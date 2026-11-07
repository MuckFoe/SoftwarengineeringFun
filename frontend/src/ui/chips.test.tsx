import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "./Badge";
import css from "./chips.module.css?raw";
import { IconButton } from "./IconButton";
import { Tag } from "./Tag";

afterEach(cleanup);

/** Declarations of the first rule whose selector list contains `selector`. */
function rule(selector: string): string {
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const [sel = "", body] = chunk.split("{");
    if (body !== undefined && sel.split(",").some((x) => x.trim() === selector)) return body;
  }
  throw new Error(`no rule for ${selector}`);
}

describe("IconButton", () => {
  it("takes its accessible name from label", () => {
    render(<IconButton icon="trash" label="Delete" />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("defaults to type=button and fires onClick", () => {
    const onClick = vi.fn();
    render(<IconButton icon="trash" label="Delete" onClick={onClick} />);
    const b = screen.getByRole("button");
    expect(b).toHaveProperty("type", "button");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("toggled sets aria-pressed, absent otherwise", () => {
    const { rerender } = render(<IconButton icon="sidebar" label="Sidebar" />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBeNull();
    rerender(<IconButton icon="sidebar" label="Sidebar" toggled />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    rerender(<IconButton icon="sidebar" label="Sidebar" toggled={false} />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  });

  it("has distinct hover, pressed, disabled and toggled colours from tokens", () => {
    const idle = rule(".iconButton");
    const hover = rule(".iconButton:hover:not(:disabled)");
    const active = rule(".iconButton:active:not(:disabled)");
    const disabled = rule(".iconButton:disabled");
    const toggled = rule('.iconButton[aria-pressed="true"]');
    const values = [idle, hover, active, disabled, toggled].map((r) => r.replace(/\s+/g, " "));
    expect(new Set(values).size).toBe(5);
    expect(hover).toMatch(/var\(--/);
    expect(disabled).toMatch(/--(action-text-disabled|text-disabled|ui-stroke-disabled)/);
  });
});

describe("Badge", () => {
  it("dot is a filled circle with no text", () => {
    render(<Badge kind="dot" label="Unread" />);
    const el = screen.getByRole("img", { name: "Unread" });
    expect(el.textContent).toBe("");
    expect(rule(".badge")).toMatch(/border-radius:\s*var\(--radius-max\)/);
    expect(rule(".dot")).toMatch(/background:\s*var\(--/);
  });

  it("count shows its value", () => {
    render(<Badge kind="count" value={7} />);
    expect(screen.getByText("7")).toBeTruthy();
    expect(rule(".badge")).toMatch(/border-radius:\s*var\(--radius-max\)/);
  });

  it("alert uses --negative", () => {
    render(<Badge kind="alert" value="!" label="Error" />);
    expect(screen.getByText("!")).toBeTruthy();
    expect(rule(".alert")).toMatch(/var\(--negative\)/);
  });
});

describe("Tag", () => {
  it("is static text without onClick", () => {
    render(<Tag label="Python" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Python")).toBeTruthy();
  });

  it("with onClick is a keyboard-operable button, selected sets aria-pressed", () => {
    const onClick = vi.fn();
    render(<Tag label="Python" selected onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Python" });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(b); // Enter/Space on a native button dispatch click
    expect(onClick).toHaveBeenCalledOnce();
    expect(b.tagName).toBe("BUTTON");
  });

  it("selected differs from idle", () => {
    expect(rule(".tag").replace(/\s+/g, " ")).not.toBe(
      rule('.tag[aria-pressed="true"]').replace(/\s+/g, " "),
    );
  });
});
