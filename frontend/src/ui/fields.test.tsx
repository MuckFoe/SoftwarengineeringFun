import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchField } from "./SearchField";
import { SegmentedControl } from "./SegmentedControl";
import { TextField } from "./TextField";

afterEach(cleanup);

describe("TextField", () => {
  it("is labelled and controlled", () => {
    const onChange = vi.fn();
    render(<TextField label="Title" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "A" } });
    expect(onChange).toHaveBeenCalledWith("A");
  });

  it("describes the field by its error", () => {
    render(<TextField label="Title" value="" onChange={() => {}} error="Title is required" />);
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const id = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe("Title is required");
  });

  it("shows a character counter", () => {
    render(
      <TextField label="Message" value="hello" onChange={() => {}} maxLength={2000} counter />,
    );
    expect(screen.getByText("5/2000")).toBeTruthy();
  });

  it("can be multi-line", () => {
    render(<TextField label="Signature" value="" onChange={() => {}} multiline />);
    expect(screen.getByRole("textbox", { name: "Signature" }).tagName).toBe("TEXTAREA");
  });
});

function ControlledSearch({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <SearchField
      label="Search problems"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("SearchField", () => {
  // AC-12 (component part)
  it("emits once per typed character", () => {
    const onChange = vi.fn();
    render(<ControlledSearch onChange={onChange} />);
    const box = screen.getByRole("searchbox", { name: "Search problems" });
    let typed = "";
    for (const ch of "rev") {
      typed += ch;
      fireEvent.change(box, { target: { value: typed } });
    }
    expect(onChange.mock.calls).toEqual([["r"], ["re"], ["rev"]]);
  });

  it("clears with the Clear button", () => {
    const onChange = vi.fn();
    render(<ControlledSearch onChange={onChange} />);
    const box = screen.getByRole("searchbox", { name: "Search problems" }) as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    fireEvent.change(box, { target: { value: "rev" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(box.value).toBe("");
    expect(document.activeElement).toBe(box);
  });
});

function ControlledSegments() {
  const [value, setValue] = useState("system");
  return (
    <SegmentedControl
      label="Appearance"
      value={value}
      onChange={setValue}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "System" },
      ]}
    />
  );
}

describe("SegmentedControl", () => {
  it("is a labelled radiogroup with one checked segment and one tab stop", () => {
    render(<ControlledSegments />);
    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  // FR-21
  it("moves selection and focus with the arrow keys, wrapping around", () => {
    render(<ControlledSegments />);
    const system = screen.getByRole("radio", { name: "System" });
    system.focus();
    fireEvent.keyDown(system, { key: "ArrowRight" });
    const light = screen.getByRole("radio", { name: "Light" });
    expect(light.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(light);
    fireEvent.keyDown(light, { key: "ArrowRight" });
    const dark = screen.getByRole("radio", { name: "Dark" });
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(dark);
    fireEvent.keyDown(dark, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(light);
  });

  it("selects on click", () => {
    render(<ControlledSegments />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
  });
});
