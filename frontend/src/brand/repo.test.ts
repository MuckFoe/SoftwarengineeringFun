// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
// The single vendored OFL fallback font (task 6).
const VENDORED = /^frontend\/src\/assets\/fonts\/[^/]+\.woff2$/;

describe("repository contains no Audi brand assets (FR-11, licensing)", () => {
  it("tracks nothing under brand-assets/", () => {
    expect(tracked.filter((p) => p.startsWith("brand-assets/"))).toEqual([]);
  });
  it("tracks no woff/woff2 except the vendored OFL one", () => {
    const fonts = tracked.filter((p) => /\.woff2?$/i.test(p) && !VENDORED.test(p));
    expect(fonts).toEqual([]);
    expect(tracked.filter((p) => VENDORED.test(p)).length).toBeLessThanOrEqual(1);
  });
  it("tracks no file named like an Audi logo or rings", () => {
    const names = tracked.filter((p) => {
      const base = p.split("/").pop() ?? "";
      return /^audi.*logo/i.test(base) || /^rings/i.test(base);
    });
    expect(names).toEqual([]);
  });
  it("tracks no Audi icon file (svg/ico under a brand icons dir, or named audi*)", () => {
    const icons = tracked.filter((p) => {
      const base = p.split("/").pop() ?? "";
      return (
        (/\.(svg|ico)$/i.test(base) && (/^audi/i.test(base) || /\/brand\/icons\//.test(p))) ||
        /^frontend\/public\/brand\//.test(p)
      );
    });
    expect(icons).toEqual([]);
  });
  it("tracks no Audi Type font by name", () => {
    expect(tracked.filter((p) => /audi.?type/i.test(p.split("/").pop() ?? ""))).toEqual([]);
  });
  it.each([".gitignore", ".dockerignore"])("%s lists brand-assets/", (f) => {
    const lines = readFileSync(join(ROOT, f), "utf8")
      .split("\n")
      .map((l) => l.trim());
    expect(lines).toContain("brand-assets/");
  });
});
