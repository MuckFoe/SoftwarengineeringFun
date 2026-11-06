import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ChessState, initialChessState } from "./chessState";
import type { Color, Game, Seat } from "./chessTypes";
import { GameControls } from "./GameControls";

const seat = (id: string): Seat => ({
  participant_id: id,
  name: id,
  signed_in: false,
  away: false,
});

function game(over: Partial<Game> = {}): Game {
  return {
    status: "in_progress",
    fen: "",
    turn: "white",
    ply: 0,
    moves: [],
    last_move: null,
    check_square: null,
    legal: {},
    promotions: [],
    draw_offer_by: null,
    claim_available_to: null,
    result: null,
    reason: null,
    ...over,
  };
}

function make(
  me: string,
  opts: { white?: boolean; black?: boolean; game?: Game | null; starter?: boolean } = {},
): ChessState {
  const { white = true, black = true, game: g = null, starter = false } = opts;
  return {
    ...initialChessState,
    you: { participant_id: me, is_starter: starter },
    state: {
      invite_id: "x",
      stale: false,
      seats: { white: white ? seat("w") : null, black: black ? seat("b") : null },
      viewers: [],
      game: g,
    },
  };
}

function setup(state: ChessState, isAdmin = false) {
  const send = vi.fn();
  const onAdminDelete = vi.fn();
  render(
    <GameControls state={state} send={send} isAdmin={isAdmin} onAdminDelete={onAdminDelete} />,
  );
  return { send, onAdminDelete };
}

const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
const cancel = () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

describe("GameControls start (AC-9)", () => {
  it("is unavailable with a reason when only White is seated", () => {
    setup(make("w", { black: false }));
    expect(screen.getByRole("button", { name: "Start" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Waiting for a second player")).toBeTruthy();
  });

  it("is unavailable for a viewer when both are seated", () => {
    setup(make("v"));
    expect(screen.getByRole("button", { name: "Start" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Only players can start")).toBeTruthy();
  });

  it("sends start for a player when both are seated", () => {
    const { send } = setup(make("w"));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(send).toHaveBeenCalledWith({ type: "start" });
  });

  it("is shown after a game ended", () => {
    setup(make("w", { game: game({ status: "ended", result: "white" }) }));
    expect(screen.getByRole("button", { name: "Start" })).toHaveProperty("disabled", false);
  });
});

describe("GameControls resign (AC-22)", () => {
  it("cancel sends nothing, confirm sends resign", () => {
    const { send } = setup(make("w", { game: game() }));
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resign" }));
    cancel();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resign" }));
    confirm();
    expect(send).toHaveBeenCalledWith({ type: "resign" });
  });

  it("is not offered to a viewer", () => {
    setup(make("v", { game: game() }));
    expect(screen.queryByRole("button", { name: "Resign" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Offer draw" })).toBeNull();
  });
});

describe("GameControls draw (AC-23)", () => {
  it("offer sends offer_draw", () => {
    const { send } = setup(make("w", { game: game() }));
    fireEvent.click(screen.getByRole("button", { name: "Offer draw" }));
    expect(send).toHaveBeenCalledWith({ type: "offer_draw" });
  });

  it("the opponent can accept or decline", () => {
    const g = game({ draw_offer_by: "white" as Color });
    const { send } = setup(make("b", { game: g }));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(send).toHaveBeenCalledWith({ type: "answer_draw", accept: true });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(send).toHaveBeenCalledWith({ type: "answer_draw", accept: false });
  });

  it("the offerer sees no Accept or Decline", () => {
    setup(make("w", { game: game({ draw_offer_by: "white" }) }));
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });
});

describe("GameControls claim win (AC-33)", () => {
  it.each([null, "black"] as const)("is disabled when available to %s", (to) => {
    setup(make("w", { game: game({ claim_available_to: to }) }));
    expect(screen.getByRole("button", { name: "Claim win" })).toHaveProperty("disabled", true);
  });

  it("is enabled for your colour and confirm sends claim_win", () => {
    const { send } = setup(make("w", { game: game({ claim_available_to: "white" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Claim win" }));
    cancel();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Claim win" }));
    confirm();
    expect(send).toHaveBeenCalledWith({ type: "claim_win" });
  });
});

describe("GameControls delete session (AC-35)", () => {
  it("is absent for a non-starter non-admin", () => {
    setup(make("b", { game: game() }));
    expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
  });

  it("starter: cancel sends nothing, confirm sends delete_session", () => {
    const { send } = setup(make("w", { starter: true }));
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    cancel();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    confirm();
    expect(send).toHaveBeenCalledWith({ type: "delete_session" });
  });

  it("admin who is not the starter calls the parent's handler", () => {
    const { send, onAdminDelete } = setup(make("v"), true);
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    confirm();
    expect(onAdminDelete).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});
