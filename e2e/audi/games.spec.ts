/// <reference lib="dom" />
// Spec 015 task 32 (FR-1, FR-4, FR-5, FR-7, FR-9): the Games lobby and the chess invite flow
// (guest joining by invite link, seats, controls, confirm dialog) in the Audi look, both
// appearances, at each width. The board, pieces and clocks are task 33's chess.spec.ts.
import { appUrl, expect, test } from "../fixtures";
import { checkScreen, watchPage } from "./checks";
import { SCHEMES, SCREENS, type Scheme, widthsFor } from "./matrix";

const lobby = SCREENS.find((s) => s.name === "games lobby");
const guest = SCREENS.find((s) => s.name === "chess session (guest)");
if (!lobby || !guest) throw new Error("matrix lacks the games screens");

for (const scheme of SCHEMES as readonly Scheme[]) {
  for (const screen of [lobby, guest]) {
    for (const width of widthsFor(screen)) {
      test.describe(`games ${scheme} ${width}px`, () => {
        test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

        test(`${screen.name}: FR-5 renders in the Audi look and passes the FR-1 check`, async ({
          page,
          request,
          keycloak,
        }) => {
          const watch = watchPage(page);
          await screen.open(page, request, keycloak.users);
          await checkScreen(page, watch, scheme);
        });
      });
    }
  }
}

for (const scheme of SCHEMES as readonly Scheme[]) {
  test.describe(`games join form and dialog ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1024, height: 800 } });

    test("FR-5: the guest join form (invite link) passes the shared checks", async ({
      page,
      request,
    }) => {
      const created = await request.post(appUrl("/api/games/chess/sessions"));
      expect(created.status()).toBe(201);
      const { invite_id } = (await created.json()) as { invite_id: string };
      const watch = watchPage(page);
      await page.goto(appUrl(`/games/chess/s/${invite_id}`));
      await expect(page.getByLabel("Your name")).toBeVisible();
      await checkScreen(page, watch, scheme);
    });

    test("FR-4: the delete confirmation follows the Audi dialog", async ({ page, request }) => {
      const created = await request.post(appUrl("/api/games/chess/sessions"));
      const { invite_id } = (await created.json()) as { invite_id: string };
      const watch = watchPage(page);
      await page.goto(appUrl(`/games/chess/s/${invite_id}`));
      await page.getByLabel("Your name").fill("Ada");
      await page.getByRole("button", { name: "Join" }).click();
      await expect(page.getByRole("button", { name: "Delete session" })).toBeVisible();
      await page.getByRole("button", { name: "Delete session" }).click();
      const dialog = page.getByRole("dialog", { name: "Delete session?" });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("0px");
      await checkScreen(page, watch, scheme);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  });
}
