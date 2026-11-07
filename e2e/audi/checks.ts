/// <reference lib="dom" />
// Spec 015 task 12: assertions shared by the screen matrix and the per-screen specs (tasks
// 24-33). Each helper reports a list of offenders so a failure names what is wrong.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Collects console errors and failed or 4xx/5xx requests from the moment it is attached. */
export interface Watch {
  problems(): string[];
}

export function watchPage(page: Page): Watch {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  // The fake GIPHY's deliberately broken media item (/media/missing/) is blocked by ORB: expected.
  page.on("requestfailed", (r) => r.url().includes("/media/missing/") || problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`);
  });
  return { problems: () => problems };
}

/** FR-7: no horizontal scroll and nothing cut off at the sides. */
export async function checkNoOverflow(page: Page): Promise<void> {
  const o = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    clipped: Array.from(document.querySelectorAll("button, a[href], [role=button], input"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.left < -0.5 || r.right > window.innerWidth + 0.5);
      })
      .map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName),
  }));
  expect.soft(o.scroll, "scrollWidth <= clientWidth").toBeLessThanOrEqual(o.client);
  expect.soft(o.clipped, "controls cut off at the sides").toEqual([]);
}

/** FR-7: no two sibling controls' boxes overlap (bounding-box intersection). */
export async function checkNoOverlap(page: Page): Promise<void> {
  const overlaps = await page.evaluate(() => {
    const sel = "button, a[href], [role=button], input, select, textarea";
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}]`;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const out: string[] = [];
    const parents = new Set<Element>();
    for (const el of document.querySelectorAll(sel)) {
      if (el.parentElement) parents.add(el.parentElement);
    }
    for (const parent of parents) {
      const kids = Array.from(parent.children).filter((c) => c.matches(sel) && visible(c));
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = (kids[i] as Element).getBoundingClientRect();
          const b = (kids[j] as Element).getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          // A field's own Clear button sits inside the field by design.
          const pair = [kids[i] as Element, kids[j] as Element];
          if (pair.some((k) => k.getAttribute("aria-label") === "Clear")) continue;
          if (w > 1 && h > 1) out.push(`${label(kids[i] as Element)} x ${label(kids[j] as Element)}`);
        }
      }
    }
    return out;
  });
  expect.soft(overlaps, "overlapping sibling controls").toEqual([]);
}

/** Accessibility NFR: axe colour-contrast and focus rules, once animations have settled. */
export async function checkAxe(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page })
    .withRules(["color-contrast", "focus-order-semantics", "scrollable-region-focusable", "tabindex"])
    .analyze();
  expect
    .soft(
      axe.violations.flatMap((v) =>
        v.nodes
          // A focusable role=separator with aria-valuenow is the WAI-ARIA window splitter widget;
          // axe's experimental focus-order-semantics rule does not know it.
          .filter((n) => !(v.id === "focus-order-semantics" && n.html.includes('role="separator"')))
          .map((n) => `${v.id} ${n.target.join(" ")}: ${n.failureSummary}`),
      ),
      "axe violations",
    )
    .toEqual([]);
}

export function checkClean(watch: Watch): void {
  expect.soft(watch.problems(), "console errors and failed or 4xx requests").toEqual([]);
}

export interface Computed {
  canvas: string;
  bodyFont: string;
  headlineStretch: string | null;
  radii: string[];
  backdrop: string[];
}

/** FR-1, FR-3, FR-8: the computed styles that make the Audi look. */
export async function readComputed(page: Page): Promise<Computed> {
  return page.evaluate(() => {
    const bg = (el: Element) => getComputedStyle(el).backgroundColor;
    let canvas = bg(document.body);
    if (canvas === "rgba(0, 0, 0, 0)") canvas = bg(document.documentElement);
    const h = document.querySelector("h1, h2");
    const controls = Array.from(
      document.querySelectorAll("button, input:not([type=checkbox]):not([type=radio]), textarea, select"),
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.closest(".cm-editor");
    });
    return {
      canvas,
      bodyFont: (getComputedStyle(document.body).fontFamily.split(",")[0] ?? "")
        .trim()
        .replace(/^["']|["']$/g, ""),
      headlineStretch: h ? getComputedStyle(h).fontStretch : null,
      radii: controls
        .filter((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) !== 0)
        .map((el) => `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 20)}] ${getComputedStyle(el).borderTopLeftRadius}`),
      backdrop: Array.from(document.querySelectorAll("*"))
        .filter((el) => {
          const s = getComputedStyle(el);
          return s.backdropFilter !== "none" && s.backdropFilter !== "";
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    };
  });
}

/** Relative luminance (WCAG) of an `rgb()/rgba()` string. */
export function luminance(color: string): number {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? ["255", "255", "255"]).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 1) + 0.7152 * (g ?? 1) + 0.0722 * (b ?? 1);
}

export async function checkComputed(page: Page, scheme: "light" | "dark"): Promise<void> {
  const c = await readComputed(page);
  // FR-1/FR-6: canvas follows the scheme (dark palette is dark, light is light).
  if (scheme === "dark") expect.soft(luminance(c.canvas), `dark canvas ${c.canvas}`).toBeLessThan(0.1);
  else expect.soft(luminance(c.canvas), `light canvas ${c.canvas}`).toBeGreaterThan(0.5);
  // FR-3: Audi Type leads the stack (the brand face, with fallbacks behind it).
  expect.soft(c.bodyFont, "first body font-family entry").toBe("Audi Type");
  // FR-3: extended headline width.
  if (c.headlineStretch !== null) {
    expect.soft(c.headlineStretch, "headline font-stretch").toBe("130%");
  }
  // FR-1: radius 0 on buttons and inputs; FR-8: no backdrop-filter.
  expect.soft(c.radii, "buttons and inputs with a non-zero radius").toEqual([]);
  expect.soft(c.backdrop, "elements with backdrop-filter").toEqual([]);
}

/** All shared checks, in one call, for a screen that is open and settled. */
export async function checkScreen(
  page: Page,
  watch: Watch,
  scheme: "light" | "dark",
): Promise<void> {
  await checkNoOverflow(page);
  await checkNoOverlap(page);
  checkClean(watch);
  await checkAxe(page);
  await checkComputed(page, scheme);
}
