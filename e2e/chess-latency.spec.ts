// Spec 014 AC-29 / NFR-1: three participants connected to a game; when a player makes a
// move, the other two see it within 1 second. Pattern of latency.spec.ts: all three pages
// run in one browser, so `performance.timeOrigin + performance.now()` is a shared clock.
import type { Page } from "@playwright/test";
import { appUrl, expect, openContexts, test } from "./fixtures";

const LIMIT_MS = 1000;

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/games/chess/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("grid", { name: "Chess board" })).toBeVisible();
}

const square = (page: Page, sq: string) => page.locator(`[data-square="${sq}"]`);

// Browser-side (strings: this package's tsconfig has no DOM lib).
const RECORD_CLICK = `() => {
  window.__clicked = 0;
  document.querySelector('[data-square="e4"]').addEventListener(
    "click", () => { window.__clicked = performance.timeOrigin + performance.now(); }, true);
}`;

/** Record when e4 first shows a white pawn. */
const RECORD_ARRIVAL = `() => {
  window.__arrived = 0;
  const el = document.querySelector('[data-square="e4"]');
  new MutationObserver(() => {
    if (!window.__arrived && (el.getAttribute("aria-label") ?? "").startsWith("e4, white pawn"))
      window.__arrived = performance.timeOrigin + performance.now();
  }).observe(el, { attributes: true, attributeFilter: ["aria-label"] });
}`;

test("AC-29: a move reaches the other two participants within 1 second", async ({
  browser,
  request,
}) => {
  const created = await request.post(appUrl("/api/games/chess/sessions"));
  expect(created.status()).toBe(201);
  const invite = ((await created.json()) as { invite_id: string }).invite_id;

  const contexts = await openContexts(browser, 3);
  try {
    const [white, black, viewer] = await Promise.all(contexts.map((c) => c.newPage()));
    if (!white || !black || !viewer) throw new Error("could not open three pages");
    await join(white, invite, "Wanda");
    await join(black, invite, "Boris");
    await join(viewer, invite, "Vera");

    // FR-5: joiners are seated automatically (White, then Black).
    await expect(white.getByRole("button", { name: "Leave seat" })).toBeVisible();
    await expect(black.getByRole("button", { name: "Leave seat" })).toBeVisible();
    await white.getByRole("button", { name: "Start", exact: true }).click();
    for (const page of [white, black, viewer]) {
      await expect(square(page, "e2")).toHaveAttribute("aria-label", /^e2, white pawn/);
      await expect(page.getByRole("button", { name: "Resign" })).toBeVisible({
        visible: page !== viewer,
      });
    }

    await white.evaluate(`(${RECORD_CLICK})()`);
    await black.evaluate(`(${RECORD_ARRIVAL})()`);
    await viewer.evaluate(`(${RECORD_ARRIVAL})()`);

    await square(white, "e2").click();
    await square(white, "e4").click();

    await black.waitForFunction("window.__arrived > 0", null, { polling: "raf" });
    await viewer.waitForFunction("window.__arrived > 0", null, { polling: "raf" });

    const sent = (await white.evaluate("window.__clicked")) as number;
    const seenBlack = (await black.evaluate("window.__arrived")) as number;
    const seenViewer = (await viewer.evaluate("window.__arrived")) as number;
    expect(sent).toBeGreaterThan(0);
    console.log(
      `AC-29: opponent ${(seenBlack - sent).toFixed(1)} ms, viewer ${(seenViewer - sent).toFixed(1)} ms`,
    );
    expect(seenBlack - sent).toBeLessThan(LIMIT_MS);
    expect(seenViewer - sent).toBeLessThan(LIMIT_MS);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
