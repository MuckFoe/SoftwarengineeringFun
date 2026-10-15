import { WS_CLOSE } from "../api/types";
import { type ClosedEvent, CollabProvider, type SocketLike } from "./provider";

/**
 * An in-memory WebSocket. Frames sent on one end are delivered asynchronously
 * (as a real socket would) to its peer, which stands in for the server relay.
 */
class MemorySocket implements SocketLike {
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  peer: MemorySocket | null = null;
  sentText: string[] = [];
  closed = false;

  constructor(readonly url: string) {}

  open() {
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  send(data: string | BufferSource) {
    if (this.closed) throw new Error("send on closed socket");
    if (typeof data === "string") this.sentText.push(data);
    let payload: string | ArrayBuffer;
    if (typeof data === "string") payload = data;
    else if (ArrayBuffer.isView(data))
      payload = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer;
    else payload = new Uint8Array(data).slice().buffer;
    const peer = this.peer;
    if (peer) queueMicrotask(() => peer.receive(payload));
  }

  receive(data: string | ArrayBuffer) {
    if (!this.closed) this.onmessage?.(new MessageEvent("message", { data }));
  }

  close(code = 1000, reason = "") {
    this.serverClose(code, reason);
  }

  serverClose(code: number, reason = "") {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.(new CloseEvent("close", { code, reason })));
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

function connectedPair() {
  const sockets: MemorySocket[] = [];
  const factory = (url: string) => {
    const s = new MemorySocket(url);
    sockets.push(s);
    return s;
  };
  const a = new CollabProvider({ inviteId: "inv", name: "Ada", createSocket: factory });
  const b = new CollabProvider({ inviteId: "inv", name: "Bob", createSocket: factory });
  const [sa, sb] = sockets;
  if (!sa || !sb) throw new Error("providers did not open sockets");
  sa.peer = sb;
  sb.peer = sa;
  sa.open();
  sb.open();
  return { a, b, sa, sb };
}

test("opens the session WebSocket url with the display name", () => {
  let opened = "";
  const p = new CollabProvider({
    inviteId: "abc",
    name: "Ada Lovelace",
    createSocket: (url) => {
      opened = url;
      return new MemorySocket(url);
    },
  });
  expect(opened).toMatch(/\/api\/sessions\/abc\/ws\?name=Ada%20Lovelace$/);
  p.destroy();
});

test("FR-19: concurrent inserts on different lines converge with both edits", async () => {
  const { a, b } = connectedPair();
  const key = "code:p1";
  a.doc.getText(key).insert(0, "def f():\n    pass\n");
  await flush();
  expect(b.doc.getText(key).toString()).toBe("def f():\n    pass\n");

  // Both edit before either edit is delivered: truly concurrent.
  a.doc.getText(key).insert(0, "# by Ada\n");
  const tb = b.doc.getText(key);
  tb.insert(tb.length, "# by Bob\n");
  await flush();

  const ta = a.doc.getText(key).toString();
  expect(ta).toBe(b.doc.getText(key).toString());
  expect(ta).toContain("# by Ada\n");
  expect(ta).toContain("# by Bob\n");
  expect(ta).toContain("def f():\n    pass\n");
  a.destroy();
  b.destroy();
});

test("FR-20: the local awareness cursor is observed by the peer, with the name", async () => {
  const { a, b } = connectedPair();
  await flush();
  a.awareness.setLocalStateField("cursor", { anchor: 3, head: 5 });
  await flush();
  const seen = b.awareness.getStates().get(a.doc.clientID);
  expect(seen?.cursor).toEqual({ anchor: 3, head: 5 });
  expect(seen?.user).toEqual({ name: "Ada" });
  a.destroy();
  b.destroy();
});

test("text frames are emitted as typed events and send() writes JSON", async () => {
  const { a, sa, sb } = connectedPair();
  await flush();
  const seen: string[] = [];
  const off = a.on("run_started", (m) => seen.push(`${m.run_id}:${m.by}`));
  sb.send(JSON.stringify({ type: "run_started", run_id: "r1", by: "Bob" }));
  await flush();
  expect(seen).toEqual(["r1:Bob"]);

  off();
  sb.send(JSON.stringify({ type: "run_started", run_id: "r2", by: "Bob" }));
  await flush();
  expect(seen).toEqual(["r1:Bob"]);

  a.send({ type: "switch_problem", problem_id: "p2" });
  expect(sa.sentText.map((t) => JSON.parse(t))).toContainEqual({
    type: "switch_problem",
    problem_id: "p2",
  });
  a.destroy();
});

test.each([
  [WS_CLOSE.full, "session_full"],
  [WS_CLOSE.notFound, "not_found"],
  [WS_CLOSE.stale, "stale"],
  [WS_CLOSE.invalidName, "invalid_name"],
  [1006, "disconnected"],
] as const)("close code %i is emitted as %s", async (code, error) => {
  let socket: MemorySocket | undefined;
  const p = new CollabProvider({
    inviteId: "inv",
    name: "Eve",
    createSocket: (url) => {
      socket = new MemorySocket(url);
      return socket;
    },
  });
  const closed: ClosedEvent[] = [];
  p.on("closed", (e) => closed.push(e));
  socket?.open();
  await flush();
  socket?.serverClose(code);
  await flush();
  expect(closed).toEqual([{ code, error }]);
  p.destroy();
});
