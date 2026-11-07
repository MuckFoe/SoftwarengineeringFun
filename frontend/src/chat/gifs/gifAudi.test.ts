// Spec 015 task 29 (FR-1, FR-5, FR-10): the GIF picker and tile use Audi tokens only, and the
// GIF sits in a --neutral-700 tile with its pixels untouched.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const image = read("./GifImage.module.css");
const picker = read("./GifPicker.module.css");

const OLD =
  /var\(--(legacy-space-\d+|separator|label(-secondary)?|control-bg|row-hover-bg|focus-ring|font-text|type-[a-z0-9]+|radius-control)\)/;

describe("GIF restyle (task 29)", () => {
  it("FR-5: no spec-003 variables remain in either stylesheet", () => {
    expect(image).not.toMatch(OLD);
    expect(picker).not.toMatch(OLD);
  });
  it("FR-1: square corners", () => {
    for (const css of [image, picker]) {
      expect(css).not.toMatch(/border-radius:(?!\s*0\b)/);
    }
  });
  it("FR-10: the GIF tile and placeholder sit on --neutral-700, pixels untouched", () => {
    expect(image).toMatch(/\.tile\s*\{[^}]*background:\s*var\(--neutral-700\)/);
    expect(image).toMatch(/\.placeholder\s*\{[^}]*background:\s*var\(--neutral-700\)/);
    expect(image).not.toMatch(/filter:|opacity:|mix-blend-mode/);
  });
  it("FR-10: caption text uses --text and --form-caption (contrast-checked pair)", () => {
    expect(image).toMatch(/\.placeholder\s*\{[^}]*color:\s*var\(--text\)/);
    expect(picker).toMatch(/\.status\s*\{[^}]*color:\s*var\(--form-caption\)/);
  });
  it("FR-5: focus uses the double ring on --focus", () => {
    expect(picker).toMatch(/\.grid:focus-visible\s*\{[^}]*var\(--focus\)/);
    expect(picker).toMatch(/\.cell\[aria-selected="true"\]\s*\{[^}]*var\(--focus\)/);
  });
});
