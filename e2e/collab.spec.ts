// FR-18, FR-19, FR-20, NFR-1: two participants, Ada and Linus, in separate browser
// contexts editing the same session's code live.
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { appUrl, createSession, expect, openContexts, test } from "./fixtures";

const PROBLEM_TITLE = "Sum Two Numbers";
const LATENCY_LIMIT_MS = 500;

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

/**
 * Browser-side: the editor's code, line by line, without remote-cursor widgets (which
 * carry participant names). A string because this package's tsconfig has no DOM lib.
 */
const READ_EDITOR = `() => Array.from(document.querySelectorAll(".cm-content > .cm-line"))
  .map((line) => {
    const copy = line.cloneNode(true);
    for (const caret of copy.querySelectorAll(".cm-ySelectionCaret")) caret.remove();
    return (copy.textContent ?? "").replaceAll("\\u2060", "");
  })
  .join("\\n")`;

async function editorText(page: Page): Promise<string> {
  return (await page.evaluate(`(${READ_EDITOR})()`)) as string;
}

/** Resolves as soon as the page's editor contains `needle`, checking every frame. */
async function editorShows(page: Page, needle: string): Promise<void> {
  await page.waitForFunction(`(${READ_EDITOR})().includes(${JSON.stringify(needle)})`, null, {
    polling: "raf",
  });
}

async function adaAndLinus(browser: Browser, request: APIRequestContext) {
  const invite = await createSession(request, PROBLEM_TITLE);
  const [adaContext, linusContext] = await openContexts(browser, 2);
  if (!adaContext || !linusContext) throw new Error("could not open two browser contexts");
  const ada = await adaContext.newPage();
  const linus = await linusContext.newPage();
  await join(ada, invite, "Ada");
  await join(linus, invite, "Linus");
  const close = async () => {
    await adaContext.close();
    await linusContext.close();
  };
  return { ada, linus, close };
}

/** Puts the caret at the end of the given 1-based line. */
async function caretAtEndOf(page: Page, line: number): Promise<void> {
  await page.locator(".cm-content > .cm-line").nth(line - 1).click();
  await page.keyboard.press("End");
}

test("FR-18 / NFR-1: Ada's typing appears in Linus's editor within 500 ms", async ({
  browser,
  request,
}) => {
  const { ada, linus, close } = await adaAndLinus(browser, request);
  try {
    await caretAtEndOf(ada, 2);
    await ada.keyboard.press("Enter");
    await ada.keyboard.type("return a + ");
    await editorShows(linus, "return a +");

    const started = Date.now();
    await ada.keyboard.type("b");
    await editorShows(linus, "return a + b");
    const elapsed = Date.now() - started;
    console.log(`FR-18 latency: ${elapsed} ms`);

    expect(elapsed).toBeLessThanOrEqual(LATENCY_LIMIT_MS);
    expect(await editorText(linus)).toContain("return a + b");
  } finally {
    await close();
  }
});

test("FR-19: simultaneous edits on different lines merge identically in both editors", async ({
  browser,
  request,
}) => {
  const { ada, linus, close } = await adaAndLinus(browser, request);
  try {
    await expect.poll(() => editorText(linus)).toBe(await editorText(ada));
    await caretAtEndOf(ada, 1);
    await caretAtEndOf(linus, 2);

    await Promise.all([
      ada.keyboard.type("  # edited by ada"),
      linus.keyboard.type("  # edited by linus"),
    ]);

    await expect
      .poll(async () => {
        const [a, l] = await Promise.all([editorText(ada), editorText(linus)]);
        return a === l && a.includes("# edited by ada") && a.includes("# edited by linus");
      })
      .toBe(true);
    const merged = await editorText(ada);
    const lines = merged.split("\n");
    expect(lines[0]).toContain("# edited by ada");
    expect(lines[1]).toContain("# edited by linus");
  } finally {
    await close();
  }
});

test("FR-20: Linus's cursor on line 3 shows Ada a marker on line 3 labelled 'Linus'", async ({
  browser,
  request,
}) => {
  const { ada, linus, close } = await adaAndLinus(browser, request);
  try {
    await linus.locator(".cm-content > .cm-line").nth(2).click();

    const lineThree = ada.locator(".cm-content > .cm-line").nth(2);
    await expect(lineThree.locator(".cm-ySelectionCaret .cm-ySelectionInfo")).toHaveText("Linus");
    await expect(
      ada.locator(".cm-content > .cm-line").filter({ has: ada.locator(".cm-ySelectionCaret") }),
    ).toHaveCount(1);
  } finally {
    await close();
  }
});
