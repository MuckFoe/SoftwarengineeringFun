// Shared e2e fixtures (plan.md "Test strategy"): the test users global-setup.ts created
// with runtime passwords, and a helper to open N independent browser contexts (each one
// a separate "browser", with its own cookies) for multi-participant scenarios.
//
// Spec 005 (plan §4.3): the same specs run at the root (default project) and under the
// hub's /collab/ (HUB=1). Paths go through appUrl/appPathname and the stack's database
// through stackCompose, so no spec assumes the app sits at the root of its origin.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  test as base,
  expect,
} from "@playwright/test";
import type { KeycloakState } from "./global-setup";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const HUB = process.env.HUB === "1";
/** Where the app sits on its origin: "/collab" on the hub, "" at the root. */
export const BASE_PATH = HUB ? "/collab" : "";

/**
 * An app path ("/s/abc") as page.goto and request resolve it against the baseURL. A leading
 * "/" would resolve against the origin and leave the app's path on the hub.
 */
export function appUrl(appPath: string): string {
  return appPath.replace(/^\//, "");
}

/** The app path of a page URL: "/collab/s/abc" on the hub, "/s/abc" at the root, is "/s/abc". */
export function appPathname(url: string | URL): string {
  const { pathname } = new URL(url);
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return "/";
  return pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : pathname;
}

/**
 * `docker compose` arguments that address the stack under test: docker-compose.yml, or on
 * the hub docker-compose.hub.yml with the env file scripts/check-hub.sh wrote.
 */
export function stackCompose(): string[] {
  if (!HUB) return ["compose", "-f", "docker-compose.yml"];
  const envFile = process.env.HUB_COLLAB_ENV_FILE;
  if (!envFile) throw new Error("HUB_COLLAB_ENV_FILE is unset; run via scripts/check-hub.sh");
  return ["compose", "-f", "docker-compose.hub.yml", "--env-file", envFile];
}

/** Runs one SQL statement in the stack's database. */
export function sql(statement: string): string {
  return execFileSync(
    "docker",
    [
      ...stackCompose(),
      "exec",
      "-T",
      "db",
      "sh",
      "-c",
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tAc "${statement}"`,
    ],
    { cwd: REPO_ROOT, stdio: "pipe", encoding: "utf-8" },
  ).trim();
}

/** Marks the session stale in the stack's database, as the stale-session job would. */
export function markStale(invite: string): void {
  if (!/^[\w-]+$/.test(invite)) throw new Error(`unexpected invite id ${invite}`);
  sql(`update session set stale_at = now() where invite_id = '${invite}'`);
}

/** Creates a session on the seeded problem with that title; returns its invite id. */
export async function createSession(
  request: APIRequestContext,
  title = "Sum Two Numbers",
): Promise<string> {
  const found = await request.get(appUrl(`/api/problems?q=${encodeURIComponent(title)}`));
  expect(found.ok()).toBe(true);
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === title);
  if (!problem) throw new Error(`no seeded problem titled ${title}`);
  const created = await request.post(appUrl("/api/sessions"), {
    data: { problem_id: problem.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

/**
 * Signs in through the app's sign-in route and waits until it lands back on `next` (an app
 * path, optionally with a query: "/profile?from=%2F" waits for that path and query).
 */
export async function signIn(
  page: Page,
  username: string,
  password: string,
  next = "/",
): Promise<void> {
  await page.goto(appUrl(`/api/auth/login?next=${encodeURIComponent(next)}`));
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  const [nextPath, nextQuery] = next.split("?", 2);
  await page.waitForURL(
    (url) =>
      appPathname(url) === nextPath &&
      (nextQuery === undefined || new URL(url).search === `?${nextQuery}`),
  );
}

/**
 * Spec 012: a new browser context (its own cookies and localStorage: another browser or
 * device) signed in as the named test user, with its page on `next`. Call it twice for the
 * same user to get two devices signed in at once. `options` are Playwright context options
 * (e.g. `{ colorScheme: "dark" }`); `prepare` runs on the page before signing in, e.g. to
 * set a preference while signed out. Close the returned context when done.
 */
export async function signedInContext(
  browser: Browser,
  keycloak: KeycloakState,
  username: string,
  next = "/",
  options: BrowserContextOptions = {},
  prepare?: (page: Page) => Promise<void>,
): Promise<{ context: BrowserContext; page: Page }> {
  const user = keycloak.users[username];
  if (!user) throw new Error(`no keycloak test user '${username}'`);
  const context = await browser.newContext(options);
  const page = await context.newPage();
  if (prepare) await prepare(page);
  await signIn(page, user.username, user.password, next);
  return { context, page };
}

function readKeycloakState(): KeycloakState {
  const file = path.join(import.meta.dirname, ".keycloak-state.json");
  return JSON.parse(readFileSync(file, "utf-8")) as KeycloakState;
}

/** A request the fake GIPHY received (docker-compose.test.yml's `giphy`); headers lower-cased. */
export interface GiphyRequest {
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

/** The fake GIPHY's control port; it stays up while the fake's API is switched off. */
const GIPHY_CONTROL_URL = (
  process.env.TEST_GIPHY_CONTROL_URL ??
  `http://127.0.0.1:${process.env.TEST_GIPHY_CONTROL_PORT ?? "58281"}`
).replace(/\/$/, "");

async function giphyControl(method: "GET" | "POST", what: string): Promise<Response> {
  const response = await fetch(`${GIPHY_CONTROL_URL}/${what}`, { method });
  if (!response.ok) {
    throw new Error(`fake GIPHY ${method} /${what}: ${response.status} ${await response.text()}`);
  }
  return response;
}

/** Controls for the fake GIPHY: the requests it recorded, switch off (refuse) and on. */
export const fakeGiphy = {
  async requests(): Promise<GiphyRequest[]> {
    return (await (await giphyControl("GET", "requests")).json()) as GiphyRequest[];
  },
  /** Connections to the fake's API (and media) are refused until `on()`. */
  async off(): Promise<void> {
    await giphyControl("POST", "off");
  },
  /** Answers again on the same port; the recorded requests are kept. */
  async on(): Promise<void> {
    await giphyControl("POST", "on");
  },
  /** Answers normally again with no recorded requests. */
  async reset(): Promise<void> {
    await giphyControl("POST", "reset");
  },
};

export async function openContexts(browser: Browser, n: number): Promise<BrowserContext[]> {
  return Promise.all(Array.from({ length: n }, () => browser.newContext()));
}

export const test = base.extend<{ keycloak: KeycloakState }>({
  keycloak: async ({}, use) => {
    await use(readKeycloakState());
  },
});

export { expect };
