import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "./Icon";

afterEach(cleanup);

describe("Icon", () => {
  it("has the plan's set of about 20 icons", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(18);
    for (const name of [
      "sidebar",
      "play",
      "stop",
      "person",
      "link",
      "sun",
      "moon",
      "chevronDown",
      "chevronRight",
      "search",
      "plus",
      "gear",
      "exclamation",
      "chat",
      "doc",
    ]) {
      expect(ICON_NAMES).toContain(name);
    }
  });

  // NFR-1: hand-drawn inline SVG only, tinted by the surrounding text colour.
  for (const name of ICON_NAMES) {
    it(`${name} is one inline svg drawn in currentColor`, () => {
      const { container } = render(<Icon name={name} />);
      const svgs = container.querySelectorAll("svg");
      expect(svgs).toHaveLength(1);
      const svg = svgs[0] as SVGSVGElement;
      expect(container.children).toHaveLength(1);
      expect(svg.querySelectorAll("image, use, foreignObject")).toHaveLength(0);
      const all = [svg, ...svg.querySelectorAll("*")];
      for (const el of all) {
        expect(el.hasAttribute("href"), el.tagName).toBe(false);
        expect(el.hasAttribute("xlink:href"), el.tagName).toBe(false);
        for (const attr of ["fill", "stroke"]) {
          const value = el.getAttribute(attr);
          if (value !== null)
            expect(["currentColor", "none"], `${el.tagName} ${attr}`).toContain(value);
        }
      }
      expect([svg.getAttribute("fill"), svg.getAttribute("stroke")]).toContain("currentColor");
      expect(svg.querySelectorAll("path, circle, rect, line, polyline").length).toBeGreaterThan(0);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    });
  }

  it("exposes a label as its accessible name", () => {
    render(<Icon name="play" label="Run" />);
    const img = screen.getByRole("img", { name: "Run" });
    expect(img.tagName.toLowerCase()).toBe("svg");
    expect(img.hasAttribute("aria-hidden")).toBe(false);
  });
});
