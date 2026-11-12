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
import { expectReducedMotion } from "./checks";

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

/** The fake model's control port (docker-compose.test.yml `llm`, spec 020). */
const LLM_CONTROL_URL = (
  process.env.TEST_LLM_CONTROL_URL ??
  `http://127.0.0.1:${process.env.TEST_LLM_CONTROL_PORT ?? "58381"}`
).replace(/\/$/, "");

/** `POST /cold`: the fake's next single `/api/ps` call reports the model cold (one-shot). */
async function coldModel(): Promise<void> {
  const response = await fetch(`${LLM_CONTROL_URL}/cold`, { method: "POST" });
  if (!response.ok) throw new Error(`fake model POST /cold: ${response.status}`);
}

/**
 * Keeps a pending hint on screen: the session socket's `hint_failed` never reaches the page.
 * The E2E timeouts are short (3 s loaded, 6 s cold), shorter than the checks at every width, so
 * the preparing and warming-up states are held on the page while the server has moved on.
 * Call before the page opens the socket.
 */
async function holdPendingHint(page: Page): Promise<void> {
  await page.routeWebSocket(/\/sessions\/[^/]+\/ws/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      if (typeof message === "string" && message.includes('"hint_failed"')) {
        try {
          if ((JSON.parse(message) as { type?: string }).type === "hint_failed") return;
        } catch {
          // Not JSON: pass it on.
        }
      }
      ws.send(message);
    });
  });
}

/** A guest (Ada) in a fresh coding session, the editor loaded. */
async function joinSession(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto(appUrl(`/s/${await createSession(request)}`));
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("textbox")).toContainText("pass");
}

/** Spec 020: a guest in a fresh session, the problem shown, with the Hint action available. */
async function openHintSession(page: Page, request: APIRequestContext): Promise<void> {
  // At 390 px the problem list opens over the window; ask at desktop width, the checks then
  // resize to each width themselves.
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024) await page.setViewportSize({ ...viewport, width: 1024 });
  await page.goto(appUrl(`/s/${await createSession(request)}`));
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("textbox")).toContainText("pass");
  await expect(page.getByRole("button", { name: "Hint", exact: true })).toBeEnabled();
}

/** Opens the note field, types the note and asks (spec 020 FR-5). */
async function askHint(page: Page, note: string): Promise<void> {
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await page.getByLabel("What are you stuck on? (optional)").fill(note);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

/** The visible line, not the polite live region that repeats it. */
function shownText(page: Page, text: string) {
  return page.locator("p:not([role=status])", { hasText: text });
}

/** Constitution-ui 20: under reduced motion the hint states run no animation or transition. */
async function expectStillUnderReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectReducedMotion(page);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) => a.playState === "running")
            .map((a) => (a instanceof CSSTransition ? `transition ${a.transitionProperty}` : "animation")),
        ),
      { message: "animations or transitions running under reduced motion" },
    )
    .toEqual([]);
  await page.emulateMedia({ reducedMotion: null });
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
    // 2026-11-12 pinnable panels: everything pinned, the sidebar too.
    name: "session panels pinned",
    lowerBound: 1024,
    async open(page, request) {
      await joinSession(page, request);
      await page.getByRole("button", { name: "Sidebar", exact: true }).click();
      await page.getByRole("button", { name: "Pin sidebar" }).click();
      await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
      await page.getByRole("main").hover();
    },
  },
  {
    // 2026-11-12 pinnable panels: all unpinned to strips, the description opened by a press
    // on its strip.
    name: "session panels unpinned, peek open",
    lowerBound: 1024,
    narrow: true,
    async open(page, request) {
      // Joined at desktop width, where every panel starts pinned; the checks then resize.
      const viewport = page.viewportSize();
      if (viewport && viewport.width < 1024) await page.setViewportSize({ ...viewport, width: 1024 });
      await joinSession(page, request);
      for (const name of ["Unpin description", "Unpin chat", "Unpin run results"]) {
        await page.getByRole("button", { name }).click();
      }
      await page.getByRole("button", { name: "Description", exact: true }).click();
      // Focus inside holds it open whatever the pointer does while the checks resize.
      await page.getByRole("button", { name: "Pin description" }).focus();
      await expect(
        page.getByRole("complementary", { name: "Inspector" }).getByRole("region", {
          name: "Description",
        }),
      ).toBeVisible();
    },
  },
  {
    // Spec 020 task 18: two hints given, the note field open for a third (AC-16).
    name: "session hints",
    lowerBound: 1024,
    narrow: true,
    async open(page, request) {
      await openHintSession(page, request);
      await askHint(page, "stuck on empty input");
      await expect(page.getByRole("heading", { name: "Hint 1", level: 3 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Hint", exact: true })).toBeEnabled();
      await askHint(page, "");
      await expect(page.getByRole("heading", { name: "Hint 2", level: 3 })).toBeVisible();
      await page.getByRole("button", { name: "Hint", exact: true }).click();
      await page.getByLabel("What are you stuck on? (optional)").fill("what about negatives?");
      await expectStillUnderReducedMotion(page);
    },
  },
  {
    // Spec 020 task 18: a hint being prepared (`fake:slow`), shown with who asked (AC-16).
    name: "session hint preparing",
    lowerBound: 1024,
    narrow: true,
    async open(page, request) {
      await holdPendingHint(page);
      await openHintSession(page, request);
      await askHint(page, "fake:slow");
      await expect(shownText(page, "Preparing hint…")).toBeVisible();
      await expect(page.getByRole("button", { name: "Hint", exact: true })).toBeDisabled();
      await expectStillUnderReducedMotion(page);
    },
  },
  {
    // Spec 020 task 18: the cold model's warming-up line (FR-14a, AC-16). `POST /cold` is the
    // fake's one-shot global state, so this entry runs in the serial "giphy" project, the
    // playwright config's project for shared fakes.
    name: "session hint warming up",
    lowerBound: 1024,
    narrow: true,
    giphy: true,
    async open(page, request) {
      await holdPendingHint(page);
      const warming = shownText(page, "Model is warming up. This hint takes longer.");
      // A hint asked elsewhere on the stack between `POST /cold` and this request takes the
      // one-shot cold state; this request is then served loaded. Start over in a fresh session.
      for (let attempt = 1; ; attempt++) {
        await openHintSession(page, request);
        await coldModel();
        await askHint(page, "fake:slow");
        try {
          await expect(warming).toBeVisible({ timeout: attempt < 3 ? 2_000 : 5_000 });
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
        }
      }
      await expectStillUnderReducedMotion(page);
    },
  },
  {
    // Spec 020 task 18: the model failed, so the request ended in "unavailable" (FR-14, AC-16).
    name: "session hint unavailable",
    lowerBound: 1024,
    narrow: true,
    async open(page, request) {
      await openHintSession(page, request);
      await askHint(page, "fake:error");
      await expect(shownText(page, "Hints are unavailable right now")).toBeVisible();
      await expect(page.getByRole("button", { name: "Hint", exact: true })).toBeEnabled();
      await expectStillUnderReducedMotion(page);
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
    // Spec 019 task 13: a hosted session's Delete opens the confirmation dialog (FR-1, FR-4).
    name: "profile with delete dialog",
    lowerBound: 1024,
    narrow: true,
    async open(page, _request, users) {
      const u = workerUser(users);
      const browser = page.context().browser();
      if (!browser) throw new Error("no browser");
      // Only this worker's account: the first sign-in then takes this browser's appearance.
      await resetPreferences(browser, u);
      await signIn(page, u.username, u.password);
      // Started signed in (page.request carries the cookie), so this user hosts it (FR-0).
      const invite = await createSession(page.request);
      await page.goto(appUrl(`/s/${invite}`));
      await expect(page.getByRole("main").getByRole("textbox")).toContainText("pass");
      await page.goto(appUrl("/profile?from=%2F"));
      // Newest first: the session just started.
      await page.getByRole("button", { name: "Delete Sum Two Numbers" }).first().click();
      await expect(page.getByRole("dialog", { name: "Delete Sum Two Numbers?" })).toBeVisible();
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
    // Run runs the code as a script; its output shows in the Output tab (spec 011, 2026-11-12).
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
      await expect(
        page.getByRole("tabpanel", { name: "Output" }).getByRole("status"),
      ).toContainText("started by", { timeout: 30_000 });
    },
  },
  {
    // Check runs the tests; their results show in the Tests tab.
    name: "check results",
    lowerBound: 1024,
    async open(page, request) {
      await page.goto(appUrl(`/s/${await createSession(request)}`));
      await page.getByLabel("Your name").fill("Ada");
      await page.getByRole("button", { name: "Join" }).click();
      await expect(page.locator(".cm-content")).toContainText("pass");
      await page
        .getByRole("toolbar", { name: "Session" })
        .getByRole("button", { name: "Check", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Run results" }).getByText(/^Test 1: /),
      ).toBeVisible({ timeout: 30_000 });
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
