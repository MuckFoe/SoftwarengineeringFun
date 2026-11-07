import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { Radio } from "./Radio";
import { Switch } from "./Switch";
import css from "./toggles.css?raw";

afterEach(cleanup);

function rule(selector: string): string {
  const m = css.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  if (!m) throw new Error(`no rule ${selector}`);
  return m[1] ?? "";
}

describe("toggle styling (FR-4)", () => {
  it("checkbox is 20px with radius 2", () => {
    const r = rule(".ui-checkbox__input");
    expect(r).toMatch(/width:\s*20px/);
    expect(r).toMatch(/height:\s*20px/);
    expect(r).toMatch(/border-radius:\s*var\(--radius-xs\)/);
  });
  it("radio is a 20px circle", () => {
    const r = rule(".ui-radio__input");
    expect(r).toMatch(/width:\s*20px/);
    expect(r).toMatch(/border-radius:\s*50%/);
  });
  it("switch is a 56x32 pill", () => {
    const r = rule(".ui-switch__input");
    expect(r).toMatch(/width:\s*56px/);
    expect(r).toMatch(/height:\s*32px/);
    expect(r).toMatch(/border-radius:\s*var\(--radius-max\)/);
  });
  it("has distinct hover, focus, checked and disabled states", () => {
    for (const s of [
      ".ui-toggle__input:hover:not(:disabled)",
      ".ui-toggle__input:focus-visible",
      ".ui-toggle__input:checked",
      ".ui-toggle__input:disabled",
    ]) {
      expect(css).toContain(s);
    }
  });
  it("uses only tokens", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

describe("Checkbox", () => {
  it("is found by role and label, toggles", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Agree" checked={false} onChange={onChange} />);
    const el = screen.getByRole("checkbox", { name: "Agree" }) as HTMLInputElement;
    expect(el.classList.contains("ui-checkbox__input")).toBe(true);
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it("disabled blocks changes and shows caption", () => {
    const onChange = vi.fn();
    render(
      <Checkbox label="Agree" caption="Required" checked={false} onChange={onChange} disabled />,
    );
    const el = screen.getByRole("checkbox", { name: "Agree" });
    expect((el as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(el);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Required")).toBeTruthy();
  });
});

describe("Radio", () => {
  it("is found by role and label", () => {
    const onChange = vi.fn();
    render(<Radio label="One" name="g" checked={false} onChange={onChange} />);
    const el = screen.getByRole("radio", { name: "One" });
    expect(el.classList.contains("ui-radio__input")).toBe(true);
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Switch", () => {
  it("has switch role and toggles", () => {
    function Host() {
      const [on, setOn] = useState(false);
      return <Switch label="Sound" checked={on} onChange={setOn} />;
    }
    render(<Host />);
    const el = screen.getByRole("switch", { name: "Sound" }) as HTMLInputElement;
    expect(el.checked).toBe(false);
    fireEvent.click(el);
    expect(el.checked).toBe(true);
  });
  it("disabled blocks changes", () => {
    const onChange = vi.fn();
    render(<Switch label="Sound" checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("switch", { name: "Sound" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
