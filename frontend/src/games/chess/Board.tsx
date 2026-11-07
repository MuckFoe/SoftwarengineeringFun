import { useRef, useState } from "react";
import styles from "./Board.module.css";
import type { Role } from "./chessState";
import type { Color, Game } from "./chessTypes";
import { type PieceKind, parseFen } from "./fen";
import bB from "./pieces/bB.svg";
import bK from "./pieces/bK.svg";
import bN from "./pieces/bN.svg";
import bP from "./pieces/bP.svg";
import bQ from "./pieces/bQ.svg";
import bR from "./pieces/bR.svg";
import wB from "./pieces/wB.svg";
import wK from "./pieces/wK.svg";
import wN from "./pieces/wN.svg";
import wP from "./pieces/wP.svg";
import wQ from "./pieces/wQ.svg";
import wR from "./pieces/wR.svg";

const ART: Record<Color, Record<PieceKind, string>> = {
  white: { K: wK, Q: wQ, R: wR, B: wB, N: wN, P: wP },
  black: { K: bK, Q: bQ, R: bR, B: bB, N: bN, P: bP },
};
const NAME: Record<PieceKind, string> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight",
  P: "pawn",
};
const REASON: Record<string, string> = {
  checkmate: "checkmate",
  resignation: "resignation",
  abandonment: "abandonment",
  agreement: "agreement",
  stalemate: "stalemate",
  insufficient_material: "insufficient material",
  threefold_repetition: "threefold repetition",
  fifty_moves: "fifty-move rule",
};

export interface BoardProps {
  game: Game;
  seat: Role;
  /** The colour drawn at the bottom. */
  bottom: Color;
  selected: string | null;
  onSelect: (square: string | null) => void;
  /** Promotion, if needed, is the parent's business. */
  onMove: (from: string, to: string) => void;
}

function announcement(game: Game): string {
  const parts: string[] = [];
  const last = game.moves[game.moves.length - 1];
  if (last) parts.push(`${game.moves.length % 2 === 1 ? "White" : "Black"}: ${last.san}`);
  if (game.status === "ended") {
    const why = game.reason ? REASON[game.reason] : "";
    if (game.result === "draw") parts.push(`Draw${why ? ` by ${why}` : ""}`);
    else if (game.result) {
      parts.push(`${game.result === "white" ? "White" : "Black"} wins${why ? ` by ${why}` : ""}`);
    }
  }
  return parts.join(". ");
}

export function Board({ game, seat, bottom, selected, onSelect, onMove }: BoardProps) {
  const squares = parseFen(game.fen);
  const ordered = bottom === "white" ? squares : [...squares].reverse();
  const canPlay = game.status === "in_progress" && seat === game.turn;
  const [focus, setFocus] = useState("e2");
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const dragFrom = useRef<string | null>(null);

  const isOwn = (sq: string) => {
    const p = squares.find((s) => s.square === sq)?.piece;
    return !!p && canPlay && p.color === seat;
  };
  const destinations = selected && canPlay ? (game.legal[selected] ?? []) : [];

  const activate = (sq: string) => {
    if (!canPlay) return;
    if (selected && destinations.includes(sq)) {
      onSelect(null);
      onMove(selected, sq);
    } else if (isOwn(sq)) {
      onSelect(sq);
    } else if (selected) {
      onSelect(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(ordered[index]?.square ?? "");
      return;
    }
    if (e.key === "Escape") {
      if (selected) onSelect(null);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    const col = Math.min(7, Math.max(0, (index % 8) + d[0]));
    const row = Math.min(7, Math.max(0, Math.floor(index / 8) + d[1]));
    const next = ordered[row * 8 + col]?.square;
    if (next) {
      setFocus(next);
      refs.current.get(next)?.focus();
    }
  };

  const squareAt = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest<HTMLElement>("[data-square]")?.dataset.square ?? null;

  // The tabbable square must exist even if `focus` was never set to one on the board.
  const tabbable = ordered.some((s) => s.square === focus) ? focus : "e2";

  return (
    <div>
      {/* biome-ignore lint/a11y/useSemanticElements: an 8x8 chess board is a grid of buttons. */}
      <div
        role="grid"
        aria-label="Chess board"
        className={styles.board}
        onPointerUp={(e) => {
          const from = dragFrom.current;
          dragFrom.current = null;
          const to = squareAt(e.target);
          if (!from || !to || from === to || !canPlay) return;
          if ((game.legal[from] ?? []).includes(to)) {
            onSelect(null);
            onMove(from, to);
          }
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
          // biome-ignore lint/a11y/useFocusableInteractive: rows are containers; the squares are focusable.
          // biome-ignore lint/a11y/useSemanticElements: grid rows.
          <div role="row" className={styles.row} key={r}>
            {ordered.slice(r * 8, r * 8 + 8).map((s, c) => {
              const index = r * 8 + c;
              const file = s.square.charCodeAt(0) - 97;
              const rank = Number(s.square[1]);
              const light = (file + rank) % 2 === 0; // a1 (0 + 1) is a dark square
              const legal = destinations.includes(s.square);
              const last = game.last_move?.from === s.square || game.last_move?.to === s.square;
              const check = game.check_square === s.square;
              const isSel = selected === s.square;
              const label = [
                `${s.square}, ${s.piece ? `${s.piece.color} ${NAME[s.piece.kind]}` : "empty"}`,
                isSel ? "selected" : "",
                legal ? "legal move" : "",
                last ? "last move" : "",
                check ? "in check" : "",
              ]
                .filter(Boolean)
                .join(", ");
              const cls = [
                styles.square,
                light ? styles.light : styles.dark,
                last && styles.last,
                isSel && styles.selected,
                check && styles.check,
                legal && styles.legal,
                legal && s.piece && styles.occupied,
                (isOwn(s.square) || legal) && styles.movable,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                // biome-ignore lint/a11y/useSemanticElements: a button is the interactive square.
                <button
                  type="button"
                  role="gridcell"
                  key={s.square}
                  data-square={s.square}
                  aria-label={label}
                  className={cls}
                  tabIndex={s.square === tabbable ? 0 : -1}
                  ref={(el) => {
                    if (el) refs.current.set(s.square, el);
                    else refs.current.delete(s.square);
                  }}
                  onFocus={() => setFocus(s.square)}
                  onClick={() => activate(s.square)}
                  onPointerDown={() => {
                    dragFrom.current = isOwn(s.square) ? s.square : null;
                  }}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  onKeyUp={(e) => e.key === " " && e.preventDefault()}
                >
                  {s.piece && (
                    <img className={styles.piece} src={ART[s.piece.color][s.piece.kind]} alt="" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div role="status" aria-live="polite" className={styles.live}>
        {announcement(game)}
      </div>
    </div>
  );
}
