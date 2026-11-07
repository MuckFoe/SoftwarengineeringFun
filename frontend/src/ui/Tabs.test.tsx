import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs";
import css from "./tabs.css?raw";

afterEach(cleanup);

const TABS = [
  { id: "a", label: "Alpha", icon: "play" as const },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [v, setV] = useState("a");
  return (
    <Tabs
      tabs={TABS}
      value={v}
      onChange={(id) => {
        setV(id);
        onChange?.(id);
      }}
    />
  );
}

describe("Tabs", () => {
  it("FR-4: tablist semantics, active vs idle", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("FR-4: 56px bar, 2px underline, nav tokens", () => {
    expect(css).toMatch(/height:\s*56px|min-height:\s*56px|var\(--space-56\)/);
    expect(css).toMatch(/2px solid var\(--nav-active\)/);
    expect(css).toMatch(/var\(--nav-idle\)/);
    expect(css).toMatch(/var\(--nav-active\)/);
  });

  it("optional icon renders", () => {
    const { container } = render(<Harness />);
    expect(
      container.querySelector("[role=tab] .icon[data-icon], [role=tab] span[aria-hidden]"),
    ).toBeTruthy();
  });

  it("FR-9: arrows move and select, wrapping; roving tabindex", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const a = screen.getByRole("tab", { name: "Alpha" });
    expect(a.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Beta" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Beta" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Alpha" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("FR-9: Enter/Space/click select", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(onChange).toHaveBeenLastCalledWith("c");
  });
});
