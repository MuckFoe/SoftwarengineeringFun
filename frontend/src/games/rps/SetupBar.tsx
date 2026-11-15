import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SIDE_LABEL } from "./RpsSeatsPanel";
import { COLS, opposite } from "./rpsState";
import type { Recipient, RpsClientMessage, RpsGame, Side } from "./rpsTypes";
import styles from "./SetupBar.module.css";

/** What Enter on an own home square places during setup (plan UI notes, keyboard). */
export type Placing = "flag" | "trap";

const PLACING_OPTIONS = [
  { value: "flag", label: "Flag" },
  { value: "trap", label: "Trap" },
] as const;

const HOME_ROWS: Record<Side, readonly [number, number]> = { a: [0, 1], b: [4, 5] };

/** The 14 squares of a side's two home rows, ascending (FR-4). */
export function homeSquares(side: Side): number[] {
  return HOME_ROWS[side].flatMap((row) => Array.from({ length: COLS }, (_, c) => row * COLS + c));
}

/**
 * The frame activating `square` sends during setup: `place` with the bar's choice when the
 * square is one of the reader's home squares and their setup is still open, else null.
 */
export function setupPlaceFrame(
  game: RpsGame,
  you: Recipient,
  placing: Placing,
  square: number,
): RpsClientMessage | null {
  if (you === "viewer" || game.status !== "setup" || game.ready[you]) return null;
  if (!homeSquares(you).includes(square)) return null;
  return { type: "place", what: placing, square };
}

interface Props {
  game: RpsGame;
  you: Recipient;
  placing: Placing;
  onPlacingChange: (placing: Placing) => void;
  send: (message: RpsClientMessage) => void;
}

/**
 * Setup before play (spec 021 FR-4 to FR-6): choose flag or trap for the next home square,
 * re-deal the fighters, confirm with Ready. Everything locks once you are ready.
 */
export function SetupBar({ game, you, placing, onPlacingChange, send }: Props) {
  if (you === "viewer") {
    return (
      <section className={styles.bar} aria-label="Setup">
        <ul className={styles.status}>
          {(["a", "b"] as const).map((side) => (
            <li key={side}>
              {SIDE_LABEL[side]} {game.ready[side] ? "is ready" : "is setting up"}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const locked = game.status !== "setup" || game.ready[you];
  const opponentReady = game.ready[opposite(you)];

  return (
    <section className={styles.bar} aria-label="Setup">
      <fieldset className={styles.controls} disabled={locked}>
        <legend className={styles.hint}>
          {locked
            ? "You are ready. Your setup is locked."
            : "Choose flag or trap, then pick one of your home squares."}
        </legend>
        <SegmentedControl
          label="Place on a home square"
          value={placing}
          onChange={(value) => {
            if (!locked) onPlacingChange(value);
          }}
          options={PLACING_OPTIONS}
        />
        <div className={styles.row}>
          <Button disabled={locked} onClick={() => send({ type: "redeal" })}>
            Re-deal
          </Button>
          <Button variant="primary" disabled={locked} onClick={() => send({ type: "ready" })}>
            Ready
          </Button>
        </div>
      </fieldset>
      <p className={styles.opponent}>
        {opponentReady ? "Your opponent is ready." : "Your opponent is still setting up."}
      </p>
    </section>
  );
}
