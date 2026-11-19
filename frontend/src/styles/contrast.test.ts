import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPEARANCES,
  type Colour,
  contrastRatio,
  evaluatePair,
  PAIRS,
  type Pair,
  resolveToken,
  THRESHOLD,
  toastText,
} from "./contrast";
import tokensCss from "./tokens.css?raw";

// Spec 015 task 5: WCAG contrast harness over declared token pairs, both appearances.
// Later tasks append their pairs to PAIRS in contrast.ts; this test iterates all of them.

describe("contrastRatio", () => {
  it("black on white is 21", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
  });
  it("identical colours are 1", () => {
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
  it("known mid value: #767676 on white is about 4.54", () => {
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });
  it("composites translucent foregrounds over the background", () => {
    // 50% black over white is #808080-ish grey, well under 21 and over 1.
    const r = contrastRatio("#00000080", "#FFFFFF");
    expect(r).toBeGreaterThan(3.5);
    expect(r).toBeLessThan(4.5);
  });
});

describe("token resolution", () => {
  it("resolves a token per appearance from kit-values.json", () => {
    expect(resolveToken("--canvas", "light")).toBe("#F4F6FA");
    expect(resolveToken("--canvas", "dark")).toBe("#0A0C11");
  });
  it("throws on an unknown token", () => {
    expect(() => resolveToken("--nope", "light")).toThrow();
  });
});

describe("toast text on signal fills", () => {
  it("picks black or white, whichever has the higher ratio", () => {
    for (const a of APPEARANCES) {
      for (const sig of ["--success", "--notice", "--negative"]) {
        const fill = resolveToken(sig, a);
        const t = toastText(fill);
        const other = t === "#000000" ? "#FFFFFF" : "#000000";
        expect(contrastRatio(t, fill)).toBeGreaterThanOrEqual(contrastRatio(other, fill));
      }
    }
  });
});

describe("declared pair list", () => {
  it("covers every required category", () => {
    const names = PAIRS.map((p) => p.name).join("\n");
    for (const needle of [
      "body text",
      "secondary text",
      "form text",
      "form caption",
      "action text",
      "toast",
      "focus ring",
      "chess",
      "editor",
    ]) {
      expect(names.toLowerCase()).toContain(needle);
    }
  });
  it("has unique names", () => {
    const names = PAIRS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("does not include disabled states", () => {
    for (const p of PAIRS) expect(p.name.toLowerCase()).not.toContain("disabled");
  });
});

// Spec 016 task 2 (FR-4): the v2 token pairs. Text >= 4.5:1, the accent as a boundary >= 3:1.
const V2_BACKGROUNDS = ["--bg", "--surface", "--surface-2"];
const V2_PAIRS: Pair[] = [
  ...V2_BACKGROUNDS.flatMap((bg): Pair[] => [
    { name: `v2 text on ${bg}`, kind: "text", fg: "--text", bg },
    { name: `v2 muted text on ${bg}`, kind: "text", fg: "--text-muted", bg },
    { name: `v2 accent boundary on ${bg}`, kind: "ui", fg: "--accent", bg },
    { name: `v2 danger text on ${bg}`, kind: "text", fg: "--danger", bg },
  ]),
  ...["--accent", "--accent-hover", "--accent-press"].map(
    (bg): Pair => ({
      name: `v2 on-accent text on ${bg}`,
      kind: "text",
      fg: "--on-accent",
      bg,
    }),
  ),
];

describe.each(APPEARANCES)("v2 contrast in %s appearance (FR-4)", (appearance) => {
  it("declares the required v2 pairs with unique names", () => {
    expect(V2_PAIRS).toHaveLength(15);
    expect(new Set(V2_PAIRS.map((p) => p.name)).size).toBe(V2_PAIRS.length);
  });
  for (const pair of V2_PAIRS) {
    const need = THRESHOLD[pair.kind];
    it(`${pair.name} >= ${need}:1`, () => {
      expect(evaluatePair(pair, appearance).ratio).toBeGreaterThanOrEqual(need);
    });
  }
});

describe.each(APPEARANCES)("contrast thresholds in %s appearance", (appearance) => {
  for (const pair of PAIRS) {
    const need = THRESHOLD[pair.kind];
    it(`${pair.name} >= ${need}:1`, () => {
      const { ratio } = evaluatePair(pair, appearance);
      expect(ratio).toBeGreaterThanOrEqual(need);
    });
  }
});

// Text on accent tints: labels, counts, badges and selected rows draw --accent-text on
// color-mix(in srgb, var(--accent) N%, transparent), N up to 16, over the page or a surface.
// The fill accent itself drops under 4.5:1 there in light (axe), so it is checked as well.
const TINT_PCT = [12, 16];
const tintOf =
  (pct: number): Colour =>
  (fill) =>
    `${fill("--accent")}${Math.round((pct / 100) * 255)
      .toString(16)
      .padStart(2, "0")}`;
const TINT_PAIRS: Pair[] = ["--bg", "--surface", "--surface-2"].flatMap((base) =>
  TINT_PCT.map(
    (pct): Pair => ({
      name: `accent text on ${pct}% accent tint over ${base}`,
      kind: "text",
      fg: "--accent-text",
      bg: tintOf(pct),
      base,
    }),
  ),
);

describe.each(APPEARANCES)("text on accent tints in %s appearance", (appearance) => {
  for (const pair of TINT_PAIRS) {
    it(`${pair.name} >= 4.5:1`, () => {
      expect(evaluatePair(pair, appearance).ratio).toBeGreaterThanOrEqual(THRESHOLD.text);
    });
  }
});

// Spec 021 task 3 (NFR-5): Rock Paper Siege pieces on the board squares. As with chess, a piece
// reads when its fill or its edge reaches 3:1 against the square. The rps tokens are aliases, so
// each is resolved through tokens.css to the token it names; the squares come from tokens.css too.
const tokenBlock = (selector: string): Map<string, string> => {
  const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = new RegExp(`(^|\\})\\s*${selector.replace(/[[\]"()]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const out = new Map<string, string>();
  for (const d of (re.exec(css)?.[2] ?? "").split(";")) {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
    if (m?.[1] && m[2]) out.set(m[1], m[2]);
  }
  return out;
};
const ROOT_TOKENS = tokenBlock(":root");
const DARK_TOKENS = tokenBlock(':root[data-appearance="dark"]');
const rpsAlias = (name: string): Colour => {
  const target = /^var\((--[\w-]+)\)$/.exec(ROOT_TOKENS.get(name) ?? "")?.[1];
  if (!target) throw new Error(`${name} is not an alias in tokens.css`);
  return target;
};
const square = (name: string): Colour => ({
  light: ROOT_TOKENS.get(name) ?? "",
  dark: DARK_TOKENS.get(name) ?? "",
});
const RPS_SIDES: [string, Colour[]][] = [
  ["a", [rpsAlias("--rps-side-a"), rpsAlias("--rps-side-a-edge")]],
  ["b", [rpsAlias("--rps-side-b-fill"), rpsAlias("--rps-side-b")]],
];
const RPS_PAIRS: Pair[] = RPS_SIDES.flatMap(([side, fg]) =>
  ["--board-light", "--board-dark"].map(
    (sq): Pair => ({
      name: `rps side ${side} piece on ${sq}`,
      kind: "ui",
      fg,
      bg: square(sq),
    }),
  ),
);

describe.each(APPEARANCES)("rps pieces on board squares in %s appearance (spec 021 NFR-5)", (a) => {
  it("declares both sides on both squares", () => {
    expect(RPS_PAIRS).toHaveLength(4);
  });
  for (const pair of RPS_PAIRS) {
    it(`${pair.name}: fill or edge >= 3:1`, () => {
      expect(evaluatePair(pair, a).ratio).toBeGreaterThanOrEqual(THRESHOLD.ui);
    });
  }
});

// Spec 021 task 35 (AC-28, AC-29; FR-27, FR-28, NFR-5): the playing field. The squares are now the
// zone tones, so each side's piece (fill or edge) and the field line (the 1 px tile outline and the
// midline, which carry the square boundary) reach 3:1 against both zones, and the target dot and
// last-move tint stay readable there. --rps-field (the gap colour) is not held to 3:1: the tile
// outline carries the boundary. The selected fighter gets a two-tone ring, outer --focus with a
// thin inner --bg, so the ring is checked as --focus against --bg. Names resolve through tokens.css.
const RPS_ZONES = ["--rps-zone-home", "--rps-zone-middle"];
const RPS_FIELD_PAIRS: Pair[] = [
  ...RPS_ZONES.flatMap((zone): Pair[] => {
    const bg = rpsAlias(zone);
    return [
      ...RPS_SIDES.map(
        ([side, fg]): Pair => ({
          name: `rps side ${side} piece on ${zone}`,
          kind: "ui",
          fg,
          bg,
        }),
      ),
      { name: `rps field line on ${zone}`, kind: "ui", fg: rpsAlias("--rps-field-line"), bg },
      {
        name: `rps figure contour on ${zone}`,
        kind: "ui",
        fg: rpsAlias("--rps-figure-contour"),
        bg,
      },
      { name: `rps target mark on ${zone}`, kind: "ui", fg: rpsAlias("--rps-target"), bg },
      {
        name: `rps last-move hatching on ${zone}`,
        kind: "ui",
        fg: rpsAlias("--rps-last-move"),
        bg,
      },
    ];
  }),
  { name: "rps selected ring: outer --focus on inner --bg", kind: "ui", fg: "--focus", bg: "--bg" },
];

describe.each(APPEARANCES)("rps playing field in %s appearance (spec 021 AC-28, AC-29)", (a) => {
  it("declares both sides and the field marks on both zones, plus the selection ring", () => {
    expect(RPS_FIELD_PAIRS).toHaveLength(13);
  });
  for (const pair of RPS_FIELD_PAIRS) {
    it(`${pair.name} >= 3:1`, () => {
      expect(evaluatePair(pair, a).ratio).toBeGreaterThanOrEqual(THRESHOLD.ui);
    });
  }
});

// Look fixes 2026-11-19: the home and middle zones are told apart in dark as in light, and the
// target and last-move marks are neutral, so they are not the same blue as side a's pieces.
describe.each(APPEARANCES)("rps zones and marks in %s appearance (spec 021 AC-29)", (a) => {
  it("home and middle zone tones differ by at least 1.25:1", () => {
    const pair: Pair = {
      name: "rps zone middle on zone home",
      kind: "ui",
      fg: rpsAlias("--rps-zone-middle"),
      bg: rpsAlias("--rps-zone-home"),
    };
    expect(evaluatePair(pair, a).ratio).toBeGreaterThanOrEqual(1.25);
  });
  it("target and last-move marks are not the accent", () => {
    for (const mark of ["--rps-target", "--rps-last-move"]) {
      expect(["--accent", "--highlight", "--focus"]).not.toContain(rpsAlias(mark));
    }
  });
});

// Spec 022 task 3 (AC-7; FR-7, NFR-6): the sketch palette. Every colour is drawn on the board, so
// each reaches 3:1 against --sketch-board in light and in dark; ink flips near-black / near-white,
// the rest keep their hue. Values come from tokens.css (light on :root, dark on the dark block);
// the board is an alias, resolved through kit-values.json. The Keycloak copy declares the same.
const SKETCH_COLOURS = ["ink", "red", "orange", "yellow", "green", "blue", "purple", "pink"].map(
  (c) => `--sketch-${c}`,
);
const LIGHT_TOKENS = tokenBlock(':root[data-appearance="light"]');
const sketchBoard = (): Colour => {
  const v = ROOT_TOKENS.get("--sketch-board") ?? "";
  const alias = /^var\((--[\w-]+)\)$/.exec(v)?.[1];
  return alias ?? { light: v, dark: DARK_TOKENS.get("--sketch-board") ?? v };
};
const SKETCH_PAIRS: Pair[] = SKETCH_COLOURS.map(
  (name): Pair => ({
    name: `sketch ${name} on --sketch-board`,
    kind: "ui",
    fg: { light: ROOT_TOKENS.get(name) ?? "", dark: DARK_TOKENS.get(name) ?? "" },
    bg: sketchBoard(),
  }),
);

describe("sketch tokens (spec 022 task 3)", () => {
  it("declares the board and all 8 colours in light, explicit light and dark", () => {
    expect(SKETCH_COLOURS).toHaveLength(8);
    expect(ROOT_TOKENS.has("--sketch-board")).toBe(true);
    for (const name of SKETCH_COLOURS) {
      expect([name, ROOT_TOKENS.get(name)]).toEqual([
        name,
        expect.stringMatching(/^#[0-9a-f]{6}$/i),
      ]);
      expect([name, LIGHT_TOKENS.get(name)]).toEqual([name, ROOT_TOKENS.get(name)]);
      expect([name, DARK_TOKENS.get(name)]).toEqual([
        name,
        expect.stringMatching(/^#[0-9a-f]{6}$/i),
      ]);
    }
  });

  it("ink is near-black in light and near-white in dark", () => {
    expect(contrastRatio(ROOT_TOKENS.get("--sketch-ink") ?? "", "#000000")).toBeLessThan(1.5);
    expect(contrastRatio(DARK_TOKENS.get("--sketch-ink") ?? "", "#FFFFFF")).toBeLessThan(1.5);
  });

  it("the Keycloak theme copy declares the same sketch tokens", () => {
    const collab = readFileSync(
      join(process.cwd(), "..", "keycloak-theme/collab/login/resources/css/collab.css"),
      "utf8",
    );
    for (const name of ["--sketch-board", ...SKETCH_COLOURS])
      expect([name, collab.includes(`${name}:`)]).toEqual([name, true]);
  });
});

describe.each(APPEARANCES)("sketch colours on the board in %s appearance (spec 022 AC-7)", (a) => {
  for (const pair of SKETCH_PAIRS) {
    it(`${pair.name} >= 3:1`, () => {
      expect(evaluatePair(pair, a).ratio).toBeGreaterThanOrEqual(THRESHOLD.ui);
    });
  }
});
