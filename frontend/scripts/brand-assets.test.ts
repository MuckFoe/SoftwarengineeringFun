// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "brand-assets.mjs");
const tmp = () => mkdtempSync(join(tmpdir(), "brand-"));
function run(dir: string) {
  const r = spawnSync("node", [SCRIPT, "--dir", dir], { encoding: "utf8" });
  return {
    status: r.status,
    css: r.status === 0 ? readFileSync(join(dir, "brand.css"), "utf8") : "",
  };
}
const put = (dir: string, rel: string, body = "x") => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), body);
};

describe("brand-assets.mjs", () => {
  it("empty dir: empty comment, no rules (FR-3)", () => {
    const d = tmp();
    const { status, css } = run(d);
    expect(status).toBe(0);
    expect(css.trim()).toMatch(/^\/\*[\s\S]*\*\/$/);
    expect(css).not.toMatch(/@font-face|\.icon|\.brand-logo/);
  });
  it("missing dir is created and still exits 0", () => {
    const d = join(tmp(), "nested");
    expect(run(d).status).toBe(0);
  });
  it("fonts only: only @font-face (FR-3)", () => {
    const d = tmp();
    put(d, "fonts/AudiType.woff2");
    const { css } = run(d);
    expect(css).toContain("@font-face");
    expect(css).toContain('"Audi Type"');
    expect(css).toContain("url(fonts/AudiType.woff2)");
    expect(css).toContain("font-weight: 100 900");
    expect(css).toContain("font-stretch: 75% 150%");
    expect(css).not.toMatch(/\.icon|\.brand-logo/);
  });
  it("fonts.json overrides ranges", () => {
    const d = tmp();
    put(d, "fonts/A.woff2");
    put(d, "fonts/fonts.json", JSON.stringify({ weight: "300 700", stretch: "80% 120%" }));
    const { css } = run(d);
    expect(css).toContain("font-weight: 300 700");
    expect(css).toContain("font-stretch: 80% 120%");
  });
  it("icons only: one rule per file with relative url (FR-2)", () => {
    const d = tmp();
    put(d, "icons/home.svg");
    put(d, "icons/search.svg");
    const { css } = run(d);
    expect(css).toContain('.icon[data-icon="home"]');
    expect(css).toContain("url(icons/home.svg)");
    expect(css).toContain('.icon[data-icon="search"]');
    expect(css.match(/\.icon\[data-icon=/g)).toHaveLength(2);
    expect(css).not.toMatch(/@font-face|\.brand-logo/);
  });
  it("logo only: .brand-logo with aspect ratio from viewBox (FR-11)", () => {
    const d = tmp();
    put(
      d,
      "logo.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path d="M0 0"/></svg>',
    );
    const { css } = run(d);
    expect(css).toContain(".brand-logo");
    expect(css).toContain("url(logo.svg)");
    expect(css).toMatch(/aspect-ratio:\s*3\b/);
    expect(css).not.toMatch(/@font-face|\.icon\[/);
  });
  it("no logo: no .brand-logo rule", () => {
    const d = tmp();
    put(d, "icons/a.svg");
    expect(run(d).css).not.toContain(".brand-logo");
  });
  it("unwritable dir exits 1", () => {
    const d = tmp();
    chmodSync(d, 0o500);
    const r = spawnSync("node", [SCRIPT, "--dir", d], { encoding: "utf8" });
    chmodSync(d, 0o700);
    if (process.getuid?.() === 0) return; // root ignores modes
    expect(r.status).toBe(1);
  });
  it("is idempotent", () => {
    const d = tmp();
    put(d, "icons/a.svg");
    const a = run(d).css;
    execFileSync("node", [SCRIPT, "--dir", d]);
    expect(readFileSync(join(d, "brand.css"), "utf8")).toBe(a);
  });
});
