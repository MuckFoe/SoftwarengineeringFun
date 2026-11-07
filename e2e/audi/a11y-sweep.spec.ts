/// <reference lib="dom" />
// Spec 015 task 36 (Accessibility NFR): tab through every focusable element on each FR-5 screen
// and assert the focused element itself shows a visible indicator: a non-none box-shadow or
// a real outline.
import { expect, test } from "../fixtures";
import { SCHEMES, SCREENS } from "./matrix";

const MAX_TABS = 120;

for (const scheme of SCHEMES) {
  for (const screen of SCREENS) {
    test.describe(`keyboard sweep ${scheme}`, () => {
      test.use({ colorScheme: scheme, viewport: { width: screen.lowerBound, height: 800 } });

      test(`${screen.name}: every tab stop shows a focus indicator`, async ({
        page,
        request,
        keycloak,
      }) => {
        test.setTimeout(120_000);
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
