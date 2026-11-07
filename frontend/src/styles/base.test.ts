import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import base from "./base.css?raw";
import kit from "./kit-values.json";
import motion from "./motion.css?raw";
import type from "./type.css?raw";

// Spec 015 task 3: base, type and motion CSS (FR-3, Accessibility NFR, Performance NFR).

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const shared = kit.shared as Record<string, string>;
const responsive = kit.responsive as Record<string, Record<string, string>>;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : [],
  );
}
const SRC = join(__dirname, "..");
const modules: Record<string, string> = Object.fromEntries(
  walk(SRC).map((f) => [f.slice(SRC.length), readFileSync(f, "utf8")]),
);

function ruleBody(css: string, selector: string): string | null {
  const re = new RegExp(
    `(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = re.exec(strip(css));
  return m?.[2] ?? null;
}

describe("base.css", () => {
  const css = strip(base);
  it("sets canvas background and text colour from tokens", () => {
    const body = norm(ruleBody(base, "body") ?? "");
    expect(body).toContain("background: var(--canvas)");
    expect(body).toContain("color: var(--text)");
    expect(body).toContain("font-family: var(--font-copy)");
  });

  it("has exactly one :focus-visible rule with the double ring", () => {
    const hits = css.match(/:focus-visible\s*\{/g) ?? [];
    expect(hits).toHaveLength(1);
    const body = norm(ruleBody(base, ":focus-visible") ?? "");
    expect(body).toContain("outline: none");
    expect(body).toContain(
      "box-shadow: 0 0 0 var(--bw-2) var(--canvas), 0 0 0 var(--bw-focus) var(--focus)",
    );
    expect(shared["--bw-2"]).toBe("2px");
    expect(shared["--bw-focus"]).toBe("4px");
  });

  it("no other stylesheet removes the outline without a replacement indicator", () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(modules)) {
      if (path.endsWith("/styles/base.css")) continue;
      for (const m of strip(src).matchAll(/\{([^{}]*)\}/g)) {
        const body = m[1] ?? "";
        if (
          /outline\s*:\s*(none|0)\s*[;}]?/.test(body) &&
          !/box-shadow\s*:\s*[^;]*var\(--focus\)/.test(body)
        )
          offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("type.css", () => {
  const css = strip(type);
  const STACK = '"Audi Type", "Roboto Flex", Verdana, system-ui, sans-serif';
  it("uses the stack in kit order", () => {
    expect(shared["--font-copy"]).toBe(STACK);
    expect(norm(css)).toContain("var(--font-copy)");
    expect(norm(css)).toContain("var(--font-display)");
  });

  const scale: Array<[string, string, string]> = [
    ["type-display-1", "display-1", "display"],
    ["type-display-2", "display-2", "display"],
    ["type-h1", "h1", "display"],
    ["type-h2", "h2", "display"],
    ["type-h3", "h3", "display"],
    ["type-h4", "h4", "display"],
    ["type-copy-1", "copy-1", "copy"],
    ["type-copy-2", "copy-2", "copy"],
    ["type-copy-3", "copy-3", "copy"],
    ["type-label-1", "label-1", "copy"],
    ["type-label-2", "label-2", "copy"],
    ["type-label-3", "label-3", "copy"],
  ];
  it.each(scale)("%s binds size and line height to kit tokens", (cls, key, kind) => {
    const body = norm(ruleBody(type, `.${cls}`) ?? "");
    expect(body, cls).toContain(`font-size: var(--fs-${key})`);
    expect(body).toContain(`line-height: var(--lh-${key})`);
    expect(body).toContain(`font-family: var(--font-${kind})`);
    expect(body).toContain(`font-stretch: calc(var(--wdth-${kind}) * 1%)`);
    const fs = shared[`--fs-${key}`] ?? responsive[`--fs-${key}`];
    expect(fs, `kit has --fs-${key}`).toBeTruthy();
  });

  it("headline stretch is 130 and copy 108 in the kit", () => {
    expect(shared["--wdth-display"]).toBe("130");
    expect(shared["--wdth-copy"]).toBe("108");
  });

  it("never uppercases", () => {
    expect(css).not.toMatch(/text-transform\s*:\s*uppercase/);
  });

  it("monospace exception for code and run output", () => {
    const body = norm(ruleBody(type, ".type-code") ?? "");
    expect(body).toContain("font-family: var(--font-mono)");
  });
});

describe("motion.css", () => {
  const css = strip(motion);
  it("transitions use the fast duration and Audi easing", () => {
    expect(norm(css)).toContain("var(--dur-fast)");
    expect(norm(css)).toContain("var(--ease-audi)");
  });
  it("zeroes durations under reduced motion", () => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/.exec(css.trim());
    expect(m).toBeTruthy();
    const inner = norm(m?.[1] ?? "");
    expect(inner).toContain("--dur-fast: var(--motion-fast)");
    expect(inner).toContain("--dur-base: var(--motion-fast)");
  });
});

describe("fonts are not preloaded", () => {
  it("no stylesheet mentions rel=preload", () => {
    for (const src of Object.values(modules)) expect(src).not.toMatch(/rel=["']?preload/);
  });
});
