// Spec 021 wire contract (plan.md "Contracts"): the per-recipient state, the events and the
// WebSocket frames. The server filters every payload per recipient (FR-21, FR-22), so a kind
// the recipient may not see arrives as `null`.
import type {
  ChatErrorCode,
  ChatMessageFrame,
  ChatRemovedMessage,
  GifErrorCode,
  GifResultsMessage,
} from "../../api/types";
import type { Person, Seat, You } from "../chess/chessTypes";

export type { Person, Seat, You };

export type Side = "a" | "b";
export type Weapon = "rock" | "paper" | "scissors";
export type Kind = Weapon | "flag" | "trap";
export type Recipient = Side | "viewer";

export type Reason = "flag" | "no_moves" | "resignation" | "abandonment" | "agreement";
export type ClosedReason = Reason | "starter" | "admin";
export type Result = Side | "draw";

/** One piece on the 7×6 board; `square = row * 7 + col`. `kind: null` = hidden to you. */
export interface RpsPiece {
  square: number;
  side: Side;
  kind: Kind | null;
  revealed: boolean;
}

export interface RpsDuel {
  from: number;
  to: number;
  attacker: Side;
  round: number;
  picked: { a: boolean; b: boolean };
  /** Your own pick this round; null for viewers and before you pick (FR-13, FR-21). */
  your_pick: Weapon | null;
  last_round: { a: Weapon; b: Weapon } | null;
}

export interface RpsGame {
  status: "setup" | "play" | "ended";
  ready: { a: boolean; b: boolean };
  first: Side;
  turn: Side | null;
  ply: number;
  pieces: RpsPiece[];
  /** Empty unless it is your move. */
  legal: Record<number, number[]>;
  duel: RpsDuel | null;
  draw_offer_by: Side | null;
  claim_available_to: Side | null;
  result: Result | null;
  reason: Reason | null;
}

export interface RpsState {
  invite_id: string;
  stale: boolean;
  seats: { a: Seat | null; b: Seat | null };
  viewers: Person[];
  you: Recipient;
  game: RpsGame | null;
}

export type RpsEvent =
  | { kind: "moved"; from: number; to: number }
  | {
      kind: "fight";
      from: number;
      to: number;
      attacker: Weapon;
      defender: Weapon;
      winner: "attacker" | "defender";
    }
  | { kind: "duel"; from: number; to: number; weapon: Weapon }
  | {
      kind: "duel_round";
      picks: { a: Weapon; b: Weapon };
      outcome: "again" | "attacker" | "defender";
    }
  | { kind: "trapped"; from: number; to: number; attacker: Weapon | null }
  | { kind: "flag"; from: number; to: number };

/**
 * Codes the server sends in `error` frames. The lifecycle codes are chess's; the rps ones
 * follow the "refused when" column of the plan's frame table.
 */
export type RpsErrorCode =
  | "session_stale"
  | "game_in_progress"
  | "no_game"
  | "seat_taken"
  | "not_seated"
  | "not_a_player"
  | "seats_incomplete"
  | "not_your_turn"
  | "illegal_move"
  | "no_draw_offer"
  | "own_draw_offer"
  | "claim_not_available"
  | "not_starter"
  | "already_ready"
  | "not_home_square"
  | "duel_pending"
  | "no_duel"
  | "already_picked"
  | ChatErrorCode
  | GifErrorCode;

// --- Server -> client -------------------------------------------------------------------

export interface Welcome {
  type: "welcome";
  you: You;
  rejoin_token: string;
  state: RpsState;
}

export interface StateMsg {
  type: "state";
  state: RpsState;
  event?: RpsEvent;
}

export interface SessionClosed {
  type: "session_closed";
  result: Result | null;
  reason: ClosedReason;
}

export interface ErrorMsg {
  type: "error";
  code: RpsErrorCode;
  client_id?: string;
  limit?: number;
  request_id?: string;
  retry_after?: number;
}

export type RpsServerMessage =
  | Welcome
  | StateMsg
  | SessionClosed
  | ErrorMsg
  | ChatMessageFrame
  | ChatRemovedMessage
  | GifResultsMessage;

// --- Client -> server -------------------------------------------------------------------

export type RpsClientMessage =
  | { type: "take_seat"; side: Side }
  | { type: "leave_seat" }
  | { type: "start" }
  | { type: "place"; what: "flag" | "trap"; square: number }
  | { type: "redeal" }
  | { type: "ready" }
  | { type: "move"; from: number; to: number }
  | { type: "duel_pick"; weapon: Weapon }
  | { type: "offer_draw" }
  | { type: "answer_draw"; accept: boolean }
  | { type: "resign" }
  | { type: "claim_win" }
  | { type: "delete_session" };
