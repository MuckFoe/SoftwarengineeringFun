import { describe, expect, it } from "vitest";
import {
  announcementOf,
  bottomSide,
  initialRpsClientState,
  roleOf,
  rpsReducer,
  squareName,
  targetsOf,
} from "./rpsState";
import type {
  Recipient,
  RpsDuel,
  RpsEvent,
  RpsGame,
  RpsPiece,
  RpsState,
  StateMsg,
  Welcome,
} from "./rpsTypes";

const person = (id: string) => ({ participant_id: id, name: id, signed_in: false });

function game(over: Partial<RpsGame> = {}): RpsGame {
  return {
    status: "play",
    ready: { a: true, b: true },
    first: "a",
    turn: "a",
    ply: 4,
    pieces: [],
    legal: {},
    duel: null,
    draw_offer_by: null,
    claim_available_to: null,
    result: null,
    reason: null,
    ...over,
  };
}

function rpsState(you: Recipient, g: RpsGame | null = game()): RpsState {
  return {
    invite_id: "inv",
    stale: false,
    seats: { a: { ...person("pa"), away: false }, b: { ...person("pb"), away: false } },
    viewers: [person("v")],
    you,
    game: g,
  };
}

function welcome(you: Recipient, g: RpsGame | null = game()): Welcome {
  const id = you === "a" ? "pa" : you === "b" ? "pb" : "v";
  return {
    type: "welcome",
    you: { participant_id: id, is_starter: you === "a" },
    rejoin_token: "t",
    state: rpsState(you, g),
  };
}

const piece = (square: number, side: "a" | "b", kind: RpsPiece["kind"] = null): RpsPiece => ({
  square,
  side,
  kind,
  revealed: kind !== null,
});

function stateMsg(you: Recipient, g: RpsGame, event?: RpsEvent): StateMsg {
  return event
    ? { type: "state", state: rpsState(you, g), event }
    : { type: "state", state: rpsState(you, g) };
}

describe("orientation (FR-21)", () => {
  it("side a's player has side a at the bottom", () => {
    const s = rpsReducer(initialRpsClientState, welcome("a"));
    expect(roleOf(s)).toBe("a");
    expect(bottomSide(s)).toBe("a");
  });

  it("side b's player has side b at the bottom", () => {
    const s = rpsReducer(initialRpsClientState, welcome("b"));
    expect(roleOf(s)).toBe("b");
    expect(bottomSide(s)).toBe("b");
  });

  it("a viewer has side a at the bottom", () => {
    const s = rpsReducer(initialRpsClientState, welcome("viewer"));
    expect(roleOf(s)).toBe("viewer");
    expect(bottomSide(s)).toBe("a");
  });

  it("before any welcome the role is viewer", () => {
    expect(roleOf(initialRpsClientState)).toBe("viewer");
    expect(bottomSide(initialRpsClientState)).toBe("a");
  });

  it("names squares from the bottom side", () => {
    expect(squareName(0, "a")).toBe("A1");
    expect(squareName(41, "a")).toBe("G6");
    expect(squareName(0, "b")).toBe("G6");
    expect(squareName(41, "b")).toBe("A1");
    expect(squareName(9, "a")).toBe("C2");
  });
});

describe("selection and targets", () => {
  it("targets come from legal for the selected square; same square deselects", () => {
    let s = rpsReducer(initialRpsClientState, welcome("a", game({ legal: { 8: [15, 9] } })));
    expect(targetsOf(s)).toEqual([]);
    s = rpsReducer(s, { type: "square_selected", square: 8 });
    expect(s.selected).toBe(8);
    expect(targetsOf(s)).toEqual([15, 9]);
    s = rpsReducer(s, { type: "square_selected", square: 3 });
    expect(targetsOf(s)).toEqual([]);
    s = rpsReducer(s, { type: "square_selected", square: 3 });
    expect(s.selected).toBeNull();
  });

  it("a state frame clears selection and error", () => {
    let s = rpsReducer(initialRpsClientState, welcome("a", game({ legal: { 8: [15] } })));
    s = rpsReducer(s, { type: "square_selected", square: 8 });
    s = rpsReducer(s, { type: "error", code: "illegal_move" });
    expect(s.error).toBe("illegal_move");
    s = rpsReducer(s, stateMsg("a", game({ turn: "b", ply: 5 })));
    expect(s.selected).toBeNull();
    expect(s.error).toBeNull();
  });

  it("session_closed records the outcome", () => {
    const s = rpsReducer(initialRpsClientState, {
      type: "session_closed",
      result: "a",
      reason: "flag",
    });
    expect(s.closed).toEqual({ result: "a", reason: "flag" });
  });
});

describe("announcements (NFR-5)", () => {
  const duel: RpsDuel = {
    from: 15,
    to: 22,
    attacker: "a",
    round: 1,
    picked: { a: false, b: false },
    your_pick: null,
    last_round: null,
  };

  const cases: [string, RpsGame, RpsEvent, RegExp][] = [
    [
      "moved",
      game({ turn: "b", ply: 5, pieces: [piece(15, "a", "rock")] }),
      { kind: "moved", from: 8, to: 15 },
      /^Your fighter moved from B2 to B3\.$/,
    ],
    [
      "fight",
      game({ turn: "b", ply: 5, pieces: [piece(22, "a", "rock")] }),
      {
        kind: "fight",
        from: 15,
        to: 22,
        attacker: "rock",
        defender: "scissors",
        winner: "attacker",
      },
      /^Your rock beat the opponent's scissors at B4\.$/,
    ],
    [
      "duel",
      game({ turn: null, ply: 5, duel }),
      { kind: "duel", from: 15, to: 22, weapon: "paper" },
      /^Duel at B4: both fighters are paper\. Pick a weapon\.$/,
    ],
    [
      "duel_round",
      game({ turn: null, ply: 5, duel: { ...duel, round: 2 } }),
      { kind: "duel_round", picks: { a: "scissors", b: "scissors" }, outcome: "again" },
      /^Duel tied: both picked scissors\. Pick again\.$/,
    ],
    [
      "trapped",
      game({ turn: "b", ply: 5, pieces: [piece(22, "b", null)] }),
      { kind: "trapped", from: 15, to: 22, attacker: "paper" },
      /^Your paper was caught by a trap at B4\.$/,
    ],
    [
      "trapped (owner)",
      game({ turn: "b", ply: 5, pieces: [piece(15, "a", "trap")] }),
      { kind: "trapped", from: 22, to: 15, attacker: null },
      /^A hidden fighter fell into your trap at B3\.$/,
    ],
    [
      "flag",
      game({
        status: "ended",
        turn: null,
        ply: 5,
        result: "a",
        reason: "flag",
        pieces: [piece(22, "b", "flag")],
      }),
      { kind: "flag", from: 15, to: 22 },
      /^Your fighter took the opponent's flag at B4\.$/,
    ],
  ];

  for (const [kind, g, event, text] of cases) {
    it(`a ${kind} event yields one announcement`, () => {
      let s = rpsReducer(initialRpsClientState, welcome("a"));
      expect(announcementOf(s)).toBeNull();
      s = rpsReducer(s, stateMsg("a", g, event));
      const first = announcementOf(s);
      expect(first?.text).toMatch(text);
      // The same frame again (e.g. a re-broadcast) does not announce again.
      s = rpsReducer(s, stateMsg("a", g, event));
      expect(announcementOf(s)).toBeNull();
    });
  }

  it("a state without an event yields none", () => {
    let s = rpsReducer(initialRpsClientState, welcome("a"));
    s = rpsReducer(s, stateMsg("a", game({ turn: "b", ply: 5 })));
    expect(announcementOf(s)).toBeNull();
  });

  it("a decided duel round names the winner from the reader's side", () => {
    let s = rpsReducer(initialRpsClientState, welcome("b", game({ turn: null, ply: 5, duel })));
    s = rpsReducer(
      s,
      stateMsg("b", game({ turn: "b", ply: 6, pieces: [piece(22, "a", "rock")] }), {
        kind: "duel_round",
        picks: { a: "rock", b: "scissors" },
        outcome: "attacker",
      }),
    );
    expect(announcementOf(s)?.text).toBe(
      "The opponent's rock beat your scissors and won the duel.",
    );
  });

  it("a viewer hears sides by name, from side a's orientation", () => {
    let s = rpsReducer(initialRpsClientState, welcome("viewer"));
    s = rpsReducer(
      s,
      stateMsg("viewer", game({ turn: "a", ply: 5, pieces: [piece(22, "b", "paper")] }), {
        kind: "fight",
        from: 29,
        to: 22,
        attacker: "rock",
        defender: "paper",
        winner: "defender",
      }),
    );
    expect(announcementOf(s)?.text).toBe("Side B's paper beat side A's rock at B4.");
  });

  it("two equal tied rounds in a row each announce", () => {
    const tie: RpsEvent = {
      kind: "duel_round",
      picks: { a: "rock", b: "rock" },
      outcome: "again",
    };
    let s = rpsReducer(initialRpsClientState, welcome("a"));
    s = rpsReducer(s, stateMsg("a", game({ turn: null, duel: { ...duel, round: 2 } }), tie));
    const first = announcementOf(s);
    expect(first).not.toBeNull();
    s = rpsReducer(s, stateMsg("a", game({ turn: null, duel: { ...duel, round: 3 } }), tie));
    const second = announcementOf(s);
    expect(second?.text).toBe(first?.text);
    expect(second?.seq).not.toBe(first?.seq);
  });
});

describe("restore (FR-24)", () => {
  it("a welcome with a pending duel replaces local state and shows the pick", () => {
    let s = rpsReducer(initialRpsClientState, welcome("a", game({ legal: { 8: [15] } })));
    s = rpsReducer(s, { type: "square_selected", square: 8 });
    s = rpsReducer(
      s,
      stateMsg("a", game({ turn: "b", ply: 5, pieces: [piece(15, "a", "rock")] }), {
        kind: "moved",
        from: 8,
        to: 15,
      }),
    );
    s = rpsReducer(s, { type: "error", code: "not_your_turn" });

    const pending = game({
      turn: null,
      ply: 7,
      pieces: [piece(15, "a", "paper"), piece(22, "b", "paper")],
      duel: {
        from: 15,
        to: 22,
        attacker: "a",
        round: 2,
        picked: { a: true, b: false },
        your_pick: "rock",
        last_round: { a: "scissors", b: "scissors" },
      },
    });
    const w = welcome("a", pending);
    s = rpsReducer(s, w);
    expect(s.state).toEqual(w.state);
    expect(s.selected).toBeNull();
    expect(targetsOf(s)).toEqual([]);
    expect(s.error).toBeNull();
    expect(announcementOf(s)).toBeNull();
    expect(s.state?.game?.duel?.your_pick).toBe("rock");
    expect(s.rejoinToken).toBe("t");
  });
});
