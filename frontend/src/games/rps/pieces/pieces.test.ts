import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Kind, Side } from "../rpsTypes";
import {
  BODY,
  EMBLEM,
  FLAG_BEARER,
  FLAG_POLE,
  HIDDEN_ARMS,
  HOLD_ARMS,
  KIND_PARTS,
  type Part,
  PLATE_EMBLEM,
} from "./figureParts";
import { PieceFigure } from "./PieceFigure";

// Spec 021 task 36: AC-28 (FR-27, FR-21), NFR-5, FR-3 / NFR-6. Every piece is a layered figure
// drawn from the part table in figureParts.ts (plan.md "Figures and playing field").

const css = readFileSync(
  join(process.cwd(), "src/games/rps/pieces/PieceFigure.module.css"),
  "utf8",
);
const KINDS: Kind[] = ["rock", "paper", "scissors", "flag", "trap"];
const SIDES: Side[] = ["a", "b"];

const draw = (props: { kind: Kind | null; side: Side; title?: string; weaponOnly?: boolean }) =>
  renderToStaticMarkup(createElement(PieceFigure, props));
const dsOf = (markup: string) => [...markup.matchAll(/ d="([^"]+)"/g)].map((m) => m[1] ?? "");
const has = (markup: string, parts: Part[]) => parts.every((p) => dsOf(markup).includes(p.d));
const hasAny = (markup: string, parts: Part[]) => parts.some((p) => dsOf(markup).includes(p.d));

const ALL_PARTS: Part[] = [
  ...BODY,
  ...HIDDEN_ARMS,
  ...HOLD_ARMS,
  ...Object.values(KIND_PARTS).flat(),
  ...Object.values(EMBLEM).flat(),
  ...Object.values(PLATE_EMBLEM).flat(),
];

describe("figure parts (FR-27)", () => {
  it("every part has a role and a non-empty path", () => {
    for (const p of ALL_PARTS) {
      expect(["fill", "edge", "detail"]).toContain(p.role);
      expect(p.d.trim()).not.toBe("");
    }
  });

  it("no kind shares a path with another kind or with the body", () => {
    for (const k of KINDS) {
      expect(KIND_PARTS[k].length, k).toBeGreaterThan(0);
      for (const other of KINDS.filter((o) => o !== k)) {
        expect(KIND_PARTS[k].some((p) => KIND_PARTS[other].some((q) => q.d === p.d))).toBe(false);
      }
      expect(KIND_PARTS[k].some((p) => BODY.some((q) => q.d === p.d))).toBe(false);
    }
  });
});

describe("PieceFigure (AC-28)", () => {
  for (const side of SIDES) {
    for (const k of KINDS) {
      it(`${k} on side ${side} renders its own parts and no other kind's`, () => {
        const m = draw({ kind: k, side });
        expect(has(m, KIND_PARTS[k])).toBe(true);
        for (const other of KINDS.filter((o) => o !== k)) {
          expect(hasAny(m, KIND_PARTS[other]), `${k} draws ${other}`).toBe(false);
        }
        expect(hasAny(m, HIDDEN_ARMS)).toBe(false);
      });

      it(`${k} weaponOnly on side ${side} renders only that kind's parts`, () => {
        const m = draw({ kind: k, side, weaponOnly: true });
        expect([...new Set(dsOf(m))].sort()).toEqual(KIND_PARTS[k].map((p) => p.d).sort());
      });
    }
  }

  it("soldiers stand on the shared body; the trap has no soldier", () => {
    for (const k of ["rock", "paper", "scissors", "flag"] as Kind[]) {
      expect(has(draw({ kind: k, side: "a" }), BODY), k).toBe(true);
    }
    expect(hasAny(draw({ kind: "trap", side: "a" }), BODY)).toBe(false);
  });

  it("renders the svg contract: viewBox, data-side, aria-hidden unless titled", () => {
    const m = draw({ kind: "rock", side: "b" });
    expect(m).toMatch(/^<svg [^>]*viewBox="0 -1.5 48 50"/);
    expect(m).toMatch(/data-side="b"/);
    expect(m).toMatch(/aria-hidden="true"/);
    expect(m).not.toMatch(/<title>/);
    const t = draw({ kind: "rock", side: "a", title: "Your rock" });
    expect(t).toMatch(/aria-hidden="false"/);
    expect(t).toMatch(/<title>Your rock<\/title>/);
  });
});

describe("hidden figures (AC-28 / FR-21)", () => {
  for (const side of SIDES) {
    it(`side ${side}: identical markup, arms behind the back, no weapon`, () => {
      const one = draw({ kind: null, side });
      expect(draw({ kind: null, side })).toBe(one);
      expect(has(one, BODY)).toBe(true);
      expect(has(one, HIDDEN_ARMS)).toBe(true);
      expect(hasAny(one, HOLD_ARMS)).toBe(false);
      for (const k of KINDS) expect(hasAny(one, KIND_PARTS[k]), k).toBe(false);
    });
  }
});

describe("side marks (NFR-5)", () => {
  for (const [name, mark] of [
    ["helmet", EMBLEM],
    ["plate", PLATE_EMBLEM],
  ] as const) {
    it(`side a and b ${name} emblems are different detail paths`, () => {
      const a = mark.a.map((p) => p.d);
      expect(a.length).toBeGreaterThan(0);
      expect(mark.b.some((p) => a.includes(p.d))).toBe(false);
      for (const p of [...mark.a, ...mark.b]) expect(p.role).toBe("detail");
    });
  }

  for (const kind of [null, "rock", "paper", "scissors", "flag", "trap"] as (Kind | null)[]) {
    it(`${kind ?? "hidden"} figures differ by emblem path, not only by class`, () => {
      const mark = kind === "trap" ? PLATE_EMBLEM : EMBLEM;
      const a = draw({ kind, side: "a" });
      const b = draw({ kind, side: "b" });
      expect(has(a, mark.a) && !hasAny(a, mark.b)).toBe(true);
      expect(has(b, mark.b) && !hasAny(b, mark.a)).toBe(true);
      expect(dsOf(a).sort()).not.toEqual(dsOf(b).sort());
    });
  }
});

describe("own artwork (FR-3 / NFR-6)", () => {
  const known = new Set(ALL_PARTS.map((p) => p.d));
  const outputs = [null, ...KINDS].flatMap((kind) =>
    SIDES.flatMap((side) => [
      draw({ kind, side }),
      ...(kind ? [draw({ kind, side, weaponOnly: true })] : []),
    ]),
  );
  const colour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black|red|green|blue)\b/;

  it("every path comes from figureParts and nothing else is drawn", () => {
    for (const m of outputs) {
      for (const d of dsOf(m)) expect(known.has(d), d).toBe(true);
      expect(m).not.toMatch(/<(image|use|foreignObject|script|circle|rect|ellipse|text)\b/);
      expect(m).not.toMatch(/href=|url\(|data:/);
      expect(m).not.toMatch(colour);
      expect(m).not.toMatch(/\b(fill|stroke)="/);
    }
  });

  it("the CSS module paints only from --rps-side-* tokens", () => {
    expect(css).not.toMatch(colour);
    expect(css).not.toMatch(/url\(|@import/);
    for (const v of css.match(/var\(--[\w-]+/g) ?? []) {
      expect(v).toMatch(
        /^var\(--(rps-side-(a|a-edge|b|b-fill)|rps-figure-contour|fig-(fill|edge))$/,
      );
    }
    for (const t of [
      "--rps-side-a)",
      "--rps-side-a-edge)",
      "--rps-side-b)",
      "--rps-side-b-fill)",
    ]) {
      expect(css).toContain(t);
    }
  });
});

// Look fixes 2026-11-19 (plan.md "Figures and playing field"): a dark outer contour so side a's
// light edge never vanishes on a light tile, and a flag that reads as a flag at board size.
describe("figure contour and flag", () => {
  const contourDs = (m: string) =>
    [...m.matchAll(/<path[^>]*data-layer="contour"[^>]*d="([^"]+)"/g)].map((x) => x[1] ?? "");

  it("every figure draws a contour under each fill and edge part, before any part", () => {
    for (const kind of [null, ...KINDS]) {
      for (const side of SIDES) {
        const m = draw({ kind, side });
        const contours = contourDs(m);
        expect(contours.length, `${kind} ${side}`).toBeGreaterThan(0);
        for (const d of contours) {
          const part = ALL_PARTS.find((p) => p.d === d);
          expect(part?.role, d).not.toBe("detail");
        }
        // every fill and edge part of the drawing is contoured, and the first path is a contour
        const drawn = dsOf(m).filter((d) => ALL_PARTS.find((p) => p.d === d)?.role !== "detail");
        for (const d of drawn) expect(contours, d).toContain(d);
        expect(m.match(/<path[^>]*>/)?.[0]).toContain('data-layer="contour"');
      }
    }
  });

  it("hidden figures stay identical per side with the contour", () => {
    expect(draw({ kind: null, side: "a" })).toBe(draw({ kind: null, side: "a" }));
  });

  it("the flag bearer stands under a tall pole with a big flag", () => {
    const m = draw({ kind: "flag", side: "a" });
    expect(m).toContain(`<g transform="${FLAG_BEARER}">`);
    for (const p of FLAG_POLE) expect(dsOf(m)).toContain(p.d);
    const flagCloth = FLAG_POLE.find((p) => p.role === "fill" && /H/.test(p.d));
    const xs = [...(flagCloth?.d ?? "").matchAll(/-?\d+(\.\d+)?/g)].map((x) => Number(x[0]));
    const evenXs = xs.filter((_, i) => i % 2 === 0);
    expect(Math.max(...evenXs) - Math.min(...evenXs)).toBeGreaterThanOrEqual(15);
  });
});
