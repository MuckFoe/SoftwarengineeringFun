// Spec 015 task 25 (FR-1, FR-5): the session list, "my sessions" and the stale list use the
// Audi tokens and primitives, not the old surface/label/separator/space vars.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const problemsCss = read("pages/ProblemsWindow.module.css");
const sessionsCss = read("pages/ProfileSessions.module.css");
const staleCss = read("components/StaleSessionsList.module.css");
const staleTsx = read("components/StaleSessionsList.tsx");

const OLD =
  /--(legacy-space-\d+|separator|label(-secondary)?|row-alt-bg|row-hover-bg|control-(bg|border)|status-[a-z-]+|radius-control|type-[a-z0-9]+|font-text|focus-ring)\b/;

describe("session list screens (task 25)", () => {
  it.each([
    ["ProblemsWindow.module.css", problemsCss],
    ["ProfileSessions.module.css", sessionsCss],
    ["StaleSessionsList.module.css", staleCss],
  ])("%s uses Audi tokens only", (_n, css) => {
    expect(css).not.toMatch(OLD);
  });

  it("uses the ListItem primitive", () => {
    // Problems and the profile's sessions mark kinds and badges with tonal pills (the reworked
    // library look) instead of the square Tag.
    expect(staleTsx).toContain('from "../ui/ListItem"');
  });
});
