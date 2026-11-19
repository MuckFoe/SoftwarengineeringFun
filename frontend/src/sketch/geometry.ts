// Pure board geometry (spec 022 plan, Board shape): pointer → board coordinates, path
// simplification, click-vs-drag, standard shape on a click, rectangle normalising.

import { BOARD_H, BOARD_W, MAX_POINTS, STANDARD_SHAPE_H, STANDARD_SHAPE_W } from "./sketchTypes";

export type BoardPoint = { x: number; y: number };
/** [x0, y0, x1, y1] with x0 ≤ x1 and y0 ≤ y1: the two corners a box or ellipse is sent with. */
export type BoardRect = [number, number, number, number];
export type ElementRect = { left: number; top: number; width: number; height: number };

/** Points closer than this to the last kept one are dropped from a pen or eraser path. */
export const SIMPLIFY_UNITS = 2;
/** A press and release no further apart than this (board units) is a click, not a drag. */
export const CLICK_UNITS = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Client pixel position inside the board element's rect → integer board coordinates. */
export function toBoard(clientX: number, clientY: number, rect: ElementRect): BoardPoint {
  const x = rect.width > 0 ? ((clientX - rect.left) / rect.width) * BOARD_W : 0;
  const y = rect.height > 0 ? ((clientY - rect.top) / rect.height) * BOARD_H : 0;
  return { x: clamp(Math.round(x), 0, BOARD_W), y: clamp(Math.round(y), 0, BOARD_H) };
}

/** The i-th point of a flat [x0, y0, x1, y1, ...] array. */
const pointAt = (flat: number[], i: number): BoardPoint => ({
  x: flat[2 * i] ?? 0,
  y: flat[2 * i + 1] ?? 0,
});

const dist = (a: BoardPoint, b: BoardPoint) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Drops points within SIMPLIFY_UNITS of the last kept one, always keeping the first and
 * last, and never returns more than MAX_POINTS points (evenly thinning if it must).
 */
export function simplifyPath(flat: number[]): number[] {
  const n = Math.floor(flat.length / 2);
  if (n <= 1) return flat.slice(0, 2);
  const kept = [pointAt(flat, 0)];
  const lastKept = () => kept[kept.length - 1] ?? pointAt(flat, 0);
  for (let i = 1; i < n - 1; i++) {
    const p = pointAt(flat, i);
    if (dist(lastKept(), p) > SIMPLIFY_UNITS) kept.push(p);
  }
  const last = pointAt(flat, n - 1);
  // The last point always stays; a kept neighbour within range of it is replaced by it.
  if (kept.length > 1 && dist(lastKept(), last) <= SIMPLIFY_UNITS) kept.pop();
  kept.push(last);
  return thin(kept).flatMap((p) => [p.x, p.y]);
}

function thin(points: BoardPoint[]): BoardPoint[] {
  if (points.length <= MAX_POINTS) return points;
  const out: BoardPoint[] = [];
  for (let k = 0; k < MAX_POINTS; k++) {
    const p = points[Math.round((k * (points.length - 1)) / (MAX_POINTS - 1))];
    if (p) out.push(p);
  }
  return out;
}

/** True when a press at `a` and release at `b` count as a click rather than a drag. */
export function isClick(a: BoardPoint, b: BoardPoint): boolean {
  return dist(a, b) <= CLICK_UNITS;
}

/** The rectangle spanned by two opposite corners, in either order. */
export function normaliseRect(a: BoardPoint, b: BoardPoint): BoardRect {
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

/** A standard-size shape centred on a click, shifted to stay inside the board. */
export function clickShape(c: BoardPoint): BoardRect {
  const x0 = clamp(c.x - STANDARD_SHAPE_W / 2, 0, BOARD_W - STANDARD_SHAPE_W);
  const y0 = clamp(c.y - STANDARD_SHAPE_H / 2, 0, BOARD_H - STANDARD_SHAPE_H);
  return [x0, y0, x0 + STANDARD_SHAPE_W, y0 + STANDARD_SHAPE_H];
}
