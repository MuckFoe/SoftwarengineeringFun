import type { ChessClientMessage, Color, Seat, Snapshot } from "./chessTypes";

interface Props {
  snapshot: Snapshot;
  youId: string;
  send: (msg: ChessClientMessage) => void;
}

const LABEL: Record<Color, string> = { white: "White", black: "Black" };

function SeatCard({ color, seat }: { color: Color; seat: Seat | null }) {
  return (
    <li>
      <strong>{LABEL[color]}</strong>{" "}
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

export function SeatsPanel({ snapshot, youId, send }: Props) {
  const { seats, viewers, game } = snapshot;
  const inProgress = game?.status === "in_progress";
  const mine: Color | null =
    seats.white?.participant_id === youId
      ? "white"
      : seats.black?.participant_id === youId
        ? "black"
        : null;
  const other: Color | null = mine === "white" ? "black" : mine === "black" ? "white" : null;

  return (
    <section aria-label="Seats">
      <ul>
        <SeatCard color="white" seat={seats.white} />
        <SeatCard color="black" seat={seats.black} />
      </ul>
      {!inProgress && (
        <div>
          {mine === null &&
            (["white", "black"] as Color[])
              .filter((c) => seats[c] === null)
              .map((c) => (
                <button key={c} type="button" onClick={() => send({ type: "take_seat", color: c })}>
                  Take seat
                  {seats.white === null && seats.black === null ? ` (${LABEL[c]})` : ""}
                </button>
              ))}
          {mine && (
            <>
              <button type="button" onClick={() => send({ type: "leave_seat" })}>
                Leave seat
              </button>
              {other && seats[other] === null && (
                <button type="button" onClick={() => send({ type: "take_seat", color: other })}>
                  Switch to {LABEL[other]}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <h3>Viewers</h3>
      <ul aria-label="Viewers">
        {viewers.map((v) => (
          <li key={v.participant_id}>{v.name}</li>
        ))}
      </ul>
    </section>
  );
}
