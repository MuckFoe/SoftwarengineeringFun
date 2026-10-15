// Client side of the session WebSocket (plan "Live editing" and "WebSocket contract").
// Binary frames carry the y-websocket protocol; text frames carry JSON messages.

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { sessionWsUrl } from "../api/client";
import { type ClientMessage, type ServerMessage, WS_CLOSE } from "../api/types";

export const messageSync = 0;
export const messageAwareness = 1;

/** The subset of WebSocket the provider uses, so tests can inject in-memory sockets. */
export interface SocketLike {
  binaryType: BinaryType;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  send(data: string | BufferSource): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Why the connection ended. Anything without a contract close code is `disconnected`. */
export type CloseError = "session_full" | "not_found" | "stale" | "invalid_name" | "disconnected";

export interface ClosedEvent {
  code: number;
  error: CloseError;
}

const CLOSE_ERRORS: Record<number, CloseError> = {
  [WS_CLOSE.full]: "session_full",
  [WS_CLOSE.notFound]: "not_found",
  [WS_CLOSE.stale]: "stale",
  [WS_CLOSE.invalidName]: "invalid_name",
};

export function closeError(code: number): CloseError {
  return CLOSE_ERRORS[code] ?? "disconnected";
}

export type ProviderEvents = {
  [K in ServerMessage["type"]]: Extract<ServerMessage, { type: K }>;
} & { closed: ClosedEvent };

export interface ProviderOptions {
  inviteId: string;
  name: string;
  createSocket?: SocketFactory;
}

type Handler = (payload: never) => void;

export class CollabProvider {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  private readonly socket: SocketLike;
  private readonly handlers = new Map<keyof ProviderEvents, Set<Handler>>();
  private open = false;
  private destroyed = false;

  constructor({ inviteId, name, createSocket = (url) => new WebSocket(url) }: ProviderOptions) {
    this.awareness.setLocalStateField("user", { name });
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);

    const socket = createSocket(sessionWsUrl(inviteId, name));
    socket.binaryType = "arraybuffer";
    socket.onopen = () => this.onOpen();
    socket.onmessage = (ev) => this.onMessage(ev.data);
    socket.onclose = (ev) => this.onClose(ev.code);
    this.socket = socket;
  }

  /** Sends a JSON control message (run, switch_problem). Dropped while not connected. */
  send(message: ClientMessage) {
    if (this.open) this.socket.send(JSON.stringify(message));
  }

  /** Subscribes to a server message type or `closed`. Returns an unsubscribe function. */
  on<K extends keyof ProviderEvents>(type: K, handler: (payload: ProviderEvents[K]) => void) {
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
    removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.open = false;
    this.socket.close();
    this.awareness.destroy();
    this.doc.destroy();
  }

  private emit<K extends keyof ProviderEvents>(type: K, payload: ProviderEvents[K]) {
    for (const h of this.handlers.get(type) ?? []) (h as (p: ProviderEvents[K]) => void)(payload);
  }

  private sendBinary(encoder: encoding.Encoder) {
    if (this.open) this.socket.send(encoding.toUint8Array(encoder));
  }

  private onOpen() {
    if (this.destroyed) return;
    this.open = true;
    const sync = encoding.createEncoder();
    encoding.writeVarUint(sync, messageSync);
    syncProtocol.writeSyncStep1(sync, this.doc);
    this.sendBinary(sync);
    this.sendAwareness([this.doc.clientID]);
  }

  private onMessage(data: unknown) {
    if (typeof data === "string") {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data) as ServerMessage;
      } catch {
        return;
      }
      if (msg && typeof msg.type === "string") this.emit(msg.type, msg as never);
      return;
    }
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data))
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else return;

    const decoder = decoding.createDecoder(bytes);
    switch (decoding.readVarUint(decoder)) {
      case messageSync: {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, messageSync);
        syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
        if (encoding.length(reply) > 1) this.sendBinary(reply);
        break;
      }
      case messageAwareness:
        applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
        break;
    }
  }

  private onClose(code: number) {
    this.open = false;
    // Peers' cursors are stale once we are disconnected.
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    removeAwarenessStates(this.awareness, others, this);
    this.emit("closed", { code, error: closeError(code) });
  }

  private sendAwareness(clients: number[]) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, messageAwareness);
    encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(this.awareness, clients));
    this.sendBinary(enc);
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, messageSync);
    syncProtocol.writeUpdate(enc, update);
    this.sendBinary(enc);
  };

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    this.sendAwareness([...added, ...updated, ...removed]);
  };
}
