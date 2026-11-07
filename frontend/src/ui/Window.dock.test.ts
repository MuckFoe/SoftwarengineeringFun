import { describe, expect, it } from "vitest";
import css from "./Window.module.css?raw";

describe("Window reserves room for the dock (016 FR-16)", () => {
  const rule = css.match(/\.window\s*\{([^}]*)\}/)?.[1] ?? "";
  it("pads the bottom by the dock height, safe area and a gap", () => {
    expect(rule).toMatch(
      /padding-bottom:\s*calc\(var\(--dock-height\)\s*\+\s*env\(safe-area-inset-bottom\)\s*\+\s*var\(--space-\d+\)\)/,
    );
  });
  it("is one dynamic viewport height, border-box, so the grid ends above the dock", () => {
    expect(rule).toMatch(/height:\s*100dvh/);
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(rule).not.toMatch(/100vh/);
  });
});
