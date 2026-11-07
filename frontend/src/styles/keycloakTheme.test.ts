import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import tokens from "./tokens.css?raw";

// Spec 016 task 25 (FR-9, FR-1): the Keycloak login theme (the hub self-registration page) takes
// the v2 tokens through its own copy (a different origin, nothing shared at runtime), pinned here
// to tokens.css, and its registration styles use the v2 shapes. Same comparison as
// scripts/check-theme-tokens.sh, which stays the shell-level check.
const THEME = join(process.cwd(), "..", "keycloak-theme/collab/login/resources/css");
const collab = readFileSync(join(THEME, "collab.css"), "utf8");
const register = readFileSync(join(THEME, "register.css"), "utf8");

const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "");

function block(css: string, selector: string): Map<string, string> {
  const re = new RegExp(
    `(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const out = new Map<string, string>();
  for (const d of (re.exec(strip(css))?.[2] ?? "").split(";")) {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
    if (m?.[1] && m[2]) out.set(m[1], m[2].replace(/\s+/g, " "));
  }
  return out;
}

const region = /tokens:begin\s*\*\/([\s\S]*?)\/\*\s*tokens:end/.exec(collab)?.[1] ?? "";

describe("keycloak theme token copy (FR-9)", () => {
  for (const selector of [":root", ':root[data-appearance="dark"]']) {
    it(`${selector} matches tokens.css`, () => {
      const want = block(tokens, selector);
      const have = block(region, selector);
      expect(want.size).toBeGreaterThan(20);
      expect(Object.fromEntries(have)).toEqual(Object.fromEntries(want));
    });
  }

  it("carries the v2 names", () => {
    const have = block(region, ":root");
    for (const n of ["--bg", "--surface", "--accent", "--radius-card", "--radius-pill", "--glow"])
      expect(have.has(n), n).toBe(true);
  });

  it("registration card, fields and buttons use the v2 shapes", () => {
    expect(collab).toMatch(/\.pf-v5-c-login__main\s*\{[^}]*border-radius:\s*var\(--radius-card\)/);
    expect(collab).toMatch(/\.pf-v5-c-login__main\s*\{[^}]*background:\s*var\(--surface\)/);
    expect(collab).toMatch(/\.pf-v5-c-button\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
    expect(register).toMatch(/\.pf-m-primary\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
    expect(register).toMatch(/\.pf-m-primary\s*\{[^}]*background:\s*var\(--accent\)/);
    expect(register).toMatch(/\.pf-m-primary\s*\{[^}]*color:\s*var\(--on-accent\)/);
    expect(register).toMatch(/aria-invalid="true"[^{]*\{[^}]*var\(--danger\)/);
    expect(collab + register).not.toMatch(/var\(--(radius-0|action-[\w-]+|surface-1)\)/);
  });
});
