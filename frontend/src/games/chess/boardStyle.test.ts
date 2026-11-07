import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 015 task 33 (plan 1.8, FR-1, FR-5): the board is painted from tokens only.
const read = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");
const board = read("games/chess/Board.module.css");
const tokens = read("styles/tokens.css");

describe("chess board styling", () => {
  it("has no raw colour literals", () => {
    expect(board).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  });

  it("paints squares from --board-light and --board-dark", () => {
    expect(board).toMatch(/var\(--board-light\)/);
    expect(board).toMatch(/var\(--board-dark\)/);
  });

  it("derives selection and last move from --focus via color-mix, legal markers from --highlight", () => {
    expect(board).toMatch(/\.selected[^}]*color-mix\([^)]*var\(--focus\)/);
    expect(board).toMatch(/\.last[^}]*color-mix\([^)]*var\(--focus\)/);
    expect(board).toMatch(/\.legal::after[^}]*var\(--highlight\)/);
  });

  it("defines the board tokens in both appearances and the system-dark block", () => {
    for (const name of ["--board-light", "--board-dark"]) {
      const count = tokens.split(`${name}:`).length - 1;
      expect(count, name).toBeGreaterThanOrEqual(4);
    }
  });
});
