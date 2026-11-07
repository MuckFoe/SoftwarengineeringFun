import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { AppHeader } from "./AppHeader";
import css from "./appHeader.css?raw";

afterEach(cleanup);

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const renderHeader = (path = "/learn/x") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ShortcutsProvider>
        <AppHeader appName="Collab" label="Header">
          <button type="button">Extra</button>
        </AppHeader>
        <Where />
      </ShortcutsProvider>
    </MemoryRouter>,
  );

describe("AppHeader (FR-6, FR-7, FR-11)", () => {
  it("is a banner-free toolbar holding the name, area tabs, page controls, appearance and account", () => {
    renderHeader();
    expect(screen.getByRole("toolbar", { name: "Header" })).toBeTruthy();
    expect(screen.getByText("Collab").classList.contains("brand-name")).toBe(true);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Problems",
      "Learn",
      "Present",
      "Games",
    ]);
    expect(screen.getByRole("tab", { name: "Learn" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Extra" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /appearance/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /profile/i })).toBeTruthy();
  });

  it("choosing a tab navigates to its area", () => {
    renderHeader("/");
    fireEvent.click(screen.getByRole("tab", { name: "Games" }));
    expect(screen.getByTestId("where").textContent).toBe("/games");
  });

  it("is 56 px tall with page-margin padding, and uses tokens only", () => {
    expect(css).toMatch(/height:\s*56px|height:\s*var\(--space-56\)/);
    expect(css).toMatch(/padding:[^;]*var\(--page-margin\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(css).not.toMatch(/--legacy-/);
  });
});
