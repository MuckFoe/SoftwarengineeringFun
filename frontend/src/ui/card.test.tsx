import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";
import css from "./card.css?raw";
import { Divider } from "./Divider";

const rule = (sel: string) => {
  const m = css.match(new RegExp(`${sel.replace(/[.[\]="-]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
};

describe("Card css", () => {
  it("is on surface-1, square, padded 16, light elevation", () => {
    const r = rule(".card");
    expect(r).toMatch(/background:\s*var\(--surface-1\)/);
    expect(r).toMatch(/border-radius:\s*0/);
    expect(r).toMatch(/padding:\s*var\(--space-16\)/);
    expect(r).toMatch(/box-shadow:\s*var\(--elev-card\)/);
  });
  it("uses an outline instead of elevation in dark", () => {
    expect(css).toMatch(
      /\[data-appearance="dark"\]\s*\.card\s*\{[^}]*box-shadow:\s*none[^}]*border[^}]*var\(--divider\)/,
    );
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
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
