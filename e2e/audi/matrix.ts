// Spec 016 task 3: the FR-9 screen list (the 015 list plus run output, GIF search, presentation
// and hub self-registration), and the scheme x width matrix the shared checks run over. The
// per-screen specs (tasks 20-25) import this.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import {
  appUrl,
  createSession,
  expect,
  fakeGiphy,
  REPO_ROOT,
  resetPreferences,
  signIn,
  workerUser,
} from "../fixtures";

export type Users = Record<string, { username: string; password: string }>;
export type Scheme = "light" | "dark";

export const SCHEMES: readonly Scheme[] = ["light", "dark"];

/** Plan §4: widths 1024 and 1920 per task; VISUAL_FULL=1 adds 1440 (the once-per-spec pass). */
export const VISUAL_FULL = process.env.VISUAL_FULL === "1";

export interface Screen {
  name: string;
  /** Narrowest supported width for this screen (audit: 1024 for every screen). */
  lowerBound: number;
  /** Keycloak pages do not carry the app's data-appearance attribute. */
  app?: boolean;
  /** Uses the fake GIPHY's global state: runs in the playwright config's "giphy" project. */
  giphy?: boolean;
  /** Also run at NARROW_WIDTH (set by the dock task, 15/16, when a screen shows the icon-only dock). */
  narrow?: boolean;
  open(page: Page, request: APIRequestContext, users: Users): Promise<void>;
}

/** Narrow layout (dock icons only, FR-16): one extra width for the screens that set `narrow`. */
export const NARROW_WIDTH = 390;

export function widthsFor(screen: Screen): number[] {
  const widths = new Set<number>([screen.lowerBound, 1920]);
  if (screen.narrow) widths.add(NARROW_WIDTH);
  if (VISUAL_FULL) widths.add(1440);
  return [...widths].sort((a, b) => a - b);
}

function user(users: Users, name: string) {
  const found = users[name];
  if (!found) throw new Error(`no keycloak test user '${name}'`);
  return found;
}

async function startLearning(request: APIRequestContext): Promise<string> {
  const created = await request.post(appUrl("/api/learn/sessions"), {
    data: { lesson_key: "01-docker/01-basics" },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

export const SCREENS: Screen[] = [
  {
    name: "problems library",
    lowerBound: 1024,
    async open(page) {
      await page.goto(appUrl("/problems"));
      await expect(page.getByRole("button", { name: /^Start session: / }).first()).toBeVisible();
    },
  },
  {
    // Spec 018 task 44: the picker with a category and a difficulty chosen (FR-10), narrow too.
    name: "problems picker (filters)",
    lowerBound: 1024,
    narrow: true,
    async open(page) {
      await page.goto(appUrl("/problems"));
      await expect(page.getByRole("button", { name: /^Start session: / }).first()).toBeVisible();
      await page.getByRole("combobox", { name: "Category" }).click();
      await page.getByRole("option", { name: "Strings" }).click();
      await page.getByRole("button", { name: "Medium", exact: true }).click();
      await expect(page.getByRole("button", { name: "Medium", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    },
  },
  {
    // Spec 017 task 17: `/` is the home screen (signed in, with a session tile).
    name: "home screen",
    lowerBound: 1024,
    async open(page, request, users) {
      const u = workerUser(users);
      const invite = await createSession(request);
      await signIn(page, u.username, u.password, `/s/${invite}`);
      await expect(page.getByRole("main").getByRole("textbox")).toContainText("pass");
      await page.goto(appUrl("/"));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
    },
  },
  {
    name: "problem editor sheet",
    lowerBound: 1024,
    async open(page, _r, users) {
      const u = user(users, "editor1");
      await signIn(page, u.username, u.password, "/problems/new");
      await expect(page.getByRole("dialog", { name: "New problem" })).toBeVisible();
    },
  },
  {
    name: "session",
    lowerBound: 1024,
    async open(page, request) {
      await page.goto(appUrl(`/s/${await createSession(request)}`));
      await page.getByLabel("Your name").fill("Ada");
      await page.getByRole("button", { name: "Join" }).click();
      await expect(page.getByLabel("Your name")).toHaveCount(0);
      await expect(page.getByRole("main").getByRole("textbox")).toContainText("pass");
    },
  },
  {
    name: "profile signed out",
    lowerBound: 1024,
    async open(page) {
      await page.goto(appUrl("/profile?from=%2F"));
      await expect(page.getByRole("link", { name: "Register" })).toBeVisible();
    },
  },
  {
    name: "profile signed in (my sessions)",
    lowerBound: 1024,
    async open(page, request, users) {
      const u = workerUser(users);
      const browser = page.context().browser();
      if (!browser) throw new Error("no browser");
      // Only this worker's account: the first sign-in then takes this browser's appearance.
      await resetPreferences(browser, u);
      const invite = await createSession(request);
      await signIn(page, u.username, u.password, `/s/${invite}`);
      await expect(page.getByRole("main").getByRole("textbox")).toContainText("pass");
      await page.goto(appUrl("/profile?from=%2F"));
      await expect(page.getByRole("region", { name: "Preferences" })).toBeVisible();
    },
  },
  {
    name: "learn area",
    lowerBound: 1024,
    async open(page) {
      await page.goto(appUrl("/learn"));
      await expect(page.getByRole("button", { name: /^Start session: / }).first()).toBeVisible();
    },
  },
  {
    name: "learning session",
    lowerBound: 1024,
    async open(page, request) {
      await page.goto(appUrl(`/learn/s/${await startLearning(request)}`));
      await expect(page.getByLabel("Your name")).toBeVisible();
    },
  },
  {
    name: "present library",
    lowerBound: 1024,
    async open(page) {
      await page.goto(appUrl("/present"));
      await expect(page.getByRole("heading", { name: "Present", level: 1 })).toBeVisible();
    },
  },
  {
    name: "games lobby",
    lowerBound: 1024,
    async open(page) {
      await page.goto(appUrl("/games"));
      await expect(page.getByRole("button", { name: "Start Chess" })).toBeVisible();
    },
  },
  {
    // Guest via invite link: no sign-in.
    name: "chess session (guest)",
    lowerBound: 1024,
    async open(page, request) {
      const created = await request.post(appUrl("/api/games/chess/sessions"));
      expect(created.status()).toBe(201);
      const invite = ((await created.json()) as { invite_id: string }).invite_id;
      await page.goto(appUrl(`/games/chess/s/${invite}`));
      await page.getByLabel("Your name").fill("Ada");
      await page.getByRole("button", { name: "Join" }).click();
      // The board exists once a game has started: a second guest takes Black, White starts.
      const browser = page.context().browser();
      if (!browser) throw new Error("no browser");
      const second = await (await browser.newContext()).newPage();
      await second.goto(appUrl(`/games/chess/s/${invite}`));
      await second.getByLabel("Your name").fill("Boris");
      await second.getByRole("button", { name: "Join" }).click();
      await expect(page.getByRole("region", { name: "Seats" })).toContainText("Boris");
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page.getByRole("grid", { name: "Chess board" })).toBeVisible();
      await expect(page.getByRole("gridcell")).toHaveCount(64);
    },
  },
  {
    name: "run output",
    lowerBound: 1024,
    async open(page, request) {
      await page.goto(appUrl(`/s/${await createSession(request)}`));
      await page.getByLabel("Your name").fill("Ada");
      await page.getByRole("button", { name: "Join" }).click();
      await expect(page.locator(".cm-content")).toContainText("pass");
      await page
        .getByRole("toolbar", { name: "Session" })
        .getByRole("button", { name: "Run", exact: true })
        .click();
      await expect(page.getByRole("region", { name: "Run results" })).toBeVisible();
    },
  },
  {
    name: "GIF search",
    lowerBound: 1024,
    giphy: true,
    async open(page, request) {
      await fakeGiphy.reset();
      await page.goto(appUrl(`/s/${await createSession(request)}`));
      await page.getByLabel("Your name").fill("Ada");
      await page.getByRole("button", { name: "Join" }).click();
      const chat = page.getByRole("region", { name: "Chat" });
      await chat.getByRole("button", { name: "GIF", exact: true }).click();
      const cont = chat.getByRole("button", { name: "Continue" });
      if (await cont.isVisible()) await cont.click();
      await chat.getByLabel("Search GIFs").fill("cat");
      await expect(chat.getByRole("option", { name: "Happy cat", exact: true })).toBeVisible();
    },
  },
  {
    name: "presentation",
    lowerBound: 1024,
    async open(page, request, users) {
      const u = user(users, "editor1");
      await signIn(page, u.username, u.password);
      const html = readFileSync(
        path.join(REPO_ROOT, "backend/tests/fixtures/presentations/single-page.html"),
        "utf-8",
      );
      const params = new URLSearchParams({ title: `Matrix stage ${Date.now()}`, topic: "Audi" });
      const added = await page.request.post(appUrl(`/api/present/presentations?${params}`), {
        data: html,
        headers: { "content-type": "text/html" },
      });
      expect(added.status()).toBe(201);
      const { id } = (await added.json()) as { id: string };
      const started = await request.post(appUrl("/api/present/sessions"), {
        data: { presentation_id: id },
      });
      expect(started.status()).toBe(201);
      const invite = ((await started.json()) as { invite_id: string }).invite_id;
      await page.goto(appUrl(`/present/s/${invite}`));
      await expect(page.locator("iframe")).toBeVisible();
    },
  },
  {
    name: "hub self-registration",
    lowerBound: 1024,
    app: false,
    async open(page) {
      await page.goto(appUrl("/api/auth/register?next=%2F"));
      await expect(page.locator("#kc-register-form")).toBeVisible();
    },
  },
  {
    name: "not found",
    lowerBound: 1024,
    async open(page) {
      await page.goto(appUrl("/nope"));
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    },
  },
  {
    name: "Keycloak sign-in",
    lowerBound: 1024,
    app: false,
    async open(page) {
      await page.goto(appUrl("/api/auth/login?next=%2F"));
      await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
    },
  },
];
