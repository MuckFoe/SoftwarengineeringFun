// Spec 021 task 31: Rock Paper Siege end to end. Each participant is a separate browser context
// (anonymous unless signed in), as in chess.spec.ts. Covers AC-1 (offered beside chess, a guest
// starts it), a game played from setup to a flag capture with two players and a viewer, AC-24
// (the home tile opens the session) and AC-25 (the jump bar lists and opens it; the dock's Games
// entry leads to the game).
//
// Fighters are dealt at random by the server (FR-4), so the board is fixed after both setups,
// between the first and the second Ready, by rewriting this game's rows in the database: the
// second Ready then starts play on that board and sends it to everyone.
import type { Browser, Page } from "@playwright/test";
import {
  appPathname,
  appUrl,
  expect,
  fixRpsBoard,
  signedInContext,
  test,
  workerUser,
} from "./fixtures";

const RPS_PATH = /^\/games\/rps\/s\/[\w-]+$/;
const square = (page: Page, sq: number) => page.locator(`[data-square="${sq}"]`);
const board = (page: Page) => page.getByRole("grid", { name: "Rock Paper Siege board" });
const seats = (page: Page) => page.getByRole("region", { name: "Seats" });
const events = (page: Page) => page.getByRole("status", { name: "Game events" });
const setup = (page: Page) => page.getByRole("region", { name: "Setup" });

async function join(page: Page, name: string): Promise<void> {
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(board(page)).toBeVisible();
}

/** Starts Rock Paper Siege from Games in a fresh guest context; returns the page and invite path. */
async function startRps(browser: Browser, name: string): Promise<{ page: Page; invite: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(appUrl("/games"));
  await page.getByRole("button", { name: "Start Rock Paper Siege" }).click();
  await page.waitForURL((url) => RPS_PATH.test(appPathname(url)));
  const invite = appPathname(page.url());
  await join(page, name);
  return { page, invite };
}

async function joinInvite(browser: Browser, invite: string, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(appUrl(invite));
  await join(page, name);
  return page;
}

async function play(page: Page, from: number, to: number): Promise<void> {
  await square(page, from).click();
  await square(page, to).click();
}

/**
 * The fixed board (squares are row * 7 + col; side A's home rows are 0-1): A's rock on 15 next
 * to B's scissors on 16, B's flag on 23 behind it, B's paper on 40 so B has a move after losing
 * the scissors; flags and traps in the corners. Side A moves first.
 */
function fixBoard(invite: string): void {
  fixRpsBoard(invite, [
    [0, "a", "flag"],
    [1, "a", "trap"],
    [15, "a", "rock"],
    [16, "b", "scissors"],
    [23, "b", "flag"],
    [40, "b", "paper"],
    [41, "b", "trap"],
  ]);
}

test("AC-1 AC-25: the Games dock entry leads to the game, listed beside chess; a guest starts it", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(appUrl("/"));
  await page.getByRole("navigation", { name: "Areas" }).getByRole("link", { name: "Games" }).click();
  await page.waitForURL((url) => appPathname(url) === "/games");
  await expect(page.getByRole("heading", { name: "Games" })).toBeVisible();

  for (const name of ["Chess", "Rock Paper Siege"]) {
    const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
    await expect(item.locator("p")).not.toBeEmpty();
    await expect(item.getByRole("button", { name: `Start ${name}` })).toBeVisible();
  }
  await page.getByRole("button", { name: "Start Rock Paper Siege" }).click();
  await page.waitForURL((url) => RPS_PATH.test(appPathname(url)));
  await join(page, "Wanda");
  await expect(seats(page)).toContainText("Wanda");
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
  await expect(page.getByText("Waiting for a second player")).toBeVisible();
  await context.close();
});

test("two guests and a viewer set up and play to a flag capture", async ({ browser }) => {
  const { page: a, invite } = await startRps(browser, "Ana");
  const b = await joinInvite(browser, invite, "Ben");
  const viewer = await joinInvite(browser, invite, "Vic");
  await expect(seats(a)).toContainText("Ben");
  await expect(seats(viewer)).toContainText("Ana");
  await expect(viewer.getByText("You are watching.")).toBeVisible();

  await a.getByRole("button", { name: "Start" }).click();
  for (const page of [a, b, viewer]) await expect(setup(page)).toBeVisible();
  // Each player sees their own 14 pieces and the other side's as hidden; the viewer sees all.
  await expect(board(a).locator('[aria-label^="Your "]')).toHaveCount(14);
  await expect(board(a).locator('[aria-label^="Opponent hidden piece"]')).toHaveCount(14);
  await expect(board(viewer).locator('[aria-label*="hidden"]')).toHaveCount(0);
  await expect(board(viewer).locator('[aria-label^="Side B "]')).toHaveCount(14);

  // Setup: side A moves its flag onto D1 (square 3) and confirms.
  await a.getByRole("radio", { name: "Flag" }).click();
  await square(a, 3).click();
  await expect(square(a, 3)).toHaveAttribute("aria-label", /^Your flag, D1/);
  await a.getByRole("button", { name: "Ready" }).click();
  await expect(setup(a)).toContainText("You are ready. Your setup is locked.");
  await expect(setup(b)).toContainText("Your opponent is ready.");
  await expect(setup(viewer)).toContainText("Side A is ready");

  fixBoard(invite);
  await b.getByRole("button", { name: "Ready" }).click();
  for (const page of [a, b, viewer]) await expect(setup(page)).toBeHidden();
  await expect(square(a, 15)).toHaveAttribute("aria-label", /^Your rock/);
  await expect(square(b, 15)).toHaveAttribute("aria-label", /^Opponent hidden piece/);
  await expect(square(viewer, 16)).toHaveAttribute("aria-label", /^Side B scissors/);

  // A's rock beats B's scissors: the survivor stands on 16, revealed to everyone.
  await play(a, 15, 16);
  await expect(square(viewer, 16)).toHaveAttribute("aria-label", /^Side A rock/);
  await expect(square(b, 16)).toHaveAttribute("aria-label", /^Opponent rock/);
  await expect(square(a, 15)).toHaveAttribute("aria-label", /^Empty/);

  await play(b, 40, 33);
  await expect(square(a, 33)).toHaveAttribute("aria-label", /^Opponent hidden piece/);

  // A takes B's flag: the game ends, worded for each reader.
  await play(a, 16, 23);
  await expect(events(a)).toContainText("You won — you captured the flag");
  await expect(events(b)).toContainText("You lost — your flag was captured");
  await expect(events(viewer)).toContainText("Side A wins — flag captured");
  for (const page of [a, b]) {
    await expect(page.getByRole("button", { name: "Resign" })).toBeHidden();
  }
});

test("AC-24 AC-25: a signed-in participant opens the session from its home tile and from the jump bar", async ({
  browser,
  keycloak,
}) => {
  const starter = `Tilda ${Math.floor(Math.random() * 1e6)}`;
  const { page: guest, invite } = await startRps(browser, starter);
  const user = workerUser(keycloak.users);
  const { context, page } = await signedInContext(browser, keycloak, user.username, invite);
  await expect(board(page)).toBeVisible();
  await expect(seats(guest).getByRole("img", { name: "signed in" })).toBeVisible();

  await page.goto(appUrl("/"));
  const tile = page
    .getByRole("main")
    .getByRole("button", { name: new RegExp(`^Rock Paper Siege, started by ${starter}, Live`) });
  await expect(tile).toBeVisible();
  await tile.click();
  await page.waitForURL((url) => appPathname(url) === invite);
  await expect(board(page)).toBeVisible();

  await page.goto(appUrl("/"));
  await page.getByRole("button", { name: "Jump to anything" }).click();
  const jump = page.getByRole("dialog", { name: "Jump to anything" });
  await jump.getByRole("combobox", { name: "Jump to" }).fill("Rock Paper Siege");
  // Sessions are listed most recent first: this one was active a moment ago.
  const option = jump.getByRole("option", { name: /Rock Paper Siege/ }).first();
  await expect(option).toBeVisible();
  await option.click();
  await page.waitForURL((url) => appPathname(url) === invite);
  await expect(board(page)).toBeVisible();
  await context.close();
  await guest.context().close();
});
