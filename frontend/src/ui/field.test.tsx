import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextArea } from "./TextArea";
import { TextField } from "./TextField";

afterEach(cleanup);

const css = readFileSync(join(process.cwd(), "src/ui/field.css"), "utf8");

/** The declaration block of the first rule whose selector list contains `selector`. */
function rule(selector: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if ((m[1] ?? "").split(",").some((s) => s.trim() === selector)) return m[2] ?? "";
  }
  return "";
}

describe("TextField (Audi underline field)", () => {
  // FR-4: error state with message
  it("error sets aria-invalid, describes by the message and shows an alert icon", () => {
    const { container } = render(
      <TextField label="Title" value="" onChange={() => {}} error="Title is required" />,
    );
    const input = screen.getByLabelText("Title");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const msg = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(msg?.textContent).toContain("Title is required");
    const icon = container.querySelector<HTMLElement>(".icon[data-icon]");
    expect(icon?.style.width).toBe("16px");
  });

  it("underline, label and message use --negative in the error state", () => {
    expect(rule(".field--error .field__control")).toContain("var(--form-underline-error)");
    expect(rule(".field--error .field__label")).toContain("var(--form-text-error)");
    expect(rule(".field__error")).toContain("var(--form-text-error)");
    expect(css).toMatch(/--form-underline-error/);
    const err = render(<TextField label="A" value="" onChange={() => {}} error="x" />).container;
    expect(err.querySelector(".field--error")).toBeTruthy();
  });

  // FR-4: states differ
  it("underline colour and width differ per state", () => {
    const idle = rule(".field__control");
    const hover = rule(".field__control:hover");
    const focus = rule(".field__control:focus");
    const disabled = rule(".field__control:disabled");
    expect(idle).toContain("56px");
    expect(idle).toContain("1px");
    expect(focus).toContain("2px");
    expect(focus).toContain("var(--form-underline-active)");
    expect(hover).toContain("var(--form-underline-active)");
    expect(disabled).toContain("var(--form-underline-disabled)");
    expect(idle).toContain("var(--form-underline)");
    expect(rule(".field__control[readonly]")).toContain("var(--form-readonly-fill)");
  });

  // FR-9
  it("keeps placeholder, label and role lookups", () => {
    const onChange = vi.fn();
    render(<TextField label="Title" value="" placeholder="Name" onChange={onChange} />);
    expect(screen.getByPlaceholderText("Name")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "A" } });
    expect(onChange).toHaveBeenCalledWith("A");
  });

  it("supports readOnly and the static label above the control", () => {
    const { container } = render(<TextField label="Id" value="x" onChange={() => {}} readOnly />);
    expect((screen.getByLabelText("Id") as HTMLInputElement).readOnly).toBe(true);
    expect(container.firstElementChild?.firstElementChild?.tagName).toBe("LABEL");
  });
});

describe("TextArea (Audi boxed)", () => {
  it("is a labelled textarea with a 1px box and 12px padding", () => {
    const onChange = vi.fn();
    render(<TextArea label="Notes" value="" placeholder="Write" onChange={onChange} />);
    const ta = screen.getByRole("textbox", { name: "Notes" });
    expect(ta.tagName).toBe("TEXTAREA");
    expect(screen.getByPlaceholderText("Write")).toBe(ta);
    fireEvent.change(ta, { target: { value: "z" } });
    expect(onChange).toHaveBeenCalledWith("z");
    const box = rule(".field__area");
    expect(box).toContain("1px");
    expect(box).toContain("var(--space-12)");
  });

  it("shows a counter when maxLength is set, and an error state", () => {
    render(<TextArea label="Notes" value="abc" onChange={() => {}} maxLength={50} />);
    expect(screen.getByText("3/50")).toBeTruthy();
    cleanup();
    render(<TextArea label="Notes" value="" onChange={() => {}} error="Too short" />);
    const ta = screen.getByLabelText("Notes");
    expect(ta.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(ta.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("Too short");
  });
});
