import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { JumpBar } from "./JumpBar";
import type { JumpItem } from "./jump";

const index = vi.hoisted(() => ({
  items: [] as JumpItem[],
  opens: [] as boolean[],
}));
vi.mock("./useJumpIndex", () => ({
  useJumpIndex: (open: boolean) => {
    index.opens.push(open);
    return { items: index.items };
  },
}));

afterEach(() => {
  cleanup();
  index.opens = [];
});

index.items = [
  { kind: "area", id: "/learn", label: "Learn", to: "/learn" },
  { kind: "session", id: "abc", label: "Two sum pairing", to: "/s/abc" },
  { kind: "problem", id: "p1", label: "Learn graphs", to: "/" },
];

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const setup = () =>
  render(
    <MemoryRouter initialEntries={["/games"]}>
      <ShortcutsProvider>
        <button type="button">before</button>
        <JumpBar />
        <Where />
      </ShortcutsProvider>
    </MemoryRouter>,
  );

describe("JumpBar (016 FR-15)", () => {
  it("shows a 'Jump to anything' trigger and no dialog until opened", () => {
    setup();
    expect(screen.getByRole("button", { name: /jump to anything/i })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(index.opens.every((o) => o === false)).toBe(true);
  });

  it("opens on Ctrl+K with the combobox focused, and prevents the browser default", () => {
    setup();
    const ev = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
    const input = screen.getByRole("combobox");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(index.opens.at(-1)).toBe(true);
  });

  it("opens from the trigger button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /jump to anything/i }));
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("filters as the user types, areas first", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /jump to anything/i }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "learn" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Learn"),
      expect.stringContaining("Learn graphs"),
    ]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/no matches/i)).toBeTruthy();
  });

  it("moves the highlight with the arrows and Enter navigates and closes", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /jump to anything/i }));
    const input = screen.getByRole("combobox");
    const options = () => screen.getAllByRole("option");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("where").textContent).toBe("/s/abc");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking a match navigates", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /jump to anything/i }));
    fireEvent.click(screen.getByRole("option", { name: /^Learn\s*Area/ }));
    expect(screen.getByTestId("where").textContent).toBe("/learn");
  });

  it("Escape closes and returns focus to the element focused before", () => {
    setup();
    const before = screen.getByRole("button", { name: "before" });
    before.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("Ctrl+K again closes it", () => {
    setup();
    const press = () =>
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
        );
      });
    press();
    press();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
