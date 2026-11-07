import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../styles/contrast";
import tokensCss from "../styles/tokens.css?raw";
import { Card } from "./Card";
import css from "./card.css?raw";
import { Divider } from "./Divider";

const rule = (sel: string) => {
  const m = css.match(new RegExp(`${sel.replace(/[.[\]="*>-]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
};

const tokens = (block: string) => {
  const m = tokensCss.match(new RegExp(`${block.replace(/[.[\]="-]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
};
const tok = (block: string, name: string) =>
  new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6,8})`).exec(tokens(block))?.[1] ?? "";

describe("Card css (v2)", () => {
  it("is a large-radius tone surface with no border (FR-1)", () => {
    const r = rule(".card");
    expect(r).toMatch(/background:\s*var\(--surface\)/);
    expect(r).toMatch(/border-radius:\s*var\(--radius-card\)/);
    expect(r).toMatch(/border:\s*0|border:\s*none/);
    expect(r).toMatch(/padding:\s*var\(--space-16\)/);
  });
  it("tone differs from the page background in both appearances", () => {
    for (const b of [':root[data-appearance="light"]', ':root[data-appearance="dark"]']) {
      expect(tok(b, "--surface")).not.toBe("");
      expect(tok(b, "--surface")).not.toBe(tok(b, "--bg"));
    }
  });
  it("radius token is at least the card radius", () => {
    expect(tokens(":root")).toMatch(/--radius-card:\s*(\d+)px/);
  });
  it("edge light is a ::before gradient strongest at the top-left, masked, click-through (FR-4)", () => {
    const r = rule(".card::before");
    expect(r).toMatch(/pointer-events:\s*none/);
    const g = /linear-gradient\(\s*(\d+)deg\s*,\s*var\(--edge-light\)[^,]*,\s*transparent/.exec(
      r ?? "",
    );
    expect(g).not.toBeNull();
    // 135deg points toward the bottom-right, so the first stop sits at the top-left corner.
    expect(Number(g?.[1])).toBe(135);
    expect(r).toMatch(/mask/);
    expect(r).toMatch(/z-index:\s*0/);
  });
  it("content sits above the edge light", () => {
    expect(rule(".card > *")).toMatch(/position:\s*relative/);
    expect(rule(".card > *")).toMatch(/z-index:\s*1/);
  });
  it("text over the surface meets 4.5:1 in both appearances (FR-4)", () => {
    for (const b of [':root[data-appearance="light"]', ':root[data-appearance="dark"]']) {
      for (const fg of ["--text", "--text-muted"]) {
        expect(contrastRatio(tok(b, fg), tok(b, "--surface"))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("uses no literal colours", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
  it("hover effect only on link cards", () => {
    expect(css).toMatch(/\.card-link:hover/);
    expect(css).not.toMatch(/\.card:hover/);
  });
  it("divider uses --divider", () => {
    expect(css).toMatch(/\.divider\s*\{[^}]*var\(--divider\)/);
  });
});

describe("Card component", () => {
  it("static card is not focusable", () => {
    render(<Card data-testid="c">hi</Card>);
    expect(screen.getByTestId("c").className).toContain("card");
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("link card is a single focusable link with its name", () => {
    render(
      <Card href="/x" aria-label="Session A">
        body
      </Card>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Session A" })).toBe(links[0]);
    expect(links[0]?.className).toContain("card-link");
  });
});

describe("Divider", () => {
  it("renders a separator", () => {
    render(<Divider />);
    expect(screen.getByRole("separator").className).toContain("divider");
  });
});
