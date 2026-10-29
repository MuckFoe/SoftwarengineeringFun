// Spec 002 FR10, FR15, FR16, FR19: session chat between independent browsers against the
// real stack: delivery with sender and time, messages as plain text, read-only once stale
// until an admin reactivates, and an admin removing a message for everyone.
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import {
  appPathname,
  appUrl,
  createSession as createSessionOn,
  expect,
  markStale,
  openContexts,
  signIn,
  test,
} from "./fixtures";

const FIRST = "Sum Two Numbers";
/** FR10, FR19: how soon everyone sees a change. */
const WITHIN = { timeout: 1000 };

const createSession = (request: APIRequestContext) => createSessionOn(request, FIRST);

/** Joins the session (already on its page, or going there) and opens the Chat tab. */
async function joinChat(page: Page, invite: string, name: string): Promise<void> {
  if (appPathname(page.url()) !== `/s/${invite}`) await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
  await page.getByRole("tab", { name: "Chat" }).click();
}

async function participants(browser: Browser, invite: string, names: string[]): Promise<Page[]> {
  const contexts = await openContexts(browser, names.length);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (const [i, page] of pages.entries()) await joinChat(page, invite, names[i] ?? "");
  return pages;
}

const chat = (page: Page) => page.getByRole("tabpanel", { name: "Chat" });
const messageInput = (page: Page) => chat(page).getByLabel("Message", { exact: true });
const messages = (page: Page) => chat(page).getByRole("list", { name: "Messages" });

async function send(page: Page, text: string): Promise<void> {
  await messageInput(page).fill(text);
  await messageInput(page).press("Enter");
}

async function closeAll(pages: Page[]): Promise<void> {
  for (const page of pages) await page.context().close();
}

test("FR10: a message reaches the other participant within 1 second, labelled with its sender and time", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ana, ben] = await participants(browser, invite, ["Ana", "Ben"]);
  if (!ana || !ben) throw new Error("no participants");

  await send(ana, "try a hashmap");

  const group = messages(ben).getByRole("listitem").filter({ hasText: "try a hashmap" });
  await expect(group).toBeVisible(WITHIN);
  const header = group.getByRole("heading");
  await expect(header).toContainText("Ana");
  await expect(header.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await expect(header.locator("time")).toHaveText(/\d{1,2}[:.]\d{2}/);
  await closeAll([ana, ben]);
});

test("FR15: a message with markup is shown as literal text, and no dialog fires", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ana, ben] = await participants(browser, invite, ["Ana", "Ben"]);
  if (!ana || !ben) throw new Error("no participants");
  const dialogs: string[] = [];
  for (const page of [ana, ben]) page.on("dialog", (d) => dialogs.push(d.message()));

  const text = "<script>alert(1)</script> **bold** <b>x</b>";
  await send(ana, text);

  const body = messages(ben).getByText(text, { exact: true });
  await expect(body).toBeVisible();
  expect(await body.textContent()).toBe(text);
  expect(await messages(ben).locator("script, b, strong").count()).toBe(0);
  expect(dialogs).toEqual([]);
  await closeAll([ana, ben]);
});

test("FR16: a stale session shows its history read-only; after an admin reactivates, sending works", async ({
  browser,
  request,
  keycloak,
}) => {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  const invite = await createSession(request);
  const [ana] = await participants(browser, invite, ["Ana"]);
  if (!ana) throw new Error("no participant");
  await send(ana, "before it went stale");
  await expect(messages(ana).getByText("before it went stale")).toBeVisible();

  markStale(invite);
  await ana.reload();
  await expect(ana.getByText(/gone stale/i)).toBeVisible();
  await expect(messages(ana).getByText("before it went stale")).toBeVisible();
  await expect(messageInput(ana)).toBeDisabled();
  await expect(chat(ana).getByText("Messages can't be sent in a stale session.")).toBeVisible();

  const [adminContext] = await openContexts(browser, 1);
  if (!adminContext) throw new Error("no browser context");
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, admin.username, admin.password, `/s/${invite}`);
  await adminPage.getByRole("button", { name: "Reactivate" }).click();
  await expect(adminPage.getByRole("status").filter({ hasText: "Session reactivated" })).toBeVisible();

  await ana.reload();
  await joinChat(ana, invite, "Ana");
  await expect(messageInput(ana)).toBeEnabled();
  await send(ana, "and after");
  await expect(messages(ana).getByText("and after", { exact: true })).toBeVisible();
  await closeAll([ana, adminPage]);
});

test("FR19: an admin removes a message; within 1 second it is gone for everyone, and for later joiners", async ({
  browser,
  request,
  keycloak,
}) => {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  const invite = await createSession(request);
  const [ana, ben] = await participants(browser, invite, ["Ana", "Ben"]);
  if (!ana || !ben) throw new Error("no participants");
  for (const text of ["one", "abuse", "three"]) {
    await send(ben, text);
    await expect(messages(ben).getByText(text, { exact: true })).toBeVisible();
  }

  const [adminContext] = await openContexts(browser, 1);
  if (!adminContext) throw new Error("no browser context");
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, admin.username, admin.password, `/s/${invite}`);
  await joinChat(adminPage, invite, "Moderator");
  // Participants without the admin role have no Remove.
  await expect(chat(ana).getByRole("button", { name: /^Remove message/ })).toHaveCount(0);

  const abuse = messages(adminPage)
    .locator("div")
    .filter({ has: adminPage.getByText("abuse", { exact: true }) })
    .last();
  await abuse.getByRole("button", { name: /^Remove message from Ben at / }).click();

  for (const page of [ana, ben, adminPage]) {
    await expect(messages(page).getByText("abuse", { exact: true })).toHaveCount(0, WITHIN);
    await expect(messages(page).getByText("one", { exact: true })).toBeVisible();
    await expect(messages(page).getByText("three", { exact: true })).toBeVisible();
  }

  const [late] = await participants(browser, invite, ["Cy"]);
  if (!late) throw new Error("no participant");
  await expect(messages(late).getByText("one", { exact: true })).toBeVisible();
  await expect(messages(late).getByText("three", { exact: true })).toBeVisible();
  await expect(messages(late).getByText("abuse", { exact: true })).toHaveCount(0);
  await closeAll([ana, ben, adminPage, late]);
});
