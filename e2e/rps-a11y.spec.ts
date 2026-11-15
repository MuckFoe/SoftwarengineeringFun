/// <reference lib="dom" />
// Spec 021 AC-27 (NFR-5): on a 390 px wide screen in dark mode with reduced motion, two guests
// set up and play Rock Paper Siege with the keyboard alone: flag and trap placed from the setup
// bar, a fight, a duel picked by keyboard, then a resignation. The whole board stays visible
// without horizontal scrolling, nothing animates (LiveBadge aside), every square names side,
// kind or "hidden" and position from the reader's side, and the one polite live region carries
// the fight result, the duel and how the game ended.
// The deal is random: side B re-deals (by keyboard) until one front-row column holds different
// weapons (the fight) and another the same weapon (the duel).
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { appUrl, expect, test } from "./fixtures";

type Side = "a" | "b";
type Weapon = "rock" | "paper" | "scissors";

const COLS = 7;
const ROWS = 6;
const WIDTH = 390;
const HEIGHT = 844;

const BEATS: Record<Weapon, Weapon> = { rock: "scissors", scissors: "paper", paper: "rock" };
const other = (s: Side): Side => (s === "a" ? "b" : "a");

/** Mirrors rpsState.squareName: columns A–G, rows 1–6 from the reader's own corner. */
function squareName(square: number, bottom: Side): string {
  const row = Math.floor(square / COLS);
  const col = square % COLS;
  const r = bottom === "a" ? row : ROWS - 1 - row;
  const c = bottom === "a" ? col : COLS - 1 - col;
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

/** A side's front home row and the row just in front of it, in column `c`. */
const front = (s: Side, c: number) => (s === "a" ? 1 : 4) * COLS + c;
const ahead = (s: Side, c: number) => (s === "a" ? 2 : 3) * COLS + c;
/** The back home row, counted from the side's own left. */
const back = (s: Side, c: number) => (s === "a" ? c : 5 * COLS + (COLS - 1 - c));

const cell = (page: Page, sq: number) => page.locator(`[data-square="${sq}"]`);
const events = (page: Page) => page.getByRole("status", { name: "Game events" });

async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/games/rps/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("grid", { name: "Rock Paper Siege board" })).toBeVisible();
}

/** Focuses a control and activates it with Enter, as a keyboard user would. */
async function press(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole("button", { name, exact: typeof name === "string" }).focus();
  await page.keyboard.press("Enter");
}

/** Places flag (back-row A) and trap (back-row B) with the setup bar and Enter on the board. */
async function keyboardSetup(page: Page, side: Side): Promise<void> {
  const flag = page.getByRole("radio", { name: "Flag" });
  await expect(flag).toHaveAttribute("aria-checked", "true");
  await cell(page, back(side, 0)).focus();
  await page.keyboard.press("Enter");
  await expect(cell(page, back(side, 0))).toHaveAttribute("aria-label", "Your flag, A1");
  await flag.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Trap" })).toHaveAttribute("aria-checked", "true");
  await cell(page, back(side, 1)).focus();
  await page.keyboard.press("Enter");
  await expect(cell(page, back(side, 1))).toHaveAttribute("aria-label", "Your trap, B1");
  await expect(cell(page, back(side, 0))).toHaveAttribute("aria-label", "Your flag, A1");
}

/** The reader's own weapons on their front row, by column (0–6, absolute). */
async function frontWeapons(page: Page, side: Side): Promise<Weapon[]> {
  const out: Weapon[] = [];
  for (let c = 0; c < COLS; c++) {
    const label = (await cell(page, front(side, c)).getAttribute("aria-label")) ?? "";
    const m = /^Your (rock|paper|scissors), /.exec(label);
    if (!m) throw new Error(`front row square ${front(side, c)} holds no fighter: "${label}"`);
    out.push(m[1] as Weapon);
  }
  return out;
}

async function allLabels(page: Page): Promise<string[]> {
  return page.locator("[data-square]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
}

/** A fight column (different weapons) and a duel column (same weapon), if the deal has both. */
function columns(a: Weapon[], b: Weapon[]): { fight: number; duel: number } | null {
  const fight = a.findIndex((w, c) => w !== b[c]);
  const duel = a.findIndex((w, c) => w === b[c]);
  return fight >= 0 && duel >= 0 ? { fight, duel } : null;
}

/** One step towards the opponent (ArrowUp from either player's side), selected by Enter. */
async function keyboardStep(page: Page, from: number, to: number): Promise<void> {
  await cell(page, from).focus();
  await page.keyboard.press("Enter");
  await expect(cell(page, from)).toHaveAttribute("aria-label", /, selected/);
  await page.keyboard.press("ArrowUp");
  await expect(cell(page, to)).toBeFocused();
  await expect(cell(page, to)).toHaveAttribute("aria-label", /legal target/);
  await page.keyboard.press("Enter");
}

/** AC-27: the whole board on screen, no horizontal scroll. */
async function expectBoardFits(page: Page): Promise<void> {
  const fit = await page.evaluate(() => {
    const board = document.querySelector('[role="grid"][aria-label="Rock Paper Siege board"]');
    const r = board?.getBoundingClientRect();
    return {
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      box: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width } : null,
      innerHeight: window.innerHeight,
    };
  });
  expect(fit.scroll, "horizontal scrolling").toBeLessThanOrEqual(fit.client);
  expect(fit.box).not.toBeNull();
  const box = fit.box ?? { left: -1, right: 0, top: -1, bottom: 0, width: 0 };
  expect(box.width).toBeGreaterThan(200);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(WIDTH);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom, "board bottom inside the viewport").toBeLessThanOrEqual(fit.innerHeight);
}

/** AC-27 "nothing animates": no animation or transition runs, except LiveBadge's dot. */
async function expectNothingAnimates(page: Page): Promise<void> {
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return target?.parentElement?.textContent?.trim() !== "Live";
      })
      .map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const name =
          (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "animation";
        return `${name} on ${target?.tagName.toLowerCase() ?? "?"}.${target?.className ?? ""}`;
      }),
  );
  expect(running, "animations running under reduced motion").toEqual([]);
}

test("AC-27: narrow, dark, reduced motion; keyboard-only setup, fight and duel; names and announcements", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const created = await request.post(appUrl("/api/games/rps/sessions"));
  expect(created.status()).toBe(201);
  const invite = ((await created.json()) as { invite_id: string }).invite_id;
  const contexts = await Promise.all([newContext(browser), newContext(browser)]);
  try {
    const [pa, pb] = await Promise.all(contexts.map((c) => c.newPage()));
    if (!pa || !pb) throw new Error("could not open two pages");
    const page: Record<Side, Page> = { a: pa, b: pb };
    await join(pa, invite, "Ada");
    await join(pb, invite, "Bob");

    // Seated automatically, A then B; Start by keyboard.
    await expect(pa.getByRole("region", { name: "Seats" })).toContainText("Ada");
    await expect(pb.getByRole("region", { name: "Seats" })).toContainText("Bob");
    await expect(pa.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
    await press(pa, "Start");
    for (const s of ["a", "b"] as const) {
      await expect(page[s].getByRole("region", { name: "Setup" })).toBeVisible();
      await expectBoardFits(page[s]);
    }

    // Keyboard-only setup on both sides.
    await keyboardSetup(pa, "a");
    await keyboardSetup(pb, "b");

    // Side B re-deals by keyboard until the deal holds a fight column and a duel column.
    let cols = columns(await frontWeapons(pa, "a"), await frontWeapons(pb, "b"));
    for (let i = 0; cols === null && i < 20; i++) {
      const before = await allLabels(pb);
      await press(pb, "Re-deal");
      await expect.poll(() => allLabels(pb)).not.toEqual(before);
      cols = columns(await frontWeapons(pa, "a"), await frontWeapons(pb, "b"));
    }
    if (cols === null) throw new Error("no deal with both a fight and a duel column");
    const wa = await frontWeapons(pa, "a");
    const wb = await frontWeapons(pb, "b");
    const weapon: Record<Side, Weapon[]> = { a: wa, b: wb };

    // Accessible names: side, kind or "hidden", position, from the reader's own side.
    const c = cols.fight;
    await expect(cell(pa, front("a", c))).toHaveAttribute(
      "aria-label",
      `Your ${wa[c]}, ${squareName(front("a", c), "a")}`,
    );
    await expect(cell(pa, front("b", c))).toHaveAttribute(
      "aria-label",
      `Opponent hidden piece, ${squareName(front("b", c), "a")}`,
    );
    await expect(cell(pa, back("b", 0))).toHaveAttribute(
      "aria-label",
      `Opponent hidden piece, ${squareName(back("b", 0), "a")}`,
    );
    await expect(cell(pa, ahead("a", c))).toHaveAttribute("aria-label", `Empty, ${squareName(ahead("a", c), "a")}`);
    await expect(cell(pb, front("b", c))).toHaveAttribute(
      "aria-label",
      `Your ${wb[c]}, ${squareName(front("b", c), "b")}`,
    );
    await expect(cell(pb, front("a", c))).toHaveAttribute(
      "aria-label",
      `Opponent hidden piece, ${squareName(front("a", c), "b")}`,
    );

    await press(pa, "Ready");
    await press(pb, "Ready");
    for (const s of ["a", "b"] as const) {
      await expect(page[s].getByRole("region", { name: "Setup" })).toHaveCount(0);
      await expect(page[s].getByRole("button", { name: "Resign" })).toBeVisible();
      await expectBoardFits(page[s]);
    }

    // Who moves first is random (FR-8): only the side on move can select a fighter.
    await cell(pa, front("a", c)).focus();
    await pa.keyboard.press("Enter");
    const aFirst = /, selected/.test((await cell(pa, front("a", c)).getAttribute("aria-label")) ?? "");
    const x: Side = aFirst ? "a" : "b";
    const y = other(x);
    if (aFirst) await pa.keyboard.press("Escape");
    await expect(cell(pa, front("a", c))).not.toHaveAttribute("aria-label", /selected/);

    // The fight: X and Y advance in column c, X attacks.
    await keyboardStep(page[x], front(x, c), ahead(x, c));
    await expect(events(page[y])).toContainText(`fighter moved from ${squareName(front(x, c), y)}`);
    await keyboardStep(page[y], front(y, c), ahead(y, c));
    await expect(events(page[x])).toContainText(`fighter moved from ${squareName(front(y, c), x)}`);
    await keyboardStep(page[x], ahead(x, c), ahead(y, c));
    const [wx, wy] = [weapon[x][c] as Weapon, weapon[y][c] as Weapon];
    const winner = BEATS[wx] === wy ? x : y;
    const [winW, loseW] = winner === x ? [wx, wy] : [wy, wx];
    for (const r of ["a", "b"] as const) {
      const at = squareName(ahead(y, c), r);
      const text =
        r === winner
          ? `Your ${winW} beat the opponent's ${loseW} at ${at}.`
          : `The opponent's ${winW} beat your ${loseW} at ${at}.`;
      await expect(events(page[r])).toContainText(text);
      await expectNothingAnimates(page[r]);
    }

    // The duel: Y and X advance in column d, Y attacks a fighter with the same weapon.
    const d = cols.duel;
    const same = weapon.a[d] as Weapon;
    await keyboardStep(page[y], front(y, d), ahead(y, d));
    await expect(events(page[x])).toContainText(`fighter moved from ${squareName(front(y, d), x)}`);
    await keyboardStep(page[x], front(x, d), ahead(x, d));
    await expect(events(page[y])).toContainText(`fighter moved from ${squareName(front(x, d), y)}`);
    await keyboardStep(page[y], ahead(y, d), ahead(x, d));
    for (const r of ["a", "b"] as const) {
      await expect(events(page[r])).toContainText(
        `Duel at ${squareName(ahead(x, d), r)}: both fighters are ${same}. Pick a weapon.`,
      );
      const picker = page[r].getByRole("group", { name: "Pick a weapon" });
      await expect(picker.getByRole("button", { name: "Rock" })).toBeFocused();
      await expectBoardFits(page[r]);
    }
    // Y (the attacker) picks paper with ArrowRight + Enter; X picks rock with Enter.
    await page[y].keyboard.press("ArrowRight");
    await expect(page[y].getByRole("button", { name: "Paper" })).toBeFocused();
    await page[y].keyboard.press("Enter");
    await expect(page[y].getByRole("region", { name: "Duel" })).toContainText("You picked paper.");
    await page[x].keyboard.press("Enter");
    await expect(events(page[y])).toContainText("Your paper beat the opponent's rock and won the duel.");
    await expect(events(page[x])).toContainText("The opponent's paper beat your rock and won the duel.");
    for (const r of ["a", "b"] as const) {
      await expect(page[r].getByRole("region", { name: "Duel" })).toHaveCount(0);
      // Plan UI notes: focus goes back to the board after the duel.
      await expect(page[r].locator('[role="gridcell"]:focus')).toHaveCount(1);
      await expectNothingAnimates(page[r]);
    }

    // The game ends by keyboard: X resigns; the polite region says how it ended.
    await press(page[x], "Resign");
    await press(page[x], "Confirm");
    await expect(events(page[y])).toContainText("You won — your opponent resigned");
    await expect(events(page[x])).toContainText("You lost — you resigned");
    // Plan UI notes: one polite live region. A live region nested inside it is announced twice.
    for (const r of ["a", "b"] as const) {
      const nested = await events(page[r]).evaluate(
        (region) => region.querySelectorAll('[role="status"], [role="alert"], [aria-live]').length,
      );
      expect(nested, "live regions nested inside the Game events region").toBe(0);
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
