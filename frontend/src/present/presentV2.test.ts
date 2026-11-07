import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 016 task 23 (FR-1, FR-9): the presentation screens use the v2 shapes and tone-based
// separation. Source-level check; the rendered look is covered by expectV2Look in e2e.
const FILES = [
  "PresentWindow.module.css",
  "PresentSessionWindow.module.css",
  "PresentationEditorSheet.module.css",
];
const css = (f: string) => readFileSync(join(process.cwd(), "src/present", f), "utf8");

describe("presentation screens in the v2 look", () => {
  for (const f of FILES) {
    it(`${f} has no square corners, outlines or literal radii`, () => {
      const text = css(f);
      expect(text).not.toMatch(/border-radius\s*:\s*0\s*[;}]/);
      expect(text).not.toMatch(/border(?:-[a-z]+)?\s*:\s*[^;]*var\(--divider\)/);
      expect(text).not.toMatch(/border-radius\s*:\s*[^;]*\d(?:px|%)/);
    });
  }

  it("the join card is a large rounded tone surface", () => {
    expect(css("PresentSessionWindow.module.css")).toMatch(
      /\.joinCard\s*{[^}]*border-radius:\s*var\(--radius-card\)/,
    );
  });

  it("menu items and the participant swatch are pill / round via tokens", () => {
    const text = css("PresentSessionWindow.module.css");
    expect(text).toMatch(/\.menuItem\s*{[^}]*border-radius:\s*var\(--radius-pill\)/);
    expect(text).toMatch(/\.swatch\s*{[^}]*border-radius:\s*var\(--radius-max\)/);
  });
});
