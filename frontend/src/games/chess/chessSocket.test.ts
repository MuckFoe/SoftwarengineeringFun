import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChessSocket,
  chessCloseError,
  chessWsUrl,
  type SocketLike,
  storedRejoin,
} from "./chessSocket";
import type { ChessServerMessage, Snapshot } from "./chessTypes";

class FakeSocket implements SocketLike {
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  serverOpen() {
    this.onopen?.(new Event("open"));
  }
  serverSend(msg: ChessServerMessage) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(msg) }));
  }
  serverClose(code: number) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}

const snapshot: Snapshot = {
  invite_id: "inv1",
  stale: false,
  seats: { white: null, black: null },
  viewers: [],
  game: null,
};

function setup(name: string | null = "Ada") {
  const sockets: FakeSocket[] = [];
  const dispatched: ChessServerMessage[] = [];
  const closed: string[] = [];
  const chess = new ChessSocket({
    invite: "inv1",
    name,
    dispatch: (m) => dispatched.push(m),
    onClosed: (e) => closed.push(e.error),
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
  });
  const nth = (i: number): FakeSocket => {
    const s = sockets[i];
    if (!s) throw new Error(`no socket ${i}`);
    return s;
  };
  return { chess, sockets, dispatched, closed, nth };
}

const welcome = (token: string): ChessServerMessage => ({
  type: "welcome",
  you: { participant_id: "p1", is_starter: true },
  rejoin_token: token,
  state: snapshot,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("chessWsUrl", () => {
  it("targets the invite's ws with name and rejoin", () => {
    const loc = { protocol: "https:", host: "h.test" } as Location;
    expect(chessWsUrl("a b", "Ada", "tok", loc)).toBe(
      "wss://h.test/api/games/chess/sessions/a%20b/ws?name=Ada&rejoin=tok",
    );
    expect(chessWsUrl("i", null, null, { protocol: "http:", host: "h" } as Location)).toBe(
      "ws://h/api/games/chess/sessions/i/ws",
    );
  });
});

describe("ChessSocket", () => {
  it("stores the rejoin token from welcome and dispatches frames", () => {
    const { nth, dispatched } = setup();
    nth(0).serverOpen();
    nth(0).serverSend(welcome("tok1"));
    expect(storedRejoin("inv1")).toBe("tok1");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("welcome");
  });

  it("AC-25: reconnects with the stored rejoin token after a drop", () => {
    const { sockets, nth } = setup();
    nth(0).serverOpen();
    nth(0).serverSend(welcome("tok1"));
    nth(0).serverClose(1006);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    expect(nth(1).url).toContain("rejoin=tok1");
  });

  it("uses a token stored by an earlier page load", () => {
    localStorage.setItem("chess:inv1", "old");
    const { nth } = setup();
    expect(nth(0).url).toContain("rejoin=old");
  });

  it.each([
    [4403, "full"],
    [4411, "deleted"],
    [4404, "not_found"],
    [4422, "invalid_name"],
    [4409, "replaced"],
  ])("AC-32/34: close %i is terminal (%s) and does not reconnect", (code, error) => {
    const { sockets, closed, nth } = setup();
    nth(0).serverOpen();
    nth(0).serverClose(code);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(closed).toEqual([error]);
    expect(chessCloseError(code)).toBe(error);
  });

  it("a non-terminal close is reported as disconnected only via reconnect, not onClosed", () => {
    const { closed, nth } = setup();
    nth(0).serverClose(1006);
    expect(closed).toEqual([]);
    expect(chessCloseError(1006)).toBe("disconnected");
  });

  it("destroy stops reconnecting", () => {
    const { chess, sockets, nth } = setup();
    nth(0).serverClose(1006);
    chess.destroy();
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
  });

  it("each send helper emits the plan's frame shape", () => {
    const { chess, nth } = setup();
    const s = nth(0);
    chess.takeSeat("black"); // dropped: not open yet
    expect(s.sent).toEqual([]);
    s.serverOpen();
    chess.takeSeat("black");
    chess.leaveSeat();
    chess.start();
    chess.move("e7", "e8", 12, "q");
    chess.move("e2", "e4", 0);
    chess.resign();
    chess.offerDraw();
    chess.answerDraw(true);
    chess.claimWin();
    chess.deleteSession();
    expect(s.sent.map((d) => JSON.parse(d))).toEqual([
      { type: "take_seat", color: "black" },
      { type: "leave_seat" },
      { type: "start" },
      { type: "move", from: "e7", to: "e8", promotion: "q", ply: 12 },
      { type: "move", from: "e2", to: "e4", ply: 0 },
      { type: "resign" },
      { type: "offer_draw" },
      { type: "answer_draw", accept: true },
      { type: "claim_win" },
      { type: "delete_session" },
    ]);
  });
});
