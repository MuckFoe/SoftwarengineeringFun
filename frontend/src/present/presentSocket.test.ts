import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GifSearchTransport } from "../chat/gifs/useGifSearch";
import type { ChatTransport, GifChatTransport } from "../chat/useChat";
import {
  type PresentClosedEvent,
  PresentSocket,
  presentWsUrl,
  type SocketLike,
  storedIdentity,
} from "./presentSocket";
import type { PresentServerMessage, PresentWelcomeMessage } from "./presentTypes";

/** A fake WebSocket: records what the client sends and lets the test play the server. */
class FakeSocket implements SocketLike {
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  serverOpen() {
    this.onopen?.(new Event("open"));
  }

  serverSend(msg: PresentServerMessage | string) {
    const data = typeof msg === "string" ? msg : JSON.stringify(msg);
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  serverClose(code: number) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}

function connect(name: string | null = "Ada", invite = "inv1", rejoin?: string | null) {
  let socket: FakeSocket | undefined;
  const present = new PresentSocket({
    invite,
    name,
    ...(rejoin === undefined ? {} : { rejoin }),
    createSocket: (url) => {
      socket = new FakeSocket(url);
      return socket;
    },
  });
  if (!socket) throw new Error("no socket opened");
  return { present, socket };
}

const sentJson = (s: FakeSocket) => s.sent.map((d) => JSON.parse(d));

function welcome(token: string, name = "Ada"): PresentWelcomeMessage {
  return {
    type: "welcome",
    you: { participant_id: "p1", rejoin_token: token, name },
    available: true,
    kind: "slides",
    slide_count: 3,
    host: { id: "p1", name, away: false },
    place: { slide: 0, anchor: null },
    participants: [{ id: "p1", name, color: 0 }],
    strokes: [],
    chat: [],
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("presentWsUrl", () => {
  const loc = (protocol: string) => ({ protocol, host: "hub.example" }) as Location;

  it("carries the encoded name, and the rejoin token when there is one", () => {
    expect(presentWsUrl("inv1", "Ada Lovelace", null, loc("http:"))).toBe(
      "ws://hub.example/api/present/sessions/inv1/ws?name=Ada%20Lovelace",
    );
    expect(presentWsUrl("inv1", "Ada", "t/k+n", loc("https:"))).toBe(
      "wss://hub.example/api/present/sessions/inv1/ws?name=Ada&rejoin=t%2Fk%2Bn",
    );
  });
});

describe("signed in (spec 012 FR-1)", () => {
  const loc = { protocol: "http:", host: "hub.example" } as Location;

  it("leaves out the name when there is none, keeping a rejoin token", () => {
    expect(presentWsUrl("inv1", null, null, loc)).toBe(
      "ws://hub.example/api/present/sessions/inv1/ws",
    );
    expect(presentWsUrl("inv1", null, "tok", loc)).toBe(
      "ws://hub.example/api/present/sessions/inv1/ws?rejoin=tok",
    );
  });

  it("opens the socket without a name and stores the welcome's rejoin token as before", () => {
    const { socket } = connect(null, "inv1", null);
    expect(socket.url).toMatch(/\/api\/present\/sessions\/inv1\/ws$/);
    socket.serverOpen();
    socket.serverSend(welcome("tok-9", "newuser"));
    expect(storedIdentity("inv1")).toEqual({ name: "newuser", rejoin_token: "tok-9" });
  });
});

describe("identity (AC-15)", () => {
  it("stores the welcome's rejoin token and name per invite", () => {
    const { socket } = connect("Ada");
    socket.serverOpen();
    socket.serverSend(welcome("tok-1", "Ada L"));
    expect(storedIdentity("inv1")).toEqual({ name: "Ada L", rejoin_token: "tok-1" });
    expect(JSON.parse(localStorage.getItem("present:inv1") ?? "null")).toEqual({
      name: "Ada L",
      rejoin_token: "tok-1",
    });
    expect(storedIdentity("other")).toBeNull();
  });

  it("reconnects with the stored rejoin token in the URL", () => {
    const first = connect("Ada");
    expect(first.socket.url).toMatch(/\/api\/present\/sessions\/inv1\/ws\?name=Ada$/);
    first.socket.serverOpen();
    first.socket.serverSend(welcome("tok-1"));
    first.present.destroy();

    const again = connect("Ada");
    expect(again.socket.url).toMatch(/\/api\/present\/sessions\/inv1\/ws\?name=Ada&rejoin=tok-1$/);
  });

  it("reads nothing from a corrupt entry", () => {
    localStorage.setItem("present:inv1", "{not json");
    expect(storedIdentity("inv1")).toBeNull();
    localStorage.setItem("present:inv1", JSON.stringify({ name: 3 }));
    expect(storedIdentity("inv1")).toBeNull();
    expect(connect().socket.url).not.toContain("rejoin");
  });
});

describe("close codes", () => {
  const cases: [number, PresentClosedEvent["error"]][] = [
    [4404, "not_found"],
    [4403, "full"], // AC-9
    [4410, "stale"],
    [4422, "invalid_name"],
    [4409, "replaced"],
    [1006, "disconnected"],
  ];
  for (const [code, error] of cases) {
    it(`maps ${code} to ${error}`, () => {
      const { present, socket } = connect();
      const seen: PresentClosedEvent[] = [];
      present.on("closed", (e) => seen.push(e));
      socket.serverClose(code);
      expect(seen).toEqual([{ code, error }]);
    });
  }
});

describe("sending", () => {
  it("sends the plan's shapes for every client message, chat and GIFs as 007 frames (AC-15h)", () => {
    const { present, socket } = connect();
    socket.serverOpen();
    const anchor = { path: [1, 0], fx: 0.5, fy: 0.25 };
    present.place(2, anchor);
    present.pointer(anchor);
    present.pointer(null);
    present.handOver("p2");
    present.strokeStart("s1", null, [[0.1, 0.2]]);
    present.strokePoints("s1", [
      [0.2, 0.3],
      [0.3, 0.4],
    ]);
    present.clearDrawings();
    present.send({ type: "chat_send", client_id: "c1", text: "hi" });
    present.send({ type: "chat_send_gif", client_id: "c2", gif_id: "g1" });
    present.send({ type: "gif_search", request_id: "r1", q: "cats" });
    expect(sentJson(socket)).toEqual([
      { type: "place", slide: 2, anchor },
      { type: "pointer", anchor },
      { type: "pointer", anchor: null },
      { type: "hand_over", participant_id: "p2" },
      { type: "stroke_start", id: "s1", anchor: null, points: [[0.1, 0.2]] },
      {
        type: "stroke_points",
        id: "s1",
        points: [
          [0.2, 0.3],
          [0.3, 0.4],
        ],
      },
      { type: "clear_drawings" },
      { type: "chat_send", client_id: "c1", text: "hi" },
      { type: "chat_send_gif", client_id: "c2", gif_id: "g1" },
      { type: "gif_search", request_id: "r1", q: "cats" },
    ]);
  });

  it("drops messages while not connected", () => {
    const { present, socket } = connect();
    present.clearDrawings();
    socket.serverOpen();
    socket.serverClose(1006);
    present.clearDrawings();
    expect(socket.sent).toEqual([]);
  });

  it("closes the socket on destroy", () => {
    const { present, socket } = connect();
    present.destroy();
    expect(socket.closed).toBe(true);
  });
});

describe("subscribing", () => {
  it("delivers server messages by type and stops after unsubscribe", () => {
    const { present, socket } = connect();
    const places: (number | null)[] = [];
    const off = present.on("place", (m) => places.push(m.slide));
    socket.serverSend({ type: "place", slide: 1, anchor: null });
    off();
    socket.serverSend({ type: "place", slide: 2, anchor: null });
    expect(places).toEqual([1]);
  });

  it("ignores malformed frames", () => {
    const { present, socket } = connect();
    const seen: unknown[] = [];
    present.on("error", (m) => seen.push(m));
    socket.serverSend("not json");
    socket.serverSend("[]");
    socket.serverSend("null");
    socket.serverSend('{"code":"x"}');
    socket.serverSend({ type: "error", code: "not_host" });
    expect(seen).toEqual([{ type: "error", code: "not_host" }]);
  });

  it("delivers gif_results to GIF search", () => {
    const { present, socket } = connect();
    const search: GifSearchTransport = present;
    const ids: string[] = [];
    search.on("gif_results", (m) => ids.push(m.request_id));
    socket.serverSend({ type: "gif_results", request_id: "r1", trending: true, results: [] });
    expect(ids).toEqual(["r1"]);
  });
});

describe("transports", () => {
  it("satisfies ChatTransport, GifChatTransport and GifSearchTransport", () => {
    const { present } = connect();
    const chat: ChatTransport = present;
    const gifChat: GifChatTransport = present;
    const gifSearch: GifSearchTransport = present;
    expect([chat, gifChat, gifSearch]).toEqual([present, present, present]);
  });
});
