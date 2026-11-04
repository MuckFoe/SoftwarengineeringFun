import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampTop, SplitPane } from "./SplitPane";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("clampTop", () => {
  it("keeps the top part at least minTop", () => {
    expect(clampTop(50, 600, 120, 160)).toBe(120);
    expect(clampTop(-10, 600, 120, 160)).toBe(120);
  });

  it("keeps the bottom part at least minBottom", () => {
    expect(clampTop(500, 600, 120, 160)).toBe(440);
    expect(clampTop(9999, 600, 120, 160)).toBe(440);
  });

  it("returns the value itself in between", () => {
    expect(clampTop(120, 600, 120, 160)).toBe(120);
    expect(clampTop(300, 600, 120, 160)).toBe(300);
    expect(clampTop(440, 600, 120, 160)).toBe(440);
  });

  it("shares a too-short container in proportion to the minimums", () => {
    expect(clampTop(10, 140, 120, 160)).toBe(60);
    expect(clampTop(130, 140, 120, 160)).toBe(60);
    expect(clampTop(0, 0, 120, 160)).toBe(0);
  });
});

describe("SplitPane", () => {
  // jsdom has no layout: give the split container a height so pixel steps mean something.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  });

  function Split({ bottomOpen = true }) {
    return (
      <>
        <button type="button">before</button>
        <SplitPane
          top={<p>description</p>}
          bottom={
            <div>
              <p>chat</p>
              <input aria-label="Message" />
            </div>
          }
          bottomOpen={bottomOpen}
          minTop={120}
          minBottom={160}
          dividerLabel="Resize description and chat"
        />
      </>
    );
  }

  const tabStops = () =>
    [...document.querySelectorAll<HTMLElement>("button, input, [tabindex]")].filter(
      (el) => el.tabIndex >= 0 && !el.closest("[inert]"),
    );

  const value = (el: HTMLElement) => Number(el.getAttribute("aria-valuenow"));

  it("renders an accessible, focusable divider", () => {
    render(<Split />);
    const divider = screen.getByRole("separator", { name: "Resize description and chat" });
    expect(divider.getAttribute("aria-orientation")).toBe("horizontal");
    expect(divider.getAttribute("aria-valuemin")).toBe("0");
    expect(divider.getAttribute("aria-valuemax")).toBe("100");
    expect(value(divider)).toBe(50);

    // Reachable by Tab: in the tab order, between the button before it and the chat input.
    expect(tabStops()).toEqual([
      screen.getByRole("button", { name: "before" }),
      divider,
      screen.getByRole("textbox", { name: "Message" }),
    ]);
  });

  it("moves the divider with the arrow keys, Home and End", () => {
    render(<Split />);
    const divider = screen.getByRole("separator", { name: "Resize description and chat" });

    fireEvent.keyDown(divider, { key: "ArrowUp" });
    const up = value(divider);
    expect(up).toBeLessThan(50);

    fireEvent.keyDown(divider, { key: "ArrowDown" });
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(value(divider)).toBeGreaterThan(up);
    expect(value(divider)).toBeGreaterThan(50);

    fireEvent.keyDown(divider, { key: "Home" });
    expect(value(divider)).toBe(Math.round((120 / 600) * 100));
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(value(divider)).toBe(Math.round((120 / 600) * 100));

    fireEvent.keyDown(divider, { key: "End" });
    expect(value(divider)).toBe(Math.round(((600 - 160) / 600) * 100));
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(value(divider)).toBe(Math.round(((600 - 160) / 600) * 100));
  });

  it("drags the divider with the pointer, clamped to both minimums, until release", () => {
    render(<Split />);
    const divider = screen.getByRole("separator", { name: "Resize description and chat" });

    // Up 60 px from the middle (300 of 600): the top part is 240 px.
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 340 });
    expect(value(divider)).toBe(40);

    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 0 });
    expect(value(divider)).toBe(Math.round((120 / 600) * 100));
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 2000 });
    expect(value(divider)).toBe(Math.round(((600 - 160) / 600) * 100));

    // Released: further moves change nothing.
    fireEvent.pointerUp(divider, { pointerId: 1, clientY: 2000 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 400 });
    expect(value(divider)).toBe(Math.round(((600 - 160) / 600) * 100));
  });

  it("ignores pointer moves without a press and presses of other buttons", () => {
    render(<Split />);
    const divider = screen.getByRole("separator", { name: "Resize description and chat" });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 100 });
    fireEvent.pointerDown(divider, { button: 2, pointerId: 1, clientY: 300 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 100 });
    expect(value(divider)).toBe(50);
  });

  it("collapses the bottom part but keeps it mounted, hidden and inert", () => {
    render(<Split bottomOpen={false} />);
    const chat = screen.getByText("chat");
    const bottom = chat.closest("[aria-hidden]");
    expect(bottom).not.toBeNull();
    expect(bottom?.getAttribute("aria-hidden")).toBe("true");
    expect(bottom?.hasAttribute("inert")).toBe(true);
    expect(tabStops()).toEqual([screen.getByRole("button", { name: "before" })]);
    expect(screen.queryByRole("separator")).toBeNull();
    expect(document.querySelector('[role="separator"]')).toBeNull();
  });

  it("keeps the divider position across hiding and showing the bottom part", () => {
    const { rerender } = render(<Split />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Home" });
    rerender(<Split bottomOpen={false} />);
    rerender(<Split />);
    expect(value(screen.getByRole("separator"))).toBe(20);
  });
});
