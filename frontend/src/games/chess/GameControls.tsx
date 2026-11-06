// Spec 014 FR-10, FR-12, FR-24, FR-25, FR-33, FR-35: Start, Resign, draw, Claim win, Delete.
import { useState } from "react";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { type ChessState, opposite, roleOf } from "./chessState";
import type { ChessClientMessage } from "./chessTypes";

interface Props {
  state: ChessState;
  send(msg: ChessClientMessage): void;
  isAdmin: boolean;
  /** An admin who is not the starter deletes over REST (task 19). */
  onAdminDelete(): void;
}

type Pending = "resign" | "claim" | "delete" | null;

const CONFIRM: Record<Exclude<Pending, null>, { title: string; text: string }> = {
  resign: { title: "Resign?", text: "You lose this game." },
  claim: { title: "Claim win?", text: "Your opponent has been away. The game ends in your win." },
  delete: { title: "Delete session?", text: "This closes the session for everyone." },
};

export function GameControls({ state, send, isAdmin, onAdminDelete }: Props) {
  const [pending, setPending] = useState<Pending>(null);
  const snap = state.state;
  if (!snap) return null;

  const role = roleOf(state);
  const game = snap.game;
  const inProgress = game?.status === "in_progress";
  const bothSeated = snap.seats.white !== null && snap.seats.black !== null;
  const isPlayer = role !== "viewer";
  const canDelete = (state.you?.is_starter ?? false) || isAdmin;

  let startReason: string | null = null;
  if (!bothSeated) startReason = "Waiting for a second player";
  else if (!isPlayer) startReason = "Only players can start";

  function run() {
    const what = pending;
    setPending(null);
    if (what === "resign") send({ type: "resign" });
    else if (what === "claim") send({ type: "claim_win" });
    else if (what === "delete") {
      if (state.you?.is_starter) send({ type: "delete_session" });
      else onAdminDelete();
    }
  }

  const offerBy = game?.draw_offer_by ?? null;
  const offerToMe = isPlayer && offerBy === opposite(role as "white" | "black");
  const offeredByMe = isPlayer && offerBy === role;

  return (
    <div>
      {!inProgress && (
        <div>
          <Button
            variant="primary"
            disabled={startReason !== null}
            onClick={() => send({ type: "start" })}
          >
            Start
          </Button>
          {startReason && <p>{startReason}</p>}
        </div>
      )}
      {inProgress && isPlayer && (
        <div>
          <Button variant="destructive" onClick={() => setPending("resign")}>
            Resign
          </Button>
          <Button disabled={offeredByMe} onClick={() => send({ type: "offer_draw" })}>
            Offer draw
          </Button>
          {offeredByMe && <p>Draw offered</p>}
          {offerToMe && (
            <>
              <Button onClick={() => send({ type: "answer_draw", accept: true })}>Accept</Button>
              <Button onClick={() => send({ type: "answer_draw", accept: false })}>Decline</Button>
            </>
          )}
          <Button disabled={game?.claim_available_to !== role} onClick={() => setPending("claim")}>
            Claim win
          </Button>
        </div>
      )}
      {canDelete && (
        <Button variant="destructive" onClick={() => setPending("delete")}>
          Delete session
        </Button>
      )}
      <Sheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? CONFIRM[pending].title : ""}
        defaultAction={run}
      >
        {pending && <p>{CONFIRM[pending].text}</p>}
        <Button onClick={() => setPending(null)}>Cancel</Button>
        <Button variant="primary" onClick={run}>
          Confirm
        </Button>
      </Sheet>
    </div>
  );
}
