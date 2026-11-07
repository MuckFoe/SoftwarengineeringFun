// Spec 011: run with your own input, in a real browser against the real stack. Two browser
// contexts share one session; solutions are typed through the editor (as the session specs do).
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { appUrl, createSession, expect, markStale, test } from "./fixtures";

const PROBLEM_TITLE = "Sum Two Numbers";

interface Participant {
  context: BrowserContext;
  page: Page;
}

async function join(browser: Browser, invite: string, name: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
  await page.getByRole("button", { name: "Show own-input run" }).click();
  return { context, page };
}

/** Replaces the editor's text with `code` (lines separated by \n). */
async function setSolution(page: Page, code: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  const lines = code.split("\n");
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.insertText(line);
  }
}

const panel = (page: Page) => page.getByRole("region", { name: "Run with your own input" });
const runButton = (page: Page) => panel(page).getByRole("button", { name: "Run", exact: true });
const status = (page: Page) => panel(page).getByRole("status");
const output = (page: Page) => panel(page).getByTestId("scratch-output");

async function twoParticipants(
  browser: Browser,
  request: Parameters<typeof createSession>[0],
): Promise<{ a: Participant; b: Participant; invite: string }> {
  const invite = await createSession(request, PROBLEM_TITLE);
  const a = await join(browser, invite, "A");
  const b = await join(browser, invite, "B");
  return { a, b, invite };
}

test("FR-5, FR-10: B sees A's run and 'started by A'; the last run survives A's reload", async ({
  browser,
  request,
}) => {
  const { a, b } = await twoParticipants(browser, request);
  await setSolution(a.page, "print(int(input()) + int(input()))");
  await panel(a.page).getByLabel("Input").fill("3\n4\n");
  await runButton(a.page).click();

  for (const p of [a, b]) {
    await expect(status(p.page)).toHaveText("finished · started by A");
    await expect(output(p.page)).toHaveText("7\n");
  }

  await a.page.reload();
  await a.page.getByLabel("Your name").fill("A");
  await a.page.getByRole("button", { name: "Join" }).click();
  await a.page.getByRole("button", { name: "Show own-input run" }).click();
  await expect(status(a.page)).toHaveText("finished · started by A");
  await expect(output(a.page)).toHaveText("7\n");
  await a.context.close();
  await b.context.close();
});

test("FR-9: while A's run is in progress B's Run is disabled and names A; then both can run", async ({
  browser,
  request,
}) => {
  const { a, b } = await twoParticipants(browser, request);
  await setSolution(a.page, "import time\nprint('hi', flush=True)\ntime.sleep(2)");
  await runButton(a.page).click();

  await expect(status(b.page)).toHaveText("running… · started by A");
  await expect(runButton(b.page)).toBeDisabled();
  await expect(panel(b.page)).toContainText("A");

  await expect(status(b.page)).toHaveText("finished · started by A", { timeout: 20_000 });
  await expect(runButton(b.page)).toBeEnabled();
  await expect(runButton(a.page)).toBeEnabled();

  await runButton(b.page).click();
  await expect(status(a.page)).toHaveText("finished · started by B");
  await a.context.close();
  await b.context.close();
});

test("FR-4: finished, error and stopped: time limit are shown", async ({ browser, request }) => {
  const invite = await createSession(request, PROBLEM_TITLE);
  const a = await join(browser, invite, "A");
  const cases: Array<[string, string]> = [
    ["print('ok')", "finished · started by A"],
    ["raise RuntimeError('boom')", "error · started by A"],
    ["while True:\n    pass", "stopped: time limit · started by A"],
  ];
  for (const [code, expected] of cases) {
    await setSolution(a.page, code);
    await runButton(a.page).click();
    await expect(status(a.page)).toHaveText(expected, { timeout: 15_000 });
    await expect(runButton(a.page)).toBeEnabled();
  }
  await a.context.close();
});

test("FR-3: an error is shown apart from stdout, visibly marked, with the message", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request, PROBLEM_TITLE);
  const a = await join(browser, invite, "A");
  await setSolution(a.page, "print('before')\nraise ValueError('bad')");
  await runButton(a.page).click();

  await expect(status(a.page)).toHaveText("error · started by A");
  const out = output(a.page).locator('[data-stream="out"]');
  const err = output(a.page).locator('[data-stream="err"]');
  await expect(out).toContainText("before");
  await expect(err).toContainText("ValueError: bad");
  await expect(err).toContainText("stderr ▸");
  await expect(out).not.toContainText("ValueError");
  const colours = await Promise.all(
    [out, err].map((l) => l.first().evaluate((el) => getComputedStyle(el).color)),
  );
  expect(colours[0]).not.toBe(colours[1]);
  await a.context.close();
});

test("NFR-4: markup and escape sequences are shown literally", async ({ browser, request }) => {
  const invite = await createSession(request, PROBLEM_TITLE);
  const a = await join(browser, invite, "A");
  await setSolution(a.page, "print('<b>x</b>')\nprint('\\x1b[31mred')");
  await runButton(a.page).click();

  await expect(status(a.page)).toHaveText("finished · started by A");
  await expect(output(a.page)).toContainText("<b>x</b>");
  await expect(output(a.page).locator("b")).toHaveCount(0);
  // The escape character is made visible, not interpreted.
  const text = (await output(a.page).textContent()) ?? "";
  expect(text).not.toContain("\u001b");
  expect(text).toContain("[31mred");
  await a.context.close();
});

test("NFR-5: a printed line reaches B within 1 s of reaching A, before the run ends", async ({
  browser,
  request,
}) => {
  const { a, b } = await twoParticipants(browser, request);
  await setSolution(a.page, "import time\nprint('tick', flush=True)\ntime.sleep(2.5)");
  const seen = (p: Page) =>
    p
      .waitForFunction(
        () =>
          document.querySelector('[data-testid="scratch-output"]')?.textContent?.includes("tick")
            ? Date.now()
            : false,
        undefined,
        { polling: 20, timeout: 15_000 },
      )
      .then((h) => h.jsonValue() as Promise<number>);
  const both = Promise.all([seen(a.page), seen(b.page)]);
  await runButton(a.page).click();
  const [onA, onB] = await both;

  expect(onB - onA).toBeLessThan(1000);
  await expect(status(b.page)).toHaveText("running… · started by A");
  await expect(status(b.page)).toHaveText("finished · started by A");
  await a.context.close();
  await b.context.close();
});

test("FR-12: a stale session has no own-input Run control", async ({ browser, request }) => {
  const invite = await createSession(request, PROBLEM_TITLE);
  const a = await join(browser, invite, "A");
  markStale(invite);
  await a.page.reload();

  await expect(a.page.getByText(/gone stale/i)).toBeVisible();
  await expect(a.page.getByRole("region", { name: "Run with your own input" })).toHaveCount(0);
  await expect(a.page.getByRole("button", { name: /own-input run/ })).toHaveCount(0);
  // The only Run left is the toolbar's test run, disabled (spec 003); no own-input Run exists.
  await expect(a.page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await expect(a.page.getByLabel("Input", { exact: true })).toHaveCount(0);
  await a.context.close();
});
