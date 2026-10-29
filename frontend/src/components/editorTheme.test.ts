import { HighlightStyle } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import tokensCss from "../theme/tokens.css?raw";
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
    expect(value, prop).not.toMatch(LITERAL_COLOUR);
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
});
