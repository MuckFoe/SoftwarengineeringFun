// Spec 021 AC-26 / NFR-2: two players and a viewer connected to a Rock Paper Siege game; when a
// player makes a move that causes a fight, the result shows on all three screens within
// 1 second. Pattern of chess-latency.spec.ts: all three pages run in one browser, so
// `performance.timeOrigin + performance.now()` is a shared clock.
//
// The deal is random, so the test reads each side's front row from its own page and picks a
// column where the two front fighters carry different weapons (a decided fight, not a duel),
// re-dealing if no column qualifies. Then both fighters step forward and the first mover attacks.
import type { Page } from "@playwright/test";
import { appUrl, expect, openContexts, test } from "./fixtures";

const LIMIT_MS = 1000;
const COLS = 7;
const WEAPON = /^Your (rock|paper|scissors),/;

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/games/rps/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("grid", { name: "Rock Paper Siege board" })).toBeVisible();
}

const square = (page: Page, sq: number) => page.locator(`[data-square="${sq}"]`);

/** The weapon of each own front-row fighter, by column (null for flag, trap or empty). */
async function frontRow(page: Page, row: number): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let c = 0; c < COLS; c++) {
    const label = (await square(page, row * COLS + c).getAttribute("aria-label")) ?? "";
    out.push(WEAPON.exec(label)?.[1] ?? null);
  }
  return out;
}

/** A column where both front fighters exist and differ, so the fight is decided at once. */
async function fightColumn(a: Page, b: Page): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(square(a, 7)).toHaveAttribute("aria-label", /^Your /);
    await expect(square(b, 28)).toHaveAttribute("aria-label", /^Your /);
    const [rowA, rowB] = await Promise.all([frontRow(a, 1), frontRow(b, 4)]);
    const c = rowA.findIndex((w, i) => w !== null && rowB[i] !== null && w !== rowB[i]);
    if (c >= 0) return c;
    // A re-deal reshuffles all 12 fighters; the two home rows coming back identical is 1 in 34,650.
    const home = async () => [...(await frontRow(a, 0)), ...(await frontRow(a, 1))];
    const before = await home();
    await a.getByRole("button", { name: "Re-deal" }).click();
    await expect.poll(home).not.toEqual(before);
  }
  throw new Error("no column with two different front fighters after five deals");
}

// Browser-side (strings: this package's tsconfig has no DOM lib).
const recordClick = (sq: number) => `() => {
  window.__clicked = 0;
  document.querySelector('[data-square="${sq}"]').addEventListener(
    "click", () => { window.__clicked = performance.timeOrigin + performance.now(); }, true);
}`;

/** Record when the events region first reports the fight's result ("... beat ..."). */
const RECORD_RESULT = `() => {
  window.__arrived = 0;
  const el = document.querySelector('[role="status"][aria-label="Game events"]');
  new MutationObserver(() => {
    if (!window.__arrived && / beat /.test(el.textContent ?? ""))
      window.__arrived = performance.timeOrigin + performance.now();
  }).observe(el, { childList: true, subtree: true, characterData: true });
}`;

const isSelected = async (page: Page, sq: number) =>
  /, selected/.test((await square(page, sq).getAttribute("aria-label")) ?? "");

/** Select `frm` (a second click would deselect it) and move it to `to`. */
async function move(page: Page, frm: number, to: number): Promise<void> {
  if (!(await isSelected(page, frm))) await square(page, frm).click();
  await expect(square(page, frm)).toHaveAttribute("aria-label", /, selected/);
  await square(page, to).click();
}

test("AC-26: a fight's result reaches both players and a viewer within 1 second", async ({
  browser,
  request,
}) => {
  const created = await request.post(appUrl("/api/games/rps/sessions"));
  expect(created.status()).toBe(201);
  const invite = ((await created.json()) as { invite_id: string }).invite_id;

  const contexts = await openContexts(browser, 3);
  try {
    const [a, b, viewer] = await Promise.all(contexts.map((c) => c.newPage()));
    if (!a || !b || !viewer) throw new Error("could not open three pages");
    await join(a, invite, "Ada");
    await join(b, invite, "Bram");
    await join(viewer, invite, "Vera");

    // FR-2: joiners are seated automatically (side a, then side b).
    await expect(a.getByRole("button", { name: "Leave seat" })).toBeVisible();
    await expect(b.getByRole("button", { name: "Leave seat" })).toBeVisible();
    await a.getByRole("button", { name: "Start", exact: true }).click();

    const c = await fightColumn(a, b);
    await a.getByRole("button", { name: "Ready", exact: true }).click();
    await b.getByRole("button", { name: "Ready", exact: true }).click();
    for (const page of [a, b, viewer]) {
      await expect(page.getByRole("group", { name: "Setup controls" })).toHaveCount(0);
    }

    // Both try to select their front fighter; only the first mover's page can.
    const aFront = 7 + c;
    const bFront = 28 + c;
    await square(a, aFront).click();
    await square(b, bFront).click();
    await expect
      .poll(async () => (await isSelected(a, aFront)) !== (await isSelected(b, bFront)))
      .toBe(true);
    const aFirst = await isSelected(a, aFront);
    const [first, second] = aFirst ? [a, b] : [b, a];
    const [firstFrom, firstTo, secondFrom, secondTo] = aFirst
      ? [aFront, aFront + COLS, bFront, bFront - COLS]
      : [bFront, bFront - COLS, aFront, aFront + COLS];

    await move(first, firstFrom, firstTo);
    await expect(square(second, firstTo)).toHaveAttribute("aria-label", /^Opponent /);
    await move(second, secondFrom, secondTo);
    await expect(square(first, secondTo)).toHaveAttribute("aria-label", /^Opponent /);
    await expect(square(viewer, secondTo)).toHaveAttribute("aria-label", /^Side /);

    // The attack: first mover's fighter onto the opponent's adjacent one.
    await square(first, firstTo).click();
    await expect(square(first, firstTo)).toHaveAttribute("aria-label", /, selected/);
    await first.evaluate(`(${recordClick(secondTo)})()`);
    for (const page of [first, second, viewer]) await page.evaluate(`(${RECORD_RESULT})()`);

    await square(first, secondTo).click();

    for (const page of [first, second, viewer]) {
      await page.waitForFunction("window.__arrived > 0", null, { polling: "raf" });
    }
    const sent = (await first.evaluate("window.__clicked")) as number;
    const [seenFirst, seenSecond, seenViewer] = (await Promise.all(
      [first, second, viewer].map((p) => p.evaluate("window.__arrived")),
    )) as number[];
    expect(sent).toBeGreaterThan(0);
    const ms = (t: number | undefined) => (t ?? Number.POSITIVE_INFINITY) - sent;
    console.log(
      `AC-26: attacker ${ms(seenFirst).toFixed(1)} ms, defender ${ms(seenSecond).toFixed(1)} ms, viewer ${ms(seenViewer).toFixed(1)} ms`,
    );
    expect(ms(seenFirst)).toBeLessThan(LIMIT_MS);
    expect(ms(seenSecond)).toBeLessThan(LIMIT_MS);
    expect(ms(seenViewer)).toBeLessThan(LIMIT_MS);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
