// Spec 017 task 16: the home screen follows other people live (FR-7, FR-3). Two browser
// contexts against the real stack. Task 14 (websocket push) was dropped, so the update comes
// from the 5 s poll: within ~8 s (poll + debounce) of the other user joining or leaving, the
// tile's count and avatars and the greeting count change with no navigation or reload.
import type { Page } from "@playwright/test";
import { appUrl, createSession, expect, signedInContext, test } from "../fixtures";

const WITHIN = 8_000;

const greetingCount = async (page: Page): Promise<number> => {
  const text = (await page.locator("[aria-live='polite']").first().textContent()) ?? "";
  const m = /(\d+) (?:people are|person is) coding/.exec(text);
  return m ? Number(m[1]) : 0;
};

test("FR-7: another user joining and leaving updates the tile and greeting without reload", async ({
  browser,
  keycloak,
}) => {
  test.setTimeout(25_000);
  const host = await signedInContext(browser, keycloak, "editor1");
  const guest = await signedInContext(browser, keycloak, "editor2");
  try {
    // The host is in a live session and watches the home screen from another page.
    const invite = await createSession(host.context.request);
    const room = host.page;
    await room.goto(appUrl(`/s/${invite}`));
    await expect(room.locator(".cm-content")).toContainText("pass");
    const home = await host.context.newPage();
    await home.goto(appUrl("/"));

    const tiles = (n: number) =>
      home.getByRole("button", { name: new RegExp(`hosted by .*, Live, ${n} people$`) });
    await expect(home.getByRole("button", { name: /Live, 1 person$/ }).first()).toBeVisible();
    const baseTwo = await tiles(2).count();
    const baseCount = await greetingCount(home);
    expect(baseCount).toBeGreaterThanOrEqual(1);

    // No navigation or reload from here on.
    let navigations = 0;
    home.on("framenavigated", () => navigations++);
    await home.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));

    // The other user joins.
    const theirs = await guest.context.newPage();
    await theirs.goto(appUrl(`/s/${invite}`));
    await expect(theirs.locator(".cm-content")).toContainText("pass");

    await expect(tiles(2)).toHaveCount(baseTwo + 1, { timeout: WITHIN });
    await expect.poll(() => greetingCount(home), { timeout: WITHIN }).toBe(baseCount + 1);
    const tile = tiles(2).first();
    await expect(tile.locator("[data-avatar]")).toHaveCount(2, { timeout: WITHIN });

    // They leave.
    await theirs.close();
    await expect(tiles(2)).toHaveCount(baseTwo, { timeout: WITHIN });
    await expect.poll(() => greetingCount(home), { timeout: WITHIN }).toBe(baseCount);

    expect(navigations).toBe(0);
    expect(
      await home.evaluate(() => (window as unknown as { __kept?: boolean }).__kept),
    ).toBe(true);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
