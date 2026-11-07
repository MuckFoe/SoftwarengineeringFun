import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 015 task 32 (FR-1, FR-8): the Games section styles use Audi tokens only, and the
// chess side panels use the shared Button. Board/pieces/clocks (task 33) are not scanned.
const FILES = [
  "games/GamesWindow.module.css",
  "games/chess/ChessSessionWindow.module.css",
  "games/chess/SeatsPanel.module.css",
  "games/chess/GameControls.module.css",
  "games/chess/MoveList.module.css",
  "games/chess/ResultBanner.module.css",
];
const read = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8");

describe("games restyle", () => {
  for (const f of FILES) {
    it(`${f} uses no spec-003 variables`, () => {
      const css = read(f);
      expect(css).not.toMatch(
        /--legacy-space|--separator|--label(-secondary|-tertiary)?\b|--type-(headline|body|callout|title\d|caption|footnote|subheadline)|--font-text|--control-bg|--content-bg/,
      );
    });
  }

  it("SeatsPanel and PromotionPicker use the shared Button, not bare buttons", () => {
    expect(read("games/chess/SeatsPanel.tsx")).not.toMatch(/<button\b/);
    expect(read("games/chess/PromotionPicker.tsx")).not.toMatch(/style=\{/);
    expect(read("games/chess/MoveList.tsx")).not.toMatch(/style=\{/);
  });
});
