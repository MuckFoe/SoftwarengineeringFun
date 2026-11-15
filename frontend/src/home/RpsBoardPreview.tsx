import type { RpsGameTile } from "../api/types";
import hidden from "../games/rps/pieces/hidden.svg?raw";
import paper from "../games/rps/pieces/paper.svg?raw";
import rock from "../games/rps/pieces/rock.svg?raw";
import scissors from "../games/rps/pieces/scissors.svg?raw";
import styles from "./RpsBoardPreview.module.css";

const COLS = 7;
const ROWS = 6;

/** The single path of each piece; the preview paints fill and edge per side (plan "Sides"). */
const pathOf = (svg: string) => / d="([^"]+)"/.exec(svg)?.[1] ?? "";
const PATHS = {
  rock: pathOf(rock),
  paper: pathOf(paper),
  scissors: pathOf(scissors),
  hidden: pathOf(hidden),
};

/** Rows top to bottom with side a at the bottom, as a viewer sees the board. */
const ORDER = Array.from({ length: ROWS * COLS }, (_, i) => {
  const row = ROWS - 1 - Math.floor(i / COLS);
  return row * COLS + (i % COLS);
});

/**
 * Small static Rock Paper Siege board from a home tile's `board` (FR-25). The server sends
 * only what both players can see, so a null kind is drawn as a hidden piece. Decorative:
 * hidden from assistive tech, never focusable.
 */
export function RpsBoardPreview({ board }: { board: RpsGameTile["board"] }) {
  return (
    <div className={styles.board} aria-hidden="true" data-rps-preview>
      {ORDER.map((sq) => {
        const light = (Math.floor(sq / COLS) + (sq % COLS)) % 2 === 0;
        const cell = board[sq] ?? null;
        const kind = cell ? (cell.kind ?? "hidden") : null;
        return (
          <div
            key={sq}
            className={light ? styles.light : styles.dark}
            data-square={sq}
            data-piece={cell && kind ? `${cell.side}-${kind}` : undefined}
          >
            {cell && kind && (
              <svg
                className={cell.side === "a" ? styles.sideA : styles.sideB}
                viewBox="0 0 48 48"
                focusable="false"
                role="presentation"
              >
                <path d={PATHS[kind]} />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
