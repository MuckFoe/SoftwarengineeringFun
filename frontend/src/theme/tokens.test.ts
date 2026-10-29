import { describe, expect, it } from "vitest";
import raw from "./tokens.css?raw";

const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

// Custom properties declared directly inside the first block whose selector is exactly `selector`.
function block(selector: string): Map<string, string> {
  const escaped = selector.replace(/[[\]()"=]/g, "\\$&");
  const match = new RegExp(`(^|})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no block for ${selector}`);
  const props = new Map<string, string>();
  for (const decl of (match[2] ?? "").split(";")) {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
    if (m?.[1] && m[2]) props.set(m[1], m[2]);
  }
  return props;
}

const light = block(":root");
const dark = block(':root[data-appearance="dark"]');

// A token is a colour token when its value contains a literal colour (shadows included).
// Aliases such as `var(--accent)` follow whichever block defines their target.
const COLOUR = /(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\()/i;
const colourTokens = (props: Map<string, string>) =>
  [...props].filter(([, value]) => COLOUR.test(value)).map(([name]) => name);

describe("theme tokens", () => {
  it("defines colour tokens on :root", () => {
    expect(colourTokens(light).length).toBeGreaterThan(10);
  });

  // FR-7: dark has no light-only leftovers.
  it("redefines every :root colour token in the dark block, and nothing else", () => {
    expect(new Set(colourTokens(dark))).toEqual(new Set(colourTokens(light)));
    expect([...dark.keys()].sort()).toEqual(colourTokens(light).sort());
  });

  // FR-1: one accent.
  it("has exactly one accent token family, also applied as accent-color", () => {
    const accentLike = [...light.keys()].filter((n) => /accent|tint|brand|primary/.test(n));
    expect(accentLike.length).toBeGreaterThan(0);
    for (const name of accentLike) expect(name).toMatch(/^--accent(-[a-z]+)*$/);
    expect(light.has("--accent")).toBe(true);
    expect(css).toMatch(/accent-color:\s*var\(--accent\)/);
  });

  // FR-1, NFR-1: system typeface by family name only.
  it("references fonts by family name only", () => {
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/url\(/);
    const fonts = [...light].filter(([n]) => n.startsWith("--font-"));
    expect(fonts.map(([n]) => n).sort()).toEqual(["--font-mono", "--font-text"]);
    for (const [, value] of fonts) expect(value).not.toMatch(/\.(otf|ttf|woff2?)/i);
    expect(light.get("--font-text")).toMatch(/^system-ui,/);
    expect(light.get("--font-mono")).toMatch(/^ui-monospace,/);
  });

  // FR-1: HIG macOS type scale.
  it("uses the HIG macOS type scale", () => {
    const scale = (name: string) => light.get(name)?.replace(/\s+/g, "");
    expect(scale("--type-body")).toBe("13px/16px");
    expect(scale("--type-title2")).toBe("17px/22px");
  });

  // FR-1: generous, regular spacing.
  it("uses a 4 px spacing grid", () => {
    const spacing = [...light].filter(([n]) => n.startsWith("--space-"));
    expect(spacing.length).toBeGreaterThan(3);
    for (const [name, value] of spacing) {
      const px = /^(\d+)px$/.exec(value);
      expect(px, name).not.toBeNull();
      expect(Number(px?.[1]) % 4, name).toBe(0);
    }
  });

  it("rounds controls at 6 px and sheets/popovers at 10 px", () => {
    expect(light.get("--radius-control")).toBe("6px");
    expect(light.get("--radius-sheet")).toBe("10px");
  });

  it("defines a focus ring token", () => {
    expect(light.has("--focus-ring")).toBe(true);
  });
});
