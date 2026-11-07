/// <reference lib="dom" />
// Spec 015 task 12 (FR-1, FR-3, FR-6, FR-6a, FR-7, FR-8, Accessibility NFR): the screen matrix
// {light, dark via emulateMedia} x widths, and the appearance behaviour. Written to fail
// against the current look; the screen tasks (24-33) turn it green.
import { expect, test } from "../fixtures";
import { luminance, readComputed } from "./checks";
import { SCREENS } from "./matrix";
import { defineSharedChecks } from "./matrix-specs";

defineSharedChecks(SCREENS.filter((s) => !s.giphy));

const canvas = (page: import("@playwright/test").Page) =>
  readComputed(page).then((c) => luminance(c.canvas));

test.describe("appearance (FR-6, FR-6a)", () => {
  test.use({ colorScheme: "dark", viewport: { width: 1024, height: 768 } });

  test("FR-6: system dark gives the dark canvas, and a flip follows without reload", async ({
    page,
  }) => {
    await page.goto("/games");
    await expect(page.getByRole("button", { name: "Start Chess" })).toBeVisible();
    expect(await canvas(page)).toBeLessThan(0.1);
    let navigations = 0;
    page.on("framenavigated", () => navigations++);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => canvas(page)).toBeGreaterThan(0.5);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => canvas(page)).toBeLessThan(0.1);
    expect(navigations).toBe(0);
  });

  // The toggle is the AppHeader's AppearanceToggle (task 23).
  test("FR-6a: picking light shows at once and after reload; 'system' follows again", async ({
    page,
  }) => {
    await page.goto("/games");
    const toggle = page.getByRole("button", { name: /appearance|theme/i });
    await toggle.click();
    await page.getByRole("menuitemradio", { name: /light/i }).click();
    expect(await canvas(page)).toBeGreaterThan(0.5);
    await page.reload();
    expect(await canvas(page)).toBeGreaterThan(0.5);
    await toggle.click();
    await page.getByRole("menuitemradio", { name: /system/i }).click();
    await expect.poll(() => canvas(page)).toBeLessThan(0.1);
  });

  // Spec 016 task 12 (FR-6): the floating panel is wholly inside the viewport and on top.
  test("016 FR-6: the panel lists three icon items, sits inside the viewport and on top", async ({
    page,
  }) => {
    await page.goto("/games");
    await page.getByRole("button", { name: /appearance|theme/i }).click();
    const menu = page.getByRole("menu", { name: /appearance/i });
    await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
    const m = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        inside:
          r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        onTop: hit !== null && el.contains(hit),
      };
    });
    expect(m).toEqual({ inside: true, onTop: true });
  });
});
