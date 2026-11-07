import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import fallbackCss from "../brand/icons-fallback.css?raw";
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

  // Decision 9 / FR-2: every icon is the brand mask span, so supplied Audi icons show everywhere.
  for (const name of ICON_NAMES) {
    it(`${name} renders the brand mask span with a fallback rule`, () => {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector("svg")).toBeNull();
      expect(container.children).toHaveLength(1);
      const el = container.children[0] as HTMLElement;
      expect(el.className).toBe("icon");
      expect(el.getAttribute("data-icon")).toBe(name);
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(fallbackCss).toContain(`.icon[data-icon="${name}"]`);
    });
  }

  it("keeps the size prop (default 16)", () => {
    const { container } = render(
      <>
        <Icon name="play" />
        <Icon name="play" size={40} />
      </>,
    );
    const [a, b] = Array.from(container.children) as HTMLElement[];
    expect([a?.style.width, a?.style.height]).toEqual(["16px", "16px"]);
    expect([b?.style.width, b?.style.height]).toEqual(["40px", "40px"]);
  });

  it("exposes a label as its accessible name", () => {
    render(<Icon name="play" label="Run" />);
    const img = screen.getByRole("img", { name: "Run" });
    expect(img.getAttribute("data-icon")).toBe("play");
    expect(img.hasAttribute("aria-hidden")).toBe(false);
  });
});
