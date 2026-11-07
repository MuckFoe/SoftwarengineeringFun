import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu";
import css from "./menu.css?raw";
import { Select } from "./Select";

afterEach(cleanup);

function rule(selector: string): string {
  const esc = selector.replace(/[.[\]()]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? (m[1] ?? "") : "";
}

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

describe("menu.css (FR-4)", () => {
  it("panel uses surface-2, elev-2, radius-0; options radius-0", () => {
    expect(rule(".ui-menu-panel")).toMatch(/background:\s*var\(--surface-2\)/);
    expect(rule(".ui-menu-panel")).toMatch(/box-shadow:\s*var\(--elev-2\)/);
    expect(rule(".ui-menu-panel")).toMatch(/border-radius:\s*var\(--radius-0\)/);
    expect(rule(".ui-menu-option")).toMatch(/border-radius:\s*var\(--radius-0\)/);
  });
  it("hover differs from idle", () => {
    expect(rule(".ui-menu-option:hover")).toMatch(/background:\s*var\(--neutral-700\)/);
    expect(rule(".ui-menu-option")).not.toMatch(/var\(--neutral-700\)/);
  });
  it("focused option is indicated", () => {
    expect(rule(".ui-menu-option:focus-visible")).toMatch(/outline|box-shadow/);
  });
  it("select is an underline field with an error state", () => {
    expect(rule(".ui-select-trigger")).toMatch(
      /border-bottom:\s*1px solid var\(--form-underline\)/,
    );
    expect(rule('.ui-select-trigger[aria-invalid="true"]')).toMatch(/--form-underline-error/);
    expect(rule(".ui-select-error")).toMatch(/--form-text-error/);
  });
});

describe("Select", () => {
  it("opens, moves with arrows, selects with Enter and returns focus", () => {
    const onChange = vi.fn();
    render(<Select label="Letter" value="a" onChange={onChange} options={options} />);
    const trigger = screen.getByRole("combobox", { name: "Letter" });
    expect(trigger.textContent).toContain("Alpha");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    const selected = screen.getByRole("option", { name: "Alpha" });
    expect(document.activeElement).toBe(selected);
    fireEvent.keyDown(selected, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Beta" }));
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Esc closes without changing and returns focus", () => {
    const onChange = vi.fn();
    render(<Select label="Letter" value="a" onChange={onChange} options={options} />);
    const trigger = screen.getByRole("combobox", { name: "Letter" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("shows the error message tied to the trigger", () => {
    render(
      <Select label="Letter" value="a" onChange={() => {}} options={options} error="Pick one" />,
    );
    const trigger = screen.getByRole("combobox", { name: "Letter" });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    const id = trigger.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe("Pick one");
  });

  it("does not open when disabled", () => {
    render(<Select label="Letter" value="a" onChange={() => {}} options={options} disabled />);
    fireEvent.click(screen.getByRole("combobox", { name: "Letter" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("Menu", () => {
  it("opens, navigates, activates with Enter, closes and returns focus", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <Menu
        label="Actions"
        items={[
          { label: "Rename", onSelect: first },
          { label: "Delete", onSelect: second },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Esc closes and returns focus; click activates", () => {
    const onSelect = vi.fn();
    render(<Menu label="Actions" items={[{ label: "Rename", onSelect }]} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onSelect).toHaveBeenCalled();
  });
});
