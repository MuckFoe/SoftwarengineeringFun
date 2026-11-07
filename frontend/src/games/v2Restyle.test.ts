import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 016 task 24 (FR-9, FR-1): Games list, chess session shell and seats panel under v2.
// Tokens only (no radius/duration/colour literal), v2 radii, narrow-viewport stacking.
const read = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8");
const FILES = [
  "games/GamesWindow.module.css",
  "games/chess/ChessSessionWindow.module.css",
  "games/chess/SeatsPanel.module.css",
  "games/chess/Board.module.css",
  "games/chess/GameControls.module.css",
  "games/chess/MoveList.module.css",
  "games/chess/ResultBanner.module.css",
  "games/chess/PromotionPicker.module.css",
];

describe("games v2 restyle (task 24)", () => {
  for (const f of FILES) {
    it(`${f} has no colour, radius or duration literal`, () => {
      const css = read(f);
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
      expect(css).not.toMatch(/border(?:-[a-z]+){0,2}-radius\s*:\s*[^;}]*?[1-9]\d*(?:px|rem|em|%)/);
      expect(css).not.toMatch(/(?<![\w.-])(?:\d+\.?\d*|\.\d+)m?s\b/);
    });
  }

  it("seat rows are v2 tiles: surface-2 fill and the medium radius token", () => {
    const css = read("games/chess/SeatsPanel.module.css");
    expect(css).toMatch(/\.seat\s*\{[^}]*background:\s*var\(--surface-2\)/);
    expect(css).toMatch(/\.seat\s*\{[^}]*border-radius:\s*var\(--radius-md\)/);
  });

  it("the chat column is a v2 card-radius panel, and the session stacks on narrow screens", () => {
    const css = read("games/chess/ChessSessionWindow.module.css");
    expect(css).toMatch(/\.chat\s*\{[^}]*border-radius:\s*var\(--radius-card\)/);
    expect(css).toMatch(
      /@media \(max-width: 767px\)\s*\{[^}]*\.layout\s*\{[^}]*flex-direction:\s*column/,
    );
  });

  it("the games list rows stack their Start button on narrow screens", () => {
    expect(read("games/GamesWindow.module.css")).toMatch(
      /@media \(max-width: 767px\)\s*\{[^}]*\.game\s*\{/,
    );
  });
});
