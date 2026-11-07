/// <reference lib="dom" />
// Spec 015 task 28 (FR-1, FR-5, FR-7, FR-9): the Learn area and an interactive learning
// session render in the Audi look and pass the shared checks in both appearances at every width.
import { expect, test } from "../fixtures";
import { checkScreen, watchPage } from "./checks";
import { SCHEMES, SCREENS, widthsFor } from "./matrix";

const NAMES = new Set(["learn area", "learning session"]);

for (const scheme of SCHEMES) {
  for (const screen of SCREENS.filter((s) => NAMES.has(s.name))) {
    for (const width of widthsFor(screen)) {
      test.describe(`${scheme} ${width}px`, () => {
        test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

        test(`${screen.name}: Audi look and shared checks`, async ({ page, request, keycloak }) => {
          const watch = watchPage(page);
          await screen.open(page, request, keycloak.users);
          await expect
            .poll(() => page.evaluate(() => document.documentElement.dataset.appearance))
            .toBe(scheme);
          // The dock replaced the header tabs and the Areas sidebar: the dock is the one Areas navigation.
          if (screen.name === "learn area") {
            await expect(page.getByRole("navigation", { name: "Areas" })).toHaveCount(1);
          }
          // Pill shapes are enforced by checkScreen (spec 016 FR-1); no Apple blur.
          await checkScreen(page, watch, scheme);
        });
      });
    }
  }
}

test.describe("learning session joined", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("step view and terminal pass the shared checks after joining", async ({
    page,
    request,
    keycloak,
  }) => {
    const screen = SCREENS.find((s) => s.name === "learning session");
    if (!screen) throw new Error("no learning session screen");
    const watch = watchPage(page);
    await screen.open(page, request, keycloak.users);
    await page.getByLabel("Your name").fill("Ada");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await checkScreen(page, watch, "light");
  });
});
