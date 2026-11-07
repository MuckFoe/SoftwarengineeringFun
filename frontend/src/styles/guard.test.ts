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
    "/src" + f.slice(SRC.length).split(sep).join("/"),
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

function scan(files: Source[]): string[] {
  const out: string[] = [];
  for (const { path, text } of files) {
    const colourText = path === STAGE ? text.replace(/#fff\b/gi, "") : text;
    if (!COLOUR_ALLOWED.has(path) && COLOUR.test(colourText)) out.push(`raw-colour ${path}`);
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

  it("has no legacy bridge or spec-003 theme styles left (FR-8)", () => {
    const paths = Object.keys(sources);
    expect(paths).not.toContain("/src/styles/legacy.css");
    expect(paths.filter((p) => /^\/src\/theme\/.*\.css$/.test(p))).toEqual([]);
  });
});
