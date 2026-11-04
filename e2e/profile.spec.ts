// Spec 012 task 26: the profile, against the full stack with real Keycloak. FR-9 (the profile
// opens from every screen, signed in or not), FR-10 (visitors get only Sign in and Register;
// Register reaches the sign-up form), FR-11 (account info read-only, Sign out), FR-2 (the
// sessions list, most recent first, another user's session absent), FR-3 (reopening a session
// from the list), FR-4 (a stale one opens read-only) and FR-13 (hiding is per user).
// Each user is its own browser context (fixtures.ts signedInContext).
import type { APIRequestContext, Browser, BrowserContext, Locator, Page } from "@playwright/test";
import {
  appPathname,
  appUrl,
  createSession,
  expect,
  markStale,
  openContexts,
  signedInContext,
  sql,
  test,
} from "./fixtures";
import type { KeycloakState } from "./global-setup";

const PROBLEM = "Sum Two Numbers";
const LESSON_KEY = "01-docker/01-basics";

const DECK = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Deck</title></head>
<body>
  <div data-slide><h1>Slide 1</h1></div>
  <div data-slide><h1>Slide 2</h1></div>
</body>
</html>`;

// --- Locators ---------------------------------------------------------------------------------

const profileTitle = (page: Page) => page.getByRole("heading", { level: 1, name: "Profile" });
const sessionsTable = (page: Page) => page.getByRole("table", { name: "Sessions" });
/** The row of the sessions table whose title links to `href` (an app path). */
const rowFor = (page: Page, href: string) =>
  sessionsTable(page)
    .getByRole("row")
    .filter({ has: page.locator(`a[href$="${href}"]`) });
const chat = (page: Page) => page.getByRole("region", { name: "Chat" });
const messageInput = (page: Page) => chat(page).getByLabel("Message", { exact: true });
const messages = (page: Page) => chat(page).getByRole("list", { name: "Messages" });

// --- Helpers ----------------------------------------------------------------------------------

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

async function signedIn(browser: Browser, keycloak: KeycloakState, username: string) {
  const signed = await signedInContext(browser, keycloak, username);
  contexts.push(signed.context);
  return signed;
}

async function signedOut(browser: Browser): Promise<Page> {
  const [context] = await openContexts(browser, 1);
  if (!context) throw new Error("no browser context");
  contexts.push(context);
  return context.newPage();
}

async function startLearningSession(request: APIRequestContext): Promise<string> {
  const created = await request.post(appUrl("/api/learn/sessions"), {
    data: { lesson_key: LESSON_KEY },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

/** editor1 adds a small deck and starts a session on it. Returns the invite id. */
async function startPresentationSession(browser: Browser, keycloak: KeycloakState) {
  const { context } = await signedIn(browser, keycloak, "editor1");
  const query = `title=${encodeURIComponent(`Profile deck ${Date.now().toString(36)}`)}&topic=Profile`;
  const added = await context.request.post(appUrl(`/api/present/presentations?${query}`), {
    data: DECK,
    headers: { "content-type": "text/html" },
  });
  expect(added.status(), await added.text()).toBe(201);
  const { id } = (await added.json()) as { id: string };
  const started = await context.request.post(appUrl("/api/present/sessions"), {
    data: { presentation_id: id },
  });
  expect(started.status()).toBe(201);
  return ((await started.json()) as { invite_id: string }).invite_id;
}

/** A coding session page as a signed-in user: joined at once, no name sheet. */
async function openCodingSignedIn(page: Page, invite: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await expect(page.locator(".cm-content")).toContainText("pass");
  await expect(page.getByLabel("Your name")).toHaveCount(0);
}

async function openLearningSignedIn(page: Page, invite: string): Promise<void> {
  await page.goto(appUrl(`/learn/s/${invite}`));
  await expect(page.getByRole("list", { name: "Steps" })).toBeVisible();
}

async function openPresentationSignedIn(page: Page, invite: string): Promise<void> {
  await page.goto(appUrl(`/present/s/${invite}`));
  await expect(page.getByRole("list", { name: "Participants" })).toContainText("(you)");
}

async function send(page: Page, text: string): Promise<void> {
  await messageInput(page).fill(text);
  await messageInput(page).press("Enter");
  await expect(messages(page).getByText(text, { exact: true })).toBeVisible();
}

/** Sets a session's last activity, as if it had last been active `interval` ago. */
function setLastActivity(table: string, invite: string, interval: string): void {
  if (!/^[\w-]+$/.test(invite)) throw new Error(`unexpected invite id ${invite}`);
  sql(
    `update ${table} set last_activity_at = now() - interval '${interval}' where invite_id = '${invite}'`,
  );
}

/** Opens the profile from the toolbar's entry and checks it came back to `from`'s screen. */
async function openProfileFrom(page: Page, entry: string | RegExp): Promise<void> {
  const from = `${appPathname(page.url())}${new URL(page.url()).search}`;
  await page.getByRole("link", { name: entry }).first().click();
  await page.waitForURL((url) => appPathname(url) === "/profile");
  expect(new URL(page.url()).searchParams.get("from")).toBe(from);
  await expect(profileTitle(page)).toBeVisible();
}

/** Opens the profile page directly and waits for its sessions table. */
async function openProfile(page: Page): Promise<void> {
  await page.goto(appUrl("/profile"));
  await expect(sessionsTable(page)).toBeVisible();
}

async function rowIndex(page: Page, href: string): Promise<number> {
  const rows = sessionsTable(page).getByRole("row");
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    if ((await rows.nth(i).locator(`a[href$="${href}"]`).count()) > 0) return i;
  }
  return -1;
}

// --- Tests ------------------------------------------------------------------------------------

test("FR-9: signed out, the profile opens from the library, coding, learning and presentation screens", async ({
  browser,
  request,
  keycloak,
}) => {
  const coding = await createSession(request, PROBLEM);
  const learning = await startLearningSession(request);
  const presentation = await startPresentationSession(browser, keycloak);
  const page = await signedOut(browser);

  for (const path of ["/", `/s/${coding}`, `/learn/s/${learning}`, `/present/s/${presentation}`]) {
    await page.goto(appUrl(path));
    await openProfileFrom(page, "Profile");
    // Back returns to the screen it was opened from.
    await page.getByRole("link", { name: "Back" }).click();
    await page.waitForURL((url) => appPathname(url) === path);
  }
});

test("FR-9: signed in, the profile opens from the library, coding, learning and presentation screens", async ({
  browser,
  request,
  keycloak,
}) => {
  const coding = await createSession(request, PROBLEM);
  const learning = await startLearningSession(request);
  const presentation = await startPresentationSession(browser, keycloak);
  const { page } = await signedIn(browser, keycloak, "newuser");

  await page.goto(appUrl("/"));
  await openProfileFrom(page, "newuser");
  await openCodingSignedIn(page, coding);
  await openProfileFrom(page, "newuser");
  await openLearningSignedIn(page, learning);
  await openProfileFrom(page, "newuser");
  await openPresentationSignedIn(page, presentation);
  await openProfileFrom(page, "newuser");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
});

test("FR-10: signed out, the profile offers only Sign in and Register; Register reaches the sign-up form", async ({
  browser,
}) => {
  const page = await signedOut(browser);
  await page.goto(appUrl("/profile?from=%2F"));
  await expect(page.getByRole("heading", { name: "You're not signed in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register" })).toBeVisible();
  for (const heading of ["Account", "Preferences", "Sessions"]) {
    await expect(page.getByRole("heading", { name: heading })).toHaveCount(0);
  }
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("Show chat beside the description")).toHaveCount(0);

  await page.getByRole("link", { name: "Register" }).click();
  // Keycloak's registration page: its own form, with a password confirmation field.
  await expect(page.locator("#kc-register-form")).toBeVisible();
  await expect(page.locator("#password-confirm")).toBeVisible();
  // Keycloak's authorization endpoint, asked for its sign-up page (prompt=create), not sign-in.
  const url = new URL(page.url());
  expect(url.pathname).toMatch(/\/protocol\/openid-connect\/auth$/);
  expect(url.searchParams.get("prompt")).toBe("create");
  await expect(page.locator("#kc-form-login")).toHaveCount(0);
});

test("FR-11: an editor's profile shows their username and editor, read-only; Sign out signs them out", async ({
  browser,
  keycloak,
}) => {
  const { page } = await signedIn(browser, keycloak, "editor1");
  await page.goto(appUrl("/profile?from=%2F"));
  const account = page.getByRole("region", { name: "Account" });
  await expect(account.getByRole("definition").first()).toHaveText("editor1");
  await expect(account.getByRole("definition").nth(1)).toHaveText("editor");
  // Text only: nothing in the account section can be edited.
  await expect(account.getByRole("textbox")).toHaveCount(0);
  await expect(account.locator("input, select, textarea, [contenteditable=true]")).toHaveCount(0);

  await account.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "You're not signed in" })).toBeVisible();
  const me = (await (await page.request.get(appUrl("/api/me"))).json()) as { signed_in: boolean };
  expect(me.signed_in).toBe(false);
});

test("FR-2: the profile lists P1, L1, S1 most recent first with kind, title, activity and status; S2 is not listed", async ({
  browser,
  request,
  keycloak,
}) => {
  const s1 = await createSession(request, PROBLEM);
  const l1 = await startLearningSession(request);
  const p1 = await startPresentationSession(browser, keycloak);
  const s2 = await createSession(request, PROBLEM);

  // `other` uses S2; newuser never joins it.
  const other = await signedIn(browser, keycloak, "other");
  await openCodingSignedIn(other.page, s2);

  const { page } = await signedIn(browser, keycloak, "newuser");
  await openCodingSignedIn(page, s1);
  await openLearningSignedIn(page, l1);
  await openPresentationSignedIn(page, p1);
  await page.goto(appUrl("/"));
  setLastActivity("session", s1, "1 day");
  setLastActivity("learning_session", l1, "1 hour");
  setLastActivity("presentation_session", p1, "0 seconds");

  await openProfile(page);
  const p1Row = rowFor(page, `/present/s/${p1}`);
  const l1Row = rowFor(page, `/learn/s/${l1}`);
  const s1Row = rowFor(page, `/s/${s1}`);
  await expect(p1Row).toHaveCount(1);
  await expect(l1Row).toHaveCount(1);
  await expect(s1Row).toHaveCount(1);
  await expect(rowFor(page, `/s/${s2}`)).toHaveCount(0);

  const [pIndex, lIndex, sIndex] = [
    await rowIndex(page, `/present/s/${p1}`),
    await rowIndex(page, `/learn/s/${l1}`),
    await rowIndex(page, `/s/${s1}`),
  ];
  expect(pIndex).toBeGreaterThan(0);
  expect(pIndex).toBeLessThan(lIndex);
  expect(lIndex).toBeLessThan(sIndex);

  const cells = (row: Locator) => row.getByRole("cell");
  await expect(cells(p1Row).nth(0)).toHaveText("Presentation");
  await expect(cells(p1Row).nth(1)).toContainText("Profile deck");
  await expect(cells(p1Row).nth(2)).toHaveText("just now");
  await expect(cells(l1Row).nth(0)).toHaveText("Learning");
  await expect(cells(l1Row).nth(1)).not.toHaveText("");
  await expect(cells(l1Row).nth(2)).toHaveText("1 hour ago");
  await expect(cells(s1Row).nth(0)).toHaveText("Coding");
  await expect(cells(s1Row).nth(1)).toHaveText(PROBLEM);
  await expect(cells(s1Row).nth(2)).toHaveText("1 day ago");
  for (const row of [p1Row, l1Row, s1Row]) {
    await expect(row.getByText("Stale", { exact: true })).toHaveCount(0);
  }
});

test("FR-3: reopening S1 from the profile joins without a prompt, the earlier message shown as own", async ({
  browser,
  request,
  keycloak,
}) => {
  const s1 = await createSession(request, PROBLEM);
  const { context, page } = await signedIn(browser, keycloak, "newuser");
  await openCodingSignedIn(page, s1);
  await send(page, "said before leaving");
  await page.close();

  const again = await context.newPage();
  await openProfile(again);
  await rowFor(again, `/s/${s1}`).getByRole("link", { name: PROBLEM }).click();
  await again.waitForURL((url) => appPathname(url) === `/s/${s1}`);
  await expect(again.locator(".cm-content")).toContainText("pass");
  await expect(again.getByLabel("Your name")).toHaveCount(0);
  const group = messages(again).getByRole("listitem").filter({ hasText: "said before leaving" });
  await expect(group).toHaveAttribute("data-own", "true");
  await expect(group.getByRole("heading")).toContainText("You");
});

test("FR-4: a stale S1 is listed as stale and opens read-only from the profile", async ({
  browser,
  request,
  keycloak,
}) => {
  const s1 = await createSession(request, PROBLEM);
  const { page } = await signedIn(browser, keycloak, "newuser");
  await openCodingSignedIn(page, s1);
  await send(page, "before it went stale");
  await page.goto(appUrl("/"));
  markStale(s1);

  await openProfile(page);
  const row = rowFor(page, `/s/${s1}`);
  await expect(row.getByText("Stale", { exact: true })).toBeVisible();
  await row.getByRole("link", { name: PROBLEM }).click();
  await page.waitForURL((url) => appPathname(url) === `/s/${s1}`);
  await expect(page.getByText(/gone stale/i)).toBeVisible();
  await expect(messages(page).getByText("before it went stale")).toBeVisible();
  await expect(messageInput(page)).toBeDisabled();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
});

test("FR-13: newuser hiding S1 removes it from their list only; other still has it and its chat is unchanged", async ({
  browser,
  request,
  keycloak,
}) => {
  const s1 = await createSession(request, PROBLEM);
  const mine = await signedIn(browser, keycloak, "newuser");
  const theirs = await signedIn(browser, keycloak, "other");
  await openCodingSignedIn(mine.page, s1);
  await send(mine.page, "newuser was here");
  await openCodingSignedIn(theirs.page, s1);
  await mine.page.goto(appUrl("/"));
  await theirs.page.goto(appUrl("/"));

  await openProfile(mine.page);
  const row = rowFor(mine.page, `/s/${s1}`);
  await row.getByRole("button", { name: `Hide ${PROBLEM}` }).click();
  await expect(row).toHaveCount(0);
  // Still hidden after a reload: the server kept it.
  await mine.page.reload();
  await expect(mine.page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(mine.page.locator(`a[href$="/s/${s1}"]`)).toHaveCount(0);

  await openProfile(theirs.page);
  await expect(rowFor(theirs.page, `/s/${s1}`)).toHaveCount(1);
  await rowFor(theirs.page, `/s/${s1}`).getByRole("link", { name: PROBLEM }).click();
  await theirs.page.waitForURL((url) => appPathname(url) === `/s/${s1}`);
  const group = messages(theirs.page).getByRole("listitem").filter({ hasText: "newuser was here" });
  await expect(group.getByRole("heading")).toContainText("newuser");
});
