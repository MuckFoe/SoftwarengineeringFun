// Spec 005 FR7, FR8, FR9 on the local hub stand-in (scripts/check-hub.sh, HUB=1): a fresh
// deployment holds only the starter set, a redeploy and a down/up keep sessions, code and
// chat, and redeploying collab never interrupts another app on the hub.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Browser, Page } from "@playwright/test";
import {
  REPO_ROOT,
  appUrl,
  createSession,
  expect,
  openContexts,
  signIn,
  sql,
  stackCompose,
  test,
} from "./fixtures";

const run = promisify(execFile);
const HUB_URL = (process.env.HUB_URL ?? "http://localhost:18080").replace(/\/$/, "");
const STUB_PATH = process.env.HUB_STUB_PATH ?? "/stub-a/";
const STARTER_TITLES = readdirSync(path.join(REPO_ROOT, "seed/problems"))
  .map((dir) => path.join(REPO_ROOT, "seed/problems", dir, "problem.json"))
  .map((file) => (JSON.parse(readFileSync(file, "utf-8")) as { title: string }).title)
  .sort();

// Builds and restarts the stack; each test does at most a few of those.
test.describe.configure({ timeout: 10 * 60_000 });

/** `docker compose <args>` against the collab project, as the runbook's operator runs it. */
async function compose(...args: string[]): Promise<void> {
  await run("docker", [...stackCompose(), ...args], { cwd: REPO_ROOT, timeout: 8 * 60_000 });
}

/** The api has no healthcheck: wait until it answers through the hub's proxy again. */
async function apiAnswers(): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${HUB_URL}/collab/api/me`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe(200);
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
  await page.getByRole("tab", { name: "Chat" }).click();
}

const messages = (page: Page) =>
  page.getByRole("tabpanel", { name: "Chat" }).getByRole("list", { name: "Messages" });

/** A new participant joins and sees the session's code and chat as they were left. */
async function expectKept(browser: Browser, invite: string, code: string, said: string) {
  const [context] = await openContexts(browser, 1);
  if (!context) throw new Error("no browser context");
  const page = await context.newPage();
  await join(page, invite, "Later");
  await expect(page.locator(".cm-content")).toContainText(code);
  await expect(messages(page).getByText(said, { exact: true })).toBeVisible();
  await context.close();
}

test("FR9: a fresh deployment has exactly the 20 starter problems and no sessions", async ({
  browser,
  keycloak,
}) => {
  const editor = keycloak.users.editor1;
  const admin = keycloak.users.admin1;
  if (!editor || !admin) throw new Error("no keycloak test users 'editor1', 'admin1'");
  // Whatever earlier specs left behind goes: a new project, a new database volume.
  await compose("down", "-v");
  await compose("up", "-d", "--wait");
  await apiAnswers();
  expect(STARTER_TITLES).toHaveLength(20);

  const [editorContext, adminContext] = await openContexts(browser, 2);
  if (!editorContext || !adminContext) throw new Error("no browser contexts");
  const editorPage = await editorContext.newPage();
  await signIn(editorPage, editor.username, editor.password, "/");
  const listed = await editorPage.request.get(appUrl("/api/problems"));
  const problems = (await listed.json()) as Array<{ title: string; is_starter: boolean }>;
  expect(problems.map((p) => p.title).sort()).toEqual(STARTER_TITLES);
  expect(problems.every((p) => p.is_starter)).toBe(true);
  await expect(editorPage.getByRole("button", { name: /^Edit / })).toHaveCount(20);

  const adminPage = await adminContext.newPage();
  await signIn(adminPage, admin.username, admin.password, "/");
  const stale = await adminPage.request.get(appUrl("/api/sessions/stale"));
  expect(stale.status()).toBe(200);
  expect(await stale.json()).toEqual([]);
  expect(sql("select count(*) from session")).toBe("0");
  await editorContext.close();
  await adminContext.close();
});

test("FR7: a session's code and chat survive a redeploy and a down/up", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const code = "# kept across redeploys";
  const said = "still here after the redeploy";
  const [adaContext, benContext] = await openContexts(browser, 2);
  if (!adaContext || !benContext) throw new Error("no browser contexts");
  const ada = await adaContext.newPage();
  await join(ada, invite, "Ada");
  await ada.locator(".cm-content > .cm-line").first().click();
  await ada.keyboard.press("End");
  await ada.keyboard.type(`  ${code}`);
  const input = ada.getByRole("tabpanel", { name: "Chat" }).getByLabel("Message", { exact: true });
  await input.fill(said);
  await input.press("Enter");
  // Ben sees both, so the server has applied (and stored) them.
  const ben = await benContext.newPage();
  await join(ben, invite, "Ben");
  await expect(ben.locator(".cm-content")).toContainText(code);
  await expect(messages(ben).getByText(said, { exact: true })).toBeVisible();
  await adaContext.close();
  await benContext.close();

  await compose("up", "-d", "--build", "--force-recreate", "--wait");
  await apiAnswers();
  await expectKept(browser, invite, code, said);

  await compose("down");
  await compose("up", "-d", "--wait");
  await apiAnswers();
  await expectKept(browser, invite, code, said);
});

test("FR8: redeploying collab leaves another hub app answering throughout", async () => {
  const statuses: number[] = [];
  let deploying = true;
  const poller = (async () => {
    while (deploying) {
      const started = Date.now();
      try {
        statuses.push((await fetch(`${HUB_URL}${STUB_PATH}`)).status);
      } catch {
        statuses.push(0);
      }
      await new Promise((r) => setTimeout(r, Math.max(0, 200 - (Date.now() - started))));
    }
  })();

  try {
    await compose("up", "-d", "--build", "--force-recreate", "--wait");
  } finally {
    deploying = false;
    await poller;
  }
  await apiAnswers();

  console.log(`FR8: ${statuses.length} requests to ${STUB_PATH} during the redeploy`);
  expect(statuses.length).toBeGreaterThan(5);
  expect(statuses.filter((s) => s < 200 || s >= 300)).toEqual([]);
});
