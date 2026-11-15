import { Button } from "../../ui/Button";
import styles from "../chess/SeatsPanel.module.css";
import type { RpsClientMessage, RpsState, Seat, Side } from "./rpsTypes";

interface Props {
  state: RpsState;
  send: (msg: RpsClientMessage) => void;
}

export const SIDE_LABEL: Record<Side, string> = { a: "Side A", b: "Side B" };

function SeatCard({ side, seat }: { side: Side; seat: Seat | null }) {
  return (
    <li className={styles.seat}>
      <strong>{SIDE_LABEL[side]}</strong>{" "}
      {seat ? (
        <>
          <span>{seat.name}</span>
          {seat.signed_in && (
            <span role="img" aria-label="signed in" title="Signed in">
              {" ✓"}
            </span>
          )}
          {seat.away && <em> away</em>}
        </>
      ) : (
        <span>free</span>
      )}
    </li>
  );
}

/** Two seats by side plus the viewers; take/leave seat only between games (FR-2, AC-2). */
export function RpsSeatsPanel({ state, send }: Props) {
  const { seats, viewers, game, you } = state;
  const between = game === null || game.status === "ended";
  const mine: Side | null = you === "viewer" ? null : you;
  const other: Side | null = mine === "a" ? "b" : mine === "b" ? "a" : null;

  return (
    <section aria-label="Seats" className={styles.panel}>
      <ul className={styles.list}>
        <SeatCard side="a" seat={seats.a} />
        <SeatCard side="b" seat={seats.b} />
      </ul>
      {between && (
        <div className={styles.actions}>
          {mine === null &&
            (["a", "b"] as Side[])
              .filter((s) => seats[s] === null)
              .map((s) => (
                <Button
                  key={s}
                  variant="primary"
                  onClick={() => send({ type: "take_seat", side: s })}
                >
                  Take seat
                  {seats.a === null && seats.b === null ? ` (${SIDE_LABEL[s]})` : ""}
                </Button>
              ))}
          {mine && (
            <>
              <Button onClick={() => send({ type: "leave_seat" })}>Leave seat</Button>
              {other && seats[other] === null && (
                <Button onClick={() => send({ type: "take_seat", side: other })}>
                  Switch to {SIDE_LABEL[other]}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      <h3 className={styles.heading}>Viewers</h3>
      <ul aria-label="Viewers" className={styles.list}>
        {viewers.map((v) => (
          <li key={v.participant_id}>{v.name}</li>
        ))}
      </ul>
    </section>
  );
}
