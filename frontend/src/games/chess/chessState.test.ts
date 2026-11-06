import { describe, expect, it } from "vitest";
import { bottomColor, chessReducer, initialChessState, roleOf } from "./chessState";
import type { Snapshot, Welcome } from "./chessTypes";

const person = (id: string) => ({ participant_id: id, name: id, signed_in: false });
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    invite_id: "inv",
    stale: false,
    seats: { white: { ...person("w"), away: false }, black: { ...person("b"), away: false } },
    viewers: [person("v")],
    game: {
      status: "in_progress",
      fen: START,
      turn: "white",
      ply: 2,
      moves: [
        { san: "e4", from: "e2", to: "e4" },
        { san: "e5", from: "e7", to: "e5" },
      ],
      last_move: { from: "e7", to: "e5" },
      check_square: null,
      legal: { e2: ["e3"] },
      promotions: [],
      draw_offer_by: null,
      claim_available_to: null,
      result: null,
      reason: null,
    },
    ...over,
  };
}

function welcome(id: string): Welcome {
  return {
    type: "welcome",
    you: { participant_id: id, is_starter: id === "w" },
    rejoin_token: "t",
    state: snapshot(),
  };
}

describe("orientation (AC-18)", () => {
  it("shows White at the bottom for White's player", () => {
    const s = chessReducer(initialChessState, welcome("w"));
    expect(roleOf(s)).toBe("white");
    expect(bottomColor(s)).toBe("white");
  });

  it("shows Black at the bottom for Black's player", () => {
    const s = chessReducer(initialChessState, welcome("b"));
    expect(roleOf(s)).toBe("black");
    expect(bottomColor(s)).toBe("black");
  });

  it("shows White at the bottom for a viewer", () => {
    const s = chessReducer(initialChessState, welcome("v"));
    expect(roleOf(s)).toBe("viewer");
    expect(bottomColor(s)).toBe("white");
  });

  it("flip changes only the local view", () => {
    let s = chessReducer(initialChessState, welcome("v"));
    s = chessReducer(s, { type: "flip_toggled" });
    expect(bottomColor(s)).toBe("black");
    expect(s.state).toEqual(snapshot());
    s = chessReducer(s, { type: "flip_toggled" });
    expect(bottomColor(s)).toBe("white");
    const b = chessReducer(chessReducer(initialChessState, welcome("b")), { type: "flip_toggled" });
    expect(bottomColor(b)).toBe("white");
  });
});

describe("join (AC-19)", () => {
  it("a single welcome yields position, moves, turn and role", () => {
    const s = chessReducer(initialChessState, welcome("b"));
    expect(s.state?.game?.fen).toBe(START);
    expect(s.state?.game?.moves).toHaveLength(2);
    expect(s.state?.game?.turn).toBe("white");
    expect(roleOf(s)).toBe("black");
    expect(s.rejoinToken).toBe("t");
  });
});

describe("other frames and local state", () => {
  it("state replaces the snapshot and clears selection and error", () => {
    let s = chessReducer(initialChessState, welcome("w"));
    s = chessReducer(s, { type: "square_selected", square: "e2" });
    s = chessReducer(s, { type: "error", code: "illegal_move" });
    expect(s.error).toBe("illegal_move");
    s = chessReducer(s, { type: "state", state: snapshot({ stale: true }) });
    expect(s.state?.stale).toBe(true);
    expect(s.selected).toBeNull();
    expect(s.error).toBeNull();
  });

  it("selecting the same square again deselects", () => {
    let s = chessReducer(initialChessState, welcome("w"));
    s = chessReducer(s, { type: "square_selected", square: "e2" });
    expect(s.selected).toBe("e2");
    s = chessReducer(s, { type: "square_selected", square: "e2" });
    expect(s.selected).toBeNull();
  });

  it("session_closed records the outcome", () => {
    const s = chessReducer(initialChessState, {
      type: "session_closed",
      result: "white",
      reason: "resignation",
    });
    expect(s.closed).toEqual({ result: "white", reason: "resignation" });
  });

  it("role is viewer before any welcome", () => {
    expect(roleOf(initialChessState)).toBe("viewer");
    expect(bottomColor(initialChessState)).toBe("white");
  });
});
