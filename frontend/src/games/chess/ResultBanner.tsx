import { Link } from "react-router";
import type { ClosedReason, Color, Reason } from "./chessTypes";
import styles from "./ResultBanner.module.css";

const REASON_TEXT: Record<Reason, string> = {
  checkmate: "checkmate",
  resignation: "resignation",
  abandonment: "abandonment",
  agreement: "agreement",
  stalemate: "stalemate",
  insufficient_material: "insufficient material",
  threefold_repetition: "threefold repetition",
  fifty_moves: "fifty-move rule",
};

export function resultText(result: Color | "draw", reason: Reason): string {
  const who = result === "draw" ? "Draw" : `${result === "white" ? "White" : "Black"} wins`;
  return `${who} — ${REASON_TEXT[reason]}`;
}

/** The result line shown when a game ends (FR-26). */
export function ResultBanner({ result, reason }: { result: Color | "draw"; reason: Reason }) {
  return (
    <div role="status" className={styles.result}>
      {resultText(result, reason)}
    </div>
  );
}

/** The "session closed" sheet (FR-34, FR-35), with a link back to Games. */
export function ClosedSheet({
  closed,
}: {
  closed: { result: Color | "draw" | null; reason: ClosedReason };
}) {
  const deleted = closed.reason === "starter" || closed.reason === "admin";
  return (
    <div role="dialog" aria-label="Session closed" className={styles.closed}>
      {!deleted && closed.result ? (
        <p>{resultText(closed.result, closed.reason as Reason)}</p>
      ) : null}
      <p>
        {deleted
          ? `This session was deleted by ${closed.reason === "admin" ? "an admin" : "the starter"}.`
          : "This session is closed."}
      </p>
      <Link to="/games">Back to Games</Link>
    </div>
  );
}
