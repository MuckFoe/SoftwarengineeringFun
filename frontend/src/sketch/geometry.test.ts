import { describe, expect, it } from "vitest";
import {
  type BoardRect,
  clickShape,
  isClick,
  normaliseRect,
  simplifyPath,
  toBoard,
} from "./geometry";
import { BOARD_H, BOARD_W, MAX_POINTS, STANDARD_SHAPE_H, STANDARD_SHAPE_W } from "./sketchTypes";

// Spec 022 task 2 (FR-3, FR-4, FR-5): pure board geometry.

const rect = (left: number, top: number, width: number) => ({
  left,
  top,
  width,
  height: (width * BOARD_H) / BOARD_W,
});

describe("toBoard (AC-3)", () => {
  it("maps the same relative pointer position to the same board coordinate at two widths", () => {
    const wide = rect(100, 50, 1200); // board on a 1920 px window
    const narrow = rect(10, 80, 640); // board on a 1024 px window
    const fractions: Array<[number, number]> = [
      [0.1, 0.2],
      [0.25, 0.25],
      [0.5, 0.5],
      [0.9, 0.7],
    ];
    for (const [fx, fy] of fractions) {
      const a = toBoard(wide.left + fx * wide.width, wide.top + fy * wide.height, wide);
      const b = toBoard(narrow.left + fx * narrow.width, narrow.top + fy * narrow.height, narrow);
      expect(a).toEqual(b);
      expect(a).toEqual({ x: Math.round(fx * BOARD_W), y: Math.round(fy * BOARD_H) });
    }
  });

  it("keeps a top-left quarter point in the top-left quarter", () => {
    const r = rect(0, 0, 1000);
    const p = toBoard(200, 100, r);
    expect(p.x).toBeLessThan(BOARD_W / 2);
    expect(p.y).toBeLessThan(BOARD_H / 2);
  });

  it("returns integers clamped to the board", () => {
    const r = rect(0, 0, 800);
    expect(toBoard(-50, -50, r)).toEqual({ x: 0, y: 0 });
    expect(toBoard(5000, 5000, r)).toEqual({ x: BOARD_W, y: BOARD_H });
    const p = toBoard(123.456, 77.7, r);
    expect(Number.isInteger(p.x)).toBe(true);
    expect(Number.isInteger(p.y)).toBe(true);
  });
});

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const at = (flat: number[], i: number) => flat[i] ?? Number.NaN;

function distToPath(px: number, py: number, flat: number[]) {
  if (flat.length === 2) return Math.hypot(px - at(flat, 0), py - at(flat, 1));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    best = Math.min(
      best,
      distToSegment(px, py, at(flat, i), at(flat, i + 1), at(flat, i + 2), at(flat, i + 3)),
    );
  }
  return best;
}

describe("simplifyPath (AC-4)", () => {
  // A dense quarter-ish curve: 2,000 samples, steps well under 2 units.
  const curve: number[] = [];
  for (let i = 0; i <= 2000; i++) {
    const t = i / 2000;
    curve.push(Math.round(200 + 600 * t), Math.round(500 - 300 * Math.sin(Math.PI * t)));
  }

  it("keeps the first and last points", () => {
    const out = simplifyPath(curve);
    expect(out.slice(0, 2)).toEqual(curve.slice(0, 2));
    expect(out.slice(-2)).toEqual(curve.slice(-2));
  });

  it("drops points within 2 units of the last kept one and stays within 2 units of the path", () => {
    const out = simplifyPath(curve);
    expect(out.length).toBeLessThan(curve.length);
    for (let i = 0; i + 3 < out.length - 2; i += 2) {
      expect(
        Math.hypot(at(out, i + 2) - at(out, i), at(out, i + 3) - at(out, i + 1)),
      ).toBeGreaterThan(2);
    }
    for (let i = 0; i < curve.length; i += 2) {
      expect(distToPath(at(curve, i), at(curve, i + 1), out)).toBeLessThanOrEqual(2);
    }
  });

  it("never exceeds the point limit", () => {
    const long: number[] = [];
    for (let i = 0; i < 5000; i++) long.push((i * 7) % BOARD_W, (i * 13) % BOARD_H);
    const out = simplifyPath(long);
    expect(out.length / 2).toBeLessThanOrEqual(MAX_POINTS);
    expect(out.slice(0, 2)).toEqual(long.slice(0, 2));
    expect(out.slice(-2)).toEqual(long.slice(-2));
  });

  it("keeps a single point (a dot)", () => {
    expect(simplifyPath([10, 20])).toEqual([10, 20]);
  });
});

describe("isClick", () => {
  it("is a click when the pointer barely moved, a drag otherwise", () => {
    expect(isClick({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true);
    expect(isClick({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(true);
    expect(isClick({ x: 100, y: 100 }, { x: 160, y: 140 })).toBe(false);
  });
});

describe("normaliseRect and clickShape (AC-5)", () => {
  const P = { x: 300, y: 700 };
  const Q = { x: 900, y: 200 };

  it("normalising (Q, P) equals normalising (P, Q)", () => {
    const a: BoardRect = normaliseRect(P, Q);
    expect(normaliseRect(Q, P)).toEqual(a);
    expect(a).toEqual([300, 200, 900, 700]);
  });

  it("a click gives the standard-size rectangle centred on it", () => {
    const c = { x: 800, y: 500 };
    const [x0, y0, x1, y1] = clickShape(c);
    expect(x1 - x0).toBe(STANDARD_SHAPE_W);
    expect(y1 - y0).toBe(STANDARD_SHAPE_H);
    expect((x0 + x1) / 2).toBe(c.x);
    expect((y0 + y1) / 2).toBe(c.y);
  });

  it("a click near an edge stays inside the board at full standard size", () => {
    for (const c of [
      { x: 0, y: 0 },
      { x: 5, y: BOARD_H - 3 },
      { x: BOARD_W, y: BOARD_H },
      { x: BOARD_W - 10, y: 4 },
    ]) {
      const [x0, y0, x1, y1] = clickShape(c);
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(y0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(BOARD_W);
      expect(y1).toBeLessThanOrEqual(BOARD_H);
      expect(x1 - x0).toBe(STANDARD_SHAPE_W);
      expect(y1 - y0).toBe(STANDARD_SHAPE_H);
    }
  });
});
