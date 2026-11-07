import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 015 task 28 (FR-1, FR-8): the learning screens are styled with the Audi tokens only.
const FILES = [
  "LearnWindow",
  "LearningSessionWindow",
  "StepView",
  "Terminal",
  "CompletionSummary",
].map((n) => `${n}.module.css`);

const OLD_LOOK =
  /--legacy-space-|--row-alt-bg|--control-bg|--control-border|--separator|--label\b|--label-secondary|--focus-ring|--status-|--radius-control|--radius-sheet|--type-|--font-text|--shadow-|--content-bg/;

describe("learn styles use Audi tokens", () => {
  for (const file of FILES) {
    it(`${file} has no spec-003 variables`, () => {
      const css = readFileSync(join(__dirname, file), "utf8");
      expect(css.match(OLD_LOOK)).toBeNull();
    });
  }
});
