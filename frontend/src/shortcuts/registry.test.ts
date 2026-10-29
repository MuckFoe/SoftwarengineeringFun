import { describe, expect, it } from "vitest";
import { type Scope, SHORTCUTS, type ShortcutId } from "./registry";
import { BROWSER_RESERVED, canonical, EDITOR_KEYMAP } from "./reserved";

const PLATFORMS = [
  { mac: true, os: "mac" as const, combo: "mac" as const },
  { mac: false, os: "windows" as const, combo: "other" as const },
];

// The editor is only mounted in the session window, so only shortcuts that can fire
// while it has focus are checked against its keymaps.
const EDITOR_SCOPES: readonly Scope[] = ["global", "session"];

// AC-18 names ⌘↩ / Ctrl+Enter for Run, which deliberately replaces CodeMirror's
// Mod-Enter (insertBlankLine) inside the editor. No other override is allowed.
const EDITOR_OVERRIDES: readonly ShortcutId[] = ["run"];

describe("canonical", () => {
  it("treats mod as ⌘ on macOS and as Ctrl elsewhere", () => {
    expect(canonical({ key: "s", mod: true }, true)).toBe(canonical({ key: "s", mod: true }, true));
    expect(canonical({ key: "s", mod: true }, false)).toBe(
      canonical({ key: "s", ctrl: true }, false),
    );
    expect(canonical({ key: "s", mod: true }, true)).not.toBe(
      canonical({ key: "s", ctrl: true }, true),
    );
    expect(canonical({ key: "A", ctrl: true }, true)).toBe(
      canonical({ key: "a", ctrl: true }, true),
    );
  });
});

describe("reserved tables", () => {
  it("covers Safari, Chrome, Firefox and Edge on macOS and Windows", () => {
    for (const os of ["mac", "windows"] as const) {
      for (const browser of ["safari", "chrome", "firefox", "edge"] as const) {
        if (os === "windows" && browser === "safari") continue;
        expect(BROWSER_RESERVED[os][browser]?.length ?? 0, `${os}/${browser}`).toBeGreaterThan(20);
      }
    }
  });

  it("includes the combos the plan names", () => {
    const mac = new Set(
      Object.values(BROWSER_RESERVED.mac)
        .flat()
        .map((c) => canonical(c, true)),
    );
    for (const c of [
      { key: "t", mod: true },
      { key: "w", mod: true },
      { key: "l", mod: true },
      { key: "r", mod: true },
      { key: "i", mod: true, alt: true },
      { key: "c", mod: true, shift: true },
      { key: "f", mod: true, ctrl: true },
      { key: "q", mod: true, ctrl: true },
      { key: "d", mod: true, ctrl: true },
      { key: " ", mod: true, ctrl: true },
    ]) {
      expect(mac.has(canonical(c, true)), JSON.stringify(c)).toBe(true);
    }
  });

  it("is read from the real CodeMirror keymaps", () => {
    const mac = new Set(EDITOR_KEYMAP.mac.map((c) => canonical(c, true)));
    expect(mac.has(canonical({ key: "z", mod: true }, true))).toBe(true);
    expect(mac.has(canonical({ key: "f", mod: true }, true))).toBe(true);
    expect(mac.has(canonical({ key: "/", mod: true }, true))).toBe(true);
    const other = new Set(EDITOR_KEYMAP.other.map((c) => canonical(c, false)));
    expect(other.has(canonical({ key: "y", ctrl: true }, false))).toBe(true);
  });
});

describe("SHORTCUTS", () => {
  // AC-18a (registry part)
  it("names every FR-17 action exactly once", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(
      new Set<ShortcutId>([
        "run",
        "close",
        "defaultButton",
        "focusSearch",
        "newProblem",
        "saveProblem",
        "toggleSidebar",
        "toggleRunPanel",
        "toggleChat",
        "nextProblem",
        "previousProblem",
        "copyInviteLink",
        "appearance",
        "shortcutList",
      ]),
    );
  });

  // AC-18b
  for (const { mac, os, combo } of PLATFORMS) {
    it(`uses no combo a browser reserves on ${os}`, () => {
      for (const [browser, reserved] of Object.entries(BROWSER_RESERVED[os])) {
        const taken = new Set(reserved.map((c) => canonical(c, mac)));
        for (const s of SHORTCUTS) {
          expect(taken.has(canonical(s[combo], mac)), `${s.id} vs ${browser}/${os}`).toBe(false);
        }
      }
    });

    it(`uses no combo the editor binds on ${os}`, () => {
      const taken = new Set(EDITOR_KEYMAP[combo].map((c) => canonical(c, mac)));
      for (const s of SHORTCUTS) {
        if (!EDITOR_SCOPES.includes(s.scope) || EDITOR_OVERRIDES.includes(s.id)) continue;
        expect(taken.has(canonical(s[combo], mac)), `${s.id} vs CodeMirror`).toBe(false);
      }
    });

    it(`has no duplicate combo within a scope plus global on ${os}`, () => {
      for (const scope of ["session", "problems", "sheet"] as const) {
        const active = SHORTCUTS.filter((s) => s.scope === scope || s.scope === "global");
        const combos = active.map((s) => canonical(s[combo], mac));
        expect(new Set(combos).size, scope).toBe(combos.length);
      }
    });
  }

  it("lists only the documented editor overrides, and they really override", () => {
    for (const id of EDITOR_OVERRIDES) {
      const s = SHORTCUTS.find((x) => x.id === id);
      expect(s).toBeDefined();
      if (!s) continue;
      expect(EDITOR_KEYMAP.mac.map((c) => canonical(c, true))).toContain(canonical(s.mac, true));
    }
  });
});
