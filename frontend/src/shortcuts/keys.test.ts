import { describe, expect, it } from "vitest";
import { isMac, label, matches } from "./keys";
import { type Combo, SHORTCUTS } from "./registry";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
const shortcut = (id: string) => {
  const s = SHORTCUTS.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};

describe("matches", () => {
  // AC-18
  it("matches Run as ⌘↩ on macOS and Ctrl+Enter elsewhere, not the other way round", () => {
    const run = shortcut("run");
    const cmdEnter = key({ key: "Enter", code: "Enter", metaKey: true });
    const ctrlEnter = key({ key: "Enter", code: "Enter", ctrlKey: true });
    expect(matches(cmdEnter, run.mac, true)).toBe(true);
    expect(matches(ctrlEnter, run.other, false)).toBe(true);
    expect(matches(ctrlEnter, run.mac, true)).toBe(false);
    expect(matches(cmdEnter, run.other, false)).toBe(false);
  });

  it("requires the exact modifiers", () => {
    const run = shortcut("run");
    expect(matches(key({ key: "Enter", metaKey: true, shiftKey: true }), run.mac, true)).toBe(
      false,
    );
    expect(matches(key({ key: "Enter" }), run.mac, true)).toBe(false);
  });

  it("matches letters regardless of case", () => {
    const save: Combo = { key: "s", mod: true };
    expect(matches(key({ key: "S", code: "KeyS", ctrlKey: true }), save, false)).toBe(true);
  });

  it("matches ⌥⌘N on macOS although Option changes the key to a symbol", () => {
    const next = shortcut("newProblem");
    const e = key({ key: "˜", code: "KeyN", metaKey: true, altKey: true });
    expect(matches(e, next.mac, true)).toBe(true);
  });

  it("matches ⇧⌘/ although Shift turns / into ?", () => {
    const list = shortcut("shortcutList");
    const e = key({ key: "?", code: "Slash", metaKey: true, shiftKey: true });
    expect(matches(e, list.mac, true)).toBe(true);
    const other = key({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true });
    expect(matches(other, list.other, false)).toBe(true);
  });

  it("matches Ctrl+Alt combos off macOS when the key produces no character", () => {
    const sidebar = shortcut("toggleSidebar");
    expect(
      matches(key({ key: "s", code: "KeyS", ctrlKey: true, altKey: true }), sidebar.other, false),
    ).toBe(true);
    const next = shortcut("nextProblem");
    expect(
      matches(
        key({ key: "PageDown", code: "PageDown", ctrlKey: true, altKey: true }),
        next.other,
        false,
      ),
    ).toBe(true);
  });

  // Known risk: AltGr is Ctrl+Alt on some European layouts.
  it("never matches a Ctrl+Alt key that types a character (AltGr)", () => {
    const e = key({ key: "ś", code: "KeyS", ctrlKey: true, altKey: true });
    for (const s of SHORTCUTS) {
      expect(matches(e, s.other, false), s.id).toBe(false);
      expect(matches(e, s.mac, true), s.id).toBe(false);
    }
  });
});

describe("label", () => {
  // AC-18
  it("renders Run as ⌘↩ and Ctrl+Enter", () => {
    const run = shortcut("run");
    expect(label(run.mac, true)).toBe("⌘↩");
    expect(label(run.other, false)).toBe("Ctrl+Enter");
  });

  it("orders macOS modifiers ⌃⌥⇧⌘ and spells them out elsewhere", () => {
    expect(label(shortcut("nextProblem").mac, true)).toBe("⌃⌘↓");
    expect(label(shortcut("newProblem").mac, true)).toBe("⌥⌘N");
    expect(label(shortcut("shortcutList").mac, true)).toBe("⇧⌘/");
    expect(label(shortcut("nextProblem").other, false)).toBe("Ctrl+Alt+PageDown");
    expect(label(shortcut("shortcutList").other, false)).toBe("Ctrl+Shift+/");
    expect(label(shortcut("close").other, false)).toBe("Esc");
    expect(label(shortcut("close").mac, true)).toBe("⎋");
  });
});

describe("isMac", () => {
  it("returns a boolean from the platform", () => {
    expect(typeof isMac()).toBe("boolean");
  });
});
