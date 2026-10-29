/// <reference lib="dom" />
// Spec 003 AC-5, AC-6, AC-7, AC-8, AC-22: appearance follows the OS and the user's choice,
// dark mode leaves no light surfaces, and reduced motion and reduced transparency are
// honoured, in a real browser against the real stack.
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const PROBLEM = "Sum Two Numbers";

async function createSession(request: APIRequestContext): Promise<string> {
  const found = await request.get(`/api/problems?q=${encodeURIComponent(PROBLEM)}`);
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === PROBLEM);
  if (!problem) throw new Error(`no seeded problem titled ${PROBLEM}`);
  const created = await request.post("/api/sessions", { data: { problem_id: problem.id } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(`/s/${invite}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

async function signIn(page: Page, username: string, password: string, next = "/"): Promise<void> {
  await page.goto(`/api/auth/login?next=${encodeURIComponent(next)}`);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL((url) => url.pathname === next);
}

const appearance = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-appearance"));

/** Relative luminance (WCAG) of the first non-transparent background at or above `el`. */
function backgroundLuminance(el: Locator): Promise<number> {
  return el.evaluate((start) => {
    let node: Element | null = start;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      const parts = bg.match(/[\d.]+/g)?.map(Number) ?? [];
      const alpha = parts.length === 4 ? (parts[3] ?? 1) : 1;
      if (parts.length >= 3 && alpha > 0) {
        const [r, g, b] = parts.slice(0, 3).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
      }
      node = node.parentElement;
    }
    return 1; // Nothing painted: the browser's white canvas.
  });
}

/** Below this, a surface reads as dark (#595959 is about 0.1). */
const DARK = 0.1;

async function chooseAppearance(page: Page, choice: "Light" | "Dark" | "System"): Promise<void> {
  await page.getByRole("button", { name: "Appearance" }).first().click();
  await page.getByRole("radio", { name: choice }).click();
  await page.keyboard.press("Escape");
}

test.describe("with a dark OS", () => {
  test.use({ colorScheme: "dark" });

  test("AC-6: no stored choice follows the OS, and an OS switch applies without a reload", async ({
    page,
  }) => {
    await page.goto("/");
    await expect.poll(() => appearance(page)).toBe("dark");
    expect(await backgroundLuminance(page.getByRole("main"))).toBeLessThan(DARK);

    await page.evaluate(() => {
      (window as Window & { __sameDocument?: boolean }).__sameDocument = true;
    });
    await page.emulateMedia({ colorScheme: "light" });

    await expect.poll(() => appearance(page)).toBe("light");
    expect(await backgroundLuminance(page.getByRole("main"))).toBeGreaterThan(DARK);
    expect(
      await page.evaluate(() => (window as Window & { __sameDocument?: boolean }).__sameDocument),
    ).toBe(true);
  });

  test("AC-7: Light under a dark OS holds on a new page; System follows the OS again", async ({
    page,
    context,
    request,
  }) => {
    await page.goto("/");
    await chooseAppearance(page, "Light");
    expect(await appearance(page)).toBe("light");
    await page.close();

    const invite = await createSession(request);
    const next = await context.newPage();
    await next.goto(`/s/${invite}`);
    await expect.poll(() => appearance(next)).toBe("light");

    await chooseAppearance(next, "System");
    expect(await appearance(next)).toBe("dark");
  });

  test("AC-8: in dark, the editor, run results, presence list and an alert have no light background", async ({
    page,
    request,
    keycloak,
  }) => {
    await join(page, await createSession(request), "Ada");
    await expect.poll(() => appearance(page)).toBe("dark");
    expect(await backgroundLuminance(page.locator(".cm-editor"))).toBeLessThan(DARK);
    expect(await backgroundLuminance(page.locator(".cm-gutters"))).toBeLessThan(DARK);
    expect(
      await backgroundLuminance(page.getByRole("region", { name: "Run results" })),
    ).toBeLessThan(DARK);
    expect(
      await backgroundLuminance(page.getByRole("region", { name: "Participants" })),
    ).toBeLessThan(DARK);

    const editor = keycloak.users.editor1;
    if (!editor) throw new Error("no keycloak test user 'editor1'");
    await signIn(page, editor.username, editor.password);
    await page.getByRole("button", { name: `Edit ${PROBLEM}` }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Delete…" }).click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    expect(await backgroundLuminance(alert)).toBeLessThan(DARK);
    await alert.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("AC-5: a sheet opening and a participant joining are only a fade", async ({
    page,
    browser,
    request,
  }) => {
    const invite = await createSession(request);
    await join(page, invite, "Ada");

    await page.keyboard.press("ControlOrMeta+Shift+Slash");
    const sheet = page.locator("dialog[open]");
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/-reduced$/);
    await page.keyboard.press("Escape");

    const other = await browser.newContext({ reducedMotion: "reduce" });
    try {
      await join(await other.newPage(), invite, "Grace");
      const row = page
        .getByRole("region", { name: "Participants" })
        .getByRole("listitem")
        .filter({ hasText: "Grace" });
      await expect(row).toBeVisible();
      expect(await row.evaluate((el) => getComputedStyle(el).animationName)).toMatch(
        /-reduced$/,
      );
    } finally {
      await other.close();
    }
  });
});

test("AC-22: with reduced transparency the sidebar and toolbar are opaque", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "prefers-reduced-transparency is emulated over CDP");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
  await page.goto("/");

  for (const el of [
    page.getByRole("toolbar", { name: "Problems" }),
    page.getByRole("navigation", { name: "Sidebar" }),
  ]) {
    const style = await el.evaluate((node) => {
      const s = getComputedStyle(node);
      return { filter: s.backdropFilter, background: s.backgroundColor };
    });
    expect(style.filter).toBe("none");
    expect(style.background).toMatch(/^rgb\(/);
  }
});
