// Client side of the chess-session WebSocket (spec 014 plan, Contracts — WebSocket).
// Pattern of present/presentSocket.ts, plus reconnection with the stored rejoin token (FR-28).

import { WS_CLOSE } from "../../api/types";
import { apiPath } from "../../base";
import type { ChessClientMessage, ChessServerMessage, Color, PromotionPiece } from "./chessTypes";

/** The subset of WebSocket the client uses, so tests can inject a fake socket. */
export interface SocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Terminal reasons the connection ended for good. Anything else is `disconnected`. */
export type ChessCloseError = "not_found" | "full" | "deleted" | "invalid_name" | "replaced";

/** Close code for a deleted session (plan: 4411). */
export const WS_CLOSE_DELETED = 4411;

const TERMINAL: Record<number, ChessCloseError> = {
  [WS_CLOSE.notFound]: "not_found",
  [WS_CLOSE.full]: "full",
  [WS_CLOSE_DELETED]: "deleted",
  [WS_CLOSE.invalidName]: "invalid_name",
  [WS_CLOSE.replaced]: "replaced",
};

export function chessCloseError(code: number): ChessCloseError | "disconnected" {
  return TERMINAL[code] ?? "disconnected";
}

export interface ChessClosedEvent {
  code: number;
  error: ChessCloseError;
}

const storageKey = (invite: string) => `chess:${invite}`;

/** The rejoin token stored for `invite`, or null. */
export function storedRejoin(invite: string): string | null {
  try {
    return localStorage.getItem(storageKey(invite));
  } catch {
    return null;
  }
}

function storeRejoin(invite: string, token: string) {
  try {
    localStorage.setItem(storageKey(invite), token);
  } catch {
    // Storage blocked: the session works, it just can't be rejoined.
  }
}

/** `name` is null for a signed-in user: the server names them after their account. */
export function chessWsUrl(
  invite: string,
  name: string | null,
  rejoin: string | null,
  loc: Location = window.location,
) {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const path = apiPath(`/games/chess/sessions/${encodeURIComponent(invite)}/ws`);
  const params = [
    ...(name === null ? [] : [`name=${encodeURIComponent(name)}`]),
    ...(rejoin ? [`rejoin=${encodeURIComponent(rejoin)}`] : []),
  ];
  return `${proto}//${loc.host}${path}${params.length ? `?${params.join("&")}` : ""}`;
}

export interface ChessSocketOptions {
  invite: string;
  name: string | null;
  /** Receives every server frame, to feed the reducer. */
  dispatch: (message: ChessServerMessage) => void;
  /** Called once when the connection ended for good (no reconnect follows). */
  onClosed?: (event: ChessClosedEvent) => void;
  /** Called with whether the socket is currently connected. */
  onConnection?: (connected: boolean) => void;
  createSocket?: SocketFactory;
}

const BACKOFF_MS = [500, 1000, 2000, 5000, 10000];

export class ChessSocket {
  private socket: SocketLike | null = null;
  private open = false;
  private destroyed = false;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly createSocket: SocketFactory;

  constructor(private readonly opts: ChessSocketOptions) {
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url));
    this.connect();
  }

  private connect() {
    const { invite, name } = this.opts;
    const socket = this.createSocket(chessWsUrl(invite, name, storedRejoin(invite)));
    socket.onopen = () => {
      if (this.destroyed) return;
      this.open = true;
      this.attempts = 0;
      this.opts.onConnection?.(true);
    };
    socket.onmessage = (ev) => this.onMessage(ev.data);
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      const wasOpen = this.open;
      this.open = false;
      if (this.destroyed) return;
      const error = chessCloseError(ev.code);
      if (error !== "disconnected") {
        this.opts.onClosed?.({ code: ev.code, error });
        return;
      }
      if (wasOpen) this.opts.onConnection?.(false);
      const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)];
      this.attempts += 1;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.destroyed) this.connect();
      }, delay);
    };
    this.socket = socket;
  }

  /** Sends one client message. Dropped while not connected. */
  send(message: ChessClientMessage) {
    if (this.open) this.socket?.send(JSON.stringify(message));
  }

  takeSeat(color: Color) {
    this.send({ type: "take_seat", color });
  }

  leaveSeat() {
    this.send({ type: "leave_seat" });
  }

  start() {
    this.send({ type: "start" });
  }

  /** `ply` is the number of moves the sender has seen; a stale one is refused. */
  move(from: string, to: string, ply: number, promotion?: PromotionPiece) {
    this.send({ type: "move", from, to, ...(promotion ? { promotion } : {}), ply });
  }

  resign() {
    this.send({ type: "resign" });
  }

  offerDraw() {
    this.send({ type: "offer_draw" });
  }

  answerDraw(accept: boolean) {
    this.send({ type: "answer_draw", accept });
  }

  claimWin() {
    this.send({ type: "claim_win" });
  }

  deleteSession() {
    this.send({ type: "delete_session" });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.socket?.close();
  }

  private onMessage(data: unknown) {
    if (typeof data !== "string") return;
    let msg: ChessServerMessage;
    try {
      msg = JSON.parse(data) as ChessServerMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    if (msg.type === "welcome" && typeof msg.rejoin_token === "string") {
      storeRejoin(this.opts.invite, msg.rejoin_token);
    }
    this.opts.dispatch(msg);
  }
}
