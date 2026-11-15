import { useRef, useState } from "react";
import { PIECE_PATHS } from "./pieces/paths";
import styles from "./RpsBoard.module.css";
import { COLS, ROWS, squareName } from "./rpsState";
import type { Kind, Recipient, RpsEvent, RpsGame, RpsPiece, Side } from "./rpsTypes";

export interface RpsBoardProps {
  game: RpsGame;
  /** The reader's role (FR-21). */
  you: Recipient;
  /** The side drawn at the bottom: your own, or side a for viewers. */
  bottom: Side;
  selected: number | null;
  onSelect: (square: number | null) => void;
  onMove: (from: number, to: number) => void;
  /** In setup, Enter or a click on a square goes here (the setup bar decides flag or trap). */
  onSetupSquare?: (square: number) => void;
  /** The latest event, to mark a fight or trap square with a motion-token effect. */
  event?: RpsEvent | null;
}

const KIND_NAME: Record<Kind, string> = {
  rock: "rock",
  paper: "paper",
  scissors: "scissors",
  flag: "flag",
  trap: "trap",
};

/** Display order, top-left to bottom-right, with `bottom`'s edge at the bottom. */
function orderFor(bottom: Side): number[] {
  return Array.from({ length: ROWS * COLS }, (_, i) => {
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    return bottom === "a" ? (ROWS - 1 - r) * COLS + c : r * COLS + (COLS - 1 - c);
  });
}

function pieceName(piece: RpsPiece, you: Recipient): string {
  const who =
    you === "viewer"
      ? `Side ${piece.side.toUpperCase()}`
      : piece.side === you
        ? "Your"
        : "Opponent";
  return `${who} ${piece.kind ? KIND_NAME[piece.kind] : "hidden piece"}`;
}

/**
 * The 7×6 Rock Paper Siege board (FR-9, FR-21, NFR-5): a keyboard grid with a roving
 * tabindex; Enter/Space selects a fighter then a target, Escape cancels.
 */
export function RpsBoard({
  game,
  you,
  bottom,
  selected,
  onSelect,
  onMove,
  onSetupSquare,
  event,
}: RpsBoardProps) {
  const order = orderFor(bottom);
  const bottomLeft = order[(ROWS - 1) * COLS] ?? 0;
  const [focus, setFocus] = useState(bottomLeft);
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const at = new Map(game.pieces.map((piece) => [piece.square, piece]));
  const canPlay = game.status === "play" && you !== "viewer" && game.turn === you && !game.duel;
  const legalFrom = (sq: number) => (canPlay ? (game.legal[sq] ?? []) : []);
  const destinations = selected === null ? [] : legalFrom(selected);
  const setup = game.status === "setup" && onSetupSquare;
  const effectAt = event && (event.kind === "fight" || event.kind === "trapped") ? event : null;

  const activate = (sq: number) => {
    if (setup) {
      onSetupSquare(sq);
      return;
    }
    if (!canPlay) return;
    if (selected !== null && destinations.includes(sq)) {
      onSelect(null);
      onMove(selected, sq);
    } else if (legalFrom(sq).length > 0) {
      onSelect(sq);
    } else if (selected !== null) {
      onSelect(null);
    }
  };

  const STEP: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(order[index] ?? 0);
      return;
    }
    if (e.key === "Escape") {
      if (selected !== null) onSelect(null);
      return;
    }
    const d = STEP[e.key];
    if (!d) return;
    e.preventDefault();
    const col = Math.min(COLS - 1, Math.max(0, (index % COLS) + d[0]));
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor(index / COLS) + d[1]));
    const next = order[row * COLS + col] ?? 0;
    setFocus(next);
    refs.current.get(next)?.focus();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a 7x6 game board is a grid of buttons.
    <div role="grid" aria-label="Rock Paper Siege board" className={styles.board}>
      {Array.from({ length: ROWS }, (_, r) => (
        // biome-ignore lint/a11y/useFocusableInteractive: rows are containers; the cells are focusable.
        // biome-ignore lint/a11y/useSemanticElements: grid rows.
        <div role="row" className={styles.row} key={order[r * COLS]}>
          {order.slice(r * COLS, r * COLS + COLS).map((sq, c) => {
            const index = r * COLS + c;
            const piece = at.get(sq);
            const light = (Math.floor(sq / COLS) + (sq % COLS)) % 2 === 0;
            const isSel = selected === sq;
            const target = destinations.includes(sq);
            const label = [
              `${piece ? pieceName(piece, you) : "Empty"}, ${squareName(sq, bottom)}`,
              isSel ? "selected" : "",
              target ? "legal target" : "",
            ]
              .filter(Boolean)
              .join(", ");
            const cls = [
              styles.cell,
              light ? styles.light : styles.dark,
              isSel && styles.selected,
              target && styles.target,
              target && piece && styles.occupied,
              (target || legalFrom(sq).length > 0 || setup) && styles.movable,
              effectAt?.to === sq && (effectAt.kind === "trapped" ? styles.trap : styles.fight),
            ]
              .filter(Boolean)
              .join(" ");
            return (
              // biome-ignore lint/a11y/useSemanticElements: a button is the interactive cell.
              <button
                type="button"
                role="gridcell"
                key={sq}
                data-square={sq}
                aria-label={label}
                className={cls}
                tabIndex={sq === focus ? 0 : -1}
                ref={(el) => {
                  if (el) refs.current.set(sq, el);
                  else refs.current.delete(sq);
                }}
                onFocus={() => setFocus(sq)}
                onClick={() => activate(sq)}
                onKeyDown={(e) => onKeyDown(e, index)}
                onKeyUp={(e) => e.key === " " && e.preventDefault()}
              >
                {piece && (
                  <svg
                    className={`${styles.piece} ${piece.side === "a" ? styles.sideA : styles.sideB}`}
                    viewBox="0 0 48 48"
                    focusable="false"
                    role="presentation"
                  >
                    <path d={PIECE_PATHS[piece.kind ?? "hidden"]} />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
