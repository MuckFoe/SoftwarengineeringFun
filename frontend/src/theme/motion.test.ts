import { describe, expect, it } from "vitest";
import materialsRaw from "./materials.css?raw";
import motionRaw from "./motion.css?raw";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const motion = strip(motionRaw);
const materials = strip(materialsRaw);

/** The body of the first `@media`/`@supports` block whose prelude matches, braces balanced. */
function atRule(css: string, prelude: RegExp): string {
  const match = prelude.exec(css);
  if (!match) throw new Error(`no block matching ${prelude}`);
  let depth = 0;
  const start = css.indexOf("{", match.index);
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start + 1, i);
  }
  throw new Error(`unbalanced block for ${prelude}`);
}

/** keyframes name -> body */
function keyframes(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const name = m[1] ?? "";
    found.set(name, atRule(css.slice(m.index), /@keyframes/));
  }
  return found;
}

describe("motion.css", () => {
  it("defines the motion tokens", () => {
    expect(motion).toMatch(/--motion-fast:\s*150ms/);
    expect(motion).toMatch(/--motion-base:\s*250ms/);
  });

  // NFR-5
  it("never lasts longer than 300 ms", () => {
    const durations = [...motion.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map((m) =>
      m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]),
    );
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) expect(d).toBeLessThanOrEqual(300);
  });

  // AC-5
  it("gives every movement keyframe a fade-only -reduced twin used under reduced motion", () => {
    const all = keyframes(motion);
    const movement = [...all.keys()].filter((n) => !n.endsWith("-reduced"));
    expect(movement.length).toBeGreaterThanOrEqual(3);
    const reduced = atRule(motion, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    for (const name of movement) {
      const twin = all.get(`${name}-reduced`);
      expect(twin, `${name}-reduced`).toBeDefined();
      const props = [...(twin ?? "").matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      expect(new Set(props), `${name}-reduced`).toEqual(new Set(["opacity"]));
      expect(reduced, name).toMatch(new RegExp(`animation-name:\\s*${name}-reduced\\b`));
    }
  });

  it("never blocks input during animation", () => {
    expect(motion).not.toMatch(/pointer-events\s*:\s*none/);
  });
});

describe("materials.css", () => {
  it("blurs the material where supported", () => {
    expect(materials).toMatch(/background:\s*var\(--material-bg\)/);
    expect(materials).toMatch(/backdrop-filter:\s*blur\(20px\)\s*saturate\(180%\)/);
  });

  // AC-22 (static part)
  for (const [name, prelude] of [
    ["@supports not", /@supports\s+not\s*\(+\s*backdrop-filter/],
    ["reduced transparency", /@media\s*\(\s*prefers-reduced-transparency:\s*reduce\s*\)/],
  ] as const) {
    it(`is opaque under ${name}`, () => {
      const body = atRule(materials, prelude);
      expect(body).toMatch(/backdrop-filter:\s*none/);
      expect(body).toMatch(/background:\s*var\(--material-bg-opaque\)/);
    });
  }

  it("defines both material colours for light and dark", () => {
    for (const token of ["--material-bg", "--material-bg-opaque"]) {
      const defs = materials.match(new RegExp(`${token}:`, "g")) ?? [];
      expect(defs.length, token).toBe(2);
    }
    expect(materials).toMatch(/:root\[data-appearance="dark"\]/);
  });
});
