import { useCallback, useEffect, useRef, useState } from "react";
import { getChat, removeChatMessage } from "../api/client";
import type {
  ChatErrorCode,
  ChatMessageFrame,
  ChatRemovedMessage,
  ChatSendMessage,
  ErrorMessage,
  WelcomeMessage,
} from "../api/types";
import { useMe } from "../auth/useMe";
import { chatError } from "./chatRules";
import { addMessage, type ChatState, removeMessage, replaceHistory } from "./chatState";

export type SendResult = "ok" | ChatErrorCode;

/** The messages useChat listens to, with only the fields it reads. */
export type ChatEvents = {
  welcome: Pick<WelcomeMessage, "chat">;
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

interface Pending {
  resolve(result: SendResult): void;
  reject(error: Error): void;
}

const EMPTY: ChatState = { messages: [] };

/**
 * A session's chat (spec 002 plan, Frontend — `chat/useChat.ts`). Live sessions get their
 * history from `welcome` and updates over the session socket; a stale session has no socket
 * (close 4410), so its history comes from REST and it is read-only (FR16).
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
  const pending = useRef(new Map<string, Pending>());
  const me = useMe();
  const canRemove = me.status === "ready" && me.me.roles.includes("admin");

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
    const settle = (clientId: string | undefined, result: SendResult) => {
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
      provider.on("welcome", (m) => setState((s) => replaceHistory(s, m.chat ?? []))),
      provider.on("chat_message", (m) => {
        setState((s) => addMessage(s, m.message));
        settle(m.client_id, "ok");
      }),
      provider.on("chat_removed", (m) => setState((s) => removeMessage(s, m.id))),
      provider.on("error", (m) => {
        if (m.code === "chat_empty" || m.code === "chat_too_long" || m.code === "session_stale") {
          settle(m.client_id, m.code);
        }
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
        pending.current.set(clientId, { resolve, reject });
      });
      provider.send({ type: "chat_send", client_id: clientId, text });
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

  return { messages: state.messages, readOnly: stale, canRemove, send, remove };
}
