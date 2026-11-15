import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chessCloseError } from "../chess/chessSocket";
import { RpsSocket, rpsCloseError, rpsWsUrl, type SocketLike, storedRejoin } from "./rpsSocket";
import type { RpsServerMessage, RpsState } from "./rpsTypes";

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
  serverSend(msg: RpsServerMessage) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(msg) }));
  }
  serverClose(code: number) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}

const state: RpsState = {
  invite_id: "inv1",
  stale: false,
  seats: { a: null, b: null },
  viewers: [],
  you: "viewer",
  game: null,
};

function setup(name: string | null = "Ada") {
  const sockets: FakeSocket[] = [];
  const dispatched: RpsServerMessage[] = [];
  const closed: string[] = [];
  const rps = new RpsSocket({
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
  return { rps, sockets, dispatched, closed, nth };
}

const welcome = (token: string): RpsServerMessage => ({
  type: "welcome",
  you: { participant_id: "p1", is_starter: true },
  rejoin_token: token,
  state,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("rpsWsUrl", () => {
  it("targets the invite's rps ws with name and rejoin", () => {
    const loc = { protocol: "https:", host: "h.test" } as Location;
    expect(rpsWsUrl("a b", "Ada", "tok", loc)).toBe(
      "wss://h.test/api/games/rps/sessions/a%20b/ws?name=Ada&rejoin=tok",
    );
    expect(rpsWsUrl("i", null, null, { protocol: "http:", host: "h" } as Location)).toBe(
      "ws://h/api/games/rps/sessions/i/ws",
    );
  });
});

describe("RpsSocket", () => {
  it("FR-24: stores the rejoin token from welcome under rps-rejoin:<invite>", () => {
    const { nth, dispatched } = setup();
    nth(0).serverOpen();
    nth(0).serverSend(welcome("tok1"));
    expect(localStorage.getItem("rps-rejoin:inv1")).toBe("tok1");
    expect(localStorage.getItem("chess:inv1")).toBeNull();
    expect(storedRejoin("inv1")).toBe("tok1");
    expect(dispatched.map((m) => m.type)).toEqual(["welcome"]);
  });

  it("FR-24: reconnects with the stored rejoin token after a drop", () => {
    const { sockets, nth } = setup();
    nth(0).serverOpen();
    nth(0).serverSend(welcome("tok1"));
    nth(0).serverClose(1006);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    expect(nth(1).url).toContain("rejoin=tok1");
  });

  it("FR-24: uses a token stored by an earlier page load", () => {
    localStorage.setItem("rps-rejoin:inv1", "old");
    const { nth } = setup();
    expect(nth(0).url).toContain("rejoin=old");
  });

  it.each([
    [4403, "full"],
    [4411, "deleted"],
    [4404, "not_found"],
    [4422, "invalid_name"],
    [4409, "replaced"],
  ])("FR-2: close %i is terminal (%s) as in chess and does not reconnect", (code, error) => {
    const { sockets, closed, nth } = setup();
    nth(0).serverOpen();
    nth(0).serverClose(code);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(closed).toEqual([error]);
    expect(rpsCloseError(code)).toBe(error);
    expect(rpsCloseError(code)).toBe(chessCloseError(code));
  });

  it("a non-terminal close reconnects and is not reported via onClosed", () => {
    const { closed, nth } = setup();
    nth(0).serverClose(1006);
    expect(closed).toEqual([]);
    expect(rpsCloseError(1006)).toBe("disconnected");
  });

  it("destroy stops reconnecting", () => {
    const { rps, sockets, nth } = setup();
    nth(0).serverClose(1006);
    rps.destroy();
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
  });

  it("each send helper emits the plan's frame shape", () => {
    const { rps, nth } = setup();
    const s = nth(0);
    rps.takeSeat("b"); // dropped: not open yet
    expect(s.sent).toEqual([]);
    s.serverOpen();
    rps.takeSeat("b");
    rps.leaveSeat();
    rps.start();
    rps.place("flag", 36);
    rps.place("trap", 40);
    rps.redeal();
    rps.ready();
    rps.move(8, 15);
    rps.duelPick("scissors");
    rps.offerDraw();
    rps.answerDraw(false);
    rps.resign();
    rps.claimWin();
    rps.deleteSession();
    expect(s.sent.map((d) => JSON.parse(d))).toEqual([
      { type: "take_seat", side: "b" },
      { type: "leave_seat" },
      { type: "start" },
      { type: "place", what: "flag", square: 36 },
      { type: "place", what: "trap", square: 40 },
      { type: "redeal" },
      { type: "ready" },
      { type: "move", from: 8, to: 15 },
      { type: "duel_pick", weapon: "scissors" },
      { type: "offer_draw" },
      { type: "answer_draw", accept: false },
      { type: "resign" },
      { type: "claim_win" },
      { type: "delete_session" },
    ]);
  });
});
