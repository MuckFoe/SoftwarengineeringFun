import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { SourceList } from "./SourceList";
import { Toolbar } from "./Toolbar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tabStops = () =>
  [...document.querySelectorAll<HTMLElement>("button, input, a[href]")].filter(
    (el) => el.tabIndex >= 0,
  );

describe("Toolbar", () => {
  function Bar() {
    return (
      <>
        <button type="button">before</button>
        <Toolbar label="Session">
          <Button label="Show sidebar" icon="sidebar" />
          <Button>Run</Button>
          <Button>Invite</Button>
        </Toolbar>
        <button type="button">after</button>
      </>
    );
  }

  // AC-18c (component part)
  it("is one tab stop", () => {
    render(<Bar />);
    expect(screen.getByRole("toolbar", { name: "Session" })).toBeTruthy();
    expect(tabStops().map((el) => el.textContent || el.getAttribute("aria-label"))).toEqual([
      "before",
      "Show sidebar",
      "after",
    ]);
  });

  it("moves focus between its items with the arrow keys and keeps the last one as its stop", () => {
    render(<Bar />);
    const sidebar = screen.getByRole("button", { name: "Show sidebar" });
    const run = screen.getByRole("button", { name: "Run" });
    const invite = screen.getByRole("button", { name: "Invite" });
    sidebar.focus();
    fireEvent.keyDown(sidebar, { key: "ArrowRight" });
    expect(document.activeElement).toBe(run);
    fireEvent.keyDown(run, { key: "ArrowRight" });
    expect(document.activeElement).toBe(invite);
    fireEvent.keyDown(invite, { key: "ArrowRight" });
    expect(document.activeElement).toBe(sidebar);
    fireEvent.keyDown(sidebar, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(invite);
    fireEvent.keyDown(invite, { key: "Home" });
    expect(document.activeElement).toBe(sidebar);
    fireEvent.keyDown(sidebar, { key: "End" });
    expect(document.activeElement).toBe(invite);
    expect(tabStops()).toContain(invite);
    expect(tabStops()).not.toContain(sidebar);
  });

  it("leaves arrow keys to a text field inside it", () => {
    render(
      <Toolbar label="Problems">
        <input aria-label="Search" />
        <Button>New problem</Button>
      </Toolbar>,
    );
    const search = screen.getByRole("textbox", { name: "Search" });
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowRight" });
    expect(document.activeElement).toBe(search);
  });

  it("uses the material", () => {
    render(<Bar />);
    expect(screen.getByRole("toolbar").className).toMatch(/material/);
  });
});

describe("SourceList", () => {
  const items = [
    { id: "a", title: "Sum Two Numbers" },
    { id: "b", title: "Reverse List" },
    { id: "c", title: "FizzBuzz" },
  ];

  function List({ onActivate = vi.fn(), list = items, selectedId = "a" }) {
    return (
      <SourceList
        label="Problems"
        items={list}
        selectedId={selectedId}
        onActivate={onActivate}
        renderItem={(item) => item.title}
      />
    );
  }

  it("is a listbox with the selected row as its one tab stop", () => {
    render(<List selectedId="b" />);
    expect(screen.getByRole("listbox", { name: "Problems" })).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(options.map((o) => o.tabIndex)).toEqual([-1, 0, -1]);
  });

  // AC-18c (component part)
  it("moves focus with the arrow keys and activates the focused row with Return", () => {
    const onActivate = vi.fn();
    render(<List onActivate={onActivate} />);
    const first = screen.getByRole("option", { name: "Sum Two Numbers" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const second = screen.getByRole("option", { name: "Reverse List" });
    expect(document.activeElement).toBe(second);
    expect(second.tabIndex).toBe(0);
    fireEvent.keyDown(second, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith(items[1]);
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "FizzBuzz" }));
  });

  it("activates on click", () => {
    const onActivate = vi.fn();
    render(<List onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("option", { name: "FizzBuzz" }));
    expect(onActivate).toHaveBeenCalledWith(items[2]);
  });

  it("animates rows in, and out before removing them", () => {
    vi.useFakeTimers();
    const { rerender } = render(<List />);
    expect(screen.getByRole("option", { name: "FizzBuzz" }).className).toMatch(/anim-row-in/);
    rerender(<List list={items.slice(0, 2)} />);
    const leaving = screen.getByText("FizzBuzz").closest("[aria-hidden]");
    expect(leaving?.className).toMatch(/anim-row-out/);
    expect(screen.queryByRole("option", { name: "FizzBuzz" })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("FizzBuzz")).toBeNull();
  });
});

describe("SourceList removals in quick succession", () => {
  it("still removes the first row when the list changes again during its exit", () => {
    vi.useFakeTimers();
    const rows = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ];
    const list = (items: typeof rows) => (
      <SourceList label="L" items={items} onActivate={() => {}} renderItem={(i) => i.title} />
    );
    const { rerender } = render(list(rows));
    rerender(list(rows.slice(0, 2)));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender(list(rows.slice(0, 1)));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("C")).toBeNull();
    expect(screen.queryByText("B")).toBeNull();
    expect(screen.getByText("A")).toBeTruthy();
  });
});
