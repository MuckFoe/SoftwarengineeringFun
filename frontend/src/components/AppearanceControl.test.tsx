// jsdom has neither matchMedia nor the popover API: following the OS live, persistence
// across visits and the popover actually showing are asserted end to end (tasks 33, 34).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { AppearanceControl } from "./AppearanceControl";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-appearance");
});

function renderControl() {
  render(
    <ShortcutsProvider>
      <AppearanceControl />
    </ShortcutsProvider>,
  );
}

const radio = (name: string) => screen.getByRole("radio", { name, hidden: true });

describe("AppearanceControl", () => {
  it("is a toolbar button that opens an appearance popover with Light, Dark and System", () => {
    renderControl();
    const trigger = screen.getByRole("button", { name: "Appearance" });
    expect(trigger.getAttribute("popovertarget")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Appearance", hidden: true })).toBeTruthy();
    expect(radio("System").getAttribute("aria-checked")).toBe("true");
  });

  // AC-7
  it("applies Light at once and keeps it", () => {
    document.documentElement.setAttribute("data-appearance", "dark");
    renderControl();
    fireEvent.click(radio("Light"));
    expect(document.documentElement.getAttribute("data-appearance")).toBe("light");
    expect(localStorage.getItem("appearance")).toBe("light");
    expect(radio("Light").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(radio("Dark"));
    expect(document.documentElement.getAttribute("data-appearance")).toBe("dark");
    expect(localStorage.getItem("appearance")).toBe("dark");
  });

  it("starts from the stored choice", () => {
    localStorage.setItem("appearance", "dark");
    renderControl();
    expect(radio("Dark").getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("dark");
  });

  // AC-18a: the appearance shortcut (Ctrl+, off macOS) opens it. jsdom keeps [popover]
  // hidden, so focus moving onto the current choice is asserted end to end.
  it("opens on the appearance shortcut", () => {
    renderControl();
    const trigger = screen.getByRole("button", { name: "Appearance" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
