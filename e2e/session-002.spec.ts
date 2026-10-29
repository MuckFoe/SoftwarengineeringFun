// Spec 003 AC-15, AC-16: the session window's inspector shows the problem's description
// beside the editor, with a wide image scaled to fit, and the session's chat, grouped by
// sender with a character count and read-only once stale. Runs against the real stack.
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, openContexts, test } from "./fixtures";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const FIRST = "Sum Two Numbers";

async function signIn(page: Page, username: string, password: string, next = "/"): Promise<void> {
  await page.goto(`/api/auth/login?next=${encodeURIComponent(next)}`);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL((url) => url.pathname === next);
}

/** Saves a problem with a 2400 px wide image in its description, as the signed-in editor. */
async function createProblemWithWideImage(page: Page, title: string): Promise<string> {
  return page.evaluate(async (title) => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#3478f6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png"),
    );
    const uploaded = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    if (uploaded.status !== 201) throw new Error(`upload: ${uploaded.status}`);
    const { url } = (await uploaded.json()) as { url: string };
    const created = await fetch("/api/problems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: `Add **a** and **b**.\n\n![wide diagram](${url})`,
        signature: "def add(a: int, b: int) -> int",
        tests: [{ args: [1, 2], expected: 3 }],
      }),
    });
    if (created.status !== 201) throw new Error(`create problem: ${created.status}`);
    const { id } = (await created.json()) as { id: string };
    const session = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problem_id: id }),
    });
    if (session.status !== 201) throw new Error(`create session: ${session.status}`);
    return ((await session.json()) as { invite_id: string }).invite_id;
  }, title);
}

test("AC-15: description and editor are visible together at 1280 px, the wide image scaled to fit", async ({
  page,
  browser,
  keycloak,
}) => {
  const editor = keycloak.users.editor1;
  if (!editor) throw new Error("no keycloak test user 'editor1'");
  await signIn(page, editor.username, editor.password);
  const invite = await createProblemWithWideImage(page, `Wide image ${Date.now()}`);

  // A participant, not signed in, in a separate browser.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const participant = await context.newPage();
  await participant.goto(`/s/${invite}`);
  await participant.getByLabel("Your name").fill("Ana");
  await participant.getByRole("button", { name: "Join" }).click();

  const editorArea = participant.getByRole("main").locator(".cm-content");
  const description = participant
    .getByRole("complementary", { name: "Inspector" })
    .getByRole("tabpanel", { name: "Description" });
  await expect(editorArea).toBeVisible();
  await expect(description).toContainText("Add a and b.");
  await expect(editorArea).toBeInViewport();
  await expect(description).toBeInViewport();

  // Side by side: the description doesn't cover the editor.
  const editorBox = await participant.getByRole("main").boundingBox();
  const descriptionBox = await description.boundingBox();
  if (!editorBox || !descriptionBox) throw new Error("no layout boxes");
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(descriptionBox.x + 1);

  const image = description.getByRole("img", { name: "wide diagram" });
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(2400);
  const fit = await image.evaluate((img: HTMLImageElement) => {
    const panel = img.closest('[role="tabpanel"]') as HTMLElement;
    const scroller = img.closest('[aria-label="Inspector"] > *') as HTMLElement;
    return {
      rendered: img.getBoundingClientRect().width,
      panel: panel.getBoundingClientRect().width,
      scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(fit.rendered).toBeLessThanOrEqual(fit.panel);
  expect(fit.rendered).toBeLessThan(2400);
  expect(fit.scrollerOverflow).toBeLessThanOrEqual(0);
  expect(fit.pageOverflow).toBeLessThanOrEqual(0);

  await context.close();
});

async function createSession(request: APIRequestContext): Promise<string> {
  const found = await request.get(`/api/problems?q=${encodeURIComponent(FIRST)}`);
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === FIRST);
  if (!problem) throw new Error(`no seeded problem titled ${FIRST}`);
  const created = await request.post("/api/sessions", { data: { problem_id: problem.id } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(`/s/${invite}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

/** Marks the session stale in the stack's database, as the stale-session job would. */
function markStale(invite: string): void {
  if (!/^[\w-]+$/.test(invite)) throw new Error(`unexpected invite id ${invite}`);
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.yml",
      "exec",
      "-T",
      "db",
      "sh",
      "-c",
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "update session set stale_at = now() where invite_id = '${invite}'"`,
    ],
    { cwd: REPO_ROOT, stdio: "pipe" },
  );
}

// The browser runs on this machine, so it reports this platform's modifiers.
const CHAT_SHORTCUT = process.platform === "darwin" ? "Control+Meta+c" : "Control+Alt+c";

async function say(page: Page, text: string): Promise<void> {
  const chat = page.getByRole("tabpanel", { name: "Chat" });
  const input = chat.getByLabel("Message", { exact: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(chat.getByRole("list", { name: "Messages" }).getByText(text, { exact: true })).toBeVisible();
  // Sent means the input has cleared; the list can show the message a render earlier, and a
  // Return pressed before then is ignored.
  await expect(input).toHaveValue("");
}

test("AC-16: chat is grouped by sender, counts characters, is toggled by its shortcut and is read-only once stale", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [anaContext, benContext] = await openContexts(browser, 2);
  if (!anaContext || !benContext) throw new Error("no browser contexts");
  const ana = await anaContext.newPage();
  const ben = await benContext.newPage();
  await join(ana, invite, "Ana");
  await join(ben, invite, "Ben");

  await ben.getByRole("tab", { name: "Chat" }).click();
  await say(ben, "one");
  await say(ben, "two");

  // The shortcut opens the chat on the Chat tab, and hides it again.
  const chat = ana.getByRole("tabpanel", { name: "Chat" });
  await ana.keyboard.press(CHAT_SHORTCUT);
  await expect(chat).toBeVisible();
  await ana.keyboard.press(CHAT_SHORTCUT);
  await expect(chat).toBeHidden();
  await ana.keyboard.press(CHAT_SHORTCUT);
  await expect(chat.getByText("two", { exact: true })).toBeVisible();
  await say(ana, "three");

  const groups = chat.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).getByRole("heading")).toContainText("Ben");
  await expect(groups.nth(0).getByText("one", { exact: true })).toBeVisible();
  await expect(groups.nth(0).getByText("two", { exact: true })).toBeVisible();
  await expect(groups.nth(1).getByRole("heading")).toContainText("Ana");

  const input = chat.getByLabel("Message", { exact: true });
  await expect(chat.getByText("0/2000")).toBeVisible();
  await input.pressSequentially("hello");
  await expect(chat.getByText("5/2000")).toBeVisible();

  markStale(invite);
  await ana.reload();
  await expect(ana.getByText(/gone stale/i)).toBeVisible();
  const staleChat = ana.getByRole("tabpanel", { name: "Chat" });
  await expect(staleChat.getByText("three", { exact: true })).toBeVisible();
  await expect(staleChat.getByLabel("Message", { exact: true })).toBeDisabled();
  await expect(staleChat.getByText("Messages can't be sent in a stale session.")).toBeVisible();

  await anaContext.close();
  await benContext.close();
});
