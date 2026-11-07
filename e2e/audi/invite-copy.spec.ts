/// <reference lib="dom" />
// Spec 015 task 37 (FR-12): the Games invite flow always shows a copy-invite-link button next
// to the link, in light and dark at each width; it copies the link and confirms with a toast.
import { appUrl, expect, test } from "../fixtures";
import { SCHEMES, type Scheme } from "./matrix";

for (const scheme of SCHEMES as readonly Scheme[]) {
  for (const width of [1024, 1920]) {
    test.describe(`invite copy ${scheme} ${width}px`, () => {
      test.use({
        colorScheme: scheme,
        viewport: { width, height: 800 },
        permissions: ["clipboard-read", "clipboard-write"],
      });

      test("FR-12: copy button is visible beside the link, copies it, and toasts", async ({
        page,
        request,
      }) => {
        const created = await request.post(appUrl("/api/games/chess/sessions"));
        expect(created.status()).toBe(201);
        const { invite_id } = (await created.json()) as { invite_id: string };
        await page.goto(appUrl(`/games/chess/s/${invite_id}`));

        // Join form: visible with no interaction.
        const link = page.getByRole("textbox", { name: "Invite link", exact: true });
        const copy = page.getByRole("button", { name: "Copy invite link" });
        await expect(link).toBeVisible();
        await expect(copy).toBeVisible();
        const url = await link.inputValue();
        expect(url).toContain(`/games/chess/s/${invite_id}`);

        // Mouse.
        await copy.click();
        await expect(page.getByRole("status").filter({ hasText: "Invite link copied" })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

        // Keyboard, after joining (button stays visible in the joined view).
        await page.getByLabel("Your name").fill("Ada");
        await page.getByRole("button", { name: "Join" }).click();
        await expect(page.getByRole("button", { name: "Delete session" })).toBeVisible();
        await page.evaluate(() => navigator.clipboard.writeText("cleared"));
        await expect(copy).toBeVisible();
        await copy.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("status").filter({ hasText: "Invite link copied" })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
      });
    });
  }
}
