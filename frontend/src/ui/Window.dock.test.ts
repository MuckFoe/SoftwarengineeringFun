import { describe, expect, it } from "vitest";
import css from "./Window.module.css?raw";

describe("Window uses the whole screen; the dock overlays it", () => {
  const rule = css.match(/\.window\s*\{([^}]*)\}/)?.[1] ?? "";
  it("reserves no bottom room for the dock", () => {
    expect(rule).not.toMatch(/padding-bottom/);
  });
  it("is one dynamic viewport height, border-box", () => {
    expect(rule).toMatch(/height:\s*100dvh/);
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(rule).not.toMatch(/100vh/);
  });
});
