/// <reference lib="dom" />
// Spec 015 task 33 (FR-1, FR-5, FR-7, Accessibility NFR): the chess board and its squares in the
// Audi look, as a guest via the invite link, in light and dark at 1024 and 1920. Not run by the
// task agent: the batched gate runs it.
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { checkScreen, watchPage } from "./checks";
import { SCHEMES, SCREENS, widthsFor } from "./matrix";

const screen = SCREENS.find((s) => s.name === "chess session (guest)");
if (!screen) throw new Error("matrix has no chess session (guest) screen");

const BOARD = {
  light: { light: "rgb(230, 230, 230)", dark: "rgb(128, 128, 128)" },
  dark: { light: "rgb(179, 179, 179)", dark: "rgb(77, 77, 77)" },
} as const;

const bg = (page: Page, sq: string) =>
  page.locator(`[data-square="${sq}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);

for (const scheme of SCHEMES) {
  for (const width of widthsFor(screen)) {
    test.describe(`chess board ${scheme} ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

      test("renders from the board tokens and passes the shared checks", async ({
        page,
        request,
        keycloak,
      }) => {
        const watch = watchPage(page);
        await screen.open(page, request, keycloak.users);
        // a1 is dark, a2 is light.
        expect(await bg(page, "a1")).toBe(BOARD[scheme].dark);
        expect(await bg(page, "a2")).toBe(BOARD[scheme].light);
        const board = await page.getByRole("grid", { name: "Chess board" }).boundingBox();
        expect(board?.width ?? 0).toBeGreaterThan(200);
        expect(board?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((board?.x ?? 0) + (board?.width ?? 0)).toBeLessThanOrEqual(width);
        await checkScreen(page, watch, scheme);
      });
    });
  }
}
