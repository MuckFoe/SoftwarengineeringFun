// Spec 015 task 12: the FR-5 screen list (notes.md audit (a)), and the scheme x width matrix
// the shared checks run over. Screen tasks 24-33 add their own spec files that import this.
import type { APIRequestContext, Page } from "@playwright/test";
import { appUrl, createSession, expect, signIn, sql } from "../fixtures";

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
  open(page: Page, request: APIRequestContext, users: Users): Promise<void>;
}

export function widthsFor(screen: Screen): number[] {
  const widths = new Set<number>([screen.lowerBound, 1920]);
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
      await page.goto(appUrl("/"));
      await expect(page.getByRole("button", { name: /^Start session: / }).first()).toBeVisible();
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
      const u = user(users, "newuser");
      sql("delete from account_preference");
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
