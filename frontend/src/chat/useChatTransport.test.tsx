import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Me } from "../api/types";
import { type ChatEvents, type ChatTransport, useChat } from "./useChat";

/** A transport that is not a CollabProvider (spec 006: learning sessions reuse useChat). */
class FakeTransport implements ChatTransport {
  sent: unknown[] = [];
  private handlers = new Map<string, Set<(payload: never) => void>>();

  send(message: Parameters<ChatTransport["send"]>[0]) {
    this.sent.push(message);
  }

  on<K extends keyof ChatEvents>(type: K, handler: (payload: ChatEvents[K]) => void) {
    const set = this.handlers.get(type) ?? new Set();
    this.handlers.set(type, set);
    const h = handler as (payload: never) => void;
    set.add(h);
    return () => {
      set.delete(h);
    };
  }

  emit<K extends keyof ChatEvents>(type: K, payload: ChatEvents[K]) {
    act(() => {
      for (const h of this.handlers.get(type) ?? []) (h as (p: ChatEvents[K]) => void)(payload);
    });
  }
}

function msg(id: number, text: string): ChatMessage {
  return { id, sender_name: "Ana", text, sent_at: "2026-10-29T09:00:00Z" };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useChat over a plain transport", () => {
  it("send emits chat_send, an incoming chat_message appears, chat_removed removes it", async () => {
    const me: Me = { signed_in: false, roles: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(me), { status: 200 })),
    );
    const transport = new FakeTransport();
    const { result } = renderHook(() =>
      useChat({ invite: "inv1", provider: transport, stale: false }),
    );

    let sending: Promise<unknown> | undefined;
    act(() => {
      sending = result.current.send("hello");
    });
    expect(transport.sent).toEqual([
      { type: "chat_send", client_id: expect.any(String), text: "hello" },
    ]);
    const clientId = (transport.sent[0] as { client_id: string }).client_id;

    transport.emit("chat_message", { message: msg(1, "hello"), client_id: clientId });
    await expect(sending).resolves.toBe("ok");
    expect(result.current.messages.map((m) => m.text)).toEqual(["hello"]);

    transport.emit("chat_removed", { id: 1 });
    await waitFor(() => expect(result.current.messages).toEqual([]));
  });
});
