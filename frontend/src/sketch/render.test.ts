import { describe, expect, it } from "vitest";
import { drawBoard, type SketchColours } from "./render";
import { ERASER_WIDTH, LINE_WIDTH, PALETTE } from "./sketchTypes";

// Spec 022 task 10: the drawing calls per kind (FR-4–FR-6). Pixels are asserted in E2E
// task 16; jsdom has no 2D context, so this records the calls a real one would receive.

type Call = { name: string; args: unknown[]; state: Record<string, unknown> };

function recorder() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    globalCompositeOperation: "source-over",
    lineCap: "butt",
    lineJoin: "miter",
  };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "canvas") return { width: 1600, height: 1000 };
      return (...args: unknown[]) => calls.push({ name: prop, args, state: { ...target } });
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, state };
}

const colours = Object.fromEntries(PALETTE.map((c) => [c, `#${c}`])) as SketchColours;
const names = (calls: Call[]) => calls.map((c) => c.name);

describe("drawBoard", () => {
  it("clears and scales before drawing", () => {
    const { ctx, calls } = recorder();
    drawBoard(ctx, [], colours, 0.5);
    expect(calls[0]?.name).toBe("setTransform");
    expect(names(calls)).toContain("clearRect");
    expect(calls.filter((c) => c.name === "setTransform").at(-1)?.args).toEqual([
      0.5, 0, 0, 0.5, 0, 0,
    ]);
  });

  it("strokes a pen path as a polyline in its colour", () => {
    const { ctx, calls } = recorder();
    drawBoard(ctx, [{ kind: "pen", color: "blue", points: [0, 0, 10, 10, 20, 0] }], colours, 1);
    expect(names(calls).filter((n) => n === "lineTo")).toHaveLength(2);
    const stroke = calls.find((c) => c.name === "stroke");
    expect(stroke?.state.strokeStyle).toBe("#blue");
    expect(stroke?.state.lineWidth).toBe(LINE_WIDTH);
    expect(stroke?.state.globalCompositeOperation).toBe("source-over");
  });

  it("draws a single-point pen as a dot", () => {
    const { ctx, calls } = recorder();
    drawBoard(ctx, [{ kind: "pen", color: "ink", points: [5, 5] }], colours, 1);
    expect(names(calls)).toContain("arc");
    const fill = calls.find((c) => c.name === "fill");
    expect(fill?.state.fillStyle).toBe("#ink");
  });

  it("strokes a box as a rectangle and an ellipse inside its rectangle", () => {
    const { ctx, calls } = recorder();
    drawBoard(
      ctx,
      [
        { kind: "box", color: "red", points: [10, 20, 110, 70] },
        { kind: "ellipse", color: "green", points: [0, 0, 200, 100] },
      ],
      colours,
      1,
    );
    expect(calls.find((c) => c.name === "strokeRect")?.args).toEqual([10, 20, 100, 50]);
    const ellipse = calls.find((c) => c.name === "ellipse");
    expect(ellipse?.args.slice(0, 4)).toEqual([100, 50, 100, 50]);
  });

  it("erases with destination-out at the eraser width, then restores", () => {
    const { ctx, calls, state } = recorder();
    drawBoard(
      ctx,
      [
        { kind: "erase", points: [0, 0, 50, 50] },
        { kind: "pen", color: "ink", points: [0, 0, 1, 1] },
      ],
      colours,
      1,
    );
    const strokes = calls.filter((c) => c.name === "stroke");
    expect(strokes[0]?.state.globalCompositeOperation).toBe("destination-out");
    expect(strokes[0]?.state.lineWidth).toBe(ERASER_WIDTH);
    expect(strokes[1]?.state.globalCompositeOperation).toBe("source-over");
    expect(state.globalCompositeOperation).toBe("source-over");
  });

  it("a clear wipes what came before it", () => {
    const { ctx, calls } = recorder();
    drawBoard(
      ctx,
      [{ kind: "pen", color: "ink", points: [0, 0, 1, 1] }, { kind: "clear" }],
      colours,
      1,
    );
    expect(names(calls).filter((n) => n === "clearRect")).toHaveLength(2);
  });
});
