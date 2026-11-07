/// <reference lib="dom" />
// Spec 015 task 34 (FR-2, FR-3, FR-11, Performance NFR): the app against synthetic brand
// directories served by a Vite dev server (BRAND_DIR), proxied to the stack's API. Cases: all
// supplied, empty directory, font file delayed 3 s.
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { makeBrandDir } from "./fixtures/brand-dirs";

const FRONTEND = path.resolve(import.meta.dirname, "..", "..", "frontend");
const HOST = "127.0.0.1";

interface Server {
  url: string;
  child: ChildProcess;
}

async function startVite(port: number, brandDir: string): Promise<Server> {
  const child = spawn(
    path.join(FRONTEND, "node_modules/.bin/vite"),
    ["--host", HOST, "--port", String(port), "--strictPort"],
    {
      cwd: FRONTEND,
      stdio: "ignore",
      env: { ...process.env, BRAND_DIR: brandDir, BRAND_FETCH_LOGO: "0" },
    },
  );
  const url = `http://${HOST}:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}brand/brand.css`)).ok) return { url, child };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(`vite did not start on ${url}`);
}

const servers: Server[] = [];
async function serve(port: number, supply: Parameters<typeof makeBrandDir>[0]): Promise<string> {
  const s = await startVite(port, makeBrandDir(supply));
  servers.push(s);
  return s.url;
}
test.afterAll(() => {
  for (const s of servers.splice(0)) s.child.kill();
});

const problems = (page: Page) => {
  const out: string[] = [];
  page.on("pageerror", (e) => out.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => out.push(`failed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400) out.push(`${r.status()}: ${r.url()}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") out.push(`console: ${m.text()}`);
  });
  return out;
};

const ready = (page: Page) => expect(page.locator(".app-header .brand-name")).toBeVisible();

test.describe("all brand assets supplied", () => {
  let url: string;
  test.beforeAll(async () => {
    url = await serve(5291, { font: true, icons: ["sun", "moon"], logo: true });
  });

  test("FR-3: the supplied face is available and used", async ({ page }) => {
    const bad = problems(page);
    await page.goto(url);
    await ready(page);
    await expect.poll(() => page.evaluate(() => document.fonts.check('16px "Audi Type"'))).toBe(true);
    expect(bad.filter((p) => !p.includes("/api/"))).toEqual([]);
  });

  test("FR-2: a supplied icon's mask is requested, an unsupplied one shows the fallback", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    await page.goto(url);
    await ready(page);
    // Light appearance shows the "sun" glyph on the toggle: supplied.
    const sun = page.locator('.app-header .icon[data-icon="sun"]');

    await expect(sun).toBeVisible();
    await expect
      .poll(() => sun.evaluate((e) => getComputedStyle(e).maskImage))
      .toContain("brand/icons/sun.svg");
    expect(requested.some((u) => u.endsWith("/brand/icons/sun.svg"))).toBe(true);
    // An icon with no supplied file keeps the committed fallback glyph (never "none").
    const other = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll(".icon")).find(
        (e) => !["sun", "moon"].includes(e.getAttribute("data-icon") ?? ""),
      );
      if (!el) return null;
      return { name: el.getAttribute("data-icon"), mask: getComputedStyle(el).maskImage };
    });
    expect(other, "an unsupplied icon is on the page").not.toBeNull();
    expect(other?.mask).not.toBe("none");
    expect(other?.mask).not.toContain("brand/icons/");
    expect(requested.some((u) => u.includes(`/brand/icons/${other?.name}.svg`))).toBe(false);
  });

  test("FR-11: the logo is visible in light and dark", async ({ page }) => {
    await page.goto(url);
    await ready(page);
    const logo = page.locator(".app-header .brand-logo");
    const colours: string[] = [];
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect(logo).toBeVisible();
      const box = await logo.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(8);
      expect(box?.height ?? 0).toBeGreaterThan(8);
      await expect
        .poll(() => logo.evaluate((e) => getComputedStyle(e).backgroundColor))
        .not.toBe(colours[0] ?? "");
      colours.push(await logo.evaluate((e) => getComputedStyle(e).backgroundColor));
      expect(await logo.evaluate((e) => getComputedStyle(e).maskImage)).toContain("logo.svg");
    }
    expect(colours[0]).not.toBe(colours[1]);
  });
});

test.describe("empty brand directory", () => {
  let url: string;
  test.beforeAll(async () => {
    url = await serve(5292, {});
  });

  test("FR-3, FR-11, Performance: no font or logo request; no logo gap; no errors", async ({
    page,
  }) => {
    const bad = problems(page);
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    await page.goto(url);
    await ready(page);
    expect(requested.filter((u) => /\/brand\/(fonts\/|logo)/.test(u))).toEqual([]);
    expect(
      await page.evaluate(() => Array.from(document.fonts).some((f) => f.family.includes("Audi"))),
    ).toBe(false);
    // The logo element is hidden, the app name is visible and sits at the header padding.
    await expect(page.locator(".app-header .brand-logo")).toBeHidden();
    const gap = await page.evaluate(() => {
      const header = document.querySelector(".app-header") as HTMLElement;
      const name = document.querySelector(".app-header .brand-name") as HTMLElement;
      return (
        name.getBoundingClientRect().left -
        (header.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(header).paddingLeft))
      );
    });
    expect(Math.abs(gap)).toBeLessThan(1);
    expect(bad.filter((p) => !p.includes("/api/"))).toEqual([]);
  });

  test("Performance: fonts load by CSS @font-face with swap, never a preload link", async ({
    page,
  }) => {
    await page.goto(url);
    await ready(page);
    expect(await page.locator('link[rel="preload"][as="font"]').count()).toBe(0);
    const swap = await page.evaluate(() =>
      Array.from(document.fonts).map((f) => f.display),
    );
    expect(swap.length).toBeGreaterThan(0);
    expect(swap.every((d) => d === "swap")).toBe(true);
  });
});

test.describe("font file delayed 3 s", () => {
  let url: string;
  test.beforeAll(async () => {
    url = await serve(5293, { font: true });
  });

  test("FR-3: text is visible in a fallback face meanwhile, then the face swaps", async ({
    page,
  }) => {
    await page.route("**/brand/fonts/*", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await page.goto(url, { waitUntil: "commit" });
    const name = page.locator(".app-header .brand-name");
    await expect(name).toBeVisible();
    const during = await name.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        status: document.fonts.status,
        loaded: document.fonts.check('16px "Audi Type"'),
        width: r.width,
        height: r.height,
        visibility: getComputedStyle(e).visibility,
      };
    });
    expect(during.status).toBe("loading");
    expect(during.loaded).toBe(false);
    expect(during.width).toBeGreaterThan(0);
    expect(during.height).toBeGreaterThan(0);
    expect(during.visibility).toBe("visible");
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('16px "Audi Type"')), { timeout: 10_000 })
      .toBe(true);
    await expect(name).toBeVisible();
  });
});
