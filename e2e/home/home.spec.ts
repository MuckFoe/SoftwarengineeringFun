// Spec 017 task 15: the home screen in a real browser against the real stack. FR-4 (inert
// preview), FR-5 (click, Enter and Space open a tile), FR-8 (nothing of a session the viewer
// may not open), FR-9 (375 px), FR-11 (chess invitee) and the Accessibility section
// (reading-order tabbing, visible focus, role/name).
import type { Browser, Page } from "@playwright/test";
import {
  appPathname,
  appUrl,
  createSession,
  expect,
  signedInContext,
  test,
} from "../fixtures";
import type { KeycloakState } from "../global-setup";

const tiles = (page: Page) => page.getByRole("main").locator("li > button");
const SESSION_PATH = /^\/s\/[\w-]+$/;

/** A signed-in context whose user has joined a coding session (so it is a tile on `/`). */
async function withSession(browser: Browser, keycloak: KeycloakState, username: string) {
  const { context, page } = await signedInContext(browser, keycloak, username);
  const invite = await createSession(context.request);
  await page.goto(appUrl(`/s/${invite}`));
  await expect(page.locator(".cm-content")).toContainText("pass");
  await page.goto(appUrl("/"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return { context, page, invite };
}

test("FR-5: a tile opens its session by click, by Enter and by Space", async ({
  browser,
  keycloak,
}) => {
  const { context, page } = await withSession(browser, keycloak, "plain1");
  const tile = () => tiles(page).filter({ hasText: "Sum Two Numbers" }).first();
  for (const how of ["click", "Enter", "Space"] as const) {
    await page.goto(appUrl("/"));
    await expect(tile()).toBeVisible();
    if (how === "click") await tile().click();
    else {
      await tile().focus();
      await page.keyboard.press(how === "Space" ? " " : "Enter");
    }
    await page.waitForURL((url) => SESSION_PATH.test(appPathname(url)));
  }
  await context.close();
});

test("Accessibility, FR-4: Tab visits every tile in reading order, with focus shown and a name; the preview is skipped", async ({
  browser,
  keycloak,
}) => {
  const { context, page, invite } = await withSession(browser, keycloak, "plain1");
  // Keep the session open in a second tab so its tile is live (and may carry a preview).
  const second = await context.newPage();
  await second.goto(appUrl(`/s/${invite}`));
  await expect(second.locator(".cm-content")).toContainText("pass");
  await page.bringToFront();
  await page.reload();
  const live = tiles(page).filter({ hasText: "Live" }).first();
  await expect(live).toBeVisible();
  await expect(live).toHaveAccessibleName(/^Sum Two Numbers, hosted by .+, Live, \d+ (person|people)$/);

  const n = await tiles(page).count();
  expect(n).toBeGreaterThan(1);
  const expected = await tiles(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim() ?? ""),
  );
  await page.locator("body").click({ position: { x: 0, y: 0 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const visited: string[] = [];
  for (let i = 0; i < 40 && visited.length < n; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const inTile = el.matches("main li > button");
      const cs = getComputedStyle(el);
      return {
        inTile,
        tag: el.tagName,
        inPreview: !!el.closest("pre, [aria-hidden='true']"),
        name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
        outlined: cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) > 0,
        shadow: cs.boxShadow !== "none",
      };
    });
    expect(info?.inPreview ?? false).toBe(false);
    if (info?.inTile) {
      expect(info.outlined || info.shadow).toBe(true);
      visited.push(info.name);
    }
  }
  expect(visited).toEqual(expected);
  expect(expected.some((name) => /Live, \d+ (person|people)$/.test(name))).toBe(true);
  await context.close();
});

test("FR-9: at 375 px the tiles stack, Start session is first and nothing scrolls sideways", async ({
  browser,
  keycloak,
}) => {
  const { context, page } = await withSession(browser, keycloak, "plain1");
  await createSession(context.request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  const columns = async () =>
    page.evaluate(() => {
      const xs = [...document.querySelectorAll("main li > button")].map((e) =>
        Math.round(e.getBoundingClientRect().left),
      );
      return new Set(xs).size;
    });
  await expect(tiles(page).first()).toBeVisible();
  const wide = await columns();

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(tiles(page).first()).toBeVisible();
  await expect(tiles(page).first()).toHaveAccessibleName("Start session");
  const narrow = await columns();
  expect(narrow).toBeLessThan(wide);
  expect(narrow).toBe(1);
  const tops = await tiles(page).evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().top),
  );
  expect(tops[0]).toBe(Math.min(...tops));
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(overflow.sw).toBeLessThanOrEqual(overflow.cw);
  await context.close();
});

test("FR-8: nothing of a session the viewer may not open appears, in the page or the response", async ({
  browser,
  keycloak,
}) => {
  const owner = await withSession(browser, keycloak, "editor2");
  const { context, page } = await signedInContext(browser, keycloak, "plain1", "/");
  const body = new Promise<string>((resolve) => {
    page.on("response", async (r) => {
      if (new URL(r.url()).pathname.endsWith("/api/home")) resolve(await r.text());
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const json = await body;
  expect(json).not.toContain(owner.invite);
  expect(await page.content()).not.toContain(owner.invite);
  const names = await tiles(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? ""),
  );
  expect(names.join("|")).not.toContain("editor2");
  const mine = (await (await owner.context.request.get(appUrl("/api/home"))).json()) as {
    sessions: Array<{ id: string; invite_id: string }>;
  };
  const id = mine.sessions.find((t) => t.invite_id === owner.invite)?.id;
  expect(id).toBeTruthy();
  const preview = await page.request.get(appUrl(`/api/home/preview/${id}`));
  expect(preview.status()).toBe(404);
  await context.close();
  await owner.context.close();
});

test("FR-11: a chess invitee sees only their game tile and its board", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(appUrl("/games"));
  await page.getByRole("button", { name: "Start Chess" }).click();
  await page.waitForURL((url) => /^\/games\/chess\/s\/[\w-]+$/.test(appPathname(url)));
  await page.getByLabel("Your name").fill("Ivy");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("grid", { name: "Chess board" })).toBeVisible();

  await page.goto(appUrl("/"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(tiles(page)).toHaveCount(2);
  await expect(tiles(page).first()).toHaveAccessibleName("Start session");
  const game = tiles(page).nth(1);
  await expect(game).toHaveAccessibleName(/^Chess, /);
  await expect(game.locator("[data-square], svg, img").first()).toBeAttached();
  await game.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => /^\/games\/chess\/s\/[\w-]+$/.test(appPathname(url)));
  await context.close();
});
