import { describe, expect, it } from "vitest";
import kit from "./kit-values.json";
import raw from "./tokens.css?raw";

// Spec 015 task 2: tokens.css is pinned to kit-values.json (values only, transcribed from
// docs/research/audi-figma-kit-tokens.md). The appearance attribute is data-appearance (decision 1).

type Decls = Map<string, string>;
interface Rule {
  media: string | null;
  selector: string;
  decls: Decls;
}

const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

function parseDecls(body: string): Decls {
  const out: Decls = new Map();
  for (const d of body.split(";")) {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
    if (m?.[1] && m[2]) out.set(m[1], m[2].replace(/\s+/g, " "));
  }
  return out;
}

// Minimal brace-aware parser: top-level rules and one level of @media nesting.
function parse(src: string, media: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (head.startsWith("@media")) rules.push(...parse(body, head.slice(6).trim()));
    else rules.push({ media, selector: head.replace(/\s+/g, " "), decls: parseDecls(body) });
    i = j;
  }
  return rules;
}

const rules = parse(css);
const LIGHT = ":root";
const EXPLICIT_LIGHT = ':root[data-appearance="light"]';
const EXPLICIT_DARK = ':root[data-appearance="dark"]';
const SYSTEM_DARK = ":root:not([data-appearance])";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
const widthOf = (media: string) => {
  const m = /^\(min-width:\s*(\d+)px\)$/.exec(media);
  return m ? Number(m[1]) : null;
};

type Path = "light" | "explicit-light" | "dark" | "system-dark" | "system-dark-attr-set";

// Resolve every variable the way the cascade would for a given path and viewport width.
function resolve(path: Path, width = 1440): Decls {
  const out: Decls = new Map();
  const apply = (r: Rule) => r.decls.forEach((v, k) => out.set(k, v));
  const sel: Record<Path, string[]> = {
    light: [LIGHT],
    "explicit-light": [LIGHT, EXPLICIT_LIGHT],
    dark: [LIGHT, EXPLICIT_DARK],
    "system-dark": [LIGHT, SYSTEM_DARK],
    "system-dark-attr-set": [LIGHT],
  };
  for (const s of sel[path]) {
    for (const r of rules) {
      if (r.selector !== s) continue;
      if (r.media === null) apply(r);
      else if (r.media === DARK_QUERY && s === SYSTEM_DARK) apply(r);
    }
  }
  for (const r of rules) {
    const w = r.media ? widthOf(r.media) : null;
    if (w !== null && w <= width && r.selector === LIGHT) apply(r);
  }
  return out;
}

const hasDarkRule = rules.some((r) => r.media === DARK_QUERY && r.selector === SYSTEM_DARK);

// Variables named in plan 1.3, spelled out independently of kit-values.json.
const SECTION_1_3 = [
  "--canvas",
  "--canvas-inverted",
  "--surface-1",
  "--surface-2",
  "--surface-3",
  "--surface-4",
  "--highlight",
  "--on-highlight",
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--neutral-${n}00`),
  "--action-primary-fill",
  "--action-primary-fill-hover",
  "--action-primary-fill-disabled",
  "--action-primary-text",
  "--action-secondary-stroke",
  "--action-secondary-stroke-hover",
  "--action-secondary-stroke-disabled",
  "--action-secondary-fill-pressed",
  "--action-text",
  "--action-text-hover",
  "--action-text-disabled",
  "--form-stroke",
  "--form-stroke-active",
  "--form-stroke-error",
  "--form-stroke-disabled",
  "--form-stroke-readonly",
  "--form-underline",
  "--form-underline-active",
  "--form-underline-error",
  "--form-underline-disabled",
  "--form-text",
  "--form-caption",
  "--form-text-active",
  "--form-text-error",
  "--form-text-disabled",
  "--form-readonly-fill",
  "--nav-active",
  "--nav-idle",
  "--nav-disabled",
  "--nav-pressed",
  "--divider",
  "--ui-stroke",
  "--ui-stroke-hover",
  "--ui-stroke-disabled",
  "--text",
  "--text-interactive",
  "--text-disabled",
  "--scrim",
  "--focus",
  "--negative",
  "--success",
  "--notice",
  "--intelligent",
  "--neon-blue",
  "--radius-0",
  "--radius-xs",
  "--radius-sm",
  "--radius-md",
  "--radius-max",
  "--bw-1",
  "--bw-2",
  "--bw-3",
  "--bw-focus",
  ...[2, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128].map(
    (n) => `--space-${n}`,
  ),
  "--page-margin",
  "--elev-1",
  "--elev-2",
  "--elev-3",
  "--elev-4",
  "--elev-card",
  "--font-copy",
  "--font-display",
  "--wdth-copy",
  "--wdth-display",
  ...[
    "display-1",
    "display-2",
    "h1",
    "h2",
    "h3",
    "h4",
    "copy-1",
    "copy-2",
    "copy-3",
    "label-1",
    "label-2",
    "label-3",
  ].flatMap((n) => [`--fs-${n}`, `--lh-${n}`]),
  "--ease-audi",
  "--dur-fast",
  "--dur-base",
];

const colour = Object.entries(kit.colour) as [string, { light: string; dark: string }][];
const shared = Object.entries(kit.shared) as [string, string][];
const responsive = Object.entries(kit.responsive) as [string, Record<string, string>][];

describe("token contract (FR-1, Consistency NFR)", () => {
  it("defines every variable named in plan 1.3", () => {
    const defined = resolve("light", 1920);
    const missing = SECTION_1_3.filter((n) => !defined.has(n));
    expect(missing).toEqual([]);
  });

  it("kit-values.json covers every variable named in plan 1.3", () => {
    const known = new Set([
      ...Object.keys(kit.colour),
      ...Object.keys(kit.shared),
      ...Object.keys(kit.responsive),
    ]);
    expect(SECTION_1_3.filter((n) => !known.has(n))).toEqual([]);
  });

  it.each([
    ["light", "light"],
    ["explicit-light", "light"],
    ["dark", "dark"],
    ["system-dark", "dark"],
  ] as [Path, "light" | "dark"][])(
    "colours resolve to the kit values on the %s path",
    (path, mode) => {
      const got = resolve(path);
      for (const [name, v] of colour)
        expect([name, norm(got.get(name) ?? "")]).toEqual([name, norm(v[mode])]);
    },
  );

  it("shared values (radius, stroke, spacing, elevation, type, motion) match the kit in every path", () => {
    for (const path of ["light", "explicit-light", "dark", "system-dark"] as Path[]) {
      const got = resolve(path);
      for (const [name, v] of shared)
        expect([path, name, norm(got.get(name) ?? "")]).toEqual([path, name, norm(v)]);
    }
  });

  it("responsive type scale and page margin match the kit at every breakpoint", () => {
    for (const w of [320, 375, 768, 1024, 1440, 1920]) {
      const got = resolve("light", w);
      for (const [name, byWidth] of responsive) {
        const key = [...Object.keys(byWidth)]
          .map(Number)
          .filter((b) => b <= w)
          .sort((a, b) => b - a)[0];
        expect([w, name, got.get(name)]).toEqual([w, name, byWidth[String(key)]]);
      }
    }
  });

  it("uses the kit breakpoints for its media queries", () => {
    const widths = new Set(
      rules.map((r) => (r.media ? widthOf(r.media) : null)).filter((w) => w !== null),
    );
    for (const w of widths) expect(kit.breakpoints).toContain(w);
  });

  it("is the only place colours are literal: no var is defined on selectors other than the four theme blocks and breakpoints", () => {
    const allowed = new Set([LIGHT, EXPLICIT_LIGHT, EXPLICIT_DARK, SYSTEM_DARK]);
    expect(rules.filter((r) => !allowed.has(r.selector))).toEqual([]);
  });
});

describe("appearance paths (FR-6)", () => {
  it("has a prefers-color-scheme: dark block scoped to :root:not([data-appearance])", () => {
    expect(hasDarkRule).toBe(true);
  });

  it("system dark resolves to exactly the explicit dark palette", () => {
    const sys = resolve("system-dark");
    const dark = resolve("dark");
    expect([...sys].sort()).toEqual([...dark].sort());
  });

  it("an explicit data-appearance wins over a dark system preference", () => {
    // The media block only matches when no attribute is set, so the explicit light block is never overridden.
    const media = rules.filter((r) => r.media === DARK_QUERY);
    expect(media.every((r) => r.selector.includes(":not([data-appearance])"))).toBe(true);
    const attrSet = resolve("system-dark-attr-set");
    expect(norm(attrSet.get("--canvas") ?? "")).toBe("#ffffff");
    expect(norm(resolve("explicit-light").get("--canvas") ?? "")).toBe("#ffffff");
  });
});
