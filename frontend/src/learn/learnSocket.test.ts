import { describe, expect, it } from "vitest";
import type { ChatTransport } from "../chat/useChat";
import { type LearnClosedEvent, LearnSocket, learnWsUrl, type SocketLike } from "./learnSocket";
import type { LearnServerMessage } from "./learnTypes";

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

  serverSend(msg: LearnServerMessage | string) {
    const data = typeof msg === "string" ? msg : JSON.stringify(msg);
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  serverClose(code: number) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}

function connect(name = "Ada") {
  let socket: FakeSocket | undefined;
  const learn = new LearnSocket({
    invite: "inv1",
    name,
    createSocket: (url) => {
      socket = new FakeSocket(url);
      return socket;
    },
  });
  if (!socket) throw new Error("no socket opened");
  return { learn, socket };
}

const sentJson = (s: FakeSocket) => s.sent.map((d) => JSON.parse(d));

describe("learnWsUrl", () => {
  const loc = (protocol: string) => ({ protocol, host: "hub.example" }) as Location;

  it("opens the learning WebSocket with the encoded display name", () => {
    expect(learnWsUrl("inv1", "Ada Lovelace", loc("http:"))).toBe(
      "ws://hub.example/api/learn/sessions/inv1/ws?name=Ada%20Lovelace",
    );
    expect(learnWsUrl("inv1", "Ada", loc("https:"))).toBe(
      "wss://hub.example/api/learn/sessions/inv1/ws?name=Ada",
    );
  });

  it("is what the socket connects to", () => {
    const { socket } = connect("Bob");
    expect(socket.url).toMatch(/\/api\/learn\/sessions\/inv1\/ws\?name=Bob$/);
  });
});

describe("close codes", () => {
  const cases: [number, LearnClosedEvent["error"]][] = [
    [4422, "invalid_name"],
    [4403, "full"],
    [4404, "not_found"],
    [4410, "stale"],
    [1006, "disconnected"],
  ];
  for (const [code, error] of cases) {
    it(`maps ${code} to ${error}`, () => {
      const { learn, socket } = connect();
      const seen: LearnClosedEvent[] = [];
      learn.on("closed", (e) => seen.push(e));
      socket.serverClose(code);
      expect(seen).toEqual([{ code, error }]);
    });
  }
});

describe("sending", () => {
  it("sends the exact plan shapes for every client message", () => {
    const { learn, socket } = connect();
    socket.serverOpen();
    learn.submitChoice(2, [0, 3]);
    learn.submitText(2, "docker ps");
    learn.submitCommand(3, "docker run hello-world");
    learn.continueStep(1);
    learn.revealHint(2);
    learn.showAnswer(2);
    learn.send({ type: "chat_send", text: "hi", client_id: "c1" });
    expect(sentJson(socket)).toEqual([
      { type: "submit_choice", step: 2, selected: [0, 3] },
      { type: "submit_text", step: 2, text: "docker ps" },
      { type: "submit_command", step: 3, command: "docker run hello-world" },
      { type: "continue", step: 1 },
      { type: "reveal_hint", step: 2 },
      { type: "show_answer", step: 2 },
      { type: "chat_send", text: "hi", client_id: "c1" },
    ]);
  });

  it("drops messages while not connected", () => {
    const { learn, socket } = connect();
    learn.submitCommand(1, "ls");
    socket.serverOpen();
    socket.serverClose(1006);
    learn.submitCommand(1, "ls");
    expect(socket.sent).toEqual([]);
  });

  it("closes the socket on destroy", () => {
    const { learn, socket } = connect();
    learn.destroy();
    expect(socket.closed).toBe(true);
  });
});

describe("subscribing", () => {
  it("delivers server messages by type and stops after unsubscribe", () => {
    const { learn, socket } = connect();
    const attempts: number[] = [];
    const off = learn.on("attempt", (m) => attempts.push(m.attempt.id));
    const attempt = {
      type: "attempt",
      step: 3,
      show_answer_available: false,
      attempt: {
        id: 7,
        by: "Ada",
        kind: "command",
        submitted: "ls",
        correct: false,
        output: "x",
        at: "t",
      },
    } as const;
    socket.serverSend(attempt);
    off();
    socket.serverSend({ ...attempt, attempt: { ...attempt.attempt, id: 8 } });
    expect(attempts).toEqual([7]);
  });

  it("ignores frames that are not JSON messages", () => {
    const { learn, socket } = connect();
    const seen: unknown[] = [];
    learn.on("error", (m) => seen.push(m));
    socket.serverSend("not json");
    socket.serverSend("[]");
    socket.serverSend({ type: "error", code: "not_current_step" });
    expect(seen).toEqual([{ type: "error", code: "not_current_step" }]);
  });
});

describe("ChatTransport", () => {
  it("is accepted by useChat", () => {
    const { learn } = connect();
    const transport: ChatTransport = learn;
    expect(transport).toBe(learn);
  });
});
