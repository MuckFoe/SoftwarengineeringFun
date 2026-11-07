import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import tokensRaw from "../styles/tokens.css?raw";
import { ICON_NAMES, Icon, SignedInMark } from "../ui/Icon";
import { PresenceList } from "./PresenceList";

afterEach(cleanup);

describe("PresenceList signed-in mark (FR-8)", () => {
  it("marks only the signed-in one of two participants both named newuser", () => {
    render(
      <PresenceList
        participants={[
          { id: "p-account", name: "newuser", signed_in: true },
          { id: "p-anon", name: "newuser", signed_in: false },
        ]}
      />,
    );
    const rows = within(screen.getByRole("list", { name: "Participants" })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.textContent).toContain("newuser");
    expect(screen.getAllByText("signed in")).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByText("signed in")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByText("signed in")).toBeNull();
  });

  it("shows no mark for an anonymous participant", () => {
    render(<PresenceList participants={[{ id: "p1", name: "ada", signed_in: false }]} />);
    expect(screen.queryByText("signed in")).toBeNull();
  });
});

describe("SignedInMark", () => {
  it("is a decorative in-house glyph plus visually hidden 'signed in' text", () => {
    const { container } = render(<SignedInMark />);
    const glyph = container.querySelector(".icon[data-icon]");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    const text = screen.getByText("signed in");
    expect(text.style.position).toBe("absolute");
    expect(text.style.width).toBe("1px");
    expect(text.style.clipPath).toBe("inset(50%)");
  });

  it("draws a person-with-checkmark icon in currentColor", () => {
    expect(ICON_NAMES).toContain("personCheck");
    const { container } = render(<Icon name="personCheck" />);
    const glyph = container.querySelector(".icon[data-icon]") as HTMLElement;
    expect(glyph.getAttribute("data-icon")).toBe("personCheck");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("sets no colour of its own, so it inherits the name's colour", () => {
    const { container } = render(<SignedInMark />);
    for (const el of container.querySelectorAll<HTMLElement | SVGElement>("*"))
      expect(el.style.color, el.tagName).toBe("");
  });
});

// Non-text contrast (WCAG 1.4.11, 3:1): the mark is drawn in the row's text colour
// (`--text-interactive`, PresenceList.module.css), so that colour must hold against the window and
// content backgrounds in light and dark.
describe("signed-in mark contrast", () => {
  const css = tokensRaw.replace(/\/\*[\s\S]*?\*\//g, "");
  function block(selector: string): Map<string, string> {
    const escaped = selector.replace(/[[\]()"=]/g, "\\$&");
    const match = new RegExp(`(^|})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (!match) throw new Error(`no block for ${selector}`);
    const props = new Map<string, string>();
    for (const decl of (match[2] ?? "").split(";")) {
      const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
      if (m?.[1] && m[2]) props.set(m[1], m[2]);
    }
    return props;
  }
  type Rgba = [number, number, number, number];
  function parse(value: string): Rgba {
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (hex?.[1]) {
      const n = Number.parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
    if (!rgba?.[1]) throw new Error(`not a colour: ${value}`);
    const [r = 0, g = 0, b = 0, a = 1] = rgba[1].split(",").map(Number);
    return [r, g, b, a];
  }
  const luminance = ([r, g, b]: Rgba) => {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
    r * a + br * (1 - a),
    g * a + bg * (1 - a),
    b * a + bb * (1 - a),
    1,
  ];
  const ratio = (fg: Rgba, bg: Rgba) => {
    const [hi, lo] = [luminance(over(fg, bg)), luminance(bg)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };

  const light = block(":root");
  const dark = {
    ...Object.fromEntries(light),
    ...Object.fromEntries(block(':root[data-appearance="dark"]')),
  };
  for (const [appearance, tokens] of [
    ["light", Object.fromEntries(light)],
    ["dark", dark],
  ] as const) {
    for (const bg of ["--canvas", "--surface-1"]) {
      it(`meets 3:1 on ${bg} in ${appearance}`, () => {
        const fg = parse(tokens["--text-interactive"] as string);
        expect(ratio(fg, parse(tokens[bg] as string))).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
