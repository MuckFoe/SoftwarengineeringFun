// Rock Paper Siege figures as data (spec 021 FR-27, plan.md "Figures and playing field"): one
// chunky soldier on a 0 0 48 48 grid, standing on y=45, with a weapon layer per kind. Drawn for
// this repo. Colours come from PieceFigure's CSS classes per `role`, never from here.
import type { Kind, Side } from "../rpsTypes";

/** `fill`: side fill, edged; `edge`: stroke only; `detail`: filled with the edge colour. */
export type Part = { d: string; role: "fill" | "edge" | "detail" };

const n = (v: number) => String(Math.round(v * 100) / 100);

/** A circle as a path (the figure is paths only). */
const circle = (cx: number, cy: number, r: number) =>
  `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;

/** A rounded rectangle as a path. */
const box = (x: number, y: number, w: number, h: number, r: number) =>
  `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}` +
  `V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}` +
  `H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}` +
  `V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`;

/** A limb or pole: a stadium of radius `r` from one point to another. */
const capsule = (x1: number, y1: number, x2: number, y2: number, r: number) => {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / len) * r;
  const ny = ((x2 - x1) / len) * r;
  return (
    `M${n(x1 + nx)} ${n(y1 + ny)}L${n(x2 + nx)} ${n(y2 + ny)}` +
    `A${n(r)} ${n(r)} 0 0 0 ${n(x2 - nx)} ${n(y2 - ny)}` +
    `L${n(x1 - nx)} ${n(y1 - ny)}A${n(r)} ${n(r)} 0 0 0 ${n(x1 + nx)} ${n(y1 + ny)}Z`
  );
};

/** The silhouette every soldier shares, so the outline never tells the kind. */
export const BODY: Part[] = [
  { role: "fill", d: box(13.5, 35, 9, 10, 3.5) }, // left leg
  { role: "fill", d: box(25.5, 35, 9, 10, 3.5) }, // right leg
  { role: "fill", d: box(9.5, 24.5, 29, 15, 7) }, // body
  { role: "fill", d: circle(24, 17.5, 10.5) }, // head
  { role: "fill", d: "M10.5 15C10.5 6 16.5 2 24 2S37.5 6 37.5 15Z" }, // helmet dome
  { role: "edge", d: "M8.5 15.5H39.5" }, // helmet rim
  { role: "detail", d: circle(19.5, 20, 2.25) }, // eyes
  { role: "detail", d: circle(28.5, 20, 2.25) },
];

/** Arms tucked behind the back: drawn first, so the body covers most of them. */
export const HIDDEN_ARMS: Part[] = [
  { role: "fill", d: capsule(11, 28, 7.5, 35, 3.5) },
  { role: "fill", d: capsule(37, 28, 40.5, 35, 3.5) },
];

/** Arms held forward for rock, paper and scissors; the weapon covers their inner ends. */
export const HOLD_ARMS: Part[] = [
  { role: "fill", d: capsule(11.5, 28, 14, 33.5, 3.75) },
  { role: "fill", d: capsule(36.5, 28, 34, 33.5, 3.75) },
];

/** Helmet emblems: the only per-side geometry (NFR-5). */
export const EMBLEM: Record<Side, Part[]> = {
  a: [{ role: "detail", d: circle(24, 8.5, 3) }],
  b: [{ role: "detail", d: box(17.5, 7, 13, 3.5, 1.5) }],
};

/** The trap has no helmet, so it carries the side's mark on its plate. */
export const PLATE_EMBLEM: Record<Side, Part[]> = {
  a: [{ role: "detail", d: circle(24, 42, 1.75) }],
  b: [{ role: "detail", d: box(19.5, 41, 9, 2.25, 1) }],
};

const ROCK: Part[] = [
  {
    role: "fill",
    d: "M14.5 32.5C12.5 27.5 17 23.5 21.5 25C24.5 22.5 31 23 32.5 27C36.5 28.5 36.5 35.5 32 37.5C29.5 40.5 21 40.5 18.5 38.5C14.5 38.5 12.5 35.5 14.5 32.5Z",
  },
  { role: "edge", d: "M27 24L25.5 28.5L28.5 30.5" }, // a crack from the top edge
  { role: "detail", d: circle(20, 33.5, 1.75) }, // speckles
  { role: "detail", d: circle(29, 35.5, 1.25) },
];

const PAPER: Part[] = [
  { role: "fill", d: "M15 23.5H27.5L33 29V41H15Z" },
  { role: "edge", d: "M27.5 23.5V29H33" },
  { role: "detail", d: box(18, 31, 11, 2.5, 1.25) },
  { role: "detail", d: box(18, 35.5, 8, 2.5, 1.25) },
];

/** A scissor arm: a kite from its handle through the pivot (widest there) to its tip. */
const blade = (hx: number, hy: number, tx: number, ty: number, w: number) => {
  const len = Math.hypot(tx - hx, ty - hy);
  const [vx, vy] = [(-(ty - hy) / len) * w, ((tx - hx) / len) * w];
  const [px, py] = [hx + (tx - hx) * 0.38, hy + (ty - hy) * 0.38];
  return `M${n(hx)} ${n(hy)}L${n(px + vx)} ${n(py + vy)}L${n(tx)} ${n(ty)}L${n(px - vx)} ${n(py - vy)}Z`;
};

const SCISSORS: Part[] = [
  // two crossed arms, each from a round handle below to an open blade tip above
  { role: "fill", d: blade(30, 38.5, 12, 18, 4.5) },
  { role: "fill", d: blade(18, 38.5, 36, 18, 4.5) },
  { role: "fill", d: circle(17.5, 38.5, 4.25) },
  { role: "fill", d: circle(30.5, 38.5, 4.25) },
  { role: "detail", d: circle(17.5, 38.5, 1.5) },
  { role: "detail", d: circle(30.5, 38.5, 1.5) },
  { role: "detail", d: circle(24, 30.5, 1.5) },
];

/**
 * The flag bearer is the common soldier drawn at 72 % beside a tall pole, so the flag itself can
 * be big enough to read at board size (look fix 2026-11-19). The flag is never shown to the
 * opponent (FR-21), so its silhouette may differ from the others.
 */
export const FLAG_BEARER = "translate(4.5 12.6) scale(0.72)";

/** The bearer's arms, in the soldier's own (untransformed) coordinates. */
export const FLAG_ARMS: Part[] = [
  { role: "fill", d: capsule(11, 28, 9, 35.5, 3.5) }, // free arm at the side
  { role: "fill", d: capsule(36.5, 28, 47, 30, 3.75) }, // arm gripping the pole
];

/** Pole and cloth, in figure coordinates: the cloth flies left over the bearer's helmet. */
export const FLAG_POLE: Part[] = [
  { role: "fill", d: capsule(40.5, 1.75, 40.5, 46, 1.75) }, // pole
  { role: "fill", d: "M39 2H17L21.5 7.25L17 12.5H39Z" }, // cloth with a swallowtail
  { role: "detail", d: circle(29.5, 7.25, 2.25) }, // a roundel on the cloth
];

const FLAG: Part[] = [...FLAG_ARMS, ...FLAG_POLE];

const TRAP: Part[] = [
  { role: "fill", d: box(4, 38.5, 40, 6.5, 2.5) }, // pressure plate
  // lower jaw: a bowl with teeth pointing up
  {
    role: "fill",
    d: "M6 30C6 40 42 40 42 30L37.5 24L33 30L28.5 24L24 30L19.5 24L15 30L10.5 24L6 30Z",
  },
  // upper jaw: a dome with teeth pointing down, set between the lower ones
  {
    role: "fill",
    d: "M6 21C6 6 42 6 42 21L38.4 27L34.8 21L31.2 27L27.6 21L24 27L20.4 21L16.8 27L13.2 21L9.6 27L6 21Z",
  },
  { role: "detail", d: circle(6, 25.5, 2.75) }, // hinges
  { role: "detail", d: circle(42, 25.5, 2.75) },
];

export const KIND_PARTS: Record<Kind, Part[]> = {
  rock: ROCK,
  paper: PAPER,
  scissors: SCISSORS,
  flag: FLAG,
  trap: TRAP,
};
