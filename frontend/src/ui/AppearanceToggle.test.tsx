import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { AppearanceToggle } from "./AppearanceToggle";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-appearance");
});

const renderToggle = () =>
  render(
    <ShortcutsProvider>
      <AppearanceToggle />
    </ShortcutsProvider>,
  );

const open = () => fireEvent.click(screen.getByRole("button", { name: /appearance/i }));

describe("AppearanceToggle (FR-6a)", () => {
  it("opens a menu of Light, Dark and System radios, system checked by default", () => {
    renderToggle();
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    expect(screen.getAllByRole("menuitemradio").map((e) => e.textContent)).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "System" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("picking Light applies data-appearance at once and stores it; System clears the stored value", () => {
    renderToggle();
    open();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-appearance")).toBe("light");
    expect(localStorage.getItem("appearance")).toBe("light");
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    expect(screen.getByRole("menuitemradio", { name: "Light" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "System" }));
    expect(localStorage.getItem("appearance")).toBeNull();
  });

  it("Escape closes the menu", () => {
    renderToggle();
    open();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
