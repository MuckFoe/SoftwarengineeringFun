import { describe, expect, it } from "vitest";
import { clampSize } from "./ResizeHandle";

describe("clampSize", () => {
  it("keeps the size between the minimum and the viewport less what is kept free", () => {
    expect(clampSize(100, 160, 640, 1440)).toBe(160);
    expect(clampSize(500, 160, 640, 1440)).toBe(500);
    expect(clampSize(1000, 160, 640, 1440)).toBe(800);
  });

  it("never goes under the minimum on a small screen", () => {
    expect(clampSize(300, 160, 640, 600)).toBe(160);
  });
});
