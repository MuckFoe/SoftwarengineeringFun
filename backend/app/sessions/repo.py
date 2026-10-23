"""Sessions repository (plan.md "Data model": `session`, `session_problem`, `participant`,
`yjs_update`, `session_event`). FR-11 / NFR-4 (invite id), FR-27 (durable), FR-29 (stale_at).

Nothing here ever deletes a session-table row (NFR-9): there is no `DELETE` statement.
"""

import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

from app import clock


@dataclass(frozen=True)
class Session:
    id: uuid.UUID
    invite_id: str
    current_problem_id: uuid.UUID
    created_at: datetime
    last_activity_at: datetime
    stale_at: datetime | None


@dataclass(frozen=True)
class Participant:
    id: uuid.UUID
    session_id: uuid.UUID
    display_name: str
    joined_at: datetime
    left_at: datetime | None


def _session(row: asyncpg.Record) -> Session:
    return Session(
        id=row["id"],
        invite_id=row["invite_id"],
        current_problem_id=row["current_problem_id"],
        created_at=row["created_at"],
        last_activity_at=row["last_activity_at"],
        stale_at=row["stale_at"],
    )


def _participant(row: asyncpg.Record) -> Participant:
    return Participant(
        id=row["id"],
        session_id=row["session_id"],
        display_name=row["display_name"],
        joined_at=row["joined_at"],
        left_at=row["left_at"],
    )


# --- sessions ------------------------------------------------------------------


async def create(conn: asyncpg.Connection, problem_id: uuid.UUID) -> Session:
    """FR-11 / NFR-4: a 128-bit invite id (`secrets.token_urlsafe(16)`)."""
    now = clock.now()
    row = await conn.fetchrow(
        """insert into session (invite_id, current_problem_id, created_at, last_activity_at)
           values ($1, $2, $3, $3)
           returning id, invite_id, current_problem_id, created_at, last_activity_at, stale_at""",
        secrets.token_urlsafe(16),
        problem_id,
        now,
    )
    return _session(row)


async def get_by_invite(conn: asyncpg.Connection, invite_id: str) -> Session | None:
    row = await conn.fetchrow(
        """select id, invite_id, current_problem_id, created_at, last_activity_at, stale_at
           from session where invite_id = $1""",
        invite_id,
    )
    return _session(row) if row else None


async def set_current_problem(
    conn: asyncpg.Connection, session_id: uuid.UUID, problem_id: uuid.UUID
) -> None:
    await conn.execute(
        "update session set current_problem_id = $2 where id = $1", session_id, problem_id
    )


async def touch_activity(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    await conn.execute(
        "update session set last_activity_at = $2 where id = $1", session_id, clock.now()
    )


async def set_stale(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    await conn.execute("update session set stale_at = $2 where id = $1", session_id, clock.now())


async def clear_stale(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    await conn.execute("update session set stale_at = null where id = $1", session_id)


# --- participants ---------------------------------------------------------------


async def add_participant(
    conn: asyncpg.Connection, session_id: uuid.UUID, display_name: str
) -> Participant:
    row = await conn.fetchrow(
        """insert into participant (session_id, display_name, joined_at)
           values ($1, $2, $3)
           returning id, session_id, display_name, joined_at, left_at""",
        session_id,
        display_name,
        clock.now(),
    )
    return _participant(row)


async def leave_participant(conn: asyncpg.Connection, participant_id: uuid.UUID) -> None:
    await conn.execute(
        "update participant set left_at = $2 where id = $1", participant_id, clock.now()
    )


async def list_participants(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[Participant]:
    rows = await conn.fetch(
        """select id, session_id, display_name, joined_at, left_at
           from participant where session_id = $1 order by joined_at""",
        session_id,
    )
    return [_participant(r) for r in rows]


# --- events -----------------------------------------------------------------------


async def append_event(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    kind: str,
    actor: str,
    payload: dict[str, Any] | None = None,
) -> None:
    await conn.execute(
        "insert into session_event (session_id, kind, actor, payload) values ($1, $2, $3, $4)",
        session_id,
        kind,
        actor,
        json.dumps(payload or {}),
    )


# --- yjs updates ----------------------------------------------------------------


async def append_update(conn: asyncpg.Connection, session_id: uuid.UUID, update: bytes) -> None:
    await conn.execute(
        "insert into yjs_update (session_id, update) values ($1, $2)", session_id, update
    )


async def load_updates(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[bytes]:
    rows = await conn.fetch(
        "select update from yjs_update where session_id = $1 order by id", session_id
    )
    return [r["update"] for r in rows]
