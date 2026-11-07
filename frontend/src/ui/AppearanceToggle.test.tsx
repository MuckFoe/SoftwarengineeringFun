import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { AppearanceToggle } from "./AppearanceToggle";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

function stubLayout(vw: number, trig: DOMRect) {
  vi.stubGlobal("innerWidth", vw);
  vi.stubGlobal("innerHeight", 600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute("role") === "menu") {
      const l = Number.parseFloat(this.style.left || "0");
      const t = Number.parseFloat(this.style.top || "0");
      return rect(l, t, 160, 120);
    }
    if (this.getAttribute("aria-haspopup")) return trig;
    return rect(0, 0, 0, 0);
  });
}

describe("AppearanceToggle v2 panel (FR-6)", () => {
  it("renders the panel in a body portal, fixed, at --z-menu, with an icon and a check on the current item", () => {
    renderToggle();
    open();
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.zIndex).toBe("var(--z-menu)");
    const items = screen.getAllByRole("menuitemradio");
    for (const it of items) expect(it.querySelector("span")).not.toBeNull();
    expect(items.map((i) => i.querySelectorAll(".appearance-menu-check > *").length)).toEqual([
      0, 0, 1,
    ]);
  });

  it.each([320, 768, 1280])(
    "stays inside the viewport at width %i with the trigger at the right edge",
    (vw) => {
      stubLayout(vw, rect(vw - 32, 8, 32, 32));
      renderToggle();
      open();
      const r = (screen.getByRole("menu") as HTMLElement).getBoundingClientRect();
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(vw);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(600);
    },
  );

  it("re-clamps on resize", () => {
    stubLayout(1280, rect(1248, 8, 32, 32));
    renderToggle();
    open();
    stubLayout(320, rect(288, 8, 32, 32));
    fireEvent(window, new Event("resize"));
    const r = (screen.getByRole("menu") as HTMLElement).getBoundingClientRect();
    expect(r.right).toBeLessThanOrEqual(320);
  });

  it("ArrowDown/ArrowUp move focus with wrap; Enter applies; Escape closes and refocuses the trigger", () => {
    renderToggle();
    open();
    const [light, dark, system] = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(system);
    fireEvent.keyDown(system as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(light);
    fireEvent.keyDown(light as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(system);
    fireEvent.keyDown(system as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(dark);
    fireEvent.keyDown(dark as HTMLElement, { key: "Enter" });
    expect(localStorage.getItem("appearance")).toBe("dark");
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /appearance/i }));
  });

  it("an outside click closes the panel", () => {
    renderToggle();
    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
