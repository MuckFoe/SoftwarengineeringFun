import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinnableColumn } from "./PinnableColumn";
import { PEEK_CLOSE_DELAY_MS, PinnablePanel, type PinnablePanelHandle } from "./PinnablePanel";
import { loadPinned, PIN_STORAGE_PREFIX, savePinned, usePinned } from "./usePinned";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A chat panel whose pin state is remembered, with a field to show its content stays mounted. */
function Chat({ defaultPinned = true }: { defaultPinned?: boolean }) {
  const [pinned, setPinned] = usePinned("chat", defaultPinned);
  return (
    <>
      <button type="button">Before</button>
      <PinnablePanel title="Chat" edge="right" pinned={pinned} onPinnedChange={setPinned}>
        <label>
          Message
          <input />
        </label>
      </PinnablePanel>
      <button type="button">Elsewhere</button>
    </>
  );
}

/** Moves focus like the keyboard would, letting React apply what follows. */
function focus(el: HTMLElement | null) {
  act(() => el?.focus());
}

/** Text that is in the accessibility tree (not inside a closed, aria-hidden peek). */
const shown = (text: string) => screen.getByText(text).closest('[aria-hidden="true"]') === null;

/** The bar's toggle while unpinned: the strip, and the opened panel's header title. */
const strip = () => screen.getByRole("button", { name: "Chat" });
const field = () => screen.queryByRole("textbox", { name: "Message" });

describe("PinnablePanel pinned", () => {
  it("renders its bar with the title and a pressed Unpin toggle, and no strip toggle", () => {
    render(<Chat />);
    expect(screen.getByRole("heading", { name: "Chat" })).toBeTruthy();
    const pin = screen.getByRole("button", { name: "Unpin chat" });
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
    expect(field()).toBeTruthy();
  });

  it("Unpin collapses it to a strip, remembered per browser", () => {
    render(<Chat />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin chat" }));
    expect(strip().getAttribute("aria-expanded")).toBe("false");
    expect(field()).toBeNull();
    expect(localStorage.getItem(`${PIN_STORAGE_PREFIX}chat`)).toBe("false");
    cleanup();
    render(<Chat />);
    expect(strip()).toBeTruthy();
  });

  it("unpinning by keyboard moves focus to the strip without opening the peek", () => {
    render(<Chat />);
    const pin = screen.getByRole("button", { name: "Unpin chat" });
    focus(pin);
    fireEvent.click(pin);
    expect(document.activeElement).toBe(strip());
    expect(strip().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps its content mounted across unpin and pin", () => {
    render(<Chat />);
    fireEvent.change(field() as HTMLInputElement, { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Unpin chat" }));
    fireEvent.click(strip());
    fireEvent.click(screen.getByRole("button", { name: "Pin chat" }));
    expect((field() as HTMLInputElement).value).toBe("draft");
  });
});

describe("PinnablePanel unpinned", () => {
  it("the strip is a named toggle; focus alone does not open it", () => {
    render(<Chat defaultPinned={false} />);
    expect(field()).toBeNull();
    focus(strip());
    expect(strip().getAttribute("aria-expanded")).toBe("false");
    expect(strip().getAttribute("aria-controls")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pin chat" })).toBeNull();
  });

  it("a click, tap, Enter or Space on the strip opens it, the bar heading it with Pin; again closes it", () => {
    render(<Chat defaultPinned={false} />);
    fireEvent.click(strip());
    expect(strip().getAttribute("aria-expanded")).toBe("true");
    expect(field()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pin chat" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    fireEvent.click(strip());
    expect(strip().getAttribute("aria-expanded")).toBe("false");
    expect(field()).toBeNull();
  });

  it("stays open while focus moves inside; Escape closes it and returns focus to the bar", () => {
    render(<Chat defaultPinned={false} />);
    fireEvent.click(strip());
    const input = field() as HTMLInputElement;
    focus(input);
    expect(strip().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).toBe(strip());
    expect(strip().getAttribute("aria-expanded")).toBe("false");
    expect(field()).toBeNull();
  });

  it("an Escape the content handled itself does not close it", () => {
    render(<Chat defaultPinned={false} />);
    fireEvent.click(strip());
    const input = field() as HTMLInputElement;
    input.addEventListener("keydown", (e) => e.preventDefault());
    fireEvent.keyDown(input, { key: "Escape" });
    expect(strip().getAttribute("aria-expanded")).toBe("true");
  });

  it("focus leaving it closes it", () => {
    render(<Chat defaultPinned={false} />);
    fireEvent.click(strip());
    focus(field());
    focus(screen.getByRole("button", { name: "Elsewhere" }));
    expect(strip().getAttribute("aria-expanded")).toBe("false");
  });

  it("a press outside closes it", () => {
    render(<Chat defaultPinned={false} />);
    fireEvent.click(strip());
    fireEvent.pointerDown(document.body);
    expect(strip().getAttribute("aria-expanded")).toBe("false");
  });

  it("hovering never opens it", () => {
    vi.useFakeTimers();
    render(<Chat defaultPinned={false} />);
    fireEvent.pointerEnter(strip());
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 2);
    });
    expect(strip().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes about 2 s after the pointer leaves it, not before, and not while it is back", () => {
    vi.useFakeTimers();
    render(<Chat defaultPinned={false} />);
    const root = strip().closest("[data-state]") as HTMLElement;
    fireEvent.pointerEnter(root);
    fireEvent.pointerDown(strip());
    fireEvent.click(strip());
    fireEvent.pointerLeave(root);
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS - 1);
    });
    expect(strip().getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerEnter(root);
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 2);
    });
    expect(strip().getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerLeave(root);
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS);
    });
    expect(strip().getAttribute("aria-expanded")).toBe("false");
  });

  it("the pointer leaving does not close it while focus is inside", () => {
    vi.useFakeTimers();
    render(<Chat defaultPinned={false} />);
    const root = strip().closest("[data-state]") as HTMLElement;
    fireEvent.click(strip());
    focus(field());
    fireEvent.pointerEnter(root);
    fireEvent.pointerLeave(root);
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 2);
    });
    expect(strip().getAttribute("aria-expanded")).toBe("true");
  });

  it("Pin in the open panel pins it, keeping focus on the toggle", () => {
    render(<Chat defaultPinned={false} />);
    fireEvent.click(strip());
    const pin = screen.getByRole("button", { name: "Pin chat" });
    focus(pin);
    fireEvent.click(pin);
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
    const unpin = screen.getByRole("button", { name: "Unpin chat" });
    expect(document.activeElement).toBe(unpin);
    expect(localStorage.getItem(`${PIN_STORAGE_PREFIX}chat`)).toBe("true");
  });
});

describe("PinnablePanel from outside (shortcuts, runs)", () => {
  function Output({ startPinned = true }: { startPinned?: boolean }) {
    const [pinned, setPinned] = useState(startPinned);
    const ref = useRef<PinnablePanelHandle>(null);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setPinned(!pinned);
            if (pinned) ref.current?.peek();
          }}
        >
          Shortcut
        </button>
        <button type="button" onClick={() => ref.current?.peek()}>
          Run
        </button>
        <PinnablePanel
          ref={ref}
          title="Run results"
          edge="bottom"
          region
          pinned={pinned}
          onPinnedChange={setPinned}
        >
          <p>Output</p>
        </PinnablePanel>
      </>
    );
  }
  const region = () => screen.queryByRole("region", { name: "Run results" });

  it("region: the panel is a region named by its title, gone while the peek is closed", () => {
    render(<Output />);
    expect(region()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unpin run results" }));
    expect(region()).toBeNull();
  });

  it("unpinned together with peek() it stays open as a peek; Escape anywhere closes it", () => {
    render(<Output />);
    fireEvent.click(screen.getByRole("button", { name: "Shortcut" }));
    expect(screen.getByRole("button", { name: "Pin run results" })).toBeTruthy();
    expect(region()).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(region()).toBeNull();
  });

  it("peek() on an unpinned panel opens it without pinning", () => {
    render(<Output startPinned={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(region()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run results" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});

describe("usePinned", () => {
  it("uses the default until a choice is stored", () => {
    expect(loadPinned("output", true)).toBe(true);
    expect(loadPinned("sidebar", false)).toBe(false);
    savePinned("sidebar", true);
    expect(loadPinned("sidebar", false)).toBe(true);
  });

  it("keeps the choice for the page when storage fails, and never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPinned("blocked", true)).toBe(true);
    expect(() => savePinned("blocked", false)).not.toThrow();
    expect(loadPinned("blocked", true)).toBe(false);
  });

  it("every hook with the same key agrees at once", () => {
    function Two() {
      const [a, setA] = usePinned("shared", true);
      const [b] = usePinned("shared", true);
      return (
        <button type="button" onClick={() => setA(!a)}>
          {`${a} ${b}`}
        </button>
      );
    }
    render(<Two />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("false false");
  });
});

describe("PinnableColumn", () => {
  function Column({ top = true, bottom = true }: { top?: boolean; bottom?: boolean }) {
    const [topPinned, setTop] = useState(top);
    const [bottomPinned, setBottom] = useState(bottom);
    return (
      <PinnableColumn
        label="Inspector"
        top={{
          title: "Description",
          pinned: topPinned,
          onPinnedChange: setTop,
          children: <p>Problem text</p>,
        }}
        bottom={{
          title: "Chat",
          pinned: bottomPinned,
          onPinnedChange: setBottom,
          children: <p>Messages</p>,
        }}
        split={{ minTop: 120, minBottom: 160, dividerLabel: "Resize description and chat" }}
      />
    );
  }

  it("both pinned: two headers split by the resizable divider", () => {
    render(<Column />);
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize description and chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpin description" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpin chat" })).toBeTruthy();
  });

  it("one unpinned: its strip in the column, no divider, the other still shown", () => {
    render(<Column />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin description" }));
    expect(screen.getByRole("button", { name: "Description" })).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(shown("Problem text")).toBe(false);
    expect(shown("Messages")).toBe(true);
    expect(
      screen.getByRole("complementary", { name: "Inspector" }).getAttribute("data-collapsed"),
    ).toBe("false");
  });

  it("both unpinned: the column narrows to two labelled strips, each peeking", () => {
    render(<Column top={false} bottom={false} />);
    const column = screen.getByRole("complementary", { name: "Inspector" });
    expect(column.getAttribute("data-collapsed")).toBe("true");
    const description = screen.getByRole("button", { name: "Description" });
    expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
    fireEvent.click(description);
    expect(shown("Problem text")).toBe(true);
    expect(shown("Messages")).toBe(false);
  });
});
