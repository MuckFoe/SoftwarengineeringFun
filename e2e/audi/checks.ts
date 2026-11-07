/// <reference lib="dom" />
// Spec 016 task 3: assertions shared by the screen matrix and the per-screen specs (tasks
// 20-25). Replaces the spec 015 shape checks with the v2 look. Each helper reports a list of offenders so a failure names what is wrong.
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
  // Colour contrast is read from computed colours, so a fade in progress (rows that mount when
  // another test's session goes live or stale, in a list everyone shares) reads as low contrast.
  // Contrast does not depend on motion: analyse under reduced motion, which stops those fades,
  // and put the page's own setting back afterwards.
  const wasReduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (!wasReduced) await page.emulateMedia({ reducedMotion: "reduce" });
  // Infinite animations (the Live dot, the header sweep) never finish; wait only for finite ones.
  await page.evaluate(async () => {
    const finite = () =>
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    for (let round = 0; round < 10; round++) {
      await Promise.all(finite().map((a) => a.finished.catch(() => undefined)));
      await frame();
      await frame();
      if (finite().length === 0) return;
    }
  });
  const axe = await new AxeBuilder({ page })
    .withRules(["color-contrast", "focus-order-semantics", "scrollable-region-focusable", "tabindex"])
    .analyze();
  if (!wasReduced) await page.emulateMedia({ reducedMotion: null });
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

export interface V2Options {
  /** Allow the danger hue (errors, destructive actions). Default true. */
  danger?: boolean;
}

/**
 * FR-1 (spec 016): the v2 look, as a list of offenders (empty = passes).
 *  - shape: visible buttons are pills (radius >= min(--radius-pill, height / 2)); cards and
 *    tiles (`[data-card]`, `[data-tile]`) have radius >= min(--radius-card, half their short side);
 *  - tone: `aside` and `[data-region]` differ in background from the region behind them;
 *  - no outlines: header, nav, aside, footer, main and `[data-region]` have no border;
 *  - colour: every saturated colour (text, background, visible border) is in the accent family
 *    (hue within 20 degrees of --accent) or, when `danger` is allowed, of --danger.
 * Exempt: anything inside `.cm-editor`, iframes, `[data-v2-exempt]`, chess squares, checkboxes
 * and radios (their shape is not a design choice).
 */
export async function v2Offenders(page: Page, opts: V2Options = {}): Promise<string[]> {
  const allowDanger = opts.danger ?? true;
  return page.evaluate((allowDanger) => {
    const out: string[] = [];
    const root = getComputedStyle(document.documentElement);
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const px = (v: string, fallback: number) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const pill = px(root.getPropertyValue("--radius-pill"), 999);
    const cardR = px(root.getPropertyValue("--radius-card"), 24);
    const exempt = (el: Element) =>
      !!el.closest(".cm-editor, [data-v2-exempt], [data-square], iframe") ||
      (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type));
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 20)}]`;
    const radius = (el: Element) => {
      const s = getComputedStyle(el);
      return Math.min(
        ...[s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius].map((v) =>
          px(v, 0),
        ),
      );
    };

    // Shape.
    for (const el of document.querySelectorAll("button")) {
      // A tile or card that is itself a button is held to the card radius below, not the pill.
      if (exempt(el) || !visible(el) || el.matches("[data-card], [data-tile]")) continue;
      const r = el.getBoundingClientRect();
      const want = Math.min(pill, r.height / 2) - 0.5;
      if (radius(el) < want) out.push(`shape: ${name(el)} radius ${radius(el)}px < ${want}px (pill)`);
    }
    for (const el of document.querySelectorAll("[data-card], [data-tile]")) {
      if (exempt(el) || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      const want = Math.min(cardR, Math.min(r.width, r.height) / 2) - 0.5;
      if (radius(el) < want) out.push(`shape: ${name(el)} radius ${radius(el)}px < ${want}px (card)`);
    }

    // Tone and outlines.
    const bgOf = (el: Element | null): string => {
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
      }
      return "rgb(255, 255, 255)";
    };
    for (const el of document.querySelectorAll("header, nav, aside, footer, main, [data-region]")) {
      if (exempt(el) || !visible(el)) continue;
      const s = getComputedStyle(el);
      const sides = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth];
      const styled = [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle];
      if (sides.some((w, i) => px(w, 0) > 0 && styled[i] !== "none")) out.push(`outline: ${name(el)} has a border`);
    }
    for (const el of document.querySelectorAll("aside, [data-region]")) {
      if (exempt(el) || !visible(el) || !el.parentElement) continue;
      if (bgOf(el) === bgOf(el.parentElement)) out.push(`tone: ${name(el)} has the same background as its surroundings`);
    }

    // Colour: parse rgb()/color(srgb) strings to hue + saturation.
    const parse = (c: string): [number, number, number, number] | null => {
      const n = c.match(/-?[\d.]+/g)?.map(Number);
      if (!n || n.length < 3) return null;
      const scale = c.startsWith("color(") ? 1 : 255;
      return [n[0]! / scale, n[1]! / scale, n[2]! / scale, n.length > 3 ? n[3]! : 1];
    };
    const hs = (c: string): { h: number; s: number } | null => {
      const p = parse(c);
      if (!p || p[3] < 0.1) return null;
      const [r, g, b] = p;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return { h: 0, s: 0 };
      const l = (max + min) / 2;
      const s = d / (1 - Math.abs(2 * l - 1));
      const h =
        max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: ((h * 60) % 360 + 360) % 360, s };
    };
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolve = (v: string, fallback: string) => {
      const raw = root.getPropertyValue(v).trim();
      probe.style.color = "";
      probe.style.color = raw || fallback;
      return getComputedStyle(probe).color;
    };
    const accent = hs(resolve("--accent", dark ? "#6c9bff" : "#1f5fff"));
    const danger = hs(resolve("--danger", dark ? "#ff6b7d" : "#c8102e"));
    probe.remove();
    const near = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= 20;
    const bad = new Map<string, string>();
    for (const el of document.querySelectorAll("body, body *")) {
      if (exempt(el) || !visible(el)) continue;
      const s = getComputedStyle(el);
      const colours: [string, string][] = [
        ["color", s.color],
        ["background", s.backgroundColor],
      ];
      if (px(s.borderTopWidth, 0) > 0 && s.borderTopStyle !== "none") colours.push(["border", s.borderTopColor]);
      for (const [what, c] of colours) {
        const v = hs(c);
        if (!v || v.s < 0.25) continue;
        if (accent && near(v.h, accent.h)) continue;
        if (allowDanger && danger && near(v.h, danger.h)) continue;
        const key = `${name(el)} ${what}`;
        if (!bad.has(key)) bad.set(key, `colour: ${key} ${c} is outside the accent family`);
      }
    }
    out.push(...bad.values());
    return out;
  }, allowDanger);
}

/** FR-1: the v2 look. */
export async function expectV2Look(page: Page, opts: V2Options = {}): Promise<void> {
  expect.soft(await v2Offenders(page, opts), "v2 look offenders").toEqual([]);
}

/** Responsive: `scrollWidth <= clientWidth` and no control cut off at the sides. */
export const expectNoOverflow = checkNoOverflow;

/** Use before navigating: the page then reports `prefers-reduced-motion: reduce`. */
export async function emulateReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
}

/** FR-3: with reduced motion on, nothing runs forever (light line, vent texture, pulse dots). */
export async function expectReducedMotion(page: Page): Promise<void> {
  const o = await page.evaluate(() => ({
    reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
    looping: document
      .getAnimations()
      .filter((a) => {
        const t = a.effect?.getComputedTiming();
        return a.playState === "running" && t !== undefined && t.iterations === Number.POSITIVE_INFINITY;
      })
      .map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return `${(a as CSSAnimation).animationName ?? "animation"} on ${target?.tagName.toLowerCase() ?? "?"}`;
      }),
  }));
  expect(o.reduce, "prefers-reduced-motion is reduce (call emulateReducedMotion first)").toBe(true);
  expect(o.looping, "infinite animations running under reduced motion").toEqual([]);
}

export async function setViewport(page: Page, width: number, height = 800): Promise<void> {
  await page.setViewportSize({ width, height });
}

export interface Computed {
  canvas: string;
  bodyFont: string;
  headlineStretch: string | null;
  radii: string[];
  backdrop: string[];
}

/** Computed styles read by the per-screen specs (canvas, fonts, radii, backdrop-filter). */
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
  const canvas = await page.evaluate(() => {
    const bg = (el: Element) => getComputedStyle(el).backgroundColor;
    const c = bg(document.body);
    return c === "rgba(0, 0, 0, 0)" ? bg(document.documentElement) : c;
  });
  // FR-10: canvas follows the scheme (dark palette is dark, light is light).
  if (scheme === "dark") expect.soft(luminance(canvas), `dark canvas ${canvas}`).toBeLessThan(0.1);
  else expect.soft(luminance(canvas), `light canvas ${canvas}`).toBeGreaterThan(0.5);
  await expectV2Look(page);
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
