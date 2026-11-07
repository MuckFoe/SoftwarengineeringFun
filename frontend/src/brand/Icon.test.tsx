import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Icon } from "./Icon";
import { iconMap } from "./iconMap";
import fallbackCss from "./icons-fallback.css?raw";

afterEach(cleanup);

const names = Object.keys(iconMap) as (keyof typeof iconMap)[];

function ruleFor(name: string): string | undefined {
  const selector = `.icon[data-icon="${name}"]`;
  const at = fallbackCss.indexOf(selector);
  if (at < 0) return undefined;
  return fallbackCss.slice(at, fallbackCss.indexOf("}", at));
}

describe("iconMap and Icon (FR-2)", () => {
  it("covers the icon names the app uses today", () => {
    for (const n of [
      "sidebar",
      "play",
      "stop",
      "person",
      "link",
      "chat",
      "pencil",
      "trash",
      "plus",
    ]) {
      expect(names).toContain(n);
    }
  });

  for (const name of names) {
    it(`${name}: Audi name, Lucide fallback name and a non-empty fallback mask`, () => {
      expect(iconMap[name].audi).toMatch(/^[a-z0-9-]+$/);
      expect(iconMap[name].lucide).toMatch(/^[a-z0-9-]+$/);
      const rule = ruleFor(name);
      expect(rule, `fallback rule for ${name}`).toBeDefined();
      const m = rule?.match(/mask-image:\s*url\("data:image\/svg\+xml,([^"]+)"\)/);
      expect(m?.[1]?.length ?? 0).toBeGreaterThan(40);
    });

    it(`${name}: renders a decorative masked span`, () => {
      const { container } = render(<Icon name={name} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.tagName).toBe("SPAN");
      expect(el.classList.contains("icon")).toBe(true);
      expect(el.getAttribute("data-icon")).toBe(name);
      expect(el.getAttribute("aria-hidden")).toBe("true");
    });
  }

  it("renders at 16, 24 and 48", () => {
    for (const size of [16, 24, 48] as const) {
      const { container, unmount } = render(<Icon name="plus" size={size} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.style.width).toBe(`${size}px`);
      expect(el.style.height).toBe(`${size}px`);
      unmount();
    }
  });

  it("is coloured with currentColor through a mask", () => {
    expect(fallbackCss).toMatch(/\.icon\s*\{[^}]*background-color:\s*currentColor/);
    expect(fallbackCss).toMatch(/\.icon\s*\{[^}]*mask-size/);
  });

  it("uses the selector brand.css overrides, so a later rule wins over the fallback", () => {
    // brand-assets.mjs (task 8) emits `.icon[data-icon="<name>"] { mask-image: ... }`; equal
    // specificity and a later stylesheet means the Audi icon replaces the fallback.
    for (const name of names) expect(fallbackCss).toContain(`.icon[data-icon="${name}"]`);
    expect(fallbackCss.split('.icon[data-icon="').length - 1).toBe(names.length);
  });

  it("carries only Lucide-derived geometry and the ISC notice (licensing)", () => {
    expect(fallbackCss).toMatch(/ISC License/);
    expect(fallbackCss).toMatch(/Lucide/);
    expect(fallbackCss).not.toMatch(/audi\s*(icon|logo)/i);
    expect(fallbackCss).toMatch(/stroke-width%3D%221%22|stroke-width='1'/);
  });
});
