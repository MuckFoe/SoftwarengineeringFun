// Spec 003 AC-17: an editor formats a new problem's description and adds an image to it
// without leaving the problem editor sheet. Runs against the real stack as the seeded editor.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function signIn(page: Page, username: string, password: string, next = "/"): Promise<void> {
  await page.goto(`/api/auth/login?next=${encodeURIComponent(next)}`);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL((url) => url.pathname === next);
}

// A 1×1 PNG; the server decides the format from these bytes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("AC-17: formatting and an image are added inside the problem editor sheet", async ({
  page,
  keycloak,
}) => {
  const editor = keycloak.users.editor1;
  if (!editor) throw new Error("no keycloak test user 'editor1'");
  await signIn(page, editor.username, editor.password);
  const pathname = new URL(page.url()).pathname;
  const sheet = page.locator("dialog[open]");
  const stillInSheet = async () => {
    await expect(sheet).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(pathname);
  };

  await page.getByRole("button", { name: "New problem" }).click();
  await stillInSheet();
  const title = `Formatted ${Date.now()}`;
  await sheet.getByLabel("Title", { exact: true }).fill(title);
  const source = sheet.getByLabel("Description", { exact: true });
  await source.fill("Add a and b.");

  await source.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 3));
  const formatting = sheet.getByRole("toolbar", { name: "Formatting" });
  await formatting.getByRole("button", { name: "Bold" }).click();
  await expect(source).toHaveValue("**Add** a and b.");
  await stillInSheet();

  await source.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(el.value.length, el.value.length);
  });
  const uploaded = page.waitForResponse(
    (res) => res.url().endsWith("/api/images") && res.request().method() === "POST",
  );
  await sheet
    .getByLabel("Image file", { exact: true })
    .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG });
  expect((await uploaded).status()).toBe(201);
  await expect(source).toHaveValue(/^\*\*Add\*\* a and b\.!\[dot\]\(\/api\/images\/[\w-]+\)$/);
  await stillInSheet();

  await sheet.getByRole("radio", { name: "Preview" }).click();
  await expect(sheet.locator("strong", { hasText: "Add" })).toBeVisible();
  await expect(sheet.getByRole("img", { name: "dot" })).toBeVisible();
  await stillInSheet();

  await sheet.getByRole("radio", { name: "Write" }).click();
  await sheet.getByLabel("Signature", { exact: true }).fill("def add(a: int, b: int) -> int");
  await sheet.getByLabel("Test 1 args", { exact: true }).fill("[1, 2]");
  await sheet.getByLabel("Test 1 expected", { exact: true }).fill("3");
  await sheet.getByRole("button", { name: "Create" }).click();
  await expect(sheet).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(pathname);
  await expect(page.getByRole("row", { name: new RegExp(title) })).toBeVisible();
});
