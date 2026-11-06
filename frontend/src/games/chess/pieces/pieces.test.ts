import { describe, expect, it } from "vitest";

const FILES = import.meta.glob("./*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const NAMES = ["w", "b"].flatMap((c) => ["K", "Q", "R", "B", "N", "P"].map((p) => `${c}${p}`));

describe("chess piece artwork (NFR-7, NFR-5)", () => {
  it("has 12 pieces", () => expect(NAMES).toHaveLength(12));
  for (const n of NAMES) {
    it(`${n}.svg is a plain, self-contained SVG with a viewBox`, () => {
      const s = FILES[`./${n}.svg`] ?? "";
      expect(s).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(s).toMatch(/viewBox="0 0 45 45"/);
      expect(s).toMatch(/stroke=/);
      expect(s).not.toMatch(/<script|<image|data:|href=|<!--|licen[cs]e/i);
    });
  }
});
