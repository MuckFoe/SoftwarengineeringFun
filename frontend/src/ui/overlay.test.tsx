import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPEARANCES, evaluatePair, PAIRS, THRESHOLD } from "../styles/contrast";
import css from "./overlay.css?raw";
import { Tooltip } from "./Popover";
import { Toast } from "./Toast";

afterEach(cleanup);

function rule(sel: string): string {
  const m = new RegExp(`${sel.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
  return m?.[1] ?? "";
}

describe("Tooltip (Audi popover)", () => {
  it("shows on hover and on keyboard focus with role=tooltip, hides on Esc", () => {
    render(
      <Tooltip content="Copy link">
        <button type="button">Copy</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    const btn = screen.getByRole("button", { name: "Copy" });
    fireEvent.mouseEnter(btn.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Copy link");
    expect(btn.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.mouseLeave(btn.parentElement as HTMLElement);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("is styled inverted, 12/16", () => {
    const r = rule(".tooltip");
    expect(r).toMatch(/background:\s*var\(--canvas-inverted\)/);
    expect(r).toMatch(/color:\s*var\(--canvas\)/);
    expect(r).toMatch(/12px/);
    expect(r).toMatch(/16px/);
    expect(r).toMatch(/border-radius:\s*0/);
  });
});

describe("Toast (Audi notification)", () => {
  it("uses role=status, alert for negative", () => {
    for (const tone of ["info", "success", "notice"] as const) {
      render(<Toast tone={tone}>Saved</Toast>);
      expect(screen.getByRole("status").getAttribute("data-tone")).toBe(tone);
      cleanup();
    }
    render(<Toast tone="negative">Failed</Toast>);
    expect(screen.getByRole("alert").getAttribute("data-tone")).toBe("negative");
  });

  it("close button is optional and calls onClose", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Toast tone="info">x</Toast>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <Toast tone="info" onClose={onClose}>
        x
      </Toast>,
    );
    act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(onClose).toHaveBeenCalled();
  });

  it("tone fills match the signal tokens, radius 0", () => {
    expect(rule('.toast[data-tone="success"]')).toMatch(/background:\s*var\(--success\)/);
    expect(rule('.toast[data-tone="notice"]')).toMatch(/background:\s*var\(--notice\)/);
    expect(rule('.toast[data-tone="negative"]')).toMatch(/background:\s*var\(--negative\)/);
    expect(rule('.toast[data-tone="info"]')).toMatch(/background:\s*var\(--canvas-inverted\)/);
    expect(rule(".toast")).toMatch(/border-radius:\s*0/);
  });

  it("each tone's text passes 4.5:1 in both appearances (contrast list)", () => {
    const names = ["info", "success", "notice", "negative"].map((t) => `toast text on ${t} fill`);
    for (const n of names) {
      const p = PAIRS.find((x) => x.name === n);
      expect(p, n).toBeTruthy();
      for (const a of APPEARANCES) {
        expect(evaluatePair(p!, a).ratio, `${n} ${a}`).toBeGreaterThanOrEqual(THRESHOLD.text);
      }
    }
  });
});
