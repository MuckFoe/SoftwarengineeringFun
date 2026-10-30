// Client side of the learning-session WebSocket (spec 006 plan, "WebSocket").
// Text frames only: every frame is one JSON message.

import { WS_CLOSE } from "../api/types";
import { apiPath } from "../base";
import type { ChatEvents, ChatTransport } from "../chat/useChat";
import type { LearnClientMessage, LearnServerMessage } from "./learnTypes";

/** The subset of WebSocket the client uses, so tests can inject a fake socket. */
export interface SocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Why the connection ended (FR-7, FR-8, FR-29). Anything else is `disconnected`. */
export type LearnCloseError = "not_found" | "full" | "stale" | "invalid_name" | "disconnected";

export interface LearnClosedEvent {
  code: number;
  error: LearnCloseError;
}

const CLOSE_ERRORS: Record<number, LearnCloseError> = {
  [WS_CLOSE.notFound]: "not_found",
  [WS_CLOSE.full]: "full",
  [WS_CLOSE.stale]: "stale",
  [WS_CLOSE.invalidName]: "invalid_name",
};

export function learnCloseError(code: number): LearnCloseError {
  return CLOSE_ERRORS[code] ?? "disconnected";
}

/** Server messages by type, plus `closed`. Chat refusals carry the sender's `client_id`. */
export type LearnEvents = {
  [K in LearnServerMessage["type"]]: K extends "error"
    ? Extract<LearnServerMessage, { type: K }> & { client_id?: string }
    : Extract<LearnServerMessage, { type: K }>;
} & { closed: LearnClosedEvent };

/** URL for the learning-session WebSocket, under the app's base path. */
export function learnWsUrl(invite: string, name: string, loc: Location = window.location) {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const path = apiPath(`/learn/sessions/${encodeURIComponent(invite)}/ws`);
  return `${proto}//${loc.host}${path}?name=${encodeURIComponent(name)}`;
}

export interface LearnSocketOptions {
  invite: string;
  name: string;
  createSocket?: SocketFactory;
}

type Handler = (payload: never) => void;

export class LearnSocket implements ChatTransport {
  private readonly socket: SocketLike;
  private readonly handlers = new Map<keyof LearnEvents, Set<Handler>>();
  private open = false;
  private destroyed = false;

  constructor({ invite, name, createSocket = (url) => new WebSocket(url) }: LearnSocketOptions) {
    const socket = createSocket(learnWsUrl(invite, name));
    socket.onopen = () => {
      if (!this.destroyed) this.open = true;
    };
    socket.onmessage = (ev) => this.onMessage(ev.data);
    socket.onclose = (ev) => {
      this.open = false;
      this.emit("closed", { code: ev.code, error: learnCloseError(ev.code) });
    };
    this.socket = socket;
  }

  /** Sends one client message. Dropped while not connected. */
  send(message: LearnClientMessage) {
    if (this.open) this.socket.send(JSON.stringify(message));
  }

  submitChoice(step: number, selected: number[]) {
    this.send({ type: "submit_choice", step, selected });
  }

  submitText(step: number, text: string) {
    this.send({ type: "submit_text", step, text });
  }

  submitCommand(step: number, command: string) {
    this.send({ type: "submit_command", step, command });
  }

  /** `continue` on an explanation step without a check. */
  continueStep(step: number) {
    this.send({ type: "continue", step });
  }

  revealHint(step: number) {
    this.send({ type: "reveal_hint", step });
  }

  showAnswer(step: number) {
    this.send({ type: "show_answer", step });
  }

  /** Subscribes to a server message type or `closed`. Returns an unsubscribe function. */
  on<K extends keyof LearnEvents>(type: K, handler: (payload: LearnEvents[K]) => void): () => void;
  /**
   * The `ChatTransport` view used by `useChat`: its `error` handler is typed with the coding
   * session's codes, but it only acts on the chat refusals, which both sockets share.
   */
  on<K extends keyof ChatEvents>(type: K, handler: (payload: ChatEvents[K]) => void): () => void;
  on(type: keyof LearnEvents, handler: (payload: never) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = handler as Handler;
    set.add(h);
    return () => {
      set.delete(h);
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open = false;
    this.socket.close();
  }

  private emit<K extends keyof LearnEvents>(type: K, payload: LearnEvents[K]) {
    for (const h of this.handlers.get(type) ?? []) (h as (p: LearnEvents[K]) => void)(payload);
  }

  private onMessage(data: unknown) {
    if (typeof data !== "string") return;
    let msg: LearnServerMessage;
    try {
      msg = JSON.parse(data) as LearnServerMessage;
    } catch {
      return;
    }
    if (msg && typeof msg.type === "string") this.emit(msg.type, msg as never);
  }
}
