import { HighlightStyle } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { APPEARANCES, colourOf, contrastRatio, PAIRS } from "../styles/contrast";
import tokensCss from "../styles/tokens.css?raw";
import { editorTheme, highlightSpecs, themeSpec } from "./editorTheme";

const COLOUR_PROP = /color|background|border|outline(?!Offset)|fill|stroke|shadow|caret/i;
const LITERAL_COLOUR =
  /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|lab|lch)\(|\b(white|black|red|green|blue|gray|grey)\b/i;

/** Every [property, value] pair in a nested theme spec. */
function* declarations(spec: object, path = ""): Generator<[string, string]> {
  for (const [key, value] of Object.entries(spec)) {
    if (value && typeof value === "object") yield* declarations(value, `${path} ${key}`);
    else yield [`${path} ${key}`.trim(), String(value)];
  }
}

const tokenNames = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

function checkColours(pairs: Iterable<[string, string]>) {
  let colours = 0;
  for (const [prop, value] of pairs) {
    expect(value.replace(/var\(--[\w-]+\)/g, ""), prop).not.toMatch(LITERAL_COLOUR);
    const last = prop.split(" ").pop() ?? "";
    if (COLOUR_PROP.test(last) && value !== "none" && value !== "transparent") {
      colours++;
      expect(value, prop).toMatch(/var\(--[\w-]+\)/);
    }
    for (const m of value.matchAll(/var\((--[\w-]+)\)/g)) {
      expect(tokenNames.has(m[1]), `${prop}: ${m[1]} is not a token`).toBe(true);
    }
  }
  return colours;
}

describe("editor theme", () => {
  // FR-7
  it("colours the editor with tokens only", () => {
    expect(checkColours(declarations(themeSpec))).toBeGreaterThan(8);
  });

  it("colours syntax with tokens only", () => {
    const pairs = highlightSpecs.flatMap(({ tag: _tag, ...style }) => [...declarations(style)]);
    expect(checkColours(pairs)).toBeGreaterThan(5);
  });

  it("builds a theme extension and a highlight style", () => {
    expect(editorTheme.length).toBe(2);
    expect(HighlightStyle.define(highlightSpecs)).toBeInstanceOf(HighlightStyle);
  });

  // FR-1, FR-10: the Audi mapping of plan 1.8
  it("maps chrome and syntax to the Audi tokens", () => {
    const syntax = (tagColour: string) =>
      highlightSpecs.find((h) => h.color === tagColour || String(h.color).includes(tagColour));
    expect(themeSpec["&"].backgroundColor).toBe("var(--surface-1)");
    expect(themeSpec[".cm-gutters"].backgroundColor).toBe("var(--surface-1)");
    expect(themeSpec[".cm-content"].caretColor).toBe("var(--focus)");
    expect(themeSpec[".cm-scroller"].fontFamily).toMatch(/monospace/);
    expect(syntax("var(--form-caption)")).toBeDefined();
    expect(syntax("var(--intelligent)")).toBeDefined();
    expect(syntax("var(--negative)")).toBeDefined();
    const kw = highlightSpecs.find((h) => h.color === "var(--text-interactive)");
    expect(kw?.fontWeight).toBe("bold");
    const num = highlightSpecs.find((h) => String(h.color).includes("--neon-blue"));
    expect(num).toBeDefined();
  });

  it("keeps the old appearance tokens out", () => {
    const all = [
      ...declarations(themeSpec),
      ...highlightSpecs.flatMap(({ tag: _tag, ...style }) => [...declarations(style)]),
    ]
      .map(([, v]) => v)
      .join(" ");
    expect(all).not.toMatch(/--(label|content-bg|accent|status-|syntax-|control-|window-bg)/);
  });

  // FR-10: every syntax pair is in the contrast list and the number mix passes on both appearances
  it("lists the syntax pairs and the number colour clears 4.5:1", () => {
    const names = PAIRS.map((p) => p.name);
    for (const n of ["editor comment", "editor keyword", "editor string", "editor number"]) {
      expect(names).toContain(n);
    }
    const number = PAIRS.find((p) => p.name === "editor number")!;
    for (const a of APPEARANCES) {
      expect(
        contrastRatio(colourOf(number.fg as string, a), colourOf(number.bg, a)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    const value = String(
      highlightSpecs.find((h) => String(h.color).includes("--neon-blue"))?.color,
    );
    expect(value).toBe("color-mix(in srgb, var(--neon-blue) 80%, var(--text-interactive))");
  });
});
