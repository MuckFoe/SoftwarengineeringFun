// Spec 010: Tab inserts at the cursor, accepts an open suggestion, and Esc then Tab
// leaves the editor. Real keypresses in a real editor; FR-7 across two browsers.
import type { Page } from "@playwright/test";
import { appUrl, createSession, expect, openContexts, test } from "./fixtures";

const PROBLEM_TITLE = "Sum Two Numbers";

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

/** Replaces the editor's text with `text` and leaves the caret at its end. */
async function resetEditor(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

const NBSP_FREE = (s: string | null) => (s ?? "").replaceAll(" ", " ");

test("FR-1: Tab at the end of a line adds 4 spaces there", async ({ page, request }) => {
  await join(page, await createSession(request, PROBLEM_TITLE), "Ada");
  await resetEditor(page, "x = 1");

  await page.keyboard.press("Tab");

  const line = page.locator(".cm-content > .cm-line").first();
  await expect.poll(async () => NBSP_FREE(await line.textContent())).toBe("x = 1    ");
  // The cursor is after the spaces: typing continues there.
  await page.keyboard.type("#");
  await expect.poll(async () => NBSP_FREE(await line.textContent())).toBe("x = 1    #");
});

test("FR-2: Tab accepts an open suggestion and inserts nothing else", async ({
  page,
  request,
}) => {
  await join(page, await createSession(request, PROBLEM_TITLE), "Ada");
  const line = page.locator(".cm-content > .cm-line").first();
  // Under load the suggestion list can close between "visible" and the keypress (a remote
  // update re-renders the editor); then Tab rightly inserts spaces, so the attempt repeats.
  await expect(async () => {
    await resetEditor(page, "");
    await page.keyboard.type("pri");
    const option = page.locator(".cm-tooltip-autocomplete [role=option]", { hasText: "print" });
    await expect(option.first()).toBeVisible({ timeout: 2_000 });

    await page.keyboard.press("Tab");

    await expect(page.locator(".cm-tooltip-autocomplete")).toBeHidden({ timeout: 2_000 });
    expect(NBSP_FREE(await line.textContent())).toMatch(/^print\S*$/);
  }).toPass({ timeout: 15_000 });
});

test("FR-5: Esc then Tab moves focus out of the editor and leaves the text alone", async ({
  page,
  request,
}) => {
  await join(page, await createSession(request, PROBLEM_TITLE), "Ada");
  await page.locator(".cm-content").click();
  const before = await page.locator(".cm-content").textContent();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");

  expect(
    await page.evaluate(`!document.activeElement?.closest(".cm-editor")`),
  ).toBe(true);
  expect(await page.locator(".cm-content").textContent()).toBe(before);
});

test("FR-7: the other participant sees the 4 spaces", async ({ browser, request }) => {
  const invite = await createSession(request, PROBLEM_TITLE);
  const [adaContext, linusContext] = await openContexts(browser, 2);
  if (!adaContext || !linusContext) throw new Error("could not open two browser contexts");
  try {
    const ada = await adaContext.newPage();
    const linus = await linusContext.newPage();
    await join(ada, invite, "Ada");
    await join(linus, invite, "Linus");
    await resetEditor(ada, "x = 1");
    await expect
      .poll(async () => NBSP_FREE(await linus.locator(".cm-content > .cm-line").first().textContent()))
      .toContain("x = 1");

    await ada.keyboard.press("Tab");

    await expect
      .poll(async () =>
        NBSP_FREE(await linus.locator(".cm-content > .cm-line").first().textContent()),
      )
      .toContain("x = 1    ");
  } finally {
    await adaContext.close();
    await linusContext.close();
  }
});
