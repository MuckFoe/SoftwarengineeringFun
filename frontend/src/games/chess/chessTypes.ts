// Spec 014 wire contract (plan.md "Contracts"): the snapshot and the WebSocket frames.
import type {
  ChatErrorCode,
  ChatMessageFrame,
  ChatRemovedMessage,
  GifErrorCode,
  GifResultsMessage,
} from "../../api/types";

export type Color = "white" | "black";

export type Reason =
  | "checkmate"
  | "resignation"
  | "abandonment"
  | "agreement"
  | "stalemate"
  | "insufficient_material"
  | "threefold_repetition"
  | "fifty_moves";

export type ClosedReason = Reason | "starter" | "admin";

export type PromotionPiece = "q" | "r" | "b" | "n";

export interface Person {
  participant_id: string;
  name: string;
  signed_in: boolean;
}

export interface Seat extends Person {
  away: boolean;
}

export interface You {
  participant_id: string;
  is_starter: boolean;
}

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
}

export interface Game {
  status: "in_progress" | "ended";
  fen: string;
  turn: Color;
  ply: number;
  moves: MoveRecord[];
  last_move: { from: string; to: string } | null;
  check_square: string | null;
  legal: Record<string, string[]>;
  promotions: string[];
  draw_offer_by: Color | null;
  claim_available_to: Color | null;
  result: Color | "draw" | null;
  reason: Reason | null;
}

export interface Snapshot {
  invite_id: string;
  stale: boolean;
  seats: { white: Seat | null; black: Seat | null };
  viewers: Person[];
  game: Game | null;
}

export type ChessErrorCode =
  | "session_stale"
  | "game_in_progress"
  | "no_game"
  | "seat_taken"
  | "not_seated"
  | "not_a_player"
  | "seats_incomplete"
  | "not_your_turn"
  | "illegal_move"
  | "promotion_required"
  | "out_of_date"
  | "no_draw_offer"
  | "own_draw_offer"
  | "claim_not_available"
  | "not_starter"
  | ChatErrorCode
  | GifErrorCode;

// --- Server -> client -------------------------------------------------------------------

export interface Welcome {
  type: "welcome";
  you: You;
  rejoin_token: string;
  state: Snapshot;
}

export interface StateMsg {
  type: "state";
  state: Snapshot;
}

export interface SessionClosed {
  type: "session_closed";
  result: Color | "draw" | null;
  reason: ClosedReason;
}

export interface ErrorMsg {
  type: "error";
  code: ChessErrorCode;
  client_id?: string;
  limit?: number;
  request_id?: string;
  retry_after?: number;
}

export type ChessServerMessage =
  | Welcome
  | StateMsg
  | SessionClosed
  | ErrorMsg
  | ChatMessageFrame
  | ChatRemovedMessage
  | GifResultsMessage;

// --- Client -> server -------------------------------------------------------------------

export type ChessClientMessage =
  | { type: "take_seat"; color: Color }
  | { type: "leave_seat" }
  | { type: "start" }
  | { type: "move"; from: string; to: string; promotion?: PromotionPiece; ply: number }
  | { type: "resign" }
  | { type: "offer_draw" }
  | { type: "answer_draw"; accept: boolean }
  | { type: "claim_win" }
  | { type: "delete_session" };
