import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Dock, type DockItem } from "./Dock";
import css from "./Dock.module.css?raw";

afterEach(cleanup);

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function mount(path: string, disabled: Partial<Record<DockItem["key"], string>> = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Dock disabled={disabled} />
      <Where />
    </MemoryRouter>,
  );
}

describe("Dock", () => {
  it("lists five areas with the current one marked (FR-16)", () => {
    mount("/learn/x");
    const nav = screen.getByRole("navigation", { name: "Areas" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((a) => a.textContent)).toEqual([
      "Sessions",
      "Problems",
      "Learn",
      "Present",
      "Games",
    ]);
    expect([...links].map((a) => a.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
      null,
      null,
    ]);
  });

  it("marks Sessions for the root route and navigates on activation", () => {
    mount("/");
    expect(screen.getByRole("link", { name: "Sessions" }).getAttribute("aria-current")).toBe(
      "page",
    );
    fireEvent.click(screen.getByRole("link", { name: "Games" }));
    expect(screen.getByTestId("where").textContent).toBe("/games");
  });

  it("renders a disabled item as non-link with a described reason (FR-16 guest)", () => {
    mount("/", { present: "Sign in to present" });
    expect(screen.queryByRole("link", { name: "Present" })).toBeNull();
    const el = screen.getByText("Present").closest("[aria-disabled]") as HTMLElement;
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.tagName).not.toBe("A");
    expect(el.getAttribute("title")).toBe("Sign in to present");
    const id = el.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe("Sign in to present");
    fireEvent.click(el);
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("keeps an aria-label on every item and hides labels when narrow (FR-16)", () => {
    mount("/", { learn: "Sign in" });
    for (const n of ["Sessions", "Problems", "Learn", "Present", "Games"]) {
      expect(document.querySelector(`[aria-label="${n}"]`), n).not.toBeNull();
    }
    expect(stripped).toMatch(/@media \(max-width: 640px\)/);
    expect(stripped).toMatch(/\.label\s*\{[^}]*display:\s*none/);
    expect(stripped).toMatch(/\.dock:hover/);
  });

  it("is a fixed centred pill at the dock layer using tokens", () => {
    expect(stripped).toMatch(/position:\s*fixed/);
    expect(stripped).toMatch(/z-index:\s*var\(--z-dock\)/);
    expect(stripped).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(stripped).toMatch(/height:\s*var\(--dock-height\)/);
  });
});
