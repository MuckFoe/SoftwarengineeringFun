// Client side of the presentation-session WebSocket (spec 013 plan, Contracts — WebSocket).
// Text frames only: every frame is one JSON message.

import { WS_CLOSE } from "../api/types";
import { apiPath } from "../base";
import type { GifSearchEvents, GifSearchTransport } from "../chat/gifs/useGifSearch";
import type { ChatEvents, GifChatTransport } from "../chat/useChat";
import type { Anchor, PresentClientMessage, PresentServerMessage } from "./presentTypes";

/** The subset of WebSocket the client uses, so tests can inject a fake socket. */
export interface SocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Why the connection ended. Anything not listed is `disconnected`. */
export type PresentCloseError =
  | "not_found"
  | "full"
  | "stale"
  | "invalid_name"
  | "replaced"
  | "disconnected";

export interface PresentClosedEvent {
  code: number;
  error: PresentCloseError;
}

/** Close code for a connection replaced by a newer one of the same participant. */
export const WS_CLOSE_REPLACED = WS_CLOSE.replaced;

const CLOSE_ERRORS: Record<number, PresentCloseError> = {
  [WS_CLOSE.notFound]: "not_found",
  [WS_CLOSE.full]: "full",
  [WS_CLOSE.stale]: "stale",
  [WS_CLOSE.invalidName]: "invalid_name",
  [WS_CLOSE_REPLACED]: "replaced",
};

export function presentCloseError(code: number): PresentCloseError {
  return CLOSE_ERRORS[code] ?? "disconnected";
}

/** Server messages by type, plus `closed`. */
export type PresentEvents = {
  [K in PresentServerMessage["type"]]: Extract<PresentServerMessage, { type: K }>;
} & { closed: PresentClosedEvent };

/** Who this browser is in a session: kept so a reload or reconnect rejoins as the same one. */
export interface StoredIdentity {
  name: string;
  rejoin_token: string;
}

const storageKey = (invite: string) => `present:${invite}`;

/** The identity stored for `invite`, or null if there is none (or it is unreadable). */
export function storedIdentity(invite: string): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(storageKey(invite));
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<StoredIdentity> | null;
    if (typeof value?.name !== "string" || typeof value.rejoin_token !== "string") return null;
    return { name: value.name, rejoin_token: value.rejoin_token };
  } catch {
    return null;
  }
}

function storeIdentity(invite: string, identity: StoredIdentity) {
  try {
    localStorage.setItem(storageKey(invite), JSON.stringify(identity));
  } catch {
    // Storage full or blocked: the session still works, it just can't be rejoined.
  }
}

/**
 * URL for the presentation WebSocket, under the app's base path. `name` is null for a
 * signed-in user: the server names them after their account (spec 012 FR-1).
 */
export function presentWsUrl(
  invite: string,
  name: string | null,
  rejoin: string | null,
  loc: Location = window.location,
) {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const path = apiPath(`/present/sessions/${encodeURIComponent(invite)}/ws`);
  const params = [
    ...(name === null ? [] : [`name=${encodeURIComponent(name)}`]),
    ...(rejoin ? [`rejoin=${encodeURIComponent(rejoin)}`] : []),
  ];
  return `${proto}//${loc.host}${path}${params.length ? `?${params.join("&")}` : ""}`;
}

export interface PresentSocketOptions {
  invite: string;
  /** Null when signed in: the account is the identity (spec 012 FR-1). */
  name: string | null;
  /** Rejoin token; defaults to the one stored for `invite`. */
  rejoin?: string | null;
  createSocket?: SocketFactory;
}

type Handler = (payload: never) => void;

export class PresentSocket implements GifChatTransport, GifSearchTransport {
  private readonly socket: SocketLike;
  private readonly handlers = new Map<keyof PresentEvents, Set<Handler>>();
  private open = false;
  private destroyed = false;

  constructor({
    invite,
    name,
    rejoin = storedIdentity(invite)?.rejoin_token ?? null,
    createSocket = (url) => new WebSocket(url),
  }: PresentSocketOptions) {
    const socket = createSocket(presentWsUrl(invite, name, rejoin));
    socket.onopen = () => {
      if (!this.destroyed) this.open = true;
    };
    socket.onmessage = (ev) => this.onMessage(invite, ev.data);
    socket.onclose = (ev) => {
      this.open = false;
      this.emit("closed", { code: ev.code, error: presentCloseError(ev.code) });
    };
    this.socket = socket;
  }

  /** Sends one client message. Dropped while not connected. */
  send(message: PresentClientMessage) {
    if (this.open) this.socket.send(JSON.stringify(message));
  }

  /** Host: move everyone to `slide` (null on a single page) and `anchor`. */
  place(slide: number | null, anchor: Anchor | null) {
    this.send({ type: "place", slide, anchor });
  }

  /** Host: the pointer over the content, or null when it left the frame. */
  pointer(anchor: Anchor | null) {
    this.send({ type: "pointer", anchor });
  }

  handOver(participantId: string) {
    this.send({ type: "hand_over", participant_id: participantId });
  }

  strokeStart(id: string, anchor: Anchor | null, points: [number, number][]) {
    this.send({ type: "stroke_start", id, anchor, points });
  }

  strokePoints(id: string, points: [number, number][]) {
    this.send({ type: "stroke_points", id, points });
  }

  clearDrawings() {
    this.send({ type: "clear_drawings" });
  }

  /** Subscribes to a server message type or `closed`. Returns an unsubscribe function. */
  on<K extends keyof PresentEvents>(
    type: K,
    handler: (payload: PresentEvents[K]) => void,
  ): () => void;
  /**
   * The `ChatTransport` view used by `useChat`: its `error` handler is typed with the coding
   * session's codes, but it only acts on the chat refusals, which both sockets share.
   */
  on<K extends keyof ChatEvents>(type: K, handler: (payload: ChatEvents[K]) => void): () => void;
  /** The `GifSearchTransport` view used by `useGifSearch`. */
  on<K extends keyof GifSearchEvents>(
    type: K,
    handler: (payload: GifSearchEvents[K]) => void,
  ): () => void;
  on(type: keyof PresentEvents, handler: (payload: never) => void): () => void {
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

  private emit<K extends keyof PresentEvents>(type: K, payload: PresentEvents[K]) {
    for (const h of this.handlers.get(type) ?? []) (h as (p: PresentEvents[K]) => void)(payload);
  }

  private onMessage(invite: string, data: unknown) {
    if (typeof data !== "string") return;
    let msg: PresentServerMessage;
    try {
      msg = JSON.parse(data) as PresentServerMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    if (msg.type === "welcome" && typeof msg.you?.rejoin_token === "string") {
      storeIdentity(invite, { name: msg.you.name, rejoin_token: msg.you.rejoin_token });
    }
    this.emit(msg.type, msg as never);
  }
}
