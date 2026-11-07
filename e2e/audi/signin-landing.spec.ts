/// <reference lib="dom" />
// Spec 015 task 24 (FR-1, FR-5, FR-7, FR-9): the sign-in entry points in the Audi look, in both
// appearances at every width: the Keycloak sign-in page (themed, own origin) and the app-side
// entry (profile signed out, with its Sign in / Register links).
import { expect, test } from "../fixtures";
import { checkScreen, watchPage } from "./checks";
import { SCHEMES, SCREENS, widthsFor } from "./matrix";

const NAMES = ["Keycloak sign-in", "profile signed out"];
const screens = SCREENS.filter((s) => NAMES.includes(s.name));

for (const scheme of SCHEMES) {
  for (const screen of screens) {
    for (const width of widthsFor(screen)) {
      test.describe(`${scheme} ${width}px`, () => {
        test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

        test(`${screen.name}: Audi look`, async ({ page, request, keycloak }) => {
          const watch = watchPage(page);
          await screen.open(page, request, keycloak.users);
          if (screen.app !== false) {
            await expect
              .poll(() => page.evaluate(() => document.documentElement.dataset.appearance))
              .toBe(scheme);
          }
          await checkScreen(page, watch, scheme);
        });
      });
    }
  }
}

test.describe("sign-in page controls", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("FR-1: the sign-in button and fields are square", async ({ page, request, keycloak }) => {
    const screen = screens.find((s) => s.name === "Keycloak sign-in");
    if (!screen) throw new Error("no sign-in screen");
    await screen.open(page, request, keycloak.users);
    const radii = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#kc-login, #username, #password, #kc-form-login button")).map(
        (el) => getComputedStyle(el).borderTopLeftRadius,
      ),
    );
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) expect(parseFloat(r)).toBe(0);
  });
});
