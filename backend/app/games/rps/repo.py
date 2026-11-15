"""Rock Paper Siege repository (spec 021 plan.md "Data model"): SQL on `rps_*` tables only.
FR-2, FR-24, NFR-3.

Sessions and participants mirror `app.games.chess.repo` with seats `a`/`b`. Game state is
`rps_game` (phase derived: ended if `ended_at`, play if both ready, else setup), one
`rps_piece` row per occupied square (a removed piece's row is deleted) and at most one
`rps_duel` per game. Deleting a session sets `deleted_at`; chat SQL lives in `rps.chat`,
stale-marking SQL in `rps.stale`.
"""

# ruff: noqa: S608 - f-strings only splice this module's own column-list constants.

import secrets
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import asyncpg

from app import clock
from app.deletion import repo as deletion_repo
from app.games.rps.rules import Piece, Side, Weapon

_SESSION_COLUMNS = """id, invite_id, starter_participant_id, a_participant_id,
    b_participant_id, current_game_id, created_at, last_activity_at, stale_at,
    deleted_at, deleted_reason, deleted_by_sub"""
_PARTICIPANT_COLUMNS = "id, session_id, display_name, joined_at, left_at, account_sub"
_GAME_COLUMNS = """id, session_id, a_participant_id, b_participant_id, first_side, started_at,
    a_ready, b_ready, turn, ply, draw_offer_by, ended_at, result, reason"""
_DUEL_COLUMNS = """game_id, from_square, to_square, attacker, round, a_pick, b_pick,
    last_a_pick, last_b_pick"""


@dataclass(frozen=True)
class RpsSession:
    id: uuid.UUID
    invite_id: str
    starter_participant_id: uuid.UUID | None
    a_participant_id: uuid.UUID | None
    b_participant_id: uuid.UUID | None
    current_game_id: uuid.UUID | None
    created_at: datetime
    last_activity_at: datetime
    stale_at: datetime | None
    deleted_at: datetime | None
    deleted_reason: str | None
    deleted_by_sub: str | None


@dataclass(frozen=True)
class Participant:
    id: uuid.UUID
    session_id: uuid.UUID
    display_name: str
    joined_at: datetime
    left_at: datetime | None
    account_sub: str | None = None

    @property
    def signed_in(self) -> bool:
        return self.account_sub is not None


@dataclass(frozen=True)
class Game:
    id: uuid.UUID
    session_id: uuid.UUID
    a_participant_id: uuid.UUID
    b_participant_id: uuid.UUID
    first_side: Side
    started_at: datetime
    a_ready: bool
    b_ready: bool
    turn: Side | None  # null in setup, while a duel waits, and once ended
    ply: int
    draw_offer_by: Side | None
    ended_at: datetime | None
    result: str | None  # 'a', 'b' or 'draw'
    reason: str | None

    @property
    def phase(self) -> Literal["setup", "play", "ended"]:
        if self.ended_at is not None:
            return "ended"
        return "play" if self.a_ready and self.b_ready else "setup"


@dataclass(frozen=True)
class Duel:
    game_id: uuid.UUID
    from_square: int  # the attacker, still on its square
    to_square: int  # the defender
    attacker: Side
    round: int
    a_pick: Weapon | None
    b_pick: Weapon | None
    last_a_pick: Weapon | None  # the previous, tied round
    last_b_pick: Weapon | None


def _side(side: str) -> Side:
    if side not in ("a", "b"):
        raise ValueError(f"unknown side {side!r}")
    return side  # type: ignore[return-value]


# --- sessions ---------------------------------------------------------------------------------


async def create_session(conn: asyncpg.Connection) -> RpsSession:
    """A session with a 128-bit invite id; no starter yet (set right after their insert)."""
    now = clock.now()
    row = await conn.fetchrow(
        f"""insert into rps_session (invite_id, created_at, last_activity_at)
            values ($1, $2, $2) returning {_SESSION_COLUMNS}""",
        secrets.token_urlsafe(16),
        now,
    )
    return RpsSession(**dict(row))


async def get_session_by_invite(conn: asyncpg.Connection, invite_id: str) -> RpsSession | None:
    """The normal lookup: a deleted session does not exist."""
    row = await conn.fetchrow(
        f"select {_SESSION_COLUMNS} from rps_session where invite_id = $1 and deleted_at is null",
        invite_id,
    )
    return RpsSession(**dict(row)) if row else None


async def is_deleted_invite(conn: asyncpg.Connection, invite_id: str) -> bool:
    """Whether the invite belonged to a deleted session (REST 410, WS 4411): soft-deleted
    here, or purged by a profile deletion (spec 019 FR-8)."""
    soft_deleted = await conn.fetchval(
        "select true from rps_session where invite_id = $1 and deleted_at is not null",
        invite_id,
    )
    return bool(soft_deleted) or await deletion_repo.is_tombstoned(conn, "rps", invite_id)


async def get_session(conn: asyncpg.Connection, session_id: uuid.UUID) -> RpsSession | None:
    """By id, deleted sessions included."""
    row = await conn.fetchrow(
        f"select {_SESSION_COLUMNS} from rps_session where id = $1", session_id
    )
    return RpsSession(**dict(row)) if row else None


async def lock_session(conn: asyncpg.Connection, session_id: uuid.UUID) -> RpsSession | None:
    """`for update`; call inside a transaction to serialise changes to one session."""
    row = await conn.fetchrow(
        f"select {_SESSION_COLUMNS} from rps_session where id = $1 for update", session_id
    )
    return RpsSession(**dict(row)) if row else None


async def set_starter(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID
) -> None:
    await conn.execute(
        "update rps_session set starter_participant_id = $2 where id = $1",
        session_id,
        participant_id,
    )


async def set_seats(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    *,
    a: uuid.UUID | None,
    b: uuid.UUID | None,
) -> None:
    await conn.execute(
        "update rps_session set a_participant_id = $2, b_participant_id = $3 where id = $1",
        session_id,
        a,
        b,
    )


async def set_current_game(
    conn: asyncpg.Connection, session_id: uuid.UUID, game_id: uuid.UUID | None
) -> None:
    await conn.execute(
        "update rps_session set current_game_id = $2 where id = $1", session_id, game_id
    )


async def touch_activity(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    await conn.execute(
        "update rps_session set last_activity_at = $2 where id = $1", session_id, clock.now()
    )


async def set_stale(
    conn: asyncpg.Connection, session_id: uuid.UUID, stale_at: datetime | None
) -> None:
    """Marks the session stale at `stale_at`, or clears it with None."""
    await conn.execute("update rps_session set stale_at = $2 where id = $1", session_id, stale_at)


async def soft_delete(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    reason: str,
    *,
    by_sub: str | None = None,
) -> bool:
    """Whether it was deleted now (false when absent or already deleted)."""
    deleted = await conn.fetchval(
        """update rps_session set deleted_at = $2, deleted_reason = $3, deleted_by_sub = $4
           where id = $1 and deleted_at is null returning true""",
        session_id,
        clock.now(),
        reason,
        by_sub,
    )
    return bool(deleted)


# --- participants -----------------------------------------------------------------------------


async def add_participant(
    conn: asyncpg.Connection, session_id: uuid.UUID, display_name: str, token_hash: str
) -> Participant:
    """`token_hash` is the SHA-256 hex of the rejoin token; the token is never stored."""
    row = await conn.fetchrow(
        f"""insert into rps_participant (session_id, display_name, rejoin_token_hash, joined_at)
            values ($1, $2, $3, $4) returning {_PARTICIPANT_COLUMNS}""",
        session_id,
        display_name,
        token_hash,
        clock.now(),
    )
    return Participant(**dict(row))


async def join_as_account(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    account_sub: str,
    name: str,
    token_hash: str,
) -> tuple[Participant, bool]:
    """The account's one participant in the session, and whether it already existed. Reuse
    clears `left_at` and `hidden_at` and rotates the rejoin token to `token_hash`."""
    row = await conn.fetchrow(
        """insert into rps_participant as p
                (session_id, display_name, rejoin_token_hash, joined_at, account_sub)
            values ($1, $2, $3, $4, $5)
            on conflict (account_sub, session_id) where account_sub is not null
            do update set left_at = null, hidden_at = null,
                          rejoin_token_hash = excluded.rejoin_token_hash
            returning p.id, p.session_id, p.display_name, p.joined_at, p.left_at,
                      p.account_sub, p.xmax <> 0 as reused""",
        session_id,
        name,
        token_hash,
        clock.now(),
        account_sub,
    )
    values = dict(row)
    reused = values.pop("reused")
    return Participant(**values), reused


async def get_participant_by_token_hash(
    conn: asyncpg.Connection, session_id: uuid.UUID, token_hash: str
) -> Participant | None:
    """Only within `session_id`: a token from another session does not rejoin this one."""
    row = await conn.fetchrow(
        f"""select {_PARTICIPANT_COLUMNS} from rps_participant
            where session_id = $1 and rejoin_token_hash = $2""",
        session_id,
        token_hash,
    )
    return Participant(**dict(row)) if row else None


async def get_participant_by_account(
    conn: asyncpg.Connection, session_id: uuid.UUID, account_sub: str
) -> Participant | None:
    row = await conn.fetchrow(
        f"""select {_PARTICIPANT_COLUMNS} from rps_participant
            where session_id = $1 and account_sub = $2""",
        session_id,
        account_sub,
    )
    return Participant(**dict(row)) if row else None


async def list_participants(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[Participant]:
    rows = await conn.fetch(
        f"""select {_PARTICIPANT_COLUMNS} from rps_participant
            where session_id = $1 order by joined_at, id""",
        session_id,
    )
    return [Participant(**dict(r)) for r in rows]


async def leave_participant(conn: asyncpg.Connection, participant_id: uuid.UUID) -> None:
    await conn.execute(
        "update rps_participant set left_at = $2 where id = $1", participant_id, clock.now()
    )


# --- games ------------------------------------------------------------------------------------


async def insert_game(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    a_participant_id: uuid.UUID,
    b_participant_id: uuid.UUID,
    first_side: Side,
) -> Game:
    """A new game in setup: nobody ready, no turn, no pieces yet."""
    row = await conn.fetchrow(
        f"""insert into rps_game
                (session_id, a_participant_id, b_participant_id, first_side, started_at)
            values ($1, $2, $3, $4, $5) returning {_GAME_COLUMNS}""",
        session_id,
        a_participant_id,
        b_participant_id,
        _side(first_side),
        clock.now(),
    )
    return Game(**dict(row))


async def get_game(conn: asyncpg.Connection, game_id: uuid.UUID) -> Game | None:
    row = await conn.fetchrow(f"select {_GAME_COLUMNS} from rps_game where id = $1", game_id)
    return Game(**dict(row)) if row else None


async def set_ready(conn: asyncpg.Connection, game_id: uuid.UUID, side: Side) -> None:
    column = f"{_side(side)}_ready"
    await conn.execute(f"update rps_game set {column} = true where id = $1", game_id)


async def set_turn(conn: asyncpg.Connection, game_id: uuid.UUID, turn: Side | None) -> None:
    """The side to move; None while a duel waits for picks."""
    await conn.execute(
        "update rps_game set turn = $2 where id = $1",
        game_id,
        None if turn is None else _side(turn),
    )


async def end_turn(conn: asyncpg.Connection, game_id: uuid.UUID, next_turn: Side) -> None:
    """A completed turn: `ply += 1`, any draw offer cleared, `next_turn` to move."""
    await conn.execute(
        "update rps_game set ply = ply + 1, draw_offer_by = null, turn = $2 where id = $1",
        game_id,
        _side(next_turn),
    )


async def set_draw_offer(conn: asyncpg.Connection, game_id: uuid.UUID, by: Side | None) -> None:
    """`by` is 'a' or 'b'; None withdraws or clears the offer."""
    await conn.execute(
        "update rps_game set draw_offer_by = $2 where id = $1",
        game_id,
        None if by is None else _side(by),
    )


async def end_game(
    conn: asyncpg.Connection, game_id: uuid.UUID, *, result: str, reason: str
) -> None:
    """Records the result (`'a'`, `'b'` or `'draw'`); clears the turn and any draw offer."""
    await conn.execute(
        """update rps_game set ended_at = $2, result = $3, reason = $4, turn = null,
                  draw_offer_by = null
           where id = $1""",
        game_id,
        clock.now(),
        result,
        reason,
    )


# --- pieces -----------------------------------------------------------------------------------


async def list_pieces(conn: asyncpg.Connection, game_id: uuid.UUID) -> dict[int, Piece]:
    """The board: square -> piece, both sides."""
    rows = await conn.fetch(
        "select square, side, kind, revealed from rps_piece where game_id = $1 order by square",
        game_id,
    )
    return {r["square"]: Piece(r["side"], r["kind"], r["revealed"]) for r in rows}


async def write_side(
    conn: asyncpg.Connection, game_id: uuid.UUID, side: Side, board: Mapping[int, Piece]
) -> None:
    """Replaces all of `side`'s rows with `board`'s pieces of that side (setup: deal, place,
    re-deal). The other side's pieces in `board` are ignored and their rows untouched."""
    side = _side(side)
    async with conn.transaction():
        await conn.execute("delete from rps_piece where game_id = $1 and side = $2", game_id, side)
        await conn.executemany(
            """insert into rps_piece (game_id, square, side, kind, revealed)
               values ($1, $2, $3, $4, $5)""",
            [
                (game_id, square, p.side, p.kind, p.revealed)
                for square, p in sorted(board.items())
                if p.side == side
            ],
        )


async def move_piece(conn: asyncpg.Connection, game_id: uuid.UUID, frm: int, to: int) -> None:
    """Moves the piece on `frm` to `to`, which must be empty (delete a loser first)."""
    await conn.execute(
        "update rps_piece set square = $3 where game_id = $1 and square = $2", game_id, frm, to
    )


async def delete_piece(conn: asyncpg.Connection, game_id: uuid.UUID, square: int) -> None:
    await conn.execute("delete from rps_piece where game_id = $1 and square = $2", game_id, square)


async def set_revealed(conn: asyncpg.Connection, game_id: uuid.UUID, square: int) -> None:
    """Marks the fighter on `square` revealed (FR-12). Flag and trap are never revealed."""
    await conn.execute(
        """update rps_piece set revealed = true
           where game_id = $1 and square = $2 and kind in ('rock', 'paper', 'scissors')""",
        game_id,
        square,
    )


# --- duel -------------------------------------------------------------------------------------


async def insert_duel(
    conn: asyncpg.Connection,
    game_id: uuid.UUID,
    *,
    from_square: int,
    to_square: int,
    attacker: Side,
) -> Duel:
    row = await conn.fetchrow(
        f"""insert into rps_duel (game_id, from_square, to_square, attacker)
            values ($1, $2, $3, $4) returning {_DUEL_COLUMNS}""",
        game_id,
        from_square,
        to_square,
        _side(attacker),
    )
    return Duel(**dict(row))


async def get_duel(conn: asyncpg.Connection, game_id: uuid.UUID) -> Duel | None:
    row = await conn.fetchrow(f"select {_DUEL_COLUMNS} from rps_duel where game_id = $1", game_id)
    return Duel(**dict(row)) if row else None


async def set_pick(conn: asyncpg.Connection, game_id: uuid.UUID, side: Side, pick: Weapon) -> None:
    column = f"{_side(side)}_pick"
    await conn.execute(f"update rps_duel set {column} = $2 where game_id = $1", game_id, pick)


async def next_round(conn: asyncpg.Connection, game_id: uuid.UUID) -> None:
    """After a tie: `round += 1`, this round's picks become `last_*`, picks cleared."""
    await conn.execute(
        """update rps_duel set round = round + 1, last_a_pick = a_pick, last_b_pick = b_pick,
                  a_pick = null, b_pick = null
           where game_id = $1""",
        game_id,
    )


async def delete_duel(conn: asyncpg.Connection, game_id: uuid.UUID) -> None:
    await conn.execute("delete from rps_duel where game_id = $1", game_id)
