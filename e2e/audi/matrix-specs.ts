/// <reference lib="dom" />
// The two matrix-driven checks every screen goes through, as functions so that a screen with
// its own global dependencies (the GIF search, which needs the fake GIPHY to itself) can run
// them from a spec in the serial project, and all others from the parallel one.
//
// Per screen and scheme the screen is opened once, at its narrowest width; the other widths are
// reached with page.setViewportSize on the same page, so a screen's login, data set-up and page
// load are paid once instead of once per width. The checks are unchanged.
import { expect, test } from "../fixtures";
import { checkScreen, watchPage } from "./checks";
import { type Screen, SCHEMES, widthsFor } from "./matrix";

const MAX_TABS = 120;

/** FR-1, FR-3, FR-6, FR-7, FR-8 (spec 015) and 016 FR-1: the shared checks, scheme x width. */
export function defineSharedChecks(screens: Screen[]): void {
  for (const scheme of SCHEMES) {
    for (const screen of screens) {
      test.describe(`${scheme}`, () => {
        const widths = widthsFor(screen);
        test.use({ colorScheme: scheme, viewport: { width: widths[0] ?? 1024, height: 800 } });

        test(`${screen.name}: shared checks at ${widths.join("px, ")}px`, async ({
          page,
          request,
          keycloak,
        }) => {
          const watch = watchPage(page);
          await screen.open(page, request, keycloak.users);
          for (const width of widths) {
            await test.step(`${width}px`, async () => {
              await page.setViewportSize({ width, height: 800 });
              if (screen.app !== false) {
                await expect
                  .poll(() => page.evaluate(() => document.documentElement.dataset.appearance))
                  .toBe(scheme);
              }
              await checkScreen(page, watch, scheme);
            });
          }
        });
      });
    }
  }
}

/** Spec 015 task 36 (Accessibility NFR): every tab stop shows a visible focus indicator. */
export function defineKeyboardSweep(screens: Screen[]): void {
  for (const scheme of SCHEMES) {
    for (const screen of screens) {
      test.describe(`keyboard sweep ${scheme}`, () => {
        test.use({ colorScheme: scheme, viewport: { width: screen.lowerBound, height: 800 } });

        test(`${screen.name}: every tab stop shows a focus indicator`, async ({
          page,
          request,
          keycloak,
        }) => {
          await screen.open(page, request, keycloak.users);
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          const missing: string[] = [];
          const seen = new Set<string>();
          let stops = 0;
          for (let i = 0; i < MAX_TABS; i++) {
            await page.keyboard.press("Tab");
            const r = await page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              if (!el || el === document.body || el === document.documentElement) return null;
              const marks = (e: Element) => {
                const s = getComputedStyle(e);
                const outline = s.outlineStyle !== "none" && Number.parseFloat(s.outlineWidth) > 0;
                return outline || (s.boxShadow !== "none" && s.boxShadow !== "");
              };
              const ok = marks(el);
              const id = `${el.tagName.toLowerCase()}#${el.id}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}]`;
              return { ok, id: `${id}.${String(el.className).slice(0, 40)}` };
            });
            if (!r) break; // focus left the document: the cycle is complete
            if (seen.has(r.id) && stops > 3) break;
            seen.add(r.id);
            stops++;
            if (!r.ok) missing.push(r.id);
          }
          expect(stops, "the screen has tab stops").toBeGreaterThan(0);
          expect(missing, "tab stops without a visible focus indicator").toEqual([]);
        });
      });
    }
  }
}
