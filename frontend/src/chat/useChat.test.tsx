import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Me } from "../api/types";
import { CollabProvider, type SocketLike } from "../collab/provider";
import { useChat } from "./useChat";

/** The browser WebSocket boundary (the seam provider.test.ts uses): records what is sent. */
class FakeSocket implements SocketLike {
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sentText: string[] = [];

  send(data: string | BufferSource) {
    if (typeof data === "string") this.sentText.push(data);
  }

  close() {}

  /** Frames the client sent of a JSON type, parsed. */
  sent(type: string): Record<string, unknown>[] {
    return this.sentText.map((t) => JSON.parse(t)).filter((m) => m.type === type);
  }

  serverSends(message: unknown) {
    act(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })));
  }

  serverCloses(code: number) {
    act(() => this.onclose?.(new CloseEvent("close", { code })));
  }
}

function connect() {
  let socket: FakeSocket | undefined;
  const provider = new CollabProvider({
    inviteId: "inv1",
    name: "Ana",
    createSocket: () => {
      socket = new FakeSocket();
      return socket;
    },
  });
  if (!socket) throw new Error("no socket");
  const s = socket;
  act(() => s.onopen?.(new Event("open")));
  return { provider, socket: s };
}

function msg(id: number, text: string, sender_name = "Ana"): ChatMessage {
  return { id, sender_name, text, sent_at: `2026-10-25T09:00:0${id % 10}Z` };
}

function welcome(chat: ChatMessage[]) {
  return {
    type: "welcome",
    participant_id: "p1",
    current_problem: {
      id: "q1",
      title: "Add",
      description: "d",
      description_html: "<p>d</p>\n",
      signature: "def add(a: int, b: int) -> int",
      deleted: false,
    },
    problems: {},
    presence: [],
    run_in_progress: false,
    chat,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Only the HTTP boundary is stubbed: /api/me, and the chat REST endpoints.
function stubServer({ roles = [] as string[], history = [] as ChatMessage[] } = {}) {
  const me: Me = { signed_in: roles.length > 0, roles };
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/me") return json(200, me);
    if (path === "/api/sessions/inv1/chat")
      return json(200, { messages: history, read_only: true });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const texts = (messages: ChatMessage[]) => messages.map((m) => m.text);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useChat", () => {
  it("FR10: a chat_message frame appears with its sender and time", () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));

    socket.serverSends(welcome([]));
    socket.serverSends({ type: "chat_message", message: msg(1, "hi", "Ben"), client_id: "x" });

    expect(result.current.messages).toEqual([msg(1, "hi", "Ben")]);
    expect(result.current.readOnly).toBe(false);
  });

  it("welcome's history is shown in id order", () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));

    socket.serverSends(welcome([msg(1, "one"), msg(2, "two")]));

    expect(texts(result.current.messages)).toEqual(["one", "two"]);
  });

  it("send emits chat_send with a client_id and resolves ok on its echo", async () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));
    socket.serverSends(welcome([]));

    let outcome: Promise<string> = Promise.resolve("");
    act(() => {
      outcome = result.current.send("hello <b>there</b>");
    });
    const [frame] = socket.sent("chat_send");
    expect(frame?.text).toBe("hello <b>there</b>");
    expect(typeof frame?.client_id).toBe("string");

    socket.serverSends({
      type: "chat_message",
      message: msg(7, "hello <b>there</b>"),
      client_id: frame?.client_id,
    });

    await expect(outcome).resolves.toBe("ok");
    expect(texts(result.current.messages)).toEqual(["hello <b>there</b>"]);
  });

  it("FR13: whitespace-only text resolves chat_empty and sends no frame", async () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));

    await expect(result.current.send("  \n")).resolves.toBe("chat_empty");
    expect(socket.sent("chat_send")).toEqual([]);
  });

  it("FR14: 2001 characters resolve chat_too_long and send no frame", async () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));

    await expect(result.current.send("x".repeat(2001))).resolves.toBe("chat_too_long");
    expect(socket.sent("chat_send")).toEqual([]);
  });

  it("FR14: a server error with the matching client_id resolves its code", async () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));

    let first: Promise<string> = Promise.resolve("");
    let second: Promise<string> = Promise.resolve("");
    act(() => {
      first = result.current.send("x".repeat(2000));
      second = result.current.send("ok text");
    });
    const [a, b] = socket.sent("chat_send");
    socket.serverSends({
      type: "error",
      code: "chat_too_long",
      limit: 2000,
      client_id: a?.client_id,
    });
    socket.serverSends({ type: "error", code: "session_stale", client_id: b?.client_id });

    await expect(first).resolves.toBe("chat_too_long");
    await expect(second).resolves.toBe("session_stale");
    expect(result.current.messages).toEqual([]);
  });

  it("a send still waiting when the connection closes is rejected", async () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));

    let outcome: Promise<string> = Promise.resolve("");
    act(() => {
      outcome = result.current.send("hello");
    });
    socket.serverCloses(1006);

    await expect(outcome).rejects.toThrow();
  });

  it("FR16: a stale session shows getChat's history and is read-only", async () => {
    const history = [msg(1, "one"), msg(2, "two")];
    stubServer({ history });
    const { result } = renderHook(() => useChat({ invite: "inv1", provider: null, stale: true }));

    await waitFor(() => expect(texts(result.current.messages)).toEqual(["one", "two"]));
    expect(result.current.readOnly).toBe(true);
    await expect(result.current.send("hello")).resolves.toBe("session_stale");
  });

  it("FR18: a second welcome after reconnect replaces the list with no duplicates", () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));

    socket.serverSends(welcome([msg(1, "one")]));
    socket.serverSends({ type: "chat_message", message: msg(2, "two"), client_id: "c" });
    socket.serverSends(welcome([msg(1, "one"), msg(2, "two"), msg(3, "three"), msg(4, "four")]));

    expect(texts(result.current.messages)).toEqual(["one", "two", "three", "four"]);
  });

  it("FR19: a chat_removed frame drops the message", () => {
    stubServer();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));

    socket.serverSends(welcome([msg(1, "one"), msg(2, "two"), msg(3, "three")]));
    socket.serverSends({ type: "chat_removed", id: 2 });

    expect(texts(result.current.messages)).toEqual(["one", "three"]);
  });

  it("FR19: canRemove is true only for a signed-in admin", async () => {
    stubServer({ roles: ["admin"] });
    const admin = renderHook(() => useChat({ invite: "inv1", provider: null, stale: false }));
    await waitFor(() => expect(admin.result.current.canRemove).toBe(true));
    admin.unmount();

    for (const roles of [[], ["editor"]]) {
      stubServer({ roles });
      const other = renderHook(() => useChat({ invite: "inv1", provider: null, stale: false }));
      await act(async () => {});
      expect(other.result.current.canRemove).toBe(false);
      other.unmount();
    }
  });

  it("FR19: remove calls the admin endpoint for this session's message", async () => {
    const fetchMock = stubServer({ roles: ["admin"] });
    const { provider, socket } = connect();
    const { result } = renderHook(() => useChat({ invite: "inv1", provider, stale: false }));
    socket.serverSends(welcome([msg(1, "one"), msg(2, "two")]));

    await act(() => result.current.remove(2));

    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(String(call?.[0])).toBe("/api/sessions/inv1/chat/2");
    expect(texts(result.current.messages)).toEqual(["one"]);
  });
});
