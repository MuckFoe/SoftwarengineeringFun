import { describe, expect, it } from "vitest";
import {
  APPEARANCES,
  type Colour,
  contrastRatio,
  evaluatePair,
  PAIRS,
  type Pair,
  resolveToken,
  THRESHOLD,
  toastText,
} from "./contrast";

// Spec 015 task 5: WCAG contrast harness over declared token pairs, both appearances.
// Later tasks append their pairs to PAIRS in contrast.ts; this test iterates all of them.

describe("contrastRatio", () => {
  it("black on white is 21", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
  });
  it("identical colours are 1", () => {
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
  it("known mid value: #767676 on white is about 4.54", () => {
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });
  it("composites translucent foregrounds over the background", () => {
    // 50% black over white is #808080-ish grey, well under 21 and over 1.
    const r = contrastRatio("#00000080", "#FFFFFF");
    expect(r).toBeGreaterThan(3.5);
    expect(r).toBeLessThan(4.5);
  });
});

describe("token resolution", () => {
  it("resolves a token per appearance from kit-values.json", () => {
    expect(resolveToken("--canvas", "light")).toBe("#F4F6FA");
    expect(resolveToken("--canvas", "dark")).toBe("#0A0C11");
  });
  it("throws on an unknown token", () => {
    expect(() => resolveToken("--nope", "light")).toThrow();
  });
});

describe("toast text on signal fills", () => {
  it("picks black or white, whichever has the higher ratio", () => {
    for (const a of APPEARANCES) {
      for (const sig of ["--success", "--notice", "--negative"]) {
        const fill = resolveToken(sig, a);
        const t = toastText(fill);
        const other = t === "#000000" ? "#FFFFFF" : "#000000";
        expect(contrastRatio(t, fill)).toBeGreaterThanOrEqual(contrastRatio(other, fill));
      }
    }
  });
});

describe("declared pair list", () => {
  it("covers every required category", () => {
    const names = PAIRS.map((p) => p.name).join("\n");
    for (const needle of [
      "body text",
      "secondary text",
      "form text",
      "form caption",
      "action text",
      "toast",
      "focus ring",
      "chess",
      "editor",
    ]) {
      expect(names.toLowerCase()).toContain(needle);
    }
  });
  it("has unique names", () => {
    const names = PAIRS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("does not include disabled states", () => {
    for (const p of PAIRS) expect(p.name.toLowerCase()).not.toContain("disabled");
  });
});

// Spec 016 task 2 (FR-4): the v2 token pairs. Text >= 4.5:1, the accent as a boundary >= 3:1.
const V2_BACKGROUNDS = ["--bg", "--surface", "--surface-2"];
const V2_PAIRS: Pair[] = [
  ...V2_BACKGROUNDS.flatMap((bg): Pair[] => [
    { name: `v2 text on ${bg}`, kind: "text", fg: "--text", bg },
    { name: `v2 muted text on ${bg}`, kind: "text", fg: "--text-muted", bg },
    { name: `v2 accent boundary on ${bg}`, kind: "ui", fg: "--accent", bg },
    { name: `v2 danger text on ${bg}`, kind: "text", fg: "--danger", bg },
  ]),
  ...["--accent", "--accent-hover", "--accent-press"].map(
    (bg): Pair => ({ name: `v2 on-accent text on ${bg}`, kind: "text", fg: "--on-accent", bg }),
  ),
];

describe.each(APPEARANCES)("v2 contrast in %s appearance (FR-4)", (appearance) => {
  it("declares the required v2 pairs with unique names", () => {
    expect(V2_PAIRS).toHaveLength(15);
    expect(new Set(V2_PAIRS.map((p) => p.name)).size).toBe(V2_PAIRS.length);
  });
  for (const pair of V2_PAIRS) {
    const need = THRESHOLD[pair.kind];
    it(`${pair.name} >= ${need}:1`, () => {
      expect(evaluatePair(pair, appearance).ratio).toBeGreaterThanOrEqual(need);
    });
  }
});

describe.each(APPEARANCES)("contrast thresholds in %s appearance", (appearance) => {
  for (const pair of PAIRS) {
    const need = THRESHOLD[pair.kind];
    it(`${pair.name} >= ${need}:1`, () => {
      const { ratio } = evaluatePair(pair, appearance);
      expect(ratio).toBeGreaterThanOrEqual(need);
    });
  }
});

// Text on accent tints: labels, counts, badges and selected rows draw --accent-text on
// color-mix(in srgb, var(--accent) N%, transparent), N up to 16, over the page or a surface.
// The fill accent itself drops under 4.5:1 there in light (axe), so it is checked as well.
const TINT_PCT = [12, 16];
const tintOf =
  (pct: number): Colour =>
  (fill) =>
    `${fill("--accent")}${Math.round((pct / 100) * 255)
      .toString(16)
      .padStart(2, "0")}`;
const TINT_PAIRS: Pair[] = ["--bg", "--surface", "--surface-2"].flatMap((base) =>
  TINT_PCT.map(
    (pct): Pair => ({
      name: `accent text on ${pct}% accent tint over ${base}`,
      kind: "text",
      fg: "--accent-text",
      bg: tintOf(pct),
      base,
    }),
  ),
);

describe.each(APPEARANCES)("text on accent tints in %s appearance", (appearance) => {
  for (const pair of TINT_PAIRS) {
    it(`${pair.name} >= 4.5:1`, () => {
      expect(evaluatePair(pair, appearance).ratio).toBeGreaterThanOrEqual(THRESHOLD.text);
    });
  }
});
