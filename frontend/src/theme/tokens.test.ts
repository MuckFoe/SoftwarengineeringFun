import { describe, expect, it } from "vitest";
import base from "../styles/base.css?raw";
import raw from "../styles/tokens.css?raw";

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
// Spec 015 retarget: elevation shadows (--elev-*) are shared by both appearances (plan 1.3).
const colourTokens = (props: Map<string, string>) =>
  [...props]
    .filter(([name, value]) => COLOUR.test(value) && !name.startsWith("--elev-"))
    .map(([name]) => name);

describe("theme tokens", () => {
  it("defines colour tokens on :root", () => {
    expect(colourTokens(light).length).toBeGreaterThan(10);
  });

  // FR-7: dark has no light-only leftovers.
  it("redefines every :root colour token in the dark block, and nothing else", () => {
    expect(new Set(colourTokens(dark))).toEqual(new Set(colourTokens(light)));
    expect([...dark.keys()].sort()).toEqual(colourTokens(light).sort());
  });

  // FR-1: one accent. Spec 016 retarget: the single interactive family is --accent* plus its
  // --action-primary-* aliases; no second accent, tint or brand family exists.
  it("has exactly one primary-action token family, also applied as accent-color", () => {
    const accentLike = [...light.keys()].filter((n) => /accent|tint|brand|primary/.test(n));
    expect(accentLike.length).toBeGreaterThan(0);
    for (const name of accentLike)
      expect(name).toMatch(/^--(action-primary-[a-z-]+|accent(-hover|-press)?|on-accent)$/);
    expect(light.has("--action-primary-fill")).toBe(true);
    expect(base).toMatch(/accent-color:\s*var\(--action-primary-fill\)/);
  });

  // FR-1: regular spacing. Spec 015 retarget: the kit scale is --space-N (px); the 2 px
  // hairline step is the only value off the 4 px grid.
  it("uses a 4 px spacing grid", () => {
    const spacing = [...light].filter(([n]) => /^--space-\d+$/.test(n));
    expect(spacing.length).toBeGreaterThan(3);
    for (const [name, value] of spacing) {
      const px = /^(\d+)px$/.exec(value);
      expect(px, name).not.toBeNull();
      if (name !== "--space-2") expect(Number(px?.[1]) % 4, name).toBe(0);
    }
  });
});
