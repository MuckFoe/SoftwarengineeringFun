import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SketchBoard, SketchCanvas, type SketchTool } from "./SketchBoard";
import type { ActionBody, PendingAction, SketchAction, SketchColor } from "./sketchTypes";

// Spec 022 task 10: FR-3–FR-7 / AC-3 (same relative positions), AC-4–AC-6 (pointer side;
// pixels are asserted in E2E task 16, jsdom has no canvas pixels).

type Resize = (entries: Array<{ contentRect: { width: number } }>) => void;
let resizeCallbacks: Resize[] = [];

class FakeResizeObserver {
  constructor(cb: Resize) {
    resizeCallbacks.push(cb);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  resizeCallbacks = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // jsdom has no 2D context; the component must cope with none.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function resizeTo(width: number) {
  act(() => {
    for (const cb of resizeCallbacks) cb([{ contentRect: { width } }]);
  });
}

function setup(
  tool: SketchTool,
  {
    readOnly = false,
    color = "red" as SketchColor,
    visible = [] as Array<SketchAction | PendingAction>,
  } = {},
) {
  const add = vi.fn<(a: Exclude<ActionBody, { kind: "clear" }>) => void>();
  render(
    <SketchCanvas visible={visible} add={add} tool={tool} color={color} readOnly={readOnly} />,
  );
  const canvas = screen.getByRole("img", { name: /^Sketch board/ }) as HTMLCanvasElement;
  // An 800×500 px board at the page origin: 1 px = 2 board units.
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 500,
    right: 800,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return { add, canvas };
}

const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0 });

describe("SketchBoard pointer drawing", () => {
  it("a pen drag calls add once on pointer-up with a pen action in board coordinates", () => {
    const { add, canvas } = setup("pen", { color: "blue" });
    fireEvent.pointerDown(canvas, at(10, 10));
    fireEvent.pointerMove(canvas, at(50, 20));
    fireEvent.pointerMove(canvas, at(100, 50));
    expect(add).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, at(100, 50));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({
      kind: "pen",
      color: "blue",
      points: [20, 20, 100, 40, 200, 100],
    });
  });

  it("an eraser drag calls add with an erase action and no colour", () => {
    const { add, canvas } = setup("erase");
    fireEvent.pointerDown(canvas, at(10, 10));
    fireEvent.pointerMove(canvas, at(100, 10));
    fireEvent.pointerUp(canvas, at(100, 10));
    expect(add).toHaveBeenCalledWith({ kind: "erase", points: [20, 20, 200, 20] });
  });

  it("a click with the box tool adds a standard-size box centred on the click", () => {
    const { add, canvas } = setup("box");
    fireEvent.pointerDown(canvas, at(400, 250));
    fireEvent.pointerUp(canvas, at(401, 250));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({
      kind: "box",
      color: "red",
      points: [720, 450, 880, 550],
    });
  });

  it("an ellipse drag adds the dragged rectangle, normalised", () => {
    const { add, canvas } = setup("ellipse", { color: "green" });
    fireEvent.pointerDown(canvas, at(300, 200));
    fireEvent.pointerMove(canvas, at(200, 150));
    fireEvent.pointerMove(canvas, at(100, 100));
    fireEvent.pointerUp(canvas, at(100, 100));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({
      kind: "ellipse",
      color: "green",
      points: [200, 200, 600, 400],
    });
  });

  it("a cancelled pointer adds nothing", () => {
    const { add, canvas } = setup("pen");
    fireEvent.pointerDown(canvas, at(10, 10));
    fireEvent.pointerMove(canvas, at(100, 50));
    fireEvent.pointerCancel(canvas, at(100, 50));
    fireEvent.pointerUp(canvas, at(100, 50));
    expect(add).not.toHaveBeenCalled();
  });

  it("readOnly never calls add", () => {
    for (const tool of ["pen", "box", "ellipse", "erase"] as const) {
      const { add, canvas } = setup(tool, { readOnly: true });
      fireEvent.pointerDown(canvas, at(10, 10));
      fireEvent.pointerMove(canvas, at(100, 50));
      fireEvent.pointerUp(canvas, at(100, 50));
      fireEvent.pointerDown(canvas, at(200, 200));
      fireEvent.pointerUp(canvas, at(200, 200));
      expect(add).not.toHaveBeenCalled();
      cleanup();
    }
  });
});

describe("SketchBoard shape and identity (AC-3)", () => {
  const confirmed: SketchAction[] = [
    { seq: 3, client_id: "a", kind: "pen", color: "ink", points: [1, 1] },
    { seq: 7, client_id: "b", kind: "box", color: "red", points: [0, 0, 10, 10] },
  ];

  it("is a focusable image labelled Sketch board with a hash of the visible seqs", () => {
    const { canvas } = setup("pen", { visible: confirmed });
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas.getAttribute("aria-label")).toBe("Sketch board");
    expect(canvas.tabIndex).toBe(0);
    const hash = canvas.getAttribute("data-sketch-hash");
    expect(hash).toBeTruthy();
    cleanup();
    // The same seqs give the same hash; different seqs a different one.
    const again = setup("pen", { visible: confirmed }).canvas.getAttribute("data-sketch-hash");
    expect(again).toBe(hash);
    cleanup();
    const other = setup("pen", { visible: [confirmed[0] as SketchAction] }).canvas;
    expect(other.getAttribute("data-sketch-hash")).not.toBe(hash);
  });

  it("pending actions do not change the hash", () => {
    const pending: PendingAction = { client_id: "p", kind: "pen", color: "ink", points: [5, 5] };
    const a = setup("pen", { visible: confirmed }).canvas.getAttribute("data-sketch-hash");
    cleanup();
    const b = setup("pen", { visible: [...confirmed, pending] }).canvas.getAttribute(
      "data-sketch-hash",
    );
    expect(b).toBe(a);
  });

  it("keeps 16:10 at two container widths, backing store scaled by devicePixelRatio", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { canvas } = setup("pen");
    resizeTo(800);
    expect(canvas.style.width).toBe("800px");
    expect(canvas.style.height).toBe("500px");
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1000);
    resizeTo(390);
    expect(canvas.style.width).toBe("390px");
    expect(canvas.style.height).toBe("243.75px");
    expect(canvas.width).toBe(780);
    expect(canvas.height).toBe(488);
  });
});

// Spec 022 task 13: toolbar, Undo, Clear, full message, live region (FR-7, FR-8, FR-12,
// FR-13, FR-15, FR-16, FR-18, NFR-6, NFR-7; AC-7, AC-8, AC-12, AC-13, AC-15, AC-16, AC-18, AC-23).

const COLOURS = ["Ink", "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink"];
const TOOLS = ["Pen", "Box", "Circle", "Eraser"];

function board({
  canUndo = false,
  full = false,
  readOnly = false,
  othersChanged = 0,
  visible = [] as Array<SketchAction | PendingAction>,
} = {}) {
  const sketch = {
    visible,
    full,
    canUndo,
    add: vi.fn<(a: Exclude<ActionBody, { kind: "clear" }>) => void>(),
    clear: vi.fn<() => void>(),
    undo: vi.fn<() => void>(),
  };
  const props = { ...sketch, readOnly, othersChanged };
  const view = render(<SketchBoard {...props} />);
  const rerender = (next: Partial<typeof props>) =>
    view.rerender(<SketchBoard {...props} {...next} />);
  const canvas = screen.getByRole("img", { name: /^Sketch board/ }) as HTMLCanvasElement;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 500,
    right: 800,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return { ...sketch, canvas, rerender };
}

const nothingSent = (s: ReturnType<typeof board>) => {
  expect(s.add).not.toHaveBeenCalled();
  expect(s.clear).not.toHaveBeenCalled();
  expect(s.undo).not.toHaveBeenCalled();
};

describe("SketchBoard toolbar (AC-7, AC-8, AC-23)", () => {
  it("offers 8 colour swatches, each named by its colour", () => {
    board();
    const toolbar = screen.getByRole("toolbar", { name: "Sketch tools" });
    for (const name of COLOURS) {
      expect(
        within(toolbar).getByRole("button", { name: new RegExp(`^${name}(, selected)?$`) }),
      ).toBeTruthy();
    }
  });

  it("defaults to Pen and Ink, selected with aria-pressed and named with their state", () => {
    board();
    const pen = screen.getByRole("button", { name: "Pen, selected" });
    expect(pen.getAttribute("aria-pressed")).toBe("true");
    const ink = screen.getByRole("button", { name: "Ink, selected" });
    expect(ink.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Eraser" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "Red" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("selecting Eraser and Red marks them selected, sends nothing, and the next stroke erases", () => {
    const s = board();
    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    const eraser = screen.getByRole("button", { name: "Eraser, selected" });
    expect(eraser.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Red, selected" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Pen" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Ink" }).getAttribute("aria-pressed")).toBe("false");
    nothingSent(s);
    fireEvent.pointerDown(s.canvas, at(10, 10));
    fireEvent.pointerUp(s.canvas, at(100, 10));
    expect(s.add).toHaveBeenCalledWith({ kind: "erase", points: [20, 20, 200, 20] });
  });

  it("the chosen tool and colour are what the next shape uses", () => {
    const s = board();
    fireEvent.click(screen.getByRole("button", { name: "Circle" }));
    fireEvent.click(screen.getByRole("button", { name: "Green" }));
    fireEvent.pointerDown(s.canvas, at(400, 250));
    fireEvent.pointerUp(s.canvas, at(400, 250));
    expect(s.add).toHaveBeenCalledWith({
      kind: "ellipse",
      color: "green",
      points: [720, 450, 880, 550],
    });
  });

  it("orders tools, then swatches, then Undo, then Clear, all reachable by keyboard", () => {
    board({ canUndo: true });
    const toolbar = screen.getByRole("toolbar", { name: "Sketch tools" });
    const names = within(toolbar)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual([
      "Pen, selected",
      ...TOOLS.slice(1),
      "Ink, selected",
      ...COLOURS.slice(1),
      "Undo",
      "Clear",
    ]);
    // One tab stop (the toolbar pattern); arrow keys walk the items in that order.
    const first = within(toolbar).getByRole("button", { name: "Pen, selected" });
    expect(first.tabIndex).toBe(0);
    first.focus();
    const visited = [document.activeElement?.getAttribute("aria-label")];
    for (let i = 0; i < names.length - 1; i++) {
      fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
      const el = document.activeElement as HTMLElement;
      visited.push(el.getAttribute("aria-label") ?? el.textContent);
    }
    expect(visited).toEqual(names);
  });
});

describe("SketchBoard Undo (AC-13, AC-15)", () => {
  it("is disabled with an accessible reason when there is nothing of yours to undo", () => {
    board({ canUndo: false });
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    const id = undo.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)?.textContent).toBe(
      "Nothing of yours to undo in this visit.",
    );
  });

  it("is enabled when canUndo and calls undo when pressed", () => {
    const s = board({ canUndo: true });
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    expect(undo.getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(undo);
    expect(s.undo).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Z and Cmd+Z on the focused board call undo and prevent the default", () => {
    const s = board({ canUndo: true });
    s.canvas.focus();
    const ctrl = fireEvent.keyDown(s.canvas, { key: "z", ctrlKey: true });
    expect(ctrl).toBe(false); // default prevented
    expect(s.undo).toHaveBeenCalledTimes(1);
    const meta = fireEvent.keyDown(screen.getByRole("button", { name: "Pen, selected" }), {
      key: "z",
      metaKey: true,
    });
    expect(meta).toBe(false);
    expect(s.undo).toHaveBeenCalledTimes(2);
  });

  it("Ctrl/Cmd+Z outside the board does not undo", () => {
    const s = board({ canUndo: true });
    const outside = document.createElement("textarea");
    document.body.append(outside);
    outside.focus();
    const result = fireEvent.keyDown(outside, { key: "z", ctrlKey: true });
    fireEvent.keyDown(outside, { key: "z", metaKey: true });
    expect(result).toBe(true);
    expect(s.undo).not.toHaveBeenCalled();
    outside.remove();
  });
});

describe("SketchBoard Clear (AC-12)", () => {
  it("opens a confirm dialog with Cancel focused; cancelling sends nothing", () => {
    const s = board();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    const dialog = screen.getByRole("dialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    expect(within(dialog).getByRole("button", { name: "Clear for everyone" })).toBeTruthy();
    fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).toBeNull();
    nothingSent(s);
  });

  it("confirming calls clear once and closes the dialog", () => {
    const s = board();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear for everyone" }));
    expect(s.clear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(s.add).not.toHaveBeenCalled();
    expect(s.undo).not.toHaveBeenCalled();
  });
});

describe("SketchBoard full message (AC-18)", () => {
  const MESSAGE = "The sketch is full. Clear the board or undo something to make room.";

  it("shows the message only when full", () => {
    const s = board({ full: false });
    expect(screen.queryByText(MESSAGE)).toBeNull();
    s.rerender({ full: true });
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });
});

describe("SketchBoard read-only (AC-16)", () => {
  it("has no toolbar, tools, swatches, Undo or Clear, and is named read-only", () => {
    const s = board({ readOnly: true, canUndo: true, full: true });
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(s.canvas.getAttribute("aria-label")).toBe("Sketch board (read-only)");
    s.canvas.focus();
    fireEvent.keyDown(s.canvas, { key: "z", ctrlKey: true });
    fireEvent.pointerDown(s.canvas, at(10, 10));
    fireEvent.pointerUp(s.canvas, at(100, 10));
    nothingSent(s);
  });
});

describe("SketchBoard live region (NFR-7, AC-23)", () => {
  const SAID = "Someone changed the sketch.";
  const region = () => screen.getByTestId("sketch-live");

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is polite and starts silent; own drawing is never announced", () => {
    const s = board();
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(region().textContent?.trim()).toBe("");
    fireEvent.pointerDown(s.canvas, at(10, 10));
    fireEvent.pointerUp(s.canvas, at(100, 10));
    s.rerender({
      visible: [{ seq: 1, client_id: "me", kind: "pen", color: "ink", points: [20, 20] }],
    });
    expect(region().textContent?.trim()).toBe("");
  });

  it("announces another participant's change, at most once per 5 s", () => {
    const s = board();
    s.rerender({ othersChanged: 1 });
    expect(region().textContent?.trim()).toBe(SAID);
    const firstText = region().textContent;
    // Further changes inside the window: no new announcement yet.
    act(() => vi.advanceTimersByTime(1000));
    s.rerender({ othersChanged: 2 });
    act(() => vi.advanceTimersByTime(1000));
    s.rerender({ othersChanged: 3 });
    expect(region().textContent).toBe(firstText);
    act(() => vi.advanceTimersByTime(2900));
    expect(region().textContent).toBe(firstText);
    // The window ends: the changes made during it are announced once.
    act(() => vi.advanceTimersByTime(200));
    expect(region().textContent?.trim()).toBe(SAID);
    expect(region().textContent).not.toBe(firstText);
    const secondText = region().textContent;
    act(() => vi.advanceTimersByTime(10_000));
    expect(region().textContent).toBe(secondText);
  });
});
