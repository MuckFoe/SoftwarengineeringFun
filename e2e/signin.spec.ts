// Spec 003 AC-18d / FR-18: the Keycloak sign-in page uses the app's visual language and
// appearance: the OS setting by default, the app's choice when it passes ?appearance=,
// kept on later Keycloak pages. AC-10a / FR-9: the toolbar's "Sign in" brings the visitor
// back to the screen they started from, signed in.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const TOKENS = readFileSync(
  path.join(import.meta.dirname, "..", "frontend", "src", "theme", "tokens.css"),
  "utf-8",
);

/** `--window-bg` from tokens.css, as the rgb() string getComputedStyle reports. */
function windowBg(appearance: "light" | "dark"): string {
  const block =
    appearance === "light"
      ? /:root\s*\{([^}]*)\}/.exec(TOKENS)
      : /:root\[data-appearance="dark"\]\s*\{([^}]*)\}/.exec(TOKENS);
  const hex = /--window-bg:\s*#([0-9a-f]{6})/i.exec(block?.[1] ?? "")?.[1];
  if (!hex) throw new Error(`no --window-bg for ${appearance} in tokens.css`);
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate("getComputedStyle(document.body).backgroundColor") as Promise<string>;
}

async function openSignIn(page: Page, query = ""): Promise<void> {
  await page.goto(`/api/auth/login${query}`);
  await expect(page.locator("#kc-form-login")).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`AC-18d: with the OS in ${scheme}, the sign-in page renders in ${scheme}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: scheme });
    try {
      const page = await context.newPage();
      await openSignIn(page);
      expect(await page.locator("html").getAttribute("data-appearance")).toBe(scheme);
      expect(await bodyBackground(page)).toBe(windowBg(scheme));
    } finally {
      await context.close();
    }
  });
}

test("AC-18d: the app's Light under a dark OS wins, also on the failed-login page", async ({
  browser,
  keycloak,
}) => {
  const editor = keycloak.users.editor1;
  if (!editor) throw new Error("no keycloak test user 'editor1'");
  const context = await browser.newContext({ colorScheme: "dark" });
  try {
    const page = await context.newPage();
    await openSignIn(page, "?appearance=light");
    expect(await bodyBackground(page)).toBe(windowBg("light"));

    await page.locator("#username").fill(editor.username);
    await page.locator("#password").fill("not-the-password");
    await page.locator("#kc-login").click();
    await expect(page.locator("#input-error, .pf-v5-c-helper-text__item-text").first()).toBeVisible();
    expect(new URL(page.url()).searchParams.get("appearance")).toBeNull();
    expect(await bodyBackground(page)).toBe(windowBg("light"));
  } finally {
    await context.close();
  }
});

test("AC-18d: the page shows no Keycloak logo and uses the system typeface", async ({ page }) => {
  await openSignIn(page);
  const font = (await page.evaluate("getComputedStyle(document.body).fontFamily")) as string;
  expect(font).toMatch(/^system-ui/);
  await expect(page.locator("div.kc-logo-text")).toBeHidden();
});

async function createSession(request: APIRequestContext): Promise<string> {
  const found = await request.get("/api/problems?q=Sum%20Two%20Numbers");
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === "Sum Two Numbers");
  if (!problem) throw new Error("no seeded problem titled Sum Two Numbers");
  const created = await request.post("/api/sessions", { data: { problem_id: problem.id } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

for (const screen of ["problems", "session"] as const) {
  test(`AC-10a: signing in from the ${screen} screen returns there, signed in`, async ({
    page,
    request,
    keycloak,
    baseURL,
  }) => {
    const editor = keycloak.users.editor1;
    if (!editor) throw new Error("no keycloak test user 'editor1'");
    const app = new URL(baseURL ?? "").origin;
    const start = screen === "problems" ? "/" : `/s/${await createSession(request)}`;
    await page.goto(start);

    const toolbar = page.getByRole("toolbar").first();
    await toolbar.getByRole("link", { name: "Sign in" }).click();
    await expect(page.locator("#kc-form-login")).toBeVisible();
    await page.locator("#username").fill(editor.username);
    await page.locator("#password").fill(editor.password);
    await page.locator("#kc-login").click();

    await page.waitForURL((url) => url.origin === app && url.pathname === start);
    const me = (await (await page.request.get("/api/me")).json()) as { name: string };
    expect(me.name).toBeTruthy();
    await expect(
      page.getByRole("toolbar").first().getByRole("button", { name: me.name }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  });
}
