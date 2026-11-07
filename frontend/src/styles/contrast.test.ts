import { describe, expect, it } from "vitest";
import {
  APPEARANCES,
  contrastRatio,
  evaluatePair,
  PAIRS,
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
    expect(resolveToken("--canvas", "light")).toBe("#FFFFFF");
    expect(resolveToken("--canvas", "dark")).toBe("#000000");
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

describe.each(APPEARANCES)("contrast thresholds in %s appearance", (appearance) => {
  for (const pair of PAIRS) {
    const need = THRESHOLD[pair.kind];
    it(`${pair.name} >= ${need}:1`, () => {
      const { ratio } = evaluatePair(pair, appearance);
      expect(ratio).toBeGreaterThanOrEqual(need);
    });
  }
});
