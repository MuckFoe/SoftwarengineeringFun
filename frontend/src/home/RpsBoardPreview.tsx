import type { RpsGameTile } from "../api/types";
import { PieceFigure } from "../games/rps/pieces/PieceFigure";
import styles from "./RpsBoardPreview.module.css";

const COLS = 7;
const ROWS = 6;

/** Rows top to bottom with side a at the bottom, as a viewer sees the board. */
const ORDER = Array.from({ length: ROWS * COLS }, (_, i) => {
  const row = ROWS - 1 - Math.floor(i / COLS);
  return row * COLS + (i % COLS);
});

/** Side a sits at the bottom: rows 0-1 its home, 2-3 the middle, 4-5 side b's home (FR-28). */
function zoneOf(sq: number): "home-bottom" | "middle" | "home-top" {
  const row = Math.floor(sq / COLS);
  if (row < 2) return "home-bottom";
  if (row < 4) return "middle";
  return "home-top";
}

/**
 * Small static Rock Paper Siege board from a home tile's `board` (FR-25), drawn with the
 * playing field's look (FR-28) and the shared figures (FR-27). The server sends only what
 * both players can see, so a null kind is drawn as the hidden figure. Decorative: hidden
 * from assistive tech, never focusable.
 */
export function RpsBoardPreview({ board }: { board: RpsGameTile["board"] }) {
  return (
    <div className={styles.board} aria-hidden="true" data-rps-preview>
      {ORDER.map((sq) => {
        const cell = board[sq] ?? null;
        return (
          <div
            key={sq}
            className={styles.cell}
            data-square={sq}
            data-zone={zoneOf(sq)}
            data-piece={cell ? `${cell.side}-${cell.kind ?? "hidden"}` : undefined}
          >
            {cell && (
              <span className={styles.figure}>
                <PieceFigure kind={cell.kind} side={cell.side} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
