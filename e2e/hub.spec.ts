// Spec 005 FR1, FR2, FR3 on the local hub stand-in (scripts/check-hub.sh, HUB=1): every
// request of a join stays under /collab/, an invite needs no sign-in, and capabilities come
// only from this app's client and stay in this app. Sign-in through client `collab` keeps
// 003's app-styled page (spec 005 NFR No behaviour change).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  appPathname,
  appUrl,
  createSession,
  expect,
  markStale,
  openContexts,
  signIn,
  test,
} from "./fixtures";

const STUB_PATH = process.env.HUB_STUB_PATH ?? "/stub-a/";

/** Every http(s) and WebSocket URL the page asks for, from now on. */
function recordUrls(page: Page): URL[] {
  const urls: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http")) urls.push(url);
  });
  page.on("websocket", (ws) => urls.push(new URL(ws.url())));
  return urls;
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

test("FR1: joining a session, the page, its API calls and its live connection are all under /collab/", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [context] = await openContexts(browser, 1);
  if (!context) throw new Error("no browser context");
  const page = await context.newPage();
  const urls = recordUrls(page);

  await join(page, invite, "Ada");

  const paths = urls.map((url) => url.pathname);
  expect(paths).toContain(`/collab/s/${invite}`);
  expect(paths.some((p) => p.startsWith("/collab/api/"))).toBe(true);
  const sockets = urls.filter((url) => url.protocol.startsWith("ws"));
  expect(sockets.map((url) => url.pathname)).toEqual([`/collab/api/sessions/${invite}/ws`]);
  expect(paths.filter((p) => !p.startsWith("/collab/"))).toEqual([]);
  await context.close();
});

test("FR2: a browser with no cookies and no account opens an invite and reaches the join step", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [context] = await openContexts(browser, 1);
  if (!context) throw new Error("no browser context");
  expect(await context.cookies()).toEqual([]);
  const page = await context.newPage();
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
  });

  await page.goto(appUrl(`/s/${invite}`));

  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join" })).toBeVisible();
  expect(appPathname(page.url())).toBe(`/s/${invite}`);
  expect(navigations.filter((p) => /^\/(auth|oauth2)\//.test(p))).toEqual([]);
  await context.close();
});

test("FR3: a collab editor can manage problems through the hub", async ({ page, keycloak }) => {
  const editor = keycloak.users.editor1;
  if (!editor) throw new Error("no keycloak test user 'editor1'");

  await signIn(page, editor.username, editor.password, "/problems/new");

  const sheet = page.locator("dialog[open]");
  await expect(sheet.getByRole("heading", { name: "New problem" })).toBeVisible();
  const me = await page.request.get(appUrl("/api/me"));
  expect(((await me.json()) as { roles: string[] }).roles).toEqual(["editor"]);
});

test("FR3: another app's editor and admin roles, and a realm role, grant nothing in collab", async ({
  page,
  request,
  keycloak,
}) => {
  const other = keycloak.users.other1;
  if (!other) throw new Error("no keycloak test user 'other1'");
  const invite = await createSession(request);
  markStale(invite);

  await signIn(page, other.username, other.password, "/");

  const me = await page.request.get(appUrl("/api/me"));
  expect(await me.json()).toMatchObject({ signed_in: true, roles: [] });
  await expect(page.getByRole("button", { name: "New problem" })).toHaveCount(0);
  const create = await page.request.post(appUrl("/api/problems"), { data: {} });
  expect(create.status()).toBe(403);
  const reactivate = await page.request.post(appUrl(`/api/sessions/${invite}/reactivate`));
  expect(reactivate.status()).toBe(403);
  const stale = await page.request.get(appUrl("/api/sessions/stale"));
  expect(stale.status()).toBe(403);
});

/** `--window-bg` for dark from tokens.css, as getComputedStyle reports it (as in signin.spec.ts). */
function darkWindowBg(): string {
  const tokens = readFileSync(
    path.join(import.meta.dirname, "..", "frontend", "src", "theme", "tokens.css"),
    "utf-8",
  );
  const block = /:root\[data-appearance="dark"\]\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? "";
  const hex = /--window-bg:\s*#([0-9a-f]{6})/i.exec(block)?.[1];
  if (!hex) throw new Error("no dark --window-bg in tokens.css");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

test("NFR no behaviour change: collab's sign-in on the hub is app-styled, another client's is the hub default", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  try {
    const page = await context.newPage();
    const body = () => page.evaluate("getComputedStyle(document.body).backgroundColor");

    await page.goto(appUrl("/api/auth/login"));
    await expect(page.locator("#kc-form-login")).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/^\/auth\/realms\/hub\//);
    expect(await page.locator("html").getAttribute("data-appearance")).toBe("dark");
    expect(await body()).toBe(darkWindowBg());

    const hub = new URL(page.url()).origin;
    const auth = new URL(`${hub}/auth/realms/hub/protocol/openid-connect/auth`);
    auth.search = new URLSearchParams({
      client_id: "other-app",
      redirect_uri: `${hub}/other-app/callback`,
      response_type: "code",
      scope: "openid",
    }).toString();
    await page.goto(auth.toString());
    await expect(page.locator("#kc-form-login")).toBeVisible();
    expect(await page.locator("html").getAttribute("data-appearance")).toBeNull();
    await expect(page.locator('link[href*="collab.css"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("FR3: signed in to collab as its admin, another hub app gets no roles and no collab cookie", async ({
  page,
  keycloak,
}) => {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  await signIn(page, admin.username, admin.password, "/");
  const me = await page.request.get(appUrl("/api/me"));
  expect(((await me.json()) as { roles: string[] }).roles).toEqual(["admin"]);
  const cookie = (await page.context().cookies()).find((c) => c.name === "collab_session");
  expect(cookie?.path).toBe("/collab");

  const sent = page.waitForRequest((r) => new URL(r.url()).pathname === STUB_PATH);
  const response = await page.goto(new URL(STUB_PATH, page.url()).toString());
  const headers = await (await sent).allHeaders();

  expect(response?.status()).toBe(200);
  expect(headers.cookie ?? "").not.toContain("collab_session");
  // whoami echoes every header it received: no identity, no token, no collab cookie.
  const echoed = (await response?.text()) ?? "";
  expect(echoed).toContain(`Name: ${STUB_PATH.replaceAll("/", "")}`);
  expect(echoed).not.toMatch(/^X-Auth-Request-/im);
  expect(echoed).not.toMatch(/^Authorization:/im);
  expect(echoed).not.toContain("collab_session");
});
