import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLogo } from "./BrandLogo";

afterEach(() => {
  cleanup();
  for (const s of document.head.querySelectorAll("style[data-test]")) s.remove();
});

function withBrandRule() {
  const s = document.createElement("style");
  s.dataset.test = "1";
  s.textContent = ".brand-logo { display: block; height: 1em; }";
  document.head.append(s);
}

describe("BrandLogo (FR-11)", () => {
  it("renders the .brand-logo mark (role img, label Audi) beside the app name when the brand rule exists", () => {
    withBrandRule();
    render(<BrandLogo appName="Collab" />);
    const logo = screen.getByRole("img", { name: "Audi" });
    expect(logo.classList.contains("brand-logo")).toBe(true);
    expect(logo.hidden).toBe(false);
    expect(screen.getByText("Collab").classList.contains("brand-name")).toBe(true);
  });

  it("with no logo rule the logo is hidden and only the app name shows, no img", () => {
    render(<BrandLogo appName="Collab" />);
    expect(screen.queryByRole("img", { name: "Audi" })).toBeNull();
    const logo = document.querySelector<HTMLElement>(".brand-logo");
    expect(logo?.hidden).toBe(true);
    expect(screen.getByText("Collab")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
