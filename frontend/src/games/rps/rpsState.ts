// Spec 021 client state: the reducer over server frames plus local selection, and the
// selectors the session window and board read (plan.md "Frontend", UI notes).
import type {
  ClosedReason,
  Recipient,
  Result,
  RpsErrorCode,
  RpsEvent,
  RpsGame,
  RpsServerMessage,
  RpsState,
  Side,
  You,
} from "./rpsTypes";

export const COLS = 7;
export const ROWS = 6;

export interface Announcement {
  text: string;
  /** Changes with every new announcement, so equal texts in a row still re-render. */
  seq: number;
}

export interface RpsClientState {
  you: You | null;
  rejoinToken: string | null;
  state: RpsState | null;
  closed: { result: Result | null; reason: ClosedReason } | null;
  /** Local only, never sent. */
  selected: number | null;
  error: RpsErrorCode | null;
  /** What the polite live region says for the latest frame; null when nothing new happened. */
  announcement: Announcement | null;
  /** Identifies the last announced event, so a repeated frame is not announced twice. */
  eventKey: string | null;
  /** Counts announcements made, the source of `Announcement.seq`. */
  seq: number;
}

export type RpsLocalAction = { type: "square_selected"; square: number | null };

export type RpsAction = RpsServerMessage | RpsLocalAction;

export const initialRpsClientState: RpsClientState = {
  you: null,
  rejoinToken: null,
  state: null,
  closed: null,
  selected: null,
  error: null,
  announcement: null,
  eventKey: null,
  seq: 0,
};

export function opposite(side: Side): Side {
  return side === "a" ? "b" : "a";
}

/** The reader's role; the server states it per recipient (FR-21). */
export function roleOf(s: RpsClientState): Recipient {
  return s.state?.you ?? "viewer";
}

/** The side drawn at the bottom: your own, or side a for viewers (FR-21). */
export function bottomSide(s: RpsClientState): Side {
  const role = roleOf(s);
  return role === "viewer" ? "a" : role;
}

/** Squares the selected fighter may move to; empty unless it is your move. */
export function targetsOf(s: RpsClientState): number[] {
  if (s.selected === null) return [];
  return s.state?.game?.legal[s.selected] ?? [];
}

export function announcementOf(s: RpsClientState): Announcement | null {
  return s.announcement;
}

/** "C2": columns A–G and rows 1–6 counted from the bottom side's corner. */
export function squareName(square: number, bottom: Side): string {
  const row = Math.floor(square / COLS);
  const col = square % COLS;
  const r = bottom === "a" ? row : ROWS - 1 - row;
  const c = bottom === "a" ? col : COLS - 1 - col;
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

function sideAt(game: RpsGame, square: number): Side | null {
  return game.pieces.find((p) => p.square === square)?.side ?? null;
}

/** "your" / "the opponent's" / "side A's", from the reader's role. */
function owner(side: Side | null, reader: Recipient): string {
  if (side === null) return "a";
  if (reader === "viewer") return `side ${side.toUpperCase()}'s`;
  return side === reader ? "your" : "the opponent's";
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One sentence per event, worded for the reader (NFR-5). */
export function describeEvent(
  event: RpsEvent,
  game: RpsGame,
  prev: RpsGame | null,
  reader: Recipient,
): string {
  const bottom: Side = reader === "viewer" ? "a" : reader;
  const at = (sq: number) => squareName(sq, bottom);
  let text: string;
  switch (event.kind) {
    case "moved":
      text = `${capitalise(owner(sideAt(game, event.to), reader))} fighter moved from ${at(event.from)} to ${at(event.to)}.`;
      break;
    case "fight": {
      const held = sideAt(game, event.to);
      const attacker = held && (event.winner === "attacker" ? held : opposite(held));
      const defender = attacker && opposite(attacker);
      const [winSide, winWeapon, loseSide, loseWeapon] =
        event.winner === "attacker"
          ? [attacker, event.attacker, defender, event.defender]
          : [defender, event.defender, attacker, event.attacker];
      text = `${capitalise(owner(winSide, reader))} ${winWeapon} beat ${owner(loseSide, reader)} ${loseWeapon} at ${at(event.to)}.`;
      break;
    }
    case "duel":
      text = `Duel at ${at(event.to)}: both fighters are ${event.weapon}.`;
      if (reader !== "viewer") text += " Pick a weapon.";
      break;
    case "duel_round": {
      if (event.outcome === "again") {
        text = `Duel tied: both picked ${event.picks.a}.`;
        if (reader !== "viewer") text += " Pick again.";
        break;
      }
      const attacker = game.duel?.attacker ?? prev?.duel?.attacker ?? null;
      const winSide = attacker && (event.outcome === "attacker" ? attacker : opposite(attacker));
      if (winSide === null) {
        text = `${capitalise(event.outcome)} won the duel.`;
        break;
      }
      const loseSide = opposite(winSide);
      text = `${capitalise(owner(winSide, reader))} ${event.picks[winSide]} beat ${owner(loseSide, reader)} ${event.picks[loseSide]} and won the duel.`;
      break;
    }
    case "trapped": {
      const trapSide = sideAt(game, event.to);
      if (event.attacker === null) {
        // FR-15, FR-22: the trap's owner learns only that a hidden fighter fell in.
        text = `A hidden fighter fell into your trap at ${at(event.to)}.`;
        break;
      }
      text = `${capitalise(owner(trapSide && opposite(trapSide), reader))} ${event.attacker} was caught by a trap at ${at(event.to)}.`;
      break;
    }
    case "flag": {
      const flagSide = sideAt(game, event.to);
      text = `${capitalise(owner(flagSide && opposite(flagSide), reader))} fighter took ${owner(flagSide, reader)} flag at ${at(event.to)}.`;
      break;
    }
  }
  return text;
}

function eventKeyOf(event: RpsEvent, game: RpsGame | null): string {
  return JSON.stringify([event, game?.ply ?? null, game?.duel?.round ?? null]);
}

export function rpsReducer(s: RpsClientState, action: RpsAction): RpsClientState {
  switch (action.type) {
    case "welcome":
      return {
        ...s,
        you: action.you,
        rejoinToken: action.rejoin_token,
        state: action.state,
        selected: null,
        error: null,
        announcement: null,
        eventKey: null,
      };
    case "state": {
      const base = { ...s, state: action.state, selected: null, error: null };
      const game = action.state.game;
      if (!action.event || !game) return { ...base, announcement: null };
      const key = eventKeyOf(action.event, game);
      if (key === s.eventKey) return { ...base, announcement: null };
      const text = describeEvent(action.event, game, s.state?.game ?? null, action.state.you);
      return {
        ...base,
        eventKey: key,
        seq: s.seq + 1,
        announcement: { text, seq: s.seq + 1 },
      };
    }
    case "session_closed":
      return { ...s, closed: { result: action.result, reason: action.reason }, selected: null };
    case "error":
      return { ...s, error: action.code };
    case "square_selected":
      return { ...s, selected: action.square === s.selected ? null : action.square };
    default:
      return s;
  }
}
