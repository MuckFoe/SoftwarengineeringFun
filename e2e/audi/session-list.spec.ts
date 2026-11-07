/// <reference lib="dom" />
// Spec 015 task 25 (FR-1, FR-5, FR-7, FR-9): the session list (problems library with its
// start-session rows) and "my sessions" in the Audi look, in light and dark, at 1024 and 1920.
import { expect, test } from "../fixtures";
import { checkScreen, watchPage } from "./checks";
import { SCHEMES, SCREENS, widthsFor } from "./matrix";

const names = ["problems library", "profile signed in (my sessions)"];
const screens = SCREENS.filter((s) => names.includes(s.name));

for (const scheme of SCHEMES) {
  for (const screen of screens) {
    for (const width of widthsFor(screen)) {
      test.describe(`${scheme} ${width}px`, () => {
        test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

        test(`${screen.name}: Audi look and shared checks`, async ({ page, request, keycloak }) => {
          const watch = watchPage(page);
          await screen.open(page, request, keycloak.users);
          await expect
            .poll(() => page.evaluate(() => document.documentElement.dataset.appearance))
            .toBe(scheme);
          await checkScreen(page, watch, scheme);

          // FR-1: rows are hairline-divided, square, with no zebra fill and no old-style pill.
          const look = await page.evaluate(() => {
            const row = document.querySelector("main tbody tr td");
            const tag = document.querySelector("main [class*='tag']");
            return {
              rowBorder: row ? getComputedStyle(row).borderBottomWidth : null,
              tagRadius: tag ? getComputedStyle(tag).borderTopLeftRadius : "0px",
            };
          });
          expect(look.rowBorder).toBe("1px");
          expect(look.tagRadius).toBe("0px");
        });
      });
    }
  }
}
