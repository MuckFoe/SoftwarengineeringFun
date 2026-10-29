/**
 * Platform detection, keydown → combo matching and label rendering (FR-17).
 * `mod` is ⌘ (Meta) on macOS and Ctrl elsewhere.
 */
import type { Combo } from "./registry";

export function isMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform ?? "");
}

/** The physical key for printable combo keys, used when a modifier changes `event.key`. */
function codeFor(key: string): string | undefined {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return { "/": "Slash", ",": "Comma", ".": "Period" }[key];
}

export function matches(e: KeyboardEvent, c: Combo, mac: boolean): boolean {
  const meta = mac && !!c.mod;
  const ctrl = !!c.ctrl || (!mac && !!c.mod);
  if (e.metaKey !== meta || e.ctrlKey !== ctrl) return false;
  if (e.altKey !== !!c.alt || e.shiftKey !== !!c.shift) return false;

  const key = c.key.length === 1 ? c.key.toLowerCase() : c.key;
  const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (pressed === key) return true;

  // Off macOS, Ctrl+Alt may be AltGr: when it types a character (ś, €), it's text, not a
  // shortcut, so only an exact `key` match counts.
  if (!mac && e.ctrlKey && e.altKey) return false;
  // Option and Shift change `key` (⌥N → ˜, ⇧/ → ?), so fall back to the physical key.
  return (!!c.alt || !!c.shift) && e.code !== "" && e.code === codeFor(key);
}

const MAC_KEYS: Record<string, string> = {
  Enter: "↩",
  Escape: "⎋",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "⇞",
  PageDown: "⇟",
  " ": "Space",
};

const OTHER_KEYS: Record<string, string> = {
  Escape: "Esc",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
};

export function label(c: Combo, mac: boolean): string {
  const keyName = (names: Record<string, string>) =>
    names[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key);
  if (mac) {
    const mods = `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.mod ? "⌘" : ""}`;
    return mods + keyName(MAC_KEYS);
  }
  const mods = [c.mod || c.ctrl ? "Ctrl" : "", c.alt ? "Alt" : "", c.shift ? "Shift" : ""];
  return [...mods.filter(Boolean), keyName(OTHER_KEYS)].join("+");
}
