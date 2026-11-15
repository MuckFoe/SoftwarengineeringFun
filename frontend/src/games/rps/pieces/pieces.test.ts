import { describe, expect, it } from "vitest";

// Spec 021 task 4 (FR-3, NFR-6): Rock Paper Siege has its own artwork, drawn for this repo.
const FILES = import.meta.glob("./*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const NAMES = ["rock", "paper", "scissors", "flag", "trap", "hidden"];

describe("rps piece artwork (FR-3, NFR-6)", () => {
  it("has exactly the six pieces", () => {
    expect(Object.keys(FILES).sort()).toEqual(NAMES.map((n) => `./${n}.svg`).sort());
  });

  for (const n of NAMES) {
    it(`${n}.svg is one currentColor path with no raster or external reference`, () => {
      const s = FILES[`./${n}.svg`] ?? "";
      expect(s, `${n}.svg exists`).not.toBe("");
      expect(s).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(s).toMatch(/viewBox="0 0 48 48"/);
      expect(s.match(/<path\b/g) ?? []).toHaveLength(1);
      expect(s).not.toMatch(/<(circle|rect|ellipse|line|polyline|polygon|g|use|text)\b/);
      expect(s).toMatch(/currentColor/);
      expect(s).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
      expect(s).not.toMatch(/<script|<image|<foreignObject|data:|href=|url\(|@import|<!--/i);
    });
  }
});
