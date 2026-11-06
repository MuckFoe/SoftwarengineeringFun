// Spec 014 AC-24 (FR-27, NFR-4) on the local hub stand-in (scripts/check-hub.sh, HUB=1): a
// chess game with moves and chat survives an `api` restart. Both players' open pages
// reconnect, seats, position, move list and chat are as they were, and the next move is seen
// by both.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { REPO_ROOT, appUrl, expect, openContexts, stackCompose, test } from "./fixtures";

const run = promisify(execFile);
const HUB_URL = (process.env.HUB_URL ?? "http://localhost:18080").replace(/\/$/, "");

// Restarts the stack; slow.
test.describe.configure({ timeout: 10 * 60_000 });

/** The api has no healthcheck: wait until it answers through the hub's proxy again. */
async function apiAnswers(): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${HUB_URL}/collab/api/me`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe(200);
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/games/chess/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("grid", { name: "Chess board" })).toBeVisible();
}

async function play(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

const moves = (page: Page) => page.getByRole("list", { name: "Moves" });
const chat = (page: Page) => page.getByRole("region", { name: "Chat" });
const chatMessages = (page: Page) => chat(page).getByRole("list", { name: "Messages" });

test("AC-24: a chess game with moves and chat survives an api restart and play continues", async ({
  browser,
  request,
}) => {
  const created = await request.post(appUrl("/api/games/chess/sessions"));
  expect(created.status()).toBe(201);
  const invite = ((await created.json()) as { invite_id: string }).invite_id;

  const [adaContext, benContext] = await openContexts(browser, 2);
  if (!adaContext || !benContext) throw new Error("no browser contexts");
  const ada = await adaContext.newPage();
  const ben = await benContext.newPage();
  await join(ada, invite, "Ada");
  await join(ben, invite, "Ben");

  await ada.getByRole("button", { name: /^Take seat/ }).click();
  await ben.getByRole("button", { name: /^Take seat/ }).click();
  await ada.getByRole("button", { name: "Start" }).click();

  await play(ada, "e2", "e4");
  await expect(moves(ben)).toContainText("1. e4");
  await play(ben, "e7", "e5");
  await expect(moves(ada)).toContainText("1. e4 e5");

  const said = "still here after the restart";
  const input = chat(ada).getByLabel("Message", { exact: true });
  await input.fill(said);
  await input.press("Enter");
  await expect(chatMessages(ben).getByText(said, { exact: true })).toBeVisible();

  // The restart: the same database, a new api process.
  await run("docker", [...stackCompose(), "restart", "api"], {
    cwd: REPO_ROOT,
    timeout: 8 * 60_000,
  });
  await apiAnswers();

  // Both open pages reconnect on their own and show the game as it was.
  for (const page of [ada, ben]) {
    await expect(moves(page)).toContainText("1. e4 e5", { timeout: 60_000 });
    await expect(chatMessages(page).getByText(said, { exact: true })).toBeVisible();
    await expect(page.locator('[data-square="e4"]')).toHaveAccessibleName(/white pawn/);
    await expect(page.locator('[data-square="e5"]')).toHaveAccessibleName(/black pawn/);
  }

  // Seats are kept: White can still move and the other side sees it.
  await play(ada, "g1", "f3");
  await expect(moves(ben)).toContainText("2. Nf3");
  await expect(moves(ada)).toContainText("2. Nf3");

  await adaContext.close();
  await benContext.close();
});
