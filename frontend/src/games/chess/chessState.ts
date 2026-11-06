import type {
  ChessErrorCode,
  ChessServerMessage,
  ClosedReason,
  Color,
  Snapshot,
  You,
} from "./chessTypes";

export type Role = "white" | "black" | "viewer";

export interface ChessState {
  you: You | null;
  rejoinToken: string | null;
  state: Snapshot | null;
  /** Set once the session ends (resignation, deletion, abandonment). */
  closed: { result: Color | "draw" | null; reason: ClosedReason } | null;
  /** Local only, never sent. */
  selected: string | null;
  flip: boolean;
  error: ChessErrorCode | null;
}

export type ChessLocalAction =
  | { type: "square_selected"; square: string | null }
  | { type: "flip_toggled" };

export type ChessAction = ChessServerMessage | ChessLocalAction;

export const initialChessState: ChessState = {
  you: null,
  rejoinToken: null,
  state: null,
  closed: null,
  selected: null,
  flip: false,
  error: null,
};

export function opposite(color: Color): Color {
  return color === "white" ? "black" : "white";
}

/** The viewer's role, derived from the seats. */
export function roleOf(s: ChessState): Role {
  const id = s.you?.participant_id;
  if (!id || !s.state) return "viewer";
  if (s.state.seats.white?.participant_id === id) return "white";
  if (s.state.seats.black?.participant_id === id) return "black";
  return "viewer";
}

/** The colour drawn at the bottom of the board. */
export function bottomColor(s: ChessState): Color {
  const role = roleOf(s);
  const base: Color = role === "viewer" ? "white" : role;
  return s.flip ? opposite(base) : base;
}

export function chessReducer(s: ChessState, action: ChessAction): ChessState {
  switch (action.type) {
    case "welcome":
      return {
        ...s,
        you: action.you,
        rejoinToken: action.rejoin_token,
        state: action.state,
        selected: null,
        error: null,
      };
    case "state":
      return { ...s, state: action.state, selected: null, error: null };
    case "session_closed":
      return { ...s, closed: { result: action.result, reason: action.reason }, selected: null };
    case "error":
      return { ...s, error: action.code };
    case "square_selected":
      return { ...s, selected: action.square === s.selected ? null : action.square };
    case "flip_toggled":
      return { ...s, flip: !s.flip };
    default:
      return s;
  }
}
