// Result wording for spec 021 (FR-20). Chess's ResultBanner/ClosedSheet are typed to
// white/black and say "White wins", so they cannot widen to sides and the reader's
// perspective cleanly; this is a copy that reuses their stylesheet.
import { Link } from "react-router";
import styles from "../chess/ResultBanner.module.css";
import type { ClosedReason, Reason, Recipient, Result, Side } from "./rpsTypes";

const SIDE: Record<Side, string> = { a: "Side A", b: "Side B" };

const WON: Record<Exclude<Reason, "agreement">, string> = {
  flag: "you captured the flag",
  no_moves: "your opponent has no legal move",
  resignation: "your opponent resigned",
  abandonment: "by claim, your opponent was away",
};

const LOST: Record<Exclude<Reason, "agreement">, string> = {
  flag: "your flag was captured",
  no_moves: "you have no legal move",
  resignation: "you resigned",
  abandonment: "your opponent claimed the win while you were away",
};

const VIEWER: Record<Exclude<Reason, "agreement">, string> = {
  flag: "flag captured",
  no_moves: "no legal move",
  resignation: "resignation",
  abandonment: "by claim",
};

/** How the game ended, worded for the reader: won, lost, draw, or a viewer's neutral line. */
export function rpsResultText(result: Result, reason: Reason, you: Recipient): string {
  if (result === "draw" || reason === "agreement") return "Draw — agreed";
  if (you === "viewer") return `${SIDE[result]} wins — ${VIEWER[reason]}`;
  return result === you ? `You won — ${WON[reason]}` : `You lost — ${LOST[reason]}`;
}

export function RpsResultBanner({
  result,
  reason,
  you,
  live = true,
}: {
  result: Result;
  reason: Reason;
  you: Recipient;
  /** False when rendered inside a parent live region, so screen readers hear it once. */
  live?: boolean;
}) {
  return (
    <div role={live ? "status" : undefined} className={styles.result}>
      {rpsResultText(result, reason, you)}
    </div>
  );
}

/** The "session closed" sheet (FR-2 as chess), with a link back to Games. */
export function RpsClosedSheet({
  closed,
  you,
}: {
  closed: { result: Result | null; reason: ClosedReason };
  you: Recipient;
}) {
  const deleted = closed.reason === "starter" || closed.reason === "admin";
  return (
    <div role="dialog" aria-label="Session closed" className={styles.closed}>
      {!deleted && closed.result ? (
        <p>{rpsResultText(closed.result, closed.reason as Reason, you)}</p>
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
