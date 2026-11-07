import { describe, expect, it } from "vitest";
import { visibleText } from "./visibleText";

describe("visibleText", () => {
  it("shows an ANSI escape as literal characters", () => {
    expect(visibleText("\x1b[31mred")).toBe("␛[31mred");
  });
  it("leaves markup unchanged", () => {
    expect(visibleText("<b>x</b>")).toBe("<b>x</b>");
  });
  it("keeps newline and tab, replaces CR, NUL and DEL", () => {
    expect(visibleText("a\nb\tc")).toBe("a\nb\tc");
    expect(visibleText("\r")).toBe("␍");
    expect(visibleText("\x00")).toBe("␀");
    expect(visibleText("\x7f")).toBe("␡");
  });
  it("leaves non-ASCII text alone", () => {
    expect(visibleText("é✓")).toBe("é✓");
  });
});
