/// <reference lib="dom" />
// Spec 015 task 31 (FR-1, FR-4, FR-5, FR-7, FR-9): hub self-registration, the Keycloak sign-up
// page (styled by keycloak-theme/collab/login, not the React app), in the Audi look in both
// appearances and at both widths, and its invalid-entry state (negative underline and message).
import { appUrl, expect, test } from "../fixtures";
import { checkScreen, watchPage } from "./checks";
import { SCHEMES } from "./matrix";

const WIDTHS = [1024, 1920];

async function openRegister(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(appUrl("/api/auth/register?next=%2F"));
  await expect(page.locator("#kc-register-form")).toBeVisible();
}

for (const scheme of SCHEMES) {
  for (const width of WIDTHS) {
    test.describe(`registration ${scheme} ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

      test("FR-5: renders in the Audi look and passes the shared checks", async ({ page }) => {
        const watch = watchPage(page);
        await openRegister(page);
        await checkScreen(page, watch, scheme);
      });

      test("FR-4: an invalid entry shows the negative underline and its message", async ({
        page,
      }) => {
        await openRegister(page);
        await page.locator("#email").fill("not-an-email");
        await page.getByRole("button", { name: "Register" }).click();
        await expect(page.locator("#kc-register-form")).toBeVisible();
        const invalid = page.locator('#kc-register-form input[aria-invalid="true"]').first();
        await expect(invalid).toBeVisible();
        const message = page.locator('#kc-register-form [id^="input-error"]').first();
        await expect(message).toBeVisible();
        await expect(message).not.toHaveText("");
        const seen = await invalid.evaluate((el) => {
          const box = el.parentElement?.closest(".pf-v5-c-form-control") ?? el;
          const s = getComputedStyle(box);
          const probe = document.createElement("span");
          probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--negative");
          document.body.append(probe);
          const negative = getComputedStyle(probe).color;
          probe.remove();
          return { underline: s.borderBottomColor, width: s.borderBottomWidth, negative };
        });
        expect(seen.underline, "underline uses --negative").toBe(seen.negative);
        expect(parseFloat(seen.width)).toBeGreaterThanOrEqual(1);
        const color = await message.evaluate((el) => getComputedStyle(el).color);
        expect(color, "message uses --negative").toBe(seen.negative);
      });
    });
  }
}
