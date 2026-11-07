// Spec 014 task 30: chess session flows end to end. Each participant is a separate browser
// context (anonymous, as in spec 001); closing a tab is page.close() and reopening is a new page
// in the same context, so the stored identity brings the same participant back (FR-28).
// Covers AC-1, AC-2, AC-4/10/16, AC-18, AC-19, AC-25, AC-22/34.
import type { Browser, Page } from "@playwright/test";
import { appPathname, appUrl, expect, test } from "./fixtures";

const square = (page: Page, sq: string) =>
	page.locator(`[data-square="${sq}"]`);
const moves = (page: Page) => page.getByRole("list", { name: "Moves" });
const seats = (page: Page) => page.getByRole("region", { name: "Seats" });

/** The square drawn first (top-left) tells which side is at the bottom: a8 white, h1 black. */
async function topLeft(page: Page): Promise<string | null> {
	return page.locator("[data-square]").first().getAttribute("data-square");
}

/** Enters the display name on the join form and waits for the board. */
async function join(page: Page, name: string): Promise<void> {
	await page.getByLabel("Your name").fill(name);
	await page.getByRole("button", { name: "Join" }).click();
	await expect(page.getByRole("grid", { name: "Chess board" })).toBeVisible();
}

/** Starts chess from Games in a fresh context; returns the page and the invite path. */
async function startChess(
	browser: Browser,
	name: string,
): Promise<{ page: Page; invite: string }> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(appUrl("/"));
	await page.getByRole("tab", { name: "Games" }).click();
	await page.getByRole("button", { name: "Start Chess" }).click();
	await page.waitForURL((url) =>
		/^\/games\/chess\/s\/[\w-]+$/.test(appPathname(url)),
	);
	const invite = appPathname(page.url());
	await join(page, name);
	return { page, invite };
}

async function joinInvite(
	browser: Browser,
	invite: string,
	name: string,
): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(appUrl(invite));
	await join(page, name);
	return page;
}

/** Plays `from` -> `to` by clicking the two squares. */
async function play(page: Page, from: string, to: string): Promise<void> {
	await square(page, from).click();
	await square(page, to).click();
}

async function setUpGame(browser: Browser) {
	const { page: white, invite } = await startChess(browser, "Wanda");
	const black = await joinInvite(browser, invite, "Boris");
	const viewer = await joinInvite(browser, invite, "Vera");
	await expect(seats(white)).toContainText("Boris");
	await white.getByRole("button", { name: "Start" }).click();
	await expect(moves(black)).toBeAttached();
	return { white, black, viewer, invite };
}

test("AC-1 AC-2: Games lists chess with its description; Start opens an unstarted board", async ({
	browser,
}) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(appUrl("/"));
	await page.getByRole("tab", { name: "Games" }).click();
	await expect(page.getByRole("heading", { name: "Games" })).toBeVisible();
	const item = page
		.getByRole("listitem")
		.filter({ has: page.getByRole("heading", { name: "Chess" }) });
	await expect(item.locator("p")).not.toBeEmpty();
	await item.getByRole("button", { name: "Start Chess" }).click();
	await page.waitForURL((url) =>
		/^\/games\/chess\/s\/[\w-]+$/.test(appPathname(url)),
	);
	await join(page, "Wanda");
	await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
	await expect(page.getByText("Waiting for a second player")).toBeVisible();
	await expect(moves(page).getByRole("listitem")).toHaveCount(0);
	await context.close();
});

test("AC-4 AC-10 AC-16 AC-18: seats, a move shown everywhere, board orientation", async ({
	browser,
}) => {
	const { white, black, viewer } = await setUpGame(browser);
	await expect(seats(viewer)).toContainText("Wanda");
	await expect(seats(viewer)).toContainText("Boris");

	// Orientation: White at the bottom for White and the viewer, Black at the bottom for Black.
	expect(await topLeft(white)).toBe("a8");
	expect(await topLeft(viewer)).toBe("a8");
	expect(await topLeft(black)).toBe("h1");
	// The viewer's flip changes only their own board.
	await viewer.getByRole("button", { name: "Flip board" }).click();
	expect(await topLeft(viewer)).toBe("h1");
	expect(await topLeft(white)).toBe("a8");
	expect(await topLeft(black)).toBe("h1");

	await play(white, "e2", "e4");
	for (const page of [white, black, viewer]) {
		await expect(square(page, "e4")).toHaveAttribute(
			"aria-label",
			/e4, white pawn.*last move/,
		);
		await expect(square(page, "e2")).toHaveAttribute(
			"aria-label",
			/e2, empty.*last move/,
		);
		await expect(moves(page)).toContainText("1. e4");
	}
});

test("AC-19: a viewer reloading after ten moves sees the full state at once", async ({
	browser,
}) => {
	const { white, black, viewer } = await setUpGame(browser);
	const line: Array<[Page, string, string, string]> = [
		[white, "e2", "e4", "1. e4"],
		[black, "e7", "e5", "1. e4 e5"],
		[white, "g1", "f3", "2. Nf3"],
		[black, "b8", "c6", "2. Nf3 Nc6"],
		[white, "f1", "c4", "3. Bc4"],
		[black, "f8", "c5", "3. Bc4 Bc5"],
		[white, "c2", "c3", "4. c3"],
		[black, "g8", "f6", "4. c3 Nf6"],
		[white, "d2", "d4", "5. d4"],
		[black, "e5", "d4", "5. d4 exd4"],
	];
	for (const [page, from, to, shown] of line) {
		await play(page, from, to);
		await expect(moves(viewer)).toContainText(shown);
	}
	await viewer.reload();
	await expect(moves(viewer)).toContainText("5. d4 exd4");
	await expect(moves(viewer).getByRole("listitem")).toHaveCount(5);
	await expect(square(viewer, "d4")).toHaveAttribute(
		"aria-label",
		/d4, black pawn/,
	);
	await expect(square(viewer, "e1")).toHaveAttribute(
		"aria-label",
		/e1, white king/,
	);
});

test("AC-25: a player closing their page shows as away; reopening resumes play", async ({
	browser,
}) => {
	const { white, black, viewer } = await setUpGame(browser);
	const blackContext = black.context();
	const blackUrl = black.url();
	await black.close();
	await expect(seats(white)).toContainText("away");
	await expect(seats(viewer)).toContainText("away");

	const back = await blackContext.newPage();
	await back.goto(blackUrl);
	await expect(back.getByRole("grid", { name: "Chess board" })).toBeVisible();
	await expect(seats(white)).not.toContainText("away");

	await play(white, "e2", "e4");
	await expect(moves(back)).toContainText("1. e4");
	await play(back, "e7", "e5");
	await expect(moves(white)).toContainText("1. e4 e5");
	await expect(moves(viewer)).toContainText("1. e4 e5");
});

test("AC-22 AC-34: resigning ends the game, closes the session, and the invite is gone", async ({
	browser,
}) => {
	const { white, black, viewer, invite } = await setUpGame(browser);
	await play(white, "e2", "e4");
	await expect(moves(black)).toContainText("1. e4");

	await black.getByRole("button", { name: "Resign" }).click();
	await black.getByRole("button", { name: "Confirm" }).click();

	for (const page of [white, black, viewer]) {
		const closed = page.getByRole("dialog", { name: "Session closed" });
		await expect(closed).toBeVisible();
		await expect(closed).toContainText("White wins — resignation");
	}

	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(appUrl(invite));
	await expect(page.getByText("This session no longer exists")).toBeVisible();
	await context.close();
});
