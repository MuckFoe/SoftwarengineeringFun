import kit from "./kit-values.json";

// Spec 015 task 5 (plan 4): WCAG 2.x contrast over declared token pairs, per appearance.
// Later tasks append their pairs to PAIRS. Disabled states are exempt (WCAG) and not listed.
// Hex literals below are the provisional chess board values (plan 1.8) and the toast text
// colours; the raw-value guard must allowlist this file.

export type Appearance = "light" | "dark";
export const APPEARANCES: Appearance[] = ["light", "dark"];
export type Kind = "text" | "large" | "ui";
export const THRESHOLD: Record<Kind, number> = { text: 4.5, large: 3, ui: 3 };

type Rgba = [number, number, number, number];

function parseHex(hex: string): Rgba {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m?.[1]) throw new Error(`bad colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function over(fg: Rgba, bg: [number, number, number]): [number, number, number] {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a)) as [number, number, number];
}

/** WCAG ratio. A translucent bg is composited on bgBase (default white) first; a translucent fg over the result. */
export function contrastRatio(fg: string, bg: string, bgBase = "#FFFFFF"): number {
  const base = parseHex(bgBase);
  const solidBg = over(parseHex(bg), [base[0], base[1], base[2]]);
  const solidFg = over(parseHex(fg), solidBg);
  const l1 = luminance(solidFg);
  const l2 = luminance(solidBg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const colours = kit.colour as Record<string, { light: string; dark: string }>;

export function resolveToken(name: string, appearance: Appearance): string {
  const entry = colours[name];
  if (!entry) throw new Error(`unknown colour token: ${name}`);
  return entry[appearance];
}

/** Black or white, whichever has the higher ratio on the fill (plan 1.7 toast deviation). */
export function toastText(fill: string): string {
  return contrastRatio("#000000", fill) >= contrastRatio("#FFFFFF", fill) ? "#000000" : "#FFFFFF";
}

/** A colour is a token name ("--x"), a literal, or a per-appearance pick. */
export type Colour =
  | string
  | { light: string; dark: string }
  | ((fillOf: (c: Colour) => string, a: Appearance) => string);

export interface Pair {
  name: string;
  kind: Kind;
  /** One colour, or several where the element stays distinguishable if any one passes (chess fill or outline). */
  fg: Colour | Colour[];
  bg: Colour;
  /** Colour the (possibly translucent) bg sits on; defaults to --canvas. */
  base?: Colour;
}

export function colourOf(c: Colour, a: Appearance): string {
  if (typeof c === "function") return c((x) => colourOf(x, a), a);
  if (typeof c === "object") return colourOf(c[a], a);
  return c.startsWith("--") ? resolveToken(c, a) : c;
}

export function evaluatePair(p: Pair, a: Appearance): { ratio: number; fg: string; bg: string } {
  const bg = colourOf(p.bg, a);
  const base = colourOf(p.base ?? "--canvas", a);
  const fgs = (Array.isArray(p.fg) ? p.fg : [p.fg]).map((f) => colourOf(f, a));
  const scored = fgs.map((fg) => ({ fg, ratio: contrastRatio(fg, bg, base) }));
  const best = scored.reduce((x, y) => (y.ratio > x.ratio ? y : x));
  return { ratio: best.ratio, fg: best.fg, bg };
}

const toastOn =
  (signal: string): Colour =>
  (fill) =>
    toastText(fill(signal));

// Provisional chess board squares (plan 1.8); the test is the arbiter.
const BOARD_LIGHT: Colour = { light: "#E6E6E6", dark: "#B3B3B3" };
const BOARD_DARK: Colour = { light: "#808080", dark: "#4D4D4D" };
const PIECE_WHITE = "#FFFFFF";
const PIECE_BLACK = "#000000";

// Editor syntax (plan 1.8, provisional) on the editor background (--surface-1).
// --neon-blue in dark (#556EFE) is 4.18:1 on #1A1A1A, under 4.5. Task 27: numbers are
// color-mix(in srgb, var(--neon-blue) 80%, var(--text-interactive)) in editorTheme.ts, which
// follows the appearance (darker in light, lighter in dark); mirrored here.
function mixHex(a: string, b: string, weightA: number): string {
  const [x, y] = [parseHex(a), parseHex(b)];
  const ch = (i: number) =>
    Math.round(x[i]! * weightA + y[i]! * (1 - weightA))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}
const EDITOR_NUMBER: Colour = (fill) =>
  mixHex(fill("--neon-blue"), fill("--text-interactive"), 0.8);
const EDITOR_BG = "--surface-1";

export const PAIRS: Pair[] = [
  // Body and secondary text
  { name: "body text on canvas", kind: "text", fg: "--text", bg: "--canvas" },
  { name: "body text on surface-1", kind: "text", fg: "--text", bg: "--surface-1" },
  { name: "body text on surface-2", kind: "text", fg: "--text", bg: "--surface-2" },
  { name: "body text on hover tint", kind: "text", fg: "--text", bg: "--neutral-700" },
  { name: "interactive text on canvas", kind: "text", fg: "--text-interactive", bg: "--canvas" },
  { name: "secondary text (nav idle) on canvas", kind: "text", fg: "--nav-idle", bg: "--canvas" },
  {
    name: "secondary text (nav idle) on surface-1",
    kind: "text",
    fg: "--nav-idle",
    bg: "--surface-1",
  },
  {
    name: "secondary text (neutral-300) on canvas",
    kind: "text",
    fg: "--neutral-300",
    bg: "--canvas",
  },
  { name: "negative text on canvas", kind: "text", fg: "--negative", bg: "--canvas" },
  // Forms
  { name: "form text on canvas", kind: "text", fg: "--form-text", bg: "--canvas" },
  { name: "form text active on canvas", kind: "text", fg: "--form-text-active", bg: "--canvas" },
  { name: "form caption on canvas", kind: "text", fg: "--form-caption", bg: "--canvas" },
  { name: "form caption on surface-1", kind: "text", fg: "--form-caption", bg: "--surface-1" },
  { name: "form error text on canvas", kind: "text", fg: "--form-text-error", bg: "--canvas" },
  {
    name: "form text on readonly fill",
    kind: "text",
    fg: "--form-text",
    bg: "--form-readonly-fill",
  },
  { name: "form underline on canvas", kind: "ui", fg: "--form-underline", bg: "--canvas" },
  { name: "form stroke on canvas", kind: "ui", fg: "--form-stroke", bg: "--canvas" },
  { name: "divider-adjacent ui stroke on canvas", kind: "ui", fg: "--ui-stroke", bg: "--canvas" },
  // Actions
  {
    name: "action text on primary fill",
    kind: "text",
    fg: "--action-primary-text",
    bg: "--action-primary-fill",
  },
  {
    name: "action text on primary fill (hover)",
    kind: "text",
    fg: "--action-primary-text",
    bg: "--action-primary-fill-hover",
  },
  { name: "action text (tertiary) on canvas", kind: "text", fg: "--action-text", bg: "--canvas" },
  {
    name: "action text (tertiary, hover) on canvas",
    kind: "text",
    fg: "--action-text-hover",
    bg: "--canvas",
  },
  {
    name: "action text (secondary) on pressed fill",
    kind: "text",
    fg: "--action-text",
    bg: "--action-secondary-fill-pressed",
  },
  {
    name: "action secondary stroke on canvas",
    kind: "ui",
    fg: "--action-secondary-stroke",
    bg: "--canvas",
  },
  { name: "highlight text on canvas", kind: "text", fg: "--on-highlight", bg: "--highlight" },
  { name: "chat bubble other", kind: "text", fg: "--text", bg: "--neutral-700" },
  {
    name: "chat bubble own",
    kind: "text",
    fg: "--action-primary-text",
    bg: "--action-primary-fill",
  },
  // Toast: black or white text, whichever passes (plan 1.7)
  { name: "toast text on success fill", kind: "text", fg: toastOn("--success"), bg: "--success" },
  { name: "toast text on notice fill", kind: "text", fg: toastOn("--notice"), bg: "--notice" },
  {
    name: "toast text on negative fill",
    kind: "text",
    fg: toastOn("--negative"),
    bg: "--negative",
  },
  {
    name: "toast text on info fill",
    kind: "text",
    fg: "--canvas",
    bg: "--canvas-inverted",
  },
  // Focus
  { name: "focus ring on canvas", kind: "ui", fg: "--focus", bg: "--canvas" },
  { name: "focus ring on surface-1", kind: "ui", fg: "--focus", bg: "--surface-1" },
  // Chess (provisional): a piece reads if its fill or its outline passes against the square
  {
    name: "chess white piece on light square",
    kind: "ui",
    fg: [PIECE_WHITE, PIECE_BLACK],
    bg: BOARD_LIGHT,
  },
  {
    name: "chess white piece on dark square",
    kind: "ui",
    fg: [PIECE_WHITE, PIECE_BLACK],
    bg: BOARD_DARK,
  },
  {
    name: "chess black piece on light square",
    kind: "ui",
    fg: [PIECE_BLACK, PIECE_WHITE],
    bg: BOARD_LIGHT,
  },
  {
    name: "chess black piece on dark square",
    kind: "ui",
    fg: [PIECE_BLACK, PIECE_WHITE],
    bg: BOARD_DARK,
  },
  { name: "chess square boundary", kind: "ui", fg: BOARD_DARK, bg: BOARD_LIGHT },
  { name: "chess low-time clock on canvas", kind: "text", fg: "--negative", bg: "--canvas" },
  // Editor syntax (provisional) on the editor background
  { name: "editor plain/function text", kind: "text", fg: "--text", bg: EDITOR_BG },
  { name: "editor comment", kind: "text", fg: "--form-caption", bg: EDITOR_BG },
  { name: "editor keyword", kind: "text", fg: "--text-interactive", bg: EDITOR_BG },
  { name: "editor string", kind: "text", fg: "--intelligent", bg: EDITOR_BG },
  { name: "editor number", kind: "text", fg: EDITOR_NUMBER, bg: EDITOR_BG },
  { name: "editor error", kind: "text", fg: "--negative", bg: EDITOR_BG },
];
