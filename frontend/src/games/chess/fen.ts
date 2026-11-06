import type { Color } from "./chessTypes";

export type PieceKind = "K" | "Q" | "R" | "B" | "N" | "P";

export interface Piece {
  color: Color;
  kind: PieceKind;
}

export interface BoardSquare {
  square: string;
  piece: Piece | null;
}

const FILES = "abcdefgh";

/** The placement field of a FEN as 64 squares, a8 first and h1 last. Display only: no rules. */
export function parseFen(fen: string): BoardSquare[] {
  const rows = (fen.split(" ")[0] ?? "").split("/");
  const squares: BoardSquare[] = [];
  rows.forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < Number(ch); i++) {
          squares.push({ square: `${FILES.charAt(file++)}${8 - r}`, piece: null });
        }
      } else {
        const upper = ch.toUpperCase() as PieceKind;
        squares.push({
          square: `${FILES.charAt(file++)}${8 - r}`,
          piece: { color: ch === upper ? "white" : "black", kind: upper },
        });
      }
    }
  });
  return squares;
}
