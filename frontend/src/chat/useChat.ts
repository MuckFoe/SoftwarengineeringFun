import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChat, removeChatMessage } from "../api/client";
import type {
  ChatErrorCode,
  ChatMessage,
  ChatMessageFrame,
  ChatRemovedMessage,
  ChatSendGifMessage,
  ChatSendMessage,
  ErrorMessage,
  GifErrorCode,
  WelcomeMessage,
} from "../api/types";
import { useMe } from "../auth/useMe";
import { chatError } from "./chatRules";
import { addMessage, type ChatState, removeMessage, replaceHistory } from "./chatState";

export type SendResult = "ok" | ChatErrorCode;

/** How a GIF post ends (spec 007): `ok` on its own `chat_message`, or the refusal code. */
export type SendGifResult = "ok" | GifErrorCode | "session_stale";

const REFUSALS: ReadonlySet<string> = new Set<ChatErrorCode | GifErrorCode>([
  "chat_empty",
  "chat_too_long",
  "session_stale",
  "gif_unavailable",
  "gif_rate_limited",
  "gif_not_allowed",
]);

/** The messages useChat listens to, with only the fields it reads. */
export type ChatEvents = {
  /**
   * `you.participant_id` is who this socket joined as (spec 012); every session kind sends
   * it. A coding-session welcome without `you` gives its top-level `participant_id` instead.
   */
  welcome: Pick<WelcomeMessage, "chat"> & {
    you?: { participant_id: string };
    participant_id?: string;
  };
  chat_message: Pick<ChatMessageFrame, "message" | "client_id">;
  chat_removed: Pick<ChatRemovedMessage, "id">;
  error: Pick<ErrorMessage, "code" | "client_id">;
  closed: unknown;
};

/**
 * What useChat needs from a session connection: send a JSON message, subscribe to JSON
 * messages. `CollabProvider` satisfies it as is; spec 006's learning socket implements it too.
 */
export interface ChatTransport {
  send(message: ChatSendMessage): void;
  on<K extends keyof ChatEvents>(type: K, handler: (payload: ChatEvents[K]) => void): () => void;
}

/**
 * A transport that can also post GIFs (spec 007): the coding session's `CollabProvider`.
 * Kept apart from `ChatTransport` so 006's learning socket, which has no GIFs, still fits it.
 */
export interface GifChatTransport extends ChatTransport {
  send(message: ChatSendMessage | ChatSendGifMessage): void;
}

interface Pending {
  resolve(result: SendResult | SendGifResult): void;
  reject(error: Error): void;
}

const EMPTY: ChatState = { messages: [] };

/** A chat message as the pane shows it: `own` when it was sent as this socket's participant. */
export type ShownChatMessage = ChatMessage & { own?: boolean };

/**
 * A session's chat (spec 002 plan, Frontend — `chat/useChat.ts`). Live sessions get their
 * history from `welcome` and updates over the session socket; a stale session has no socket
 * (close 4410), so its history comes from REST and it is read-only (FR16).
 *
 * Messages sent as the participant this socket joined as (`welcome.you`) come back with
 * `own: true` (spec 012 FR-3), so a returning account sees its earlier messages as its own.
 *
 * `send` resolves when the server answers that send: `ok` on its own `chat_message`, or the
 * refusal code. It rejects if the connection is missing or drops before an answer.
 */
export function useChat({
  invite,
  provider,
  stale,
}: {
  invite: string;
  provider: ChatTransport | null;
  stale: boolean;
}) {
  const [state, setState] = useState<ChatState>(EMPTY);
  const [youId, setYouId] = useState<string | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const me = useMe();
  const canRemove = me.status === "ready" && me.me.signed_in && me.me.roles.includes("admin");

  useEffect(() => {
    if (!stale) return;
    let cancelled = false;
    getChat(invite).then(
      (history) => {
        if (!cancelled) setState((s) => replaceHistory(s, history.messages));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [invite, stale]);

  useEffect(() => {
    if (!provider) return;
    const waiting = pending.current;
    const settle = (clientId: string | undefined, result: SendResult | SendGifResult) => {
      const p = clientId === undefined ? undefined : waiting.get(clientId);
      if (!p || clientId === undefined) return;
      waiting.delete(clientId);
      p.resolve(result);
    };
    const failAll = () => {
      for (const p of waiting.values()) p.reject(new Error("disconnected"));
      waiting.clear();
    };
    const offs = [
      provider.on("welcome", (m) => {
        setYouId(m.you?.participant_id ?? m.participant_id ?? null);
        setState((s) => replaceHistory(s, m.chat ?? []));
      }),
      provider.on("chat_message", (m) => {
        setState((s) => addMessage(s, m.message));
        settle(m.client_id, "ok");
      }),
      provider.on("chat_removed", (m) => setState((s) => removeMessage(s, m.id))),
      provider.on("error", (m) => {
        if (REFUSALS.has(m.code)) settle(m.client_id, m.code as SendResult | SendGifResult);
      }),
      provider.on("closed", failAll),
    ];
    return () => {
      for (const off of offs) off();
      failAll();
    };
  }, [provider]);

  const send = useCallback(
    (text: string): Promise<SendResult> => {
      if (stale) return Promise.resolve("session_stale");
      const refused = chatError(text);
      if (refused) return Promise.resolve(refused);
      if (!provider) return Promise.reject(new Error("not connected"));
      const clientId = crypto.randomUUID();
      const result = new Promise<SendResult>((resolve, reject) => {
        pending.current.set(clientId, {
          resolve: (r) => resolve(r as SendResult),
          reject,
        });
      });
      provider.send({ type: "chat_send", client_id: clientId, text });
      return result;
    },
    [provider, stale],
  );

  /**
   * Posts a GIF by id (spec 007). Only callers with a `GifChatTransport` are given GIF
   * controls (the coding session page); the learning page never calls this.
   */
  const sendGif = useCallback(
    (gifId: string): Promise<SendGifResult> => {
      if (stale) return Promise.resolve("session_stale");
      if (!provider) return Promise.reject(new Error("not connected"));
      const clientId = crypto.randomUUID();
      const result = new Promise<SendGifResult>((resolve, reject) => {
        pending.current.set(clientId, {
          resolve: (r) => resolve(r as SendGifResult),
          reject,
        });
      });
      (provider as GifChatTransport).send({
        type: "chat_send_gif",
        client_id: clientId,
        gif_id: gifId,
      });
      return result;
    },
    [provider, stale],
  );

  const remove = useCallback(
    async (id: number) => {
      await removeChatMessage(invite, id);
      setState((s) => removeMessage(s, id));
    },
    [invite],
  );

  const messages = useMemo<ShownChatMessage[]>(
    () =>
      youId === null
        ? state.messages
        : state.messages.map((m) => (m.participant_id === youId ? { ...m, own: true } : m)),
    [state.messages, youId],
  );

  return { messages, readOnly: stale, canRemove, send, sendGif, remove };
}
