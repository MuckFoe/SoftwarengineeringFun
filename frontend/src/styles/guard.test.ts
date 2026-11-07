import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 015 task 4 (plan 1.1, 1.9, 4): the raw-value guard. Colour literals live only in
// styles/tokens.css (and icons-fallback.css); the Apple look must not come back (FR-8).
// Task 35 removed the baseline: there are no exceptions beyond the allowlists below.
// Chess piece images are .svg files, not scanned (decision 3).

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : /\.(css|ts|tsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

const sources: Record<string, string> = Object.fromEntries(
  walk(SRC).map((f) => [
    `/src${f.slice(SRC.length).split(sep).join("/")}`,
    readFileSync(f, "utf8"),
  ]),
);

interface Source {
  path: string;
  text: string;
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const FORBIDDEN = /backdrop-filter|-apple-system|SF Pro|BlinkMacSystemFont|traffic/i;

const COLOUR_ALLOWED = new Set([
  "/src/styles/tokens.css",
  "/src/brand/icons-fallback.css",
  "/src/styles/guard.test.ts", // this file names the patterns
  "/src/styles/tokens.test.ts", // asserts token values
  "/src/styles/contrast.ts", // task 5: parses token values
  "/src/styles/contrast.test.ts",
  // User-drawn stroke colours (data, not styling); the pinned swatch assertion in
  // PresentSessionWindow.test.tsx (FR-9) fixes these exact values.
  "/src/present/presentTypes.ts",
  "/src/present/PresentSessionWindow.test.tsx",
]);
const FORBIDDEN_ALLOWED = new Set(["/src/styles/guard.test.ts"]);
// The presentation stage is white by design (FR-10); only #fff is permitted there.
const STAGE = "/src/present/PresentationFrame.module.css";

// Spec 016 task 2 (Consistency): no radius or duration literal in *.css / *.module.css / *.tsx
// outside tokens.css; colours are already covered above. A radius is a non-zero length (or
// percentage) in a border-radius declaration; a duration is a literal like 150ms or 0.2s.
const RADIUS = /border(?:-[a-z]+){0,2}-radius\s*:\s*[^;}]*?(?:[1-9]\d*|0?\.\d+)(?:px|rem|em|%)/i;
const DURATION = /(?<![\w.-])(?:\d+\.?\d*|\.\d+)m?s\b/;
const V2_SCANNED = /\.(css|tsx)$/;
const V2_EXEMPT = /(?:^\/src\/styles\/tokens\.css$|\.test\.tsx$)/;

function scan(files: Source[]): string[] {
  const out: string[] = [];
  for (const { path, text } of files) {
    const colourText = path === STAGE ? text.replace(/#fff\b/gi, "") : text;
    if (!COLOUR_ALLOWED.has(path) && COLOUR.test(colourText)) out.push(`raw-colour ${path}`);
    if (V2_SCANNED.test(path) && !V2_EXEMPT.test(path)) {
      if (RADIUS.test(text)) out.push(`raw-radius ${path}`);
      if (DURATION.test(text)) out.push(`raw-duration ${path}`);
    }
    if (!FORBIDDEN_ALLOWED.has(path) && FORBIDDEN.test(text)) out.push(`forbidden ${path}`);
  }
  return out.sort();
}

describe("raw-value guard (FR-1, FR-8)", () => {
  const real = Object.entries(sources).map(([path, text]) => ({ path, text }));

  it("flags a colour literal in a new file but not in tokens.css", () => {
    const hex = "a { color: #ff0000; }";
    expect(scan([{ path: "/src/new/Thing.module.css", text: hex }])).toEqual([
      "raw-colour /src/new/Thing.module.css",
    ]);
    expect(scan([{ path: "/src/styles/tokens.css", text: hex }])).toEqual([]);
    expect(scan([{ path: "/src/a.ts", text: 'const c = "rgb(1, 2, 3)"; hsl(0 0% 0%)' }])).toEqual([
      "raw-colour /src/a.ts",
    ]);
  });

  it("allows only #fff on the presentation stage", () => {
    expect(scan([{ path: STAGE, text: "a { background: #fff; }" }])).toEqual([]);
    expect(scan([{ path: STAGE, text: "a { background: #fefefe; }" }])).toEqual([
      `raw-colour ${STAGE}`,
    ]);
  });

  it("flags forbidden Apple-look strings in a new file", () => {
    for (const s of [
      "backdrop-filter: blur(1px)",
      "-apple-system",
      "SF Pro",
      "BlinkMacSystemFont",
      "traffic light",
    ]) {
      expect(scan([{ path: "/src/new/x.css", text: s }]), s).toEqual(["forbidden /src/new/x.css"]);
    }
  });

  it("finds no raw colour or Apple-look string anywhere in src", () => {
    expect(scan(real), "use a token from styles/tokens.css").toEqual([]);
  });

  it("flags a radius or duration literal in a new file but not in tokens.css (FR-4)", () => {
    const css = "a { border-radius: 12px; transition: color 150ms ease; animation: x 0.6s; }";
    expect(scan([{ path: "/src/new/Thing.module.css", text: css }])).toEqual(
      ["raw-duration /src/new/Thing.module.css", "raw-radius /src/new/Thing.module.css"].sort(),
    );
    expect(scan([{ path: "/src/new/T.tsx", text: 'style={{ borderRadius: "0" }}' }])).toEqual([]);
    expect(
      scan([
        {
          path: "/src/new/T.module.css",
          text: "a { border-radius: var(--radius-card); transition: color var(--motion-fast); border-radius: 0; }",
        },
      ]),
    ).toEqual([]);
    expect(scan([{ path: "/src/styles/tokens.css", text: css }])).toEqual([]);
  });

  it("finds no radius or duration literal anywhere in src (spec 016 task 27: no allowlist)", () => {
    expect(scan(real).filter((x) => /^raw-(radius|duration)/.test(x))).toEqual([]);
  });

  it("has no legacy bridge or spec-003 theme styles left (FR-8)", () => {
    const paths = Object.keys(sources);
    expect(paths).not.toContain("/src/styles/legacy.css");
    expect(paths.filter((p) => /^\/src\/theme\/.*\.css$/.test(p))).toEqual([]);
  });
});
