"""The secrecy filter (spec 021 plan Decision 2): the full stored state plus a recipient in, only
what that recipient may see out. FR-7, FR-13, FR-15, FR-20, FR-21, FR-22, FR-23, NFR-1.

Every outgoing game payload (welcome, state, event, home tile, profile list) is built here; no
other module builds board JSON. Pure: imports nothing from the app but `rules`.

Rules, in one place:
- a player sees their own pieces in full, and of the opponent only revealed fighters; the
  opponent's flag and trap are always `kind: null` (FR-21, FR-15). In setup no opponent piece
  is revealed, so the opponent's 14 squares are all alike (FR-7);
- a viewer sees every kind at all times (FR-21); after the game ends, so does everyone (FR-20);
- in a duel a player gets only their own current pick, nobody else gets any current pick, and
  everyone gets the previous tied round (FR-13, FR-21, FR-22);
- `legal` goes only to the side to move, and to nobody while a duel waits (FR-9);
- the tile preview shows only what both players see: revealed fighters (FR-25, NFR-1).

The recipient is the role in the current game, worked out per message by the caller, so a
participant who switches from viewer to player gets a player's view from then on (FR-23).
"""

from dataclasses import dataclass
from typing import Literal

from app.games.rps.rules import SQUARES, WEAPONS, Board, Piece, Side, Weapon, Winner, legal_moves

Recipient = Literal["a", "b", "viewer"]
Status = Literal["setup", "play", "ended"]


@dataclass(frozen=True)
class Person:
    participant_id: str
    name: str
    signed_in: bool


@dataclass(frozen=True)
class Seat(Person):
    away: bool


@dataclass(frozen=True)
class DuelState:
    """The pending `rps_duel` row: current picks and the previous, tied round's picks."""

    frm: int
    to: int
    attacker: Side
    round: int
    a_pick: Weapon | None
    b_pick: Weapon | None
    last_a_pick: Weapon | None
    last_b_pick: Weapon | None


@dataclass(frozen=True)
class GameState:
    status: Status
    a_ready: bool
    b_ready: bool
    first: Side
    turn: Side | None
    ply: int
    board: Board
    duel: DuelState | None
    draw_offer_by: Side | None
    claim_available_to: Side | None
    result: str | None  # "a", "b" or "draw"
    reason: str | None


@dataclass(frozen=True)
class FullState:
    """Everything stored about a session, unfiltered (built by `service.snapshot`)."""

    invite_id: str
    stale: bool
    seat_a: Seat | None
    seat_b: Seat | None
    viewers: tuple[Person, ...]
    game: GameState | None


# --- raw events: transient, sent once with the state that follows the action -----------------


@dataclass(frozen=True)
class MovedEvent:
    frm: int
    to: int


@dataclass(frozen=True)
class FightEvent:
    frm: int
    to: int
    attacker: Weapon
    defender: Weapon
    winner: Winner


@dataclass(frozen=True)
class DuelEvent:
    """A tie between two fighters of `weapon`: picking starts."""

    frm: int
    to: int
    weapon: Weapon


@dataclass(frozen=True)
class DuelRoundEvent:
    """Both picks of a round are in; `outcome` "again" means a tie and another round."""

    a_pick: Weapon
    b_pick: Weapon
    outcome: Literal["again", "attacker", "defender"]


@dataclass(frozen=True)
class TrappedEvent:
    """`side` attacked; only that side and viewers learn the fallen fighter's weapon."""

    frm: int
    to: int
    attacker: Weapon
    side: Side


@dataclass(frozen=True)
class FlagEvent:
    frm: int
    to: int


RawEvent = MovedEvent | FightEvent | DuelEvent | DuelRoundEvent | TrappedEvent | FlagEvent


# --- filtering --------------------------------------------------------------------------------


def _kind_for(piece: Piece, recipient: Recipient, status: Status) -> str | None:
    if recipient == "viewer" or status == "ended" or piece.side == recipient:
        return piece.kind
    if piece.revealed and piece.kind in WEAPONS:
        return piece.kind
    return None


def _person(p: Person) -> dict:
    return {"participant_id": p.participant_id, "name": p.name, "signed_in": p.signed_in}


def _seat(s: Seat | None) -> dict | None:
    return None if s is None else {**_person(s), "away": s.away}


def _duel(duel: DuelState | None, recipient: Recipient) -> dict | None:
    if duel is None:
        return None
    your_pick = {"a": duel.a_pick, "b": duel.b_pick}.get(recipient)
    last = None
    if duel.last_a_pick is not None and duel.last_b_pick is not None:
        last = {"a": duel.last_a_pick, "b": duel.last_b_pick}
    return {
        "from": duel.frm,
        "to": duel.to,
        "attacker": duel.attacker,
        "round": duel.round,
        "picked": {"a": duel.a_pick is not None, "b": duel.b_pick is not None},
        "your_pick": your_pick,
        "last_round": last,
    }


def _legal(game: GameState, recipient: Recipient) -> dict[int, list[int]]:
    if game.status != "play" or game.duel is not None or game.turn != recipient:
        return {}
    return legal_moves(game.board, game.turn)


def _game(game: GameState, recipient: Recipient) -> dict:
    return {
        "status": game.status,
        "ready": {"a": game.a_ready, "b": game.b_ready},
        "first": game.first,
        "turn": game.turn,
        "ply": game.ply,
        "pieces": [
            {
                "square": sq,
                "side": piece.side,
                "kind": _kind_for(piece, recipient, game.status),
                "revealed": piece.revealed,
            }
            for sq, piece in sorted(game.board.items())
        ],
        "legal": _legal(game, recipient),
        "duel": _duel(game.duel, recipient),
        "draw_offer_by": game.draw_offer_by,
        "claim_available_to": game.claim_available_to,
        "result": game.result,
        "reason": game.reason,
    }


def state_for(full: FullState, recipient: Recipient) -> dict:
    """The `state` payload for one recipient (plan "Contracts", `RpsState`)."""
    return {
        "invite_id": full.invite_id,
        "stale": full.stale,
        "seats": {"a": _seat(full.seat_a), "b": _seat(full.seat_b)},
        "viewers": [_person(p) for p in full.viewers],
        "you": recipient,
        "game": None if full.game is None else _game(full.game, recipient),
    }


def event_for(event: RawEvent, recipient: Recipient) -> dict | None:
    """The wire event for one recipient, or None if they get none. Every event goes to
    everyone: fights reveal both weapons (FR-12), duel picks go out once both are in (FR-13,
    FR-21), and a trap catching a fighter is shown to both players and viewers (FR-15), with
    the fighter's weapon withheld from the trap's owner."""
    match event:
        case MovedEvent(frm, to):
            return {"kind": "moved", "from": frm, "to": to}
        case FightEvent(frm, to, attacker, defender, winner):
            return {
                "kind": "fight",
                "from": frm,
                "to": to,
                "attacker": attacker,
                "defender": defender,
                "winner": winner,
            }
        case DuelEvent(frm, to, weapon):
            return {"kind": "duel", "from": frm, "to": to, "weapon": weapon}
        case DuelRoundEvent(a_pick, b_pick, outcome):
            return {"kind": "duel_round", "picks": {"a": a_pick, "b": b_pick}, "outcome": outcome}
        case TrappedEvent(frm, to, attacker, side):
            # FR-15, FR-22: the trap's owner learns only that a hidden fighter fell in.
            shown = attacker if recipient in (side, "viewer") else None
            return {"kind": "trapped", "from": frm, "to": to, "attacker": shown}
        case FlagEvent(frm, to):
            return {"kind": "flag", "from": frm, "to": to}
    return None


def tile_board(full: FullState) -> list[dict | None]:
    """The 42-cell home tile preview: what both players see, i.e. kinds of revealed fighters
    only, in any phase and for any requester (FR-25, NFR-1). `None` is an empty square."""
    cells: list[dict | None] = [None] * SQUARES
    if full.game is None:
        return cells
    for sq, piece in full.game.board.items():
        kind = piece.kind if piece.revealed and piece.kind in WEAPONS else None
        cells[sq] = {"side": piece.side, "kind": kind}
    return cells
