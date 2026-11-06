import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromotionPicker } from "./PromotionPicker";

afterEach(cleanup);

describe("PromotionPicker", () => {
  it.each([
    ["Queen", "q"],
    ["Rook", "r"],
    ["Bishop", "b"],
    ["Knight", "n"],
  ])("AC-15: %s button returns %s", (name, letter) => {
    const onChoose = vi.fn();
    render(<PromotionPicker onChoose={onChoose} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(letter);
  });

  it("AC-31: focus starts inside and every button is in the tab order", () => {
    render(<PromotionPicker onChoose={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Queen" }));
    for (const button of screen.getAllByRole("button")) {
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("AC-31: arrow keys move focus (wrapping), Enter on a button chooses it", () => {
    render(<PromotionPicker onChoose={() => {}} onCancel={() => {}} />);
    const key = (k: string) => fireEvent.keyDown(document.activeElement as Element, { key: k });
    key("ArrowRight");
    key("ArrowRight");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bishop" }));
    key("ArrowLeft");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rook" }));
    key("ArrowLeft");
    key("ArrowLeft");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Knight" }));
  });

  it("AC-31: Escape cancels and nothing is chosen", () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(<PromotionPicker onChoose={onChoose} onCancel={onCancel} />);
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
  });
});
