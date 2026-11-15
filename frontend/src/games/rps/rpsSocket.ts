// Client side of the rps-session WebSocket (spec 021 plan, Contracts — WebSocket).
// chessSocket.ts adapted: rps URL, the same close codes, rejoin key `rps-rejoin:<invite>` (FR-24).

import { apiPath } from "../../base";
import { type ChessCloseError, chessCloseError, type SocketFactory } from "../chess/chessSocket";
import type { RpsClientMessage, RpsServerMessage, Side, Weapon } from "./rpsTypes";

export type { SocketFactory, SocketLike } from "../chess/chessSocket";

/** Terminal reasons the connection ended for good: the same close codes as chess (FR-2). */
export type RpsCloseError = ChessCloseError;

export function rpsCloseError(code: number): RpsCloseError | "disconnected" {
  return chessCloseError(code);
}

export interface RpsClosedEvent {
  code: number;
  error: RpsCloseError;
}

const storageKey = (invite: string) => `rps-rejoin:${invite}`;

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
export function rpsWsUrl(
  invite: string,
  name: string | null,
  rejoin: string | null,
  loc: Location = window.location,
) {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const path = apiPath(`/games/rps/sessions/${encodeURIComponent(invite)}/ws`);
  const params = [
    ...(name === null ? [] : [`name=${encodeURIComponent(name)}`]),
    ...(rejoin ? [`rejoin=${encodeURIComponent(rejoin)}`] : []),
  ];
  return `${proto}//${loc.host}${path}${params.length ? `?${params.join("&")}` : ""}`;
}

export interface RpsSocketOptions {
  invite: string;
  name: string | null;
  /** Receives every server frame, to feed the reducer. */
  dispatch: (message: RpsServerMessage) => void;
  /** Called once when the connection ended for good (no reconnect follows). */
  onClosed?: (event: RpsClosedEvent) => void;
  /** Called with whether the socket is currently connected. */
  onConnection?: (connected: boolean) => void;
  createSocket?: SocketFactory;
}

const BACKOFF_MS = [500, 1000, 2000, 5000, 10000];

export class RpsSocket {
  private socket: ReturnType<SocketFactory> | null = null;
  private open = false;
  private destroyed = false;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly createSocket: SocketFactory;

  constructor(private readonly opts: RpsSocketOptions) {
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url));
    this.connect();
  }

  private connect() {
    const { invite, name } = this.opts;
    const socket = this.createSocket(rpsWsUrl(invite, name, storedRejoin(invite)));
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
      const error = rpsCloseError(ev.code);
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
  send(message: RpsClientMessage) {
    if (this.open) this.socket?.send(JSON.stringify(message));
  }

  takeSeat(side: Side) {
    this.send({ type: "take_seat", side });
  }

  leaveSeat() {
    this.send({ type: "leave_seat" });
  }

  start() {
    this.send({ type: "start" });
  }

  place(what: "flag" | "trap", square: number) {
    this.send({ type: "place", what, square });
  }

  redeal() {
    this.send({ type: "redeal" });
  }

  ready() {
    this.send({ type: "ready" });
  }

  move(from: number, to: number) {
    this.send({ type: "move", from, to });
  }

  duelPick(weapon: Weapon) {
    this.send({ type: "duel_pick", weapon });
  }

  offerDraw() {
    this.send({ type: "offer_draw" });
  }

  answerDraw(accept: boolean) {
    this.send({ type: "answer_draw", accept });
  }

  resign() {
    this.send({ type: "resign" });
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
    let msg: RpsServerMessage;
    try {
      msg = JSON.parse(data) as RpsServerMessage;
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
