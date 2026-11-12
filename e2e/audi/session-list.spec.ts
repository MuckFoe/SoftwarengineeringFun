/// <reference lib="dom" />
// Spec 015 task 25 (FR-1, FR-5, FR-7, FR-9): the session list (problems library with its
// start-session rows) and "my sessions" in the Audi look, in light and dark, at 1024 and 1920.
import { expect, test } from "../fixtures";
import { checkScreen, watchPage } from "./checks";
import { SCHEMES, SCREENS, widthsFor } from "./matrix";

const names = ["problems library", "problems picker (filters)", "profile signed in (my sessions)"];
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

          // Rows are hairline-divided; badges are tonal pills (the reworked library look).
          const look = await page.evaluate(() => {
            // Narrow (stacked cards): the divider is the row's, not its cells'.
            const row = document.querySelector(
              innerWidth <= 640 ? "main tbody tr:not([class*='groupRow'])" : "main tbody tr td",
            );
            const tag = document.querySelector("main tbody [class*='tag']");
            return {
              rowBorder: row ? getComputedStyle(row).borderBottomWidth : null,
              tagRadius: tag ? getComputedStyle(tag).borderTopLeftRadius : null,
            };
          });
          expect(look.rowBorder).toBe("1px");
          if (look.tagRadius !== null) expect(look.tagRadius).not.toBe("0px");
        });
      });
    }
  }
}
