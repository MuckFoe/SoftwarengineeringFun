import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GifResult } from "../../api/types";
import { CollabProvider, type SocketLike } from "../../collab/provider";
import { type GifSearchTransport, useGifSearch } from "./useGifSearch";

/** The browser WebSocket boundary (001's seam): records what the client sends. */
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

  /** `gif_search` frames the client sent, parsed. */
  searches(): { type: string; request_id: string; q: string }[] {
    return this.sentText.map((t) => JSON.parse(t)).filter((m) => m.type === "gif_search");
  }

  serverSends(message: unknown) {
    act(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })));
  }
}

function connect() {
  let socket: FakeSocket | undefined;
  const provider = new CollabProvider({
    inviteId: "inv1",
    name: "Ada",
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

function gif(id: string, title = id): GifResult {
  return {
    id,
    title,
    url: `https://media.example/${id}.gif`,
    still_url: `https://media.example/${id}_s.gif`,
    width: 200,
    height: 150,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useGifSearch", () => {
  it("FR-2: enabling sends q '' at once; the reply shows trending", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useGifSearch({ provider, enabled: true }));

    const [first, ...rest] = socket.searches();
    expect(rest).toEqual([]);
    expect(first?.q).toBe("");
    expect(typeof first?.request_id).toBe("string");
    expect(result.current.status).toBe("loading");

    socket.serverSends({
      type: "gif_results",
      request_id: first?.request_id,
      trending: true,
      results: [gif("t1")],
    });

    expect(result.current.status).toBe("results");
    expect(result.current.trending).toBe(true);
    expect(result.current.results).toEqual([gif("t1")]);
  });

  it("FR-1: typing c, ca, cat sends one gif_search for 'cat' after 400 ms; stale replies are ignored", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useGifSearch({ provider, enabled: true }));
    const [trending] = socket.searches();

    act(() => result.current.setQuery("c"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.setQuery("ca"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.setQuery("cat"));
    expect(result.current.query).toBe("cat");
    act(() => vi.advanceTimersByTime(399));
    expect(socket.searches()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));

    const sent = socket.searches();
    expect(sent).toHaveLength(2);
    const cat = sent[1];
    expect(cat?.q).toBe("cat");
    expect(cat?.request_id).not.toBe(trending?.request_id);

    // The trending reply arrives late: it answers an earlier request, so it is ignored.
    socket.serverSends({
      type: "gif_results",
      request_id: trending?.request_id,
      trending: true,
      results: [gif("t1")],
    });
    expect(result.current.status).toBe("loading");
    expect(result.current.results).toEqual([]);

    socket.serverSends({
      type: "gif_results",
      request_id: cat?.request_id,
      trending: false,
      results: [gif("cat1", "Cat"), gif("cat2", "Kitten")],
    });
    expect(result.current.status).toBe("results");
    expect(result.current.trending).toBe(false);
    expect(result.current.results.map((g) => g.id)).toEqual(["cat1", "cat2"]);
  });

  it("FR-9: gif_unavailable for the latest request → status unavailable", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useGifSearch({ provider, enabled: true }));
    const [first] = socket.searches();

    socket.serverSends({ type: "error", code: "gif_unavailable", request_id: first?.request_id });

    expect(result.current.status).toBe("unavailable");
    expect(result.current.retryAfter).toBeNull();
  });

  it("NFR-3: gif_rate_limited with retry_after 12 → status rate_limited, retryAfter 12", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useGifSearch({ provider, enabled: true }));
    const [first] = socket.searches();

    socket.serverSends({
      type: "error",
      code: "gif_rate_limited",
      request_id: first?.request_id,
      retry_after: 12,
    });

    expect(result.current.status).toBe("rate_limited");
    expect(result.current.retryAfter).toBe(12);
  });

  it("ignores errors for other requests (a stale search or a chat_send_gif refusal)", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useGifSearch({ provider, enabled: true }));

    socket.serverSends({ type: "error", code: "gif_unavailable", request_id: "older" });
    socket.serverSends({
      type: "error",
      code: "gif_rate_limited",
      client_id: "c1",
      retry_after: 3,
    });

    expect(result.current.status).toBe("loading");
    expect(result.current.retryAfter).toBeNull();
  });

  it("FR-5: while disabled, no frame is sent, even after typing", () => {
    const { provider, socket } = connect();
    const { result, rerender } = renderHook(({ enabled }) => useGifSearch({ provider, enabled }), {
      initialProps: { enabled: false },
    });

    act(() => result.current.setQuery("cat"));
    act(() => vi.advanceTimersByTime(1000));

    expect(socket.sentText.filter((t) => t.startsWith("{"))).toEqual([]);
    expect(result.current.status).toBe("idle");

    rerender({ enabled: true });
    expect(socket.searches()).toHaveLength(1);
  });

  it("013 AC-15h: any GifSearchTransport works, not only a CollabProvider", () => {
    const sent: { type: "gif_search"; request_id: string; q: string }[] = [];
    const handlers = new Map<string, (payload: never) => void>();
    const transport: GifSearchTransport = {
      send: (m) => {
        sent.push(m);
      },
      on: (type, handler) => {
        handlers.set(type, handler as (payload: never) => void);
        return () => handlers.delete(type);
      },
    };
    const { result, unmount } = renderHook(() =>
      useGifSearch({ provider: transport, enabled: true }),
    );

    const [first] = sent;
    expect(first?.q).toBe("");
    act(() =>
      (handlers.get("gif_results") as (m: unknown) => void)({
        type: "gif_results",
        request_id: first?.request_id,
        trending: true,
        results: [gif("t1")],
      }),
    );
    expect(result.current.status).toBe("results");
    expect(result.current.results).toEqual([gif("t1")]);

    unmount();
    expect(handlers.size).toBe(0);
  });
});
