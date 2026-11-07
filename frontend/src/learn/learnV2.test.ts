import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 016 task 21 (FR-9, FR-1): the learning screens use the v2 shapes and tones.
const css = (n: string) => readFileSync(join(__dirname, `${n}.module.css`), "utf8");
const rule = (src: string, sel: string) => {
  const m = src.match(
    new RegExp(`(?:^|\\n)${sel.replace(/[.[\]="()]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  return m?.[1] ?? "";
};

describe("learn screens, v2 look", () => {
  it("the join card is a card: card radius, no outline", () => {
    const r = rule(css("LearningSessionWindow"), ".joinCard");
    expect(r).toContain("var(--radius-card)");
    expect(r).not.toMatch(/border:/);
  });
  it("the step box is a card-shaped surface without an outline", () => {
    const r = rule(css("StepView"), ".box");
    expect(r).toContain("var(--radius-card)");
    expect(r).not.toMatch(/border:/);
  });
  it("step rows are not square", () => {
    expect(rule(css("LearningSessionWindow"), ".step")).not.toContain("var(--radius-0)");
    expect(rule(css("StepView"), ".box")).not.toContain("var(--radius-0)");
  });
  it("the pass and fail colours stay in the accent and danger families", () => {
    for (const n of ["StepView", "LearningSessionWindow", "LearnWindow"]) {
      expect(css(n), n).not.toMatch(/var\(--(success|negative)\)/);
    }
  });
  it("the terminal is a rounded card without an outline or divider", () => {
    const t = css("Terminal");
    const r = rule(t, ".terminal");
    expect(r).toContain("var(--radius-card)");
    expect(r).not.toMatch(/border:/);
    expect(r).not.toContain("var(--radius-0)");
    expect(t).not.toMatch(/--ui-stroke/);
  });
  it("the completion summary has no divider rules", () => {
    expect(css("CompletionSummary")).not.toMatch(/--divider|border-top/);
  });
  it("the join card and step box carry the card marker", () => {
    const w = readFileSync(join(__dirname, "LearningSessionWindow.tsx"), "utf8");
    const v = readFileSync(join(__dirname, "StepView.tsx"), "utf8");
    expect(w.match(/className=\{styles\.joinCard\}\s+data-card/g)?.length).toBe(2);
    expect(v).toMatch(/className=\{styles\.box\}\s+data-card/);
  });
});
