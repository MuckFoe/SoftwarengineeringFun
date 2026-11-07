import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const frontend = resolve(__dirname, "../..");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "brand-assets") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = walk(frontend);
const css = files.filter((f) => f.endsWith(".css"));
const faceBlocks = (text: string) => strip(text).match(/@font-face\s*\{[^}]*\}/g) ?? [];

describe("fallback font", () => {
  it("every @font-face in the repository CSS uses font-display: swap", () => {
    const blocks = css.flatMap((f) => faceBlocks(readFileSync(f, "utf8")));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toMatch(/font-display:\s*swap/);
  });

  it("vendors Roboto Flex, the second entry of the font stack, with its licence beside it", () => {
    const tokens = strip(readFileSync(join(frontend, "src/styles/tokens.css"), "utf8"));
    const stack = /--font-copy:\s*([^;]+);/.exec(tokens)?.[1] ?? "";
    expect(stack.split(",")[1]?.trim()).toBe('"Roboto Flex"');

    const fallback = strip(readFileSync(join(frontend, "src/brand/fonts-fallback.css"), "utf8"));
    expect(fallback).toMatch(/font-family:\s*"Roboto Flex"/);
    expect(fallback).toMatch(/font-weight:\s*100 1000/);
    expect(fallback).toMatch(/font-stretch:\s*25% 151%/);
    const url = /url\(["']?([^"')]+\.woff2)["']?\)/.exec(fallback)?.[1];
    expect(url).toBeTruthy();
    const dir = join(frontend, "src/brand");
    const woff = resolve(dir, url as string);
    expect(existsSync(woff)).toBe(true);
    expect(readdirSync(join(woff, "..")).some((n) => /^OFL|LICENSE/i.test(n))).toBe(true);
  });

  it("does not preload fonts in index.html", () => {
    const html = readFileSync(join(frontend, "index.html"), "utf8");
    expect(html).not.toMatch(/<link[^>]+rel=["']?preload/i);
  });

  it("the vendored file is the only .woff/.woff2 under frontend/", () => {
    const fonts = files.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));
    expect(fonts.map((f) => f.slice(frontend.length + 1))).toHaveLength(1);
    expect(fonts[0]).toContain("src/assets/fonts/");
  });
});
