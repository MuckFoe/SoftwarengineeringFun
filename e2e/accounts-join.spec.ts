// Spec 012 task 25: joining as an account, against the full stack with real Keycloak.
// FR-1 (no name prompt when signed in, on all three kinds of session), FR-3 (back as the same
// participant), FR-5 (a second device is the same participant; the first is told so), FR-6
// (visitors still give a name and never have to sign in), FR-7 (a returning account takes no
// second seat) and FR-8 (the *signed in* mark, only on the signed-in one of two equal names).
// "Devices" are separate browser contexts, each signed in on its own (fixtures.ts).
import type { APIRequestContext, Browser, BrowserContext, Locator, Page } from "@playwright/test";
import {
  appPathname,
  appUrl,
  createSession,
  expect,
  openContexts,
  signedInContext,
  test,
} from "./fixtures";
import type { KeycloakState } from "./global-setup";

const PROBLEM = "Sum Two Numbers";
const LESSON_KEY = "01-docker/01-basics";
const REPLACED = "This session was opened in another tab or window.";

// --- Locators ---------------------------------------------------------------------------------

const participantList = (page: Page) => page.getByRole("list", { name: "Participants" });
/** The participant list, pinning the sidebar first: a coding session starts with it unpinned. */
async function participants(page: Page) {
  const strip = page.getByRole("button", { name: "Sidebar", exact: true });
  if (await strip.isVisible()) {
    await strip.click();
    await page.getByRole("button", { name: "Pin sidebar" }).click();
  }
  return participantList(page);
}
const people = async (page: Page) => (await participants(page)).getByRole("listitem");
const chat = (page: Page) => page.getByRole("region", { name: "Chat" });
const messageInput = (page: Page) => chat(page).getByLabel("Message", { exact: true });
const messages = (page: Page) => chat(page).getByRole("list", { name: "Messages" });
/** The *signed in* mark: an icon with the accessible text "signed in" (task 6). */
const mark = (within: Locator) => within.getByText("signed in", { exact: true });
/** The chat group (sender header and its messages) that holds `text`. */
const groupWith = (page: Page, text: string) =>
  messages(page).getByRole("listitem").filter({ hasText: text });

// --- Helpers ----------------------------------------------------------------------------------

/** A device (browser context) signed in as `username`; its sign-in page is closed. */
async function device(
  browser: Browser,
  keycloak: KeycloakState,
  username: string,
): Promise<BrowserContext> {
  const { context, page } = await signedInContext(browser, keycloak, username);
  await page.close();
  return context;
}

/** A coding session page as a signed-in user: joined at once, no name sheet. */
async function openCodingSignedIn(page: Page, invite: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await expect(page.locator(".cm-content")).toContainText("pass");
  await expect(page.getByLabel("Your name")).toHaveCount(0);
}

/** A visitor's join: asked for a name, never for an account (FR-6). */
async function joinCodingAnonymously(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

async function send(page: Page, text: string): Promise<void> {
  await messageInput(page).fill(text);
  await messageInput(page).press("Enter");
  await expect(messages(page).getByText(text, { exact: true })).toBeVisible();
}

async function startLearningSession(request: APIRequestContext): Promise<string> {
  const created = await request.post(appUrl("/api/learn/sessions"), {
    data: { lesson_key: LESSON_KEY },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

async function joinLearningAnonymously(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/learn/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("list", { name: "Steps" })).toBeVisible();
}

const DECK = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Deck</title></head>
<body>
  <div data-slide><h1>Slide 1</h1></div>
  <div data-slide><h1>Slide 2</h1></div>
</body>
</html>`;

/** editor1 adds a small deck; anyone then starts a session on it. Returns the invite id. */
async function startPresentationSession(browser: Browser, keycloak: KeycloakState) {
  const context = await device(browser, keycloak, "editor1");
  try {
    const query = `title=${encodeURIComponent(`Accounts deck ${Date.now().toString(36)}`)}&topic=Accounts`;
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
  } finally {
    await context.close();
  }
}

async function closeAll(contexts: BrowserContext[]): Promise<void> {
  for (const context of contexts) await context.close();
}

// --- Tests ------------------------------------------------------------------------------------

test("FR-1: signed in, starting a coding session shows no name prompt and lists them as newuser", async ({
  browser,
  keycloak,
}) => {
  const laptop = await device(browser, keycloak, "newuser");
  const [visitorContext] = await openContexts(browser, 1);
  if (!visitorContext) throw new Error("no browser context");
  try {
    const page = await laptop.newPage();
    await page.goto(appUrl("/problems"));
    await page
      .getByRole("button", { name: `Start session: ${PROBLEM}` })
      .first()
      .click();
    await page.waitForURL((url) => /^\/s\/[\w-]+$/.test(appPathname(url)));
    await expect(page.locator(".cm-content")).toContainText("pass");
    await expect(page.getByLabel("Your name")).toHaveCount(0);
    await expect((await people(page))).toHaveCount(1);
    await expect((await people(page)).first()).toContainText("newuser");

    // In the chat too, as another participant sees it.
    const invite = appPathname(page.url()).slice("/s/".length);
    await send(page, "hello from my account");
    const visitor = await visitorContext.newPage();
    await joinCodingAnonymously(visitor, invite, "Vi");
    const group = groupWith(visitor, "hello from my account");
    await expect(group.getByRole("heading")).toContainText("newuser");
  } finally {
    await closeAll([laptop, visitorContext]);
  }
});

test("FR-1: signed in, a learning invite link joins as newuser without a prompt", async ({
  browser,
  request,
  keycloak,
}) => {
  const invite = await startLearningSession(request);
  const laptop = await device(browser, keycloak, "newuser");
  try {
    const page = await laptop.newPage();
    await page.goto(appUrl(`/learn/s/${invite}`));
    await expect(page.getByRole("list", { name: "Steps" })).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveCount(0);
    await expect((await people(page))).toHaveCount(1);
    await expect((await people(page)).first()).toContainText("newuser");
    await expect(mark((await people(page)).first())).toHaveCount(1);
  } finally {
    await laptop.close();
  }
});

test("FR-1: signed in, a presentation invite link joins as newuser without a prompt", async ({
  browser,
  keycloak,
}) => {
  const invite = await startPresentationSession(browser, keycloak);
  const laptop = await device(browser, keycloak, "newuser");
  try {
    const page = await laptop.newPage();
    await page.goto(appUrl(`/present/s/${invite}`));
    // The first to join hosts; the host carries the mark (task 21).
    await expect((await participants(page))).toContainText("newuser");
    await expect((await participants(page))).toContainText("(you)");
    await expect(page.getByLabel("Your name")).toHaveCount(0);
    await expect((await people(page))).toHaveCount(1);
    await expect(mark((await people(page)).first())).toHaveCount(1);
  } finally {
    await laptop.close();
  }
});

test("FR-3: back in S1 after closing the tab, no prompt, and the earlier message is their own", async ({
  browser,
  request,
  keycloak,
}) => {
  const invite = await createSession(request, PROBLEM);
  const laptop = await device(browser, keycloak, "newuser");
  try {
    const first = await laptop.newPage();
    await openCodingSignedIn(first, invite);
    await send(first, "remember me");
    await first.close();

    const again = await laptop.newPage();
    await openCodingSignedIn(again, invite);
    const group = groupWith(again, "remember me");
    await expect(group).toHaveAttribute("data-own", "true");
    await expect(group.getByRole("heading")).toContainText("You");
  } finally {
    await laptop.close();
  }
});

test("FR-5: opening S1 on a second device keeps one newuser; the first device is told so", async ({
  browser,
  request,
  keycloak,
}) => {
  const invite = await createSession(request, PROBLEM);
  const laptop = await device(browser, keycloak, "newuser");
  const phone = await device(browser, keycloak, "newuser");
  const [visitorContext] = await openContexts(browser, 1);
  if (!visitorContext) throw new Error("no browser context");
  try {
    const onLaptop = await laptop.newPage();
    await openCodingSignedIn(onLaptop, invite);
    const visitor = await visitorContext.newPage();
    await joinCodingAnonymously(visitor, invite, "Vi");
    await expect((await people(visitor))).toHaveCount(2);

    const onPhone = await phone.newPage();
    await openCodingSignedIn(onPhone, invite);

    for (const page of [onPhone, visitor]) {
      await expect((await people(page))).toHaveCount(2);
      await expect((await people(page)).filter({ hasText: "newuser" })).toHaveCount(1);
    }
    await expect(onLaptop.getByText(REPLACED)).toBeVisible();
    await expect(onLaptop.getByRole("button", { name: "Use here" })).toBeVisible();
    await expect(onLaptop.getByLabel("Your name")).toHaveCount(0);

    // *Use here* takes it back; the phone is told in turn, and still one newuser.
    await onLaptop.getByRole("button", { name: "Use here" }).click();
    await expect(onLaptop.locator(".cm-content")).toContainText("pass");
    await expect(onPhone.getByText(REPLACED)).toBeVisible();
    await expect((await people(visitor)).filter({ hasText: "newuser" })).toHaveCount(1);
  } finally {
    await closeAll([laptop, phone, visitorContext]);
  }
});

test("FR-6: a visitor not signed in is asked for a name and joins with it, never asked to sign in", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request, PROBLEM);
  const [visitorContext] = await openContexts(browser, 1);
  if (!visitorContext) throw new Error("no browser context");
  try {
    const page = await visitorContext.newPage();
    await page.goto(appUrl(`/s/${invite}`));
    await expect(page.getByLabel("Your name")).toBeVisible();
    // Still on the session's page: no redirect to Keycloak's sign-in.
    expect(appPathname(page.url())).toBe(`/s/${invite}`);
    await expect(page.locator("#kc-login")).toHaveCount(0);
    await page.getByLabel("Your name").fill("Visitor Vi");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.locator(".cm-content")).toContainText("pass");
    await expect((await people(page))).toHaveCount(1);
    await expect((await people(page)).first()).toContainText("Visitor Vi");
    await expect(mark((await people(page)).first())).toHaveCount(0);
    expect(appPathname(page.url())).toBe(`/s/${invite}`);
  } finally {
    await visitorContext.close();
  }
});

test("FR-7: newuser rejoining L1 from a second device takes no seat; a fifth can still join", async ({
  browser,
  request,
  keycloak,
}) => {
  const invite = await startLearningSession(request);
  const laptop = await device(browser, keycloak, "newuser");
  const phone = await device(browser, keycloak, "newuser");
  const anonymous = await openContexts(browser, 4);
  try {
    const onLaptop = await laptop.newPage();
    await onLaptop.goto(appUrl(`/learn/s/${invite}`));
    await expect(onLaptop.getByRole("list", { name: "Steps" })).toBeVisible();
    const visitors: Page[] = [];
    for (const [i, name] of ["Ada", "Bob", "Cy"].entries()) {
      const page = await (anonymous[i] as BrowserContext).newPage();
      await joinLearningAnonymously(page, invite, name);
      visitors.push(page);
    }
    await expect((await people(onLaptop))).toHaveCount(4);

    const onPhone = await phone.newPage();
    await onPhone.goto(appUrl(`/learn/s/${invite}`));
    await expect(onPhone.getByRole("list", { name: "Steps" })).toBeVisible();
    await expect(onLaptop.getByText(REPLACED)).toBeVisible();
    for (const page of [onPhone, ...visitors]) {
      await expect((await people(page))).toHaveCount(4);
      await expect((await people(page)).filter({ hasText: "newuser" })).toHaveCount(1);
    }

    const fifth = await (anonymous[3] as BrowserContext).newPage();
    await joinLearningAnonymously(fifth, invite, "Dee");
    await expect(fifth.getByText(/session is full/i)).toHaveCount(0);
    for (const page of [onPhone, fifth]) await expect((await people(page))).toHaveCount(5);
  } finally {
    await closeAll([laptop, phone, ...anonymous]);
  }
});

test("FR-8: a visitor named newuser beside signed-in newuser: only the account has the mark, in the list and on each chat message", async ({
  browser,
  request,
  keycloak,
}) => {
  const invite = await createSession(request, PROBLEM);
  const laptop = await device(browser, keycloak, "newuser");
  const [impostorContext, observerContext] = await openContexts(browser, 2);
  if (!impostorContext || !observerContext) throw new Error("no browser contexts");
  try {
    const real = await laptop.newPage();
    await openCodingSignedIn(real, invite);
    const impostor = await impostorContext.newPage();
    await joinCodingAnonymously(impostor, invite, "newuser");
    const observer = await observerContext.newPage();
    await joinCodingAnonymously(observer, invite, "Obs");

    for (const page of [real, impostor, observer]) {
      const named = (await people(page)).filter({ hasText: "newuser" });
      await expect(named).toHaveCount(2);
      await expect(mark((await participants(page)))).toHaveCount(1);
      await expect(named.filter({ has: page.getByText("signed in", { exact: true }) })).toHaveCount(
        1,
      );
    }

    // Alternating senders, so every message is its own group with its own header.
    await send(real, "first from the account");
    await send(impostor, "first from the visitor");
    await send(real, "second from the account");
    await send(impostor, "second from the visitor");

    for (const text of ["first from the account", "second from the account"]) {
      const group = groupWith(observer, text);
      await expect(group.getByRole("heading")).toContainText("newuser");
      await expect(mark(group.getByRole("heading"))).toHaveCount(1);
      // The account's own view: its messages, still marked.
      await expect(mark(groupWith(real, text).getByRole("heading"))).toHaveCount(1);
    }
    for (const text of ["first from the visitor", "second from the visitor"]) {
      const group = groupWith(observer, text);
      await expect(group.getByRole("heading")).toContainText("newuser");
      await expect(mark(group.getByRole("heading"))).toHaveCount(0);
      await expect(mark(groupWith(real, text).getByRole("heading"))).toHaveCount(0);
    }
  } finally {
    await closeAll([laptop, impostorContext, observerContext]);
  }
});
