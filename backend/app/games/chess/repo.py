"""Chess repository (spec 014 plan.md "Data model"): SQL on `chess_*` tables only.
FR-27, FR-34, NFR-4.

Deleting a session sets `deleted_at`; nothing here ever drops a row. Chat SQL lives in
`chess.chat`, stale-marking SQL in `chess.stale`.
"""

# ruff: noqa: S608 - f-strings only splice this module's own column-list constants.

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from app import clock
from app.deletion import repo as deletion_repo

_SESSION_COLUMNS = """id, invite_id, starter_participant_id, white_participant_id,
    black_participant_id, current_game_id, created_at, last_activity_at, stale_at,
    deleted_at, deleted_reason, deleted_by_sub"""
_PARTICIPANT_COLUMNS = "id, session_id, display_name, joined_at, left_at, account_sub"
_GAME_COLUMNS = """id, session_id, white_participant_id, black_participant_id, started_at,
    draw_offer_by, ended_at, result, reason"""


@dataclass(frozen=True)
class ChessSession:
    id: uuid.UUID
    invite_id: str
    starter_participant_id: uuid.UUID | None
    white_participant_id: uuid.UUID | None
    black_participant_id: uuid.UUID | None
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
    white_participant_id: uuid.UUID
    black_participant_id: uuid.UUID
    started_at: datetime
    draw_offer_by: str | None
    ended_at: datetime | None
    result: str | None
    reason: str | None


@dataclass(frozen=True)
class Move:
    game_id: uuid.UUID
    ply: int
    uci: str
    san: str
    participant_id: uuid.UUID
    made_at: datetime


# --- sessions ---------------------------------------------------------------------------------


async def create_session(conn: asyncpg.Connection) -> ChessSession:
    """A session with a 128-bit invite id; no starter yet (set right after their insert)."""
    now = clock.now()
    row = await conn.fetchrow(
        f"""insert into chess_session (invite_id, created_at, last_activity_at)
            values ($1, $2, $2) returning {_SESSION_COLUMNS}""",
        secrets.token_urlsafe(16),
        now,
    )
    return ChessSession(**dict(row))


async def get_session_by_invite(conn: asyncpg.Connection, invite_id: str) -> ChessSession | None:
    """The normal lookup: a deleted session does not exist (FR-34)."""
    row = await conn.fetchrow(
        f"select {_SESSION_COLUMNS} from chess_session where invite_id = $1 and deleted_at is null",
        invite_id,
    )
    return ChessSession(**dict(row)) if row else None


async def is_deleted_invite(conn: asyncpg.Connection, invite_id: str) -> bool:
    """FR-34: whether the invite belonged to a session that was deleted (REST 410, WS 4411):
    soft-deleted in chess, or purged by a profile deletion (spec 019 FR-8, FR-14)."""
    soft_deleted = await conn.fetchval(
        "select true from chess_session where invite_id = $1 and deleted_at is not null",
        invite_id,
    )
    return bool(soft_deleted) or await deletion_repo.is_tombstoned(conn, "chess", invite_id)


async def get_session(conn: asyncpg.Connection, session_id: uuid.UUID) -> ChessSession | None:
    """By id, deleted sessions included."""
    row = await conn.fetchrow(
        f"select {_SESSION_COLUMNS} from chess_session where id = $1", session_id
    )
    return ChessSession(**dict(row)) if row else None


async def lock_session(conn: asyncpg.Connection, session_id: uuid.UUID) -> ChessSession | None:
    """`for update`; call inside a transaction to serialise changes to one session."""
    row = await conn.fetchrow(
        f"select {_SESSION_COLUMNS} from chess_session where id = $1 for update", session_id
    )
    return ChessSession(**dict(row)) if row else None


async def set_starter(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID
) -> None:
    await conn.execute(
        "update chess_session set starter_participant_id = $2 where id = $1",
        session_id,
        participant_id,
    )


async def set_seats(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    *,
    white: uuid.UUID | None,
    black: uuid.UUID | None,
) -> None:
    await conn.execute(
        """update chess_session set white_participant_id = $2, black_participant_id = $3
           where id = $1""",
        session_id,
        white,
        black,
    )


async def set_current_game(
    conn: asyncpg.Connection, session_id: uuid.UUID, game_id: uuid.UUID | None
) -> None:
    await conn.execute(
        "update chess_session set current_game_id = $2 where id = $1", session_id, game_id
    )


async def touch_activity(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    await conn.execute(
        "update chess_session set last_activity_at = $2 where id = $1", session_id, clock.now()
    )


async def set_stale(
    conn: asyncpg.Connection, session_id: uuid.UUID, stale_at: datetime | None
) -> None:
    """Marks the session stale at `stale_at`, or clears it with None."""
    await conn.execute("update chess_session set stale_at = $2 where id = $1", session_id, stale_at)


async def soft_delete(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    reason: str,
    *,
    by_sub: str | None = None,
) -> bool:
    """FR-34: whether it was deleted now (false when absent or already deleted)."""
    deleted = await conn.fetchval(
        """update chess_session set deleted_at = $2, deleted_reason = $3, deleted_by_sub = $4
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
        f"""insert into chess_participant (session_id, display_name, rejoin_token_hash, joined_at)
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
        """insert into chess_participant as p
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
        f"""select {_PARTICIPANT_COLUMNS} from chess_participant
            where session_id = $1 and rejoin_token_hash = $2""",
        session_id,
        token_hash,
    )
    return Participant(**dict(row)) if row else None


async def get_participant_by_account(
    conn: asyncpg.Connection, session_id: uuid.UUID, account_sub: str
) -> Participant | None:
    row = await conn.fetchrow(
        f"""select {_PARTICIPANT_COLUMNS} from chess_participant
            where session_id = $1 and account_sub = $2""",
        session_id,
        account_sub,
    )
    return Participant(**dict(row)) if row else None


async def list_participants(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[Participant]:
    rows = await conn.fetch(
        f"""select {_PARTICIPANT_COLUMNS} from chess_participant
            where session_id = $1 order by joined_at, id""",
        session_id,
    )
    return [Participant(**dict(r)) for r in rows]


async def leave_participant(conn: asyncpg.Connection, participant_id: uuid.UUID) -> None:
    await conn.execute(
        "update chess_participant set left_at = $2 where id = $1", participant_id, clock.now()
    )


# --- games and moves --------------------------------------------------------------------------


async def insert_game(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    white_participant_id: uuid.UUID,
    black_participant_id: uuid.UUID,
) -> Game:
    row = await conn.fetchrow(
        f"""insert into chess_game
                (session_id, white_participant_id, black_participant_id, started_at)
            values ($1, $2, $3, $4) returning {_GAME_COLUMNS}""",
        session_id,
        white_participant_id,
        black_participant_id,
        clock.now(),
    )
    return Game(**dict(row))


async def get_game(conn: asyncpg.Connection, game_id: uuid.UUID) -> Game | None:
    row = await conn.fetchrow(f"select {_GAME_COLUMNS} from chess_game where id = $1", game_id)
    return Game(**dict(row)) if row else None


async def insert_move(
    conn: asyncpg.Connection,
    game_id: uuid.UUID,
    ply: int,
    uci: str,
    san: str,
    participant_id: uuid.UUID,
) -> Move:
    row = await conn.fetchrow(
        """insert into chess_move (game_id, ply, uci, san, participant_id, made_at)
           values ($1, $2, $3, $4, $5, $6)
           returning game_id, ply, uci, san, participant_id, made_at""",
        game_id,
        ply,
        uci,
        san,
        participant_id,
        clock.now(),
    )
    return Move(**dict(row))


async def list_moves(conn: asyncpg.Connection, game_id: uuid.UUID) -> list[Move]:
    rows = await conn.fetch(
        """select game_id, ply, uci, san, participant_id, made_at
           from chess_move where game_id = $1 order by ply""",
        game_id,
    )
    return [Move(**dict(r)) for r in rows]


async def set_draw_offer(conn: asyncpg.Connection, game_id: uuid.UUID, by: str | None) -> None:
    """`by` is 'white' or 'black'; None withdraws or clears the offer."""
    await conn.execute("update chess_game set draw_offer_by = $2 where id = $1", game_id, by)


async def end_game(
    conn: asyncpg.Connection, game_id: uuid.UUID, *, result: str, reason: str
) -> None:
    """Records the result and clears any draw offer (the schema forbids both)."""
    await conn.execute(
        """update chess_game set ended_at = $2, result = $3, reason = $4, draw_offer_by = null
           where id = $1""",
        game_id,
        clock.now(),
        result,
        reason,
    )
