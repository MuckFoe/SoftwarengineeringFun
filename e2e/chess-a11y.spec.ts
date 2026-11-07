// Spec 014 AC-31 (NFR-5): White's player using only the keyboard selects a piece, chooses a
// destination and completes a move, including a promotion choice, and a screen reader is
// told each square's piece and the last move (accessible names and the live region).
// Black's player is a second browser that moves with the pointer.
import type { Page } from "@playwright/test";
import { appUrl, expect, openContexts, test } from "./fixtures";

const square = (page: Page, sq: string) => page.locator(`[data-square="${sq}"]`);
const announcement = (page: Page, text: RegExp) => page.getByRole("status").filter({ hasText: text });

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/games/chess/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("grid", { name: "Chess board" })).toBeVisible();
}

/** Focuses a control and activates it with Enter, as a keyboard user would. */
async function press(page: Page, name: string | RegExp): Promise<void> {
  const button = page.getByRole("button", { name });
  await button.focus();
  await page.keyboard.press("Enter");
}

/** White at the bottom: Up raises the rank, Right raises the file. */
async function keyboardMove(page: Page, from: string, to: string): Promise<void> {
  await square(page, from).focus();
  await page.keyboard.press("Enter");
  await expect(square(page, from)).toHaveAttribute("aria-label", /selected/);
  const dx = to.charCodeAt(0) - from.charCodeAt(0);
  const dy = Number(to[1]) - Number(from[1]);
  for (let i = 0; i < Math.abs(dx); i++) await page.keyboard.press(dx > 0 ? "ArrowRight" : "ArrowLeft");
  for (let i = 0; i < Math.abs(dy); i++) await page.keyboard.press(dy > 0 ? "ArrowUp" : "ArrowDown");
  await expect(square(page, to)).toBeFocused();
  await expect(square(page, to)).toHaveAttribute("aria-label", /legal move/);
  await page.keyboard.press("Enter");
}

async function pointerMove(page: Page, from: string, to: string): Promise<void> {
  await square(page, from).click();
  await square(page, to).click();
}

test("AC-31: a keyboard-only White plays to a promotion; squares and the last move are announced", async ({
  browser,
  request,
}) => {
  const created = await request.post(appUrl("api/games/chess/sessions"));
  expect(created.status()).toBe(201);
  const { invite_id } = (await created.json()) as { invite_id: string };
  const [whiteContext, blackContext] = await openContexts(browser, 2);
  if (!whiteContext || !blackContext) throw new Error("no browser contexts");
  const white = await whiteContext.newPage();
  const black = await blackContext.newPage();

  try {
    await join(white, invite_id, "Ada");
    await join(black, invite_id, "Bob");

    // Seats and Start, by keyboard.
    // FR-5: joiners are seated automatically (White, then Black).
    await expect(white.getByRole("region", { name: "Seats" })).toContainText("Ada");
    await expect(black.getByRole("region", { name: "Seats" })).toContainText("Bob");
    await expect(white.getByRole("button", { name: "Start" })).toBeEnabled();
    await press(white, "Start");
    // The starting position shows before Start (FR-3); wait for the game itself.
    await expect(white.getByRole("button", { name: "Resign" })).toBeVisible();

    // Each square's piece is in its accessible name.
    await expect(square(white, "e2")).toHaveAttribute("aria-label", "e2, white pawn");
    await expect(square(white, "e1")).toHaveAttribute("aria-label", "e1, white king");
    await expect(square(white, "d8")).toHaveAttribute("aria-label", "d8, black queen");
    await expect(square(white, "e4")).toHaveAttribute("aria-label", "e4, empty");

    // 1. h4 by keyboard; the live region and the squares report it.
    await keyboardMove(white, "h2", "h4");
    await expect(square(black, "h4")).toHaveAttribute("aria-label", /white pawn/);
    await expect(announcement(white, /White: h4/)).toBeVisible();
    await expect(square(white, "h4")).toHaveAttribute("aria-label", /white pawn.*last move/);
    await expect(square(white, "h2")).toHaveAttribute("aria-label", /empty.*last move/);

    // 1... g5, 2. hxg5 h6 3. gxh6 a6 4. h7 a5
    await pointerMove(black, "g7", "g5");
    await expect(announcement(white, /Black: g5/)).toBeVisible();
    await keyboardMove(white, "h4", "g5");
    await expect(square(black, "g5")).toHaveAttribute("aria-label", /white pawn/);
    await pointerMove(black, "h7", "h6");
    await expect(announcement(white, /Black: h6/)).toBeVisible();
    await keyboardMove(white, "g5", "h6");
    await expect(square(black, "h6")).toHaveAttribute("aria-label", /white pawn/);
    await pointerMove(black, "a7", "a6");
    await expect(announcement(white, /Black: a6/)).toBeVisible();
    await keyboardMove(white, "h6", "h7");
    await expect(square(black, "h7")).toHaveAttribute("aria-label", /white pawn/);
    await pointerMove(black, "a6", "a5");
    await expect(announcement(white, /Black: a5/)).toBeVisible();

    // 5. hxg8: the promotion choice is reachable and operable by keyboard.
    await square(white, "h7").focus();
    await page_enter(white);
    await white.keyboard.press("ArrowLeft");
    await white.keyboard.press("ArrowUp");
    await expect(square(white, "g8")).toHaveAttribute("aria-label", /black knight, legal move/);
    await page_enter(white);

    const picker = white.getByRole("group", { name: "Promote pawn to" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: "Queen" })).toBeFocused();
    await white.keyboard.press("ArrowRight");
    await expect(picker.getByRole("button", { name: "Rook" })).toBeFocused();
    await white.keyboard.press("ArrowLeft");
    await expect(picker.getByRole("button", { name: "Queen" })).toBeFocused();
    await white.keyboard.press("Enter");

    await expect(picker).toHaveCount(0);
    await expect(announcement(white, /White: hxg8=Q/)).toBeVisible();
    await expect(announcement(black, /White: hxg8=Q/)).toBeVisible();
    await expect(square(white, "g8")).toHaveAttribute("aria-label", /white queen.*last move/);
    await expect(white.getByRole("list", { name: "Moves" })).toContainText("hxg8=Q");
  } finally {
    await whiteContext.close();
    await blackContext.close();
  }
});

async function page_enter(page: Page): Promise<void> {
  await page.keyboard.press("Enter");
}
