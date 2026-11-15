"""Pure Rock Paper Siege rules: board, deal, re-deal, place, first mover, moves, fights, duels,
traps and the flag. No `app` imports.

Board coordinates: col 0-6, row 0-5, `square = row * 7 + col`. Side `a` owns rows 0-1, side `b`
rows 4-5. Randomness comes only from the `random.Random` the caller passes in.
"""

import random
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, cast

Side = Literal["a", "b"]
Weapon = Literal["rock", "paper", "scissors"]
Kind = Literal["rock", "paper", "scissors", "flag", "trap"]

COLS = 7
ROWS = 6
SQUARES = COLS * ROWS
WEAPONS: tuple[Weapon, ...] = ("rock", "paper", "scissors")
_FIGHTERS: tuple[Weapon, ...] = WEAPONS * 4  # 4 rock, 4 paper, 4 scissors (FR-4)
_HOME_ROWS: dict[str, tuple[int, int]] = {"a": (0, 1), "b": (4, 5)}


@dataclass(frozen=True)
class Piece:
    side: Side
    kind: Kind
    revealed: bool = False


Board = Mapping[int, Piece]  # square -> piece


@dataclass(frozen=True)
class PrevGame:
    """Who sat where in the previous game of the session, and which side moved first."""

    first_side: Side
    a_pid: object
    b_pid: object


class Illegal(Exception):
    """A refused action; `code` names why. Raised by setup rules, returned by `resolve_move`."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


Winner = Literal["attacker", "defender"]


@dataclass(frozen=True)
class Moved:
    """A fighter stepped onto an empty square (FR-9, FR-11)."""

    frm: int
    to: int


@dataclass(frozen=True)
class Fought:
    """A fight between two fighters was decided, directly or by a duel (FR-12, FR-14)."""

    frm: int
    to: int
    winner: Winner


@dataclass(frozen=True)
class DuelStarted:
    """Two fighters with the same weapon met; both players must pick (FR-13)."""

    frm: int
    to: int


@dataclass(frozen=True)
class Trapped:
    """A fighter attacked the enemy trap and is removed (FR-15)."""

    frm: int
    to: int


@dataclass(frozen=True)
class FlagTaken:
    """A fighter attacked the enemy flag; the attacker wins the game (FR-16)."""

    frm: int
    to: int


MoveOutcome = Moved | Fought | DuelStarted | Trapped | FlagTaken | Illegal


def home_squares(side: Side) -> list[int]:
    """The 14 squares of a side's two home rows, ascending."""
    return [row * COLS + col for row in _HOME_ROWS[side] for col in range(COLS)]


def _fighters_onto(squares: list[int], side: Side, rng: random.Random) -> dict[int, Piece]:
    weapons = list(_FIGHTERS)
    rng.shuffle(weapons)
    return {sq: Piece(side, kind) for sq, kind in zip(sorted(squares), weapons, strict=True)}


def deal(side: Side, flag: int, trap: int, rng: random.Random) -> dict[int, Piece]:
    """A side's 14 setup pieces: flag and trap where given, 12 fighters dealt at random (FR-4)."""
    home = home_squares(side)
    if flag not in home or trap not in home or flag == trap:
        raise Illegal("not_home_square")
    rest = [sq for sq in home if sq not in (flag, trap)]
    return {flag: Piece(side, "flag"), trap: Piece(side, "trap"), **_fighters_onto(rest, side, rng)}


def redeal(board: Board, side: Side, rng: random.Random) -> dict[int, Piece]:
    """The board with `side`'s fighters dealt again; flag and trap stay where they are (FR-5)."""
    squares = [sq for sq, p in board.items() if p.side == side and p.kind in WEAPONS]
    return {**board, **_fighters_onto(squares, side, rng)}


def place(board: Board, side: Side, what: Literal["flag", "trap"], square: int) -> dict[int, Piece]:
    """Move `side`'s flag or trap to an own home square; what stood there takes the vacated one."""
    if square not in home_squares(side):
        raise Illegal("not_home_square")
    frm = next((sq for sq, p in board.items() if p.side == side and p.kind == what), None)
    if frm is None:
        raise Illegal("no_piece")
    out = dict(board)
    if frm == square:
        return out
    displaced = out.get(square)
    out[square] = out[frm]
    if displaced is None:
        del out[frm]
    else:
        out[frm] = displaced
    return out


def first_side(prev: PrevGame | None, a_pid: object, b_pid: object, rng: random.Random) -> Side:
    """FR-8: the previous non-first-mover goes first if seated; else the seat opposite the
    previous first mover if they are seated; else (and in a first game) at random."""
    if prev is not None:
        first_pid = prev.a_pid if prev.first_side == "a" else prev.b_pid
        other_pid = prev.b_pid if prev.first_side == "a" else prev.a_pid
        if other_pid == a_pid:
            return "a"
        if other_pid == b_pid:
            return "b"
        if first_pid == a_pid:
            return "b"
        if first_pid == b_pid:
            return "a"
    return rng.choice(("a", "b"))


_BEATS: dict[str, str] = {"rock": "scissors", "scissors": "paper", "paper": "rock"}


def beats(x: Weapon, y: Weapon) -> bool:
    """Rock beats scissors, scissors beats paper, paper beats rock."""
    return _BEATS[x] == y


def _neighbours(square: int) -> list[int]:
    """The on-board squares one step up, down, left or right, ascending."""
    row, col = divmod(square, COLS)
    out = []
    if row > 0:
        out.append(square - COLS)
    if col > 0:
        out.append(square - 1)
    if col < COLS - 1:
        out.append(square + 1)
    if row < ROWS - 1:
        out.append(square + COLS)
    return out


def legal_moves(board: Board, side: Side) -> dict[int, list[int]]:
    """Each of `side`'s fighters that can move, with its targets: one orthogonal step onto an
    empty or enemy square (FR-9). Flags and traps never appear (FR-10); empty means FR-18."""
    moves: dict[int, list[int]] = {}
    for sq, piece in board.items():
        if piece.side != side or piece.kind not in WEAPONS:
            continue
        targets = [to for to in _neighbours(sq) if (t := board.get(to)) is None or t.side != side]
        if targets:
            moves[sq] = targets
    return dict(sorted(moves.items()))


def resolve_move(board: Board, side: Side, frm: int, to: int) -> MoveOutcome:
    """What `side` moving `frm` -> `to` leads to; `Illegal` (returned, not raised) if refused."""
    piece = board.get(frm)
    if piece is None or piece.side != side:
        return Illegal("not_your_piece")
    if piece.kind not in WEAPONS:
        return Illegal("immovable")
    if not 0 <= to < SQUARES or to not in _neighbours(frm):
        return Illegal("not_adjacent")
    target = board.get(to)
    if target is None:
        return Moved(frm, to)
    if target.side == side:
        return Illegal("own_piece")
    if target.kind == "flag":
        return FlagTaken(frm, to)
    if target.kind == "trap":
        return Trapped(frm, to)
    if target.kind == piece.kind:
        return DuelStarted(frm, to)
    won = beats(cast(Weapon, piece.kind), cast(Weapon, target.kind))
    return Fought(frm, to, "attacker" if won else "defender")


def resolve_duel(a_pick: Weapon, b_pick: Weapon, attacker: Side) -> Winner | None:
    """The duel's winner by the picks' weapon order, or None on a tie (FR-13)."""
    if a_pick == b_pick:
        return None
    winning_side: Side = "a" if beats(a_pick, b_pick) else "b"
    return "attacker" if winning_side == attacker else "defender"


def apply(board: Board, outcome: MoveOutcome) -> dict[int, Piece]:
    """The board after `outcome`. Fight survivors are revealed, losers removed; a duel reveals
    both fighters; traps stay; flags and traps are never revealed. No turn state."""
    if isinstance(outcome, Illegal):
        raise ValueError(f"cannot apply an illegal move: {outcome.code}")
    out = dict(board)
    frm, to = outcome.frm, outcome.to
    if isinstance(outcome, Moved):
        out[to] = out.pop(frm)
    elif isinstance(outcome, Fought):
        attacker = out.pop(frm)
        survivor = attacker if outcome.winner == "attacker" else out[to]
        out[to] = Piece(survivor.side, survivor.kind, True)
    elif isinstance(outcome, DuelStarted):
        out[frm] = Piece(out[frm].side, out[frm].kind, True)
        out[to] = Piece(out[to].side, out[to].kind, True)
    elif isinstance(outcome, Trapped):
        del out[frm]
    # FlagTaken: the game ends; the board stays as it was.
    return out
