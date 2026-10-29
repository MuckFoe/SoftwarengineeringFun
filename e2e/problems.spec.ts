// Spec 003 AC-2, FR-8, AC-4: the problem editor is a sheet over the problems window, the
// old deep links open that window with the sheet already open, and a save the server
// rejects keeps the input. Runs against the real stack as the seeded editor.
import type { Page } from "@playwright/test";
import { appPathname, appUrl, expect, signIn, test } from "./fixtures";

async function signInAsEditor(
  page: Page,
  users: Record<string, { username: string; password: string }>,
  next = "/",
): Promise<void> {
  const editor = users.editor1;
  if (!editor) throw new Error("no keycloak test user 'editor1'");
  await signIn(page, editor.username, editor.password, next);
}

/** The scroll offset of the element that scrolls the problem table. */
function listScrollTop(page: Page): Promise<number> {
  return page.locator("table").evaluate((table) => {
    let el = table.parentElement;
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
    return el ? el.scrollTop : -1;
  });
}

test("AC-2: edit opens a sheet over the list, the URL stays, closing keeps the scroll position", async ({
  page,
  keycloak,
}) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await signInAsEditor(page, keycloak.users);
  await expect(page.getByRole("row")).not.toHaveCount(1);

  // A row far enough down that the list has to scroll to show it; the offset is taken once
  // it is in view, so the click itself doesn't move the list.
  const edit = page.getByRole("button", { name: /^Edit / }).nth(12);
  await edit.scrollIntoViewIfNeeded();
  const before = await listScrollTop(page);
  expect(before).toBeGreaterThan(0);
  await edit.click();
  expect(await listScrollTop(page)).toBe(before);

  const sheet = page.locator("dialog[open]");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Edit problem" })).toBeVisible();
  expect(appPathname(page.url())).toBe("/");

  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await listScrollTop(page)).toBe(before);
});

test("FR-8: /problems/new opens the problems window with the new-problem sheet open", async ({
  page,
  keycloak,
}) => {
  await signInAsEditor(page, keycloak.users, "/problems/new");

  const sheet = page.locator("dialog[open]");
  await expect(sheet.getByRole("heading", { name: "New problem" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Problems" })).toBeAttached();
});

test("FR-8: /problems/:id/edit opens the problems window with that problem's sheet open", async ({
  page,
  keycloak,
}) => {
  await signInAsEditor(page, keycloak.users);
  const found = await page.request.get(appUrl("/api/problems?q=Sum%20Two%20Numbers"));
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === "Sum Two Numbers");
  if (!problem) throw new Error("no seeded problem titled Sum Two Numbers");

  await page.goto(appUrl(`/problems/${problem.id}/edit`));

  const sheet = page.locator("dialog[open]");
  await expect(sheet.getByRole("heading", { name: "Edit problem" })).toBeVisible();
  await expect(sheet.getByLabel("Title")).toHaveValue("Sum Two Numbers");
  await expect(page.getByRole("toolbar", { name: "Problems" })).toBeAttached();
});

test("AC-4: a save the server rejects keeps the input and shows the message beside the field", async ({
  page,
  keycloak,
}) => {
  await signInAsEditor(page, keycloak.users);
  await page.getByRole("button", { name: "New problem" }).click();
  const sheet = page.locator("dialog[open]");

  await sheet.getByLabel("Title").fill("Rejected by the server");
  await sheet.getByLabel("Signature").fill("this is not a signature");
  await sheet.getByLabel("Test 1 args").fill("[1]");
  await sheet.getByLabel("Test 1 expected").fill("1");
  const saved = page.waitForResponse(
    (res) => res.url().endsWith("/api/problems") && res.request().method() === "POST",
  );
  await sheet.getByRole("button", { name: "Create" }).click();
  expect((await saved).status()).toBe(422);

  const signature = sheet.getByLabel("Signature");
  await expect(signature).toHaveAttribute("aria-invalid", "true");
  const messageId = await signature.getAttribute("aria-describedby");
  expect(messageId).toBeTruthy();
  await expect(sheet.locator(`[id="${messageId}"]`)).toBeVisible();
  await expect(signature).toHaveValue("this is not a signature");
  await expect(sheet.getByLabel("Title")).toHaveValue("Rejected by the server");
  await expect(sheet.getByLabel("Test 1 args")).toHaveValue("[1]");
});
