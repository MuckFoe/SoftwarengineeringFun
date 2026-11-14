/**
 * The user's text size: one of five steps of the type scale. Every text size in
 * styles/tokens.css is its kit value times `--text-scale`, so the sizes keep their ratios.
 * Pure apart from `localStorage` and the <html> style; storage failures fall back to the
 * default. The inline script in `index.html` applies the same rules before first paint; keep
 * the two in step.
 */
export type TextSize = "xs" | "s" | "m" | "l" | "xl";

export const DEFAULT_TEXT_SIZE: TextSize = "s";

export const TEXT_SCALE: Record<TextSize, number> = {
  xs: 0.625,
  s: 0.75,
  m: 0.875,
  l: 1,
  xl: 1.125,
};

const KEY = "textSize";

export function isTextSize(v: unknown): v is TextSize {
  return typeof v === "string" && Object.hasOwn(TEXT_SCALE, v);
}

export function loadTextSize(): TextSize {
  try {
    const stored = localStorage.getItem(KEY);
    return isTextSize(stored) ? stored : DEFAULT_TEXT_SIZE;
  } catch {
    return DEFAULT_TEXT_SIZE;
  }
}

export function saveTextSize(size: TextSize): void {
  try {
    // The default is the absence of a stored value, like appearance's "system".
    if (size === DEFAULT_TEXT_SIZE) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, size);
  } catch {
    // Storage unavailable: the size still applies for this page, it just isn't kept.
  }
}

/** Sets `--text-scale` on <html>, overriding the default in tokens.css. */
export function applyTextSize(size: TextSize): void {
  document.documentElement.style.setProperty("--text-scale", String(TEXT_SCALE[size]));
}
