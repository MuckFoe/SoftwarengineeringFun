/**
 * Combos the app must not use (FR-20, AC-18b): what Safari, Chrome, Firefox and Edge on
 * macOS and Windows keep for themselves, and every binding in the CodeMirror keymaps the
 * editor loads (`basicSetup`). Checked against `SHORTCUTS` by the registry test only.
 *
 * Combos are written CodeMirror-style ("Shift-Mod-t"); `Mod` is ⌘ on macOS, Ctrl elsewhere.
 */
import { closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import type { KeyBinding } from "@codemirror/view";
import type { Combo } from "./registry";

export type Os = "mac" | "windows";
export type Browser = "safari" | "chrome" | "firefox" | "edge";

/** One comparable string per physical combo: `mod` becomes ⌘ on macOS and Ctrl elsewhere. */
export function canonical(c: Combo, mac: boolean): string {
  const meta = mac && c.mod;
  const ctrl = c.ctrl || (!mac && c.mod);
  const key = c.key.length === 1 ? c.key.toLowerCase() : c.key;
  return [meta && "meta", ctrl && "ctrl", c.alt && "alt", c.shift && "shift", key]
    .filter(Boolean)
    .join("+");
}

/** Parses a CodeMirror key name such as "Shift-Mod-k", "Ctrl-Space" or "Mod-[". */
export function parse(name: string): Combo {
  const parts = name.split(/-(?!$)/);
  const combo: Combo = { key: parts.pop() ?? "" };
  for (const mod of parts) {
    if (/^(cmd|meta|m)$/i.test(mod) || mod === "Mod") combo.mod = true;
    else if (/^(ctrl|control|c)$/i.test(mod)) combo.ctrl = true;
    else if (/^(alt|a)$/i.test(mod)) combo.alt = true;
    else if (/^(shift|s)$/i.test(mod)) combo.shift = true;
    else throw new Error(`unknown modifier ${mod} in ${name}`);
  }
  if (combo.key === "Space") combo.key = " ";
  return combo;
}

const all = (names: string) => names.trim().split(/\s+/).map(parse);
const digits = (mod: string) => [..."123456789"].map((d) => parse(`${mod}-${d}`));

// macOS: tabs/windows, address bar, history, reload, zoom, find-in-page helpers, print,
// devtools (incl. ⌥⌘I, ⌥⌘J, ⌥⌘C, ⇧⌘C, ⌥⌘U), fullscreen ⌃⌘F, and OS combos.
// ⌘, (Settings) is a browser menu item but pages can intercept it, so it isn't listed;
// the shortcut E2E (task 36) confirms that in each browser.
const MAC_COMMON = [
  ...all(`
    Mod-t Mod-n Shift-Mod-n Mod-w Shift-Mod-w Mod-q Shift-Mod-t
    Mod-l Mod-[ Mod-] Alt-Mod-ArrowLeft Alt-Mod-ArrowRight Shift-Mod-[ Shift-Mod-]
    Ctrl-Tab Shift-Ctrl-Tab Mod-r Shift-Mod-r
    Alt-Mod-i Alt-Mod-j Alt-Mod-c Shift-Mod-c Alt-Mod-u
    Ctrl-Mod-f Mod-h Alt-Mod-h Mod-m Mod-\` Mod-Tab Mod-Space
    Ctrl-Mod-q Ctrl-Mod-d Ctrl-Mod-Space
    Mod-p Mod-d Mod-= Mod-+ Mod-- Mod-0 Mod-o Mod-e Mod-g Shift-Mod-g
    Shift-Mod-b Alt-Mod-b Shift-Mod-Backspace
  `),
  ...digits("Mod"),
];

// Windows: the same families with Ctrl, plus F-keys and Alt navigation.
const WINDOWS_COMMON = [
  ...all(`
    Mod-t Mod-n Shift-Mod-n Mod-w Mod-F4 Shift-Mod-w Alt-F4 Shift-Mod-t
    Mod-l Alt-d F6 Mod-e Mod-k Alt-ArrowLeft Alt-ArrowRight Alt-Home
    Mod-Tab Shift-Mod-Tab Mod-PageDown Mod-PageUp
    Mod-r F5 Mod-F5 Shift-Mod-r Shift-F5
    F12 Shift-Mod-i Shift-Mod-j Shift-Mod-c Mod-u
    F11 Mod-h Mod-j Mod-d Shift-Mod-b Shift-Mod-o Shift-Mod-Delete
    Mod-p Mod-o Mod-= Mod-+ Mod-- Mod-0 Mod-g Shift-Mod-g
    Ctrl-Alt-Delete Shift-Ctrl-Escape Alt-Tab Alt-Space
  `),
  ...digits("Mod"),
];

export const BROWSER_RESERVED: Record<Os, Partial<Record<Browser, readonly Combo[]>>> = {
  mac: {
    safari: [...MAC_COMMON, ...all("Shift-Mod-\\ Alt-Mod-l Shift-Mod-l Alt-Mod-e Shift-Mod-h")],
    chrome: [...MAC_COMMON, ...all("Mod-y Shift-Mod-j Alt-Mod-a Shift-Mod-m")],
    firefox: [
      ...MAC_COMMON,
      ...all("Shift-Mod-p Shift-Mod-k Shift-Mod-m Shift-Mod-e Shift-Mod-a Mod-y"),
    ],
    edge: [
      ...MAC_COMMON,
      ...all("Mod-y Shift-Mod-j Shift-Mod-a Shift-Mod-, Shift-Mod-y Shift-Mod-e"),
    ],
  },
  windows: {
    chrome: [...WINDOWS_COMMON, ...all("Shift-Mod-a Shift-Mod-m Shift-Mod-q")],
    firefox: [
      ...WINDOWS_COMMON,
      ...all("Shift-Mod-p Shift-Mod-k Shift-Mod-m Shift-Mod-e Shift-Mod-a"),
    ],
    edge: [
      ...WINDOWS_COMMON,
      ...all("Shift-Mod-a Shift-Mod-, Shift-Mod-y Shift-Mod-e Shift-Mod-l"),
    ],
  },
};

const EDITOR_BINDINGS: readonly KeyBinding[] = [
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...searchKeymap,
  ...historyKeymap,
  ...foldKeymap,
  ...completionKeymap,
  ...lintKeymap,
];

function editorCombos(pick: (b: KeyBinding) => string | undefined): Combo[] {
  return EDITOR_BINDINGS.map(pick)
    .filter((k): k is string => k !== undefined)
    .map(parse);
}

/** Every combo the editor binds; "other" covers both CodeMirror's `win` and `linux` overrides. */
export const EDITOR_KEYMAP: { mac: readonly Combo[]; other: readonly Combo[] } = {
  mac: editorCombos((b) => b.mac ?? b.key),
  other: [...editorCombos((b) => b.win ?? b.key), ...editorCombos((b) => b.linux ?? b.key)],
};
