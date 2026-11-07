import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 015 task 30 (plan 1.8, FR-10): the presentation stage is a light, white, bordered
// box in both appearances, and the present styles use the Audi tokens only.
const dir = join(process.cwd(), "src", "present");
const css = (name: string) => readFileSync(join(dir, name), "utf8");
const OLD =
  /var\(--(separator|content-bg|label|label-secondary|accent|accent-label|row-alt-bg|row-hover-bg|radius-control|radius-sheet|shadow-sheet|focus-ring|type-[a-z0-9]+|font-text)\)|--legacy-space/;

describe("presentation stage (FR-10)", () => {
  const frame = css("PresentationFrame.module.css");
  const block = /\.frame\s*\{([^}]*)\}/.exec(frame)?.[1] ?? "";

  it("is light, white and bordered with the divider in both appearances", () => {
    expect(block).toMatch(/color-scheme:\s*light/);
    expect(block).toMatch(/background:\s*#f{3}\b/i);
    expect(block).toMatch(/border:\s*1px solid var\(--divider\)/);
  });

  it.each([
    "PresentationFrame.module.css",
    "PresentWindow.module.css",
    "PresentSessionWindow.module.css",
    "PresentationEditorSheet.module.css",
  ])("%s uses no pre-Audi tokens", (name) => {
    expect(css(name)).not.toMatch(OLD);
  });
});
