"""Spec 019: deleting a session for everyone from the profile (FR-2, FR-6, FR-7, FR-9, FR-11,
FR-12, FR-14; plan.md "Architecture", "Contracts").

`delete_session` locks the session row, authorises the caller (its host, or an admin), purges
the session and writes its tombstone in one transaction, and only after the commit closes
the session's live hub, so nobody is told "deleted" for a deletion that rolled back.
"""

import contextlib
import uuid
from typing import Literal

import asyncpg
from fastapi import FastAPI

from app.auth.deps import User
from app.deletion import repo
from app.games.chess import service as chess_service
from app.games.chess import ws as chess_ws
from app.learn import ws as learn_ws
from app.present import ws as present_ws
from app.sessions import ws as sessions_ws

# Each kind's (session table, participant table). Fixed names, never caller input.
_TABLES: dict[str, tuple[str, str]] = {
    "coding": ("session", "participant"),
    "learning": ("learning_session", "learning_participant"),
    "presentation": ("presentation_session", "presentation_participant"),
    "chess": ("chess_session", "chess_participant"),
}


class Refused(Exception):
    """Why a deletion was refused: `not_found`, `session_deleted` or `not_host`."""

    def __init__(self, code: Literal["not_found", "session_deleted", "not_host"]) -> None:
        super().__init__(code)
        self.code = code


def _session_lock(kind: str, session_id: uuid.UUID) -> contextlib.AbstractAsyncContextManager:
    """Chess serialises its writes on an in-process lock as well as the row lock; take it
    too, so a move or a chess deletion in flight finishes before the purge."""
    if kind == "chess":
        return chess_service.lock(session_id)
    return contextlib.nullcontext()


async def delete_session(
    conn: asyncpg.Connection, app: FastAPI, user: User, kind: str, invite_id: str
) -> None:
    """Locks the session row (for update), authorises (host_sub == user.sub or admin), purges
    it and writes the tombstone in one transaction; after commit closes its live hub.

    Refused `not_found` for an unknown kind or invite, or (for a non-admin) a session not in
    the caller's list; `session_deleted` once it is tombstoned (or, for chess, soft-deleted);
    `not_host` for a listed session the caller neither hosts nor may delete as an admin."""
    if kind not in _TABLES:
        raise Refused("not_found")
    table, participants = _TABLES[kind]
    session_id = await conn.fetchval(f"select id from {table} where invite_id = $1", invite_id)  # noqa: S608
    if session_id is None:
        raise await _gone(conn, kind, invite_id)
    async with _session_lock(kind, session_id):
        by = await _purge_locked(conn, user, kind, invite_id, session_id, participants)
    await _close_live(app, kind, session_id, by)


async def _gone(conn: asyncpg.Connection, kind: str, invite_id: str) -> Refused:
    return Refused(
        "session_deleted" if await repo.is_tombstoned(conn, kind, invite_id) else "not_found"
    )


async def _purge_locked(
    conn: asyncpg.Connection,
    user: User,
    kind: str,
    invite_id: str,
    session_id: uuid.UUID,
    participants: str,
) -> Literal["host", "admin"]:
    table = _TABLES[kind][0]
    soft_deleted = ", deleted_at is not null" if kind == "chess" else ", false"
    async with conn.transaction():
        row = await conn.fetchrow(
            f"select id{soft_deleted} as deleted from {table} where id = $1 for update",  # noqa: S608
            session_id,
        )
        if row is None:  # deleted by a concurrent request while we waited for the lock
            raise await _gone(conn, kind, invite_id)
        if row["deleted"]:  # chess's own (soft) deletion: the invite already says "deleted"
            raise Refused("session_deleted")
        is_admin = "admin" in user.roles
        if not is_admin and not await conn.fetchval(
            f"""select exists (select 1 from {participants}
                 where session_id = $1 and account_sub = $2 and hidden_at is null)""",  # noqa: S608
            session_id,
            user.sub,
        ):
            raise Refused("not_found")
        if await repo.host_sub(conn, kind, session_id) == user.sub:
            by: Literal["host", "admin"] = "host"
        elif is_admin:
            by = "admin"
        else:
            raise Refused("not_host")
        await repo.purge(conn, kind, session_id)
        if not await repo.is_tombstoned(conn, kind, invite_id):
            await repo.tombstone(conn, kind, invite_id, by)
    return by


async def _close_live(
    app: FastAPI, kind: str, session_id: uuid.UUID, by: Literal["host", "admin"]
) -> None:
    """FR-7, FR-14: after the commit, tell everyone connected and close their sockets."""
    if kind == "chess":
        reason = "starter" if by == "host" else "admin"
        await chess_ws.close_session(app, session_id, chess_service.Closed(None, reason))
    elif kind == "coding":
        await sessions_ws.cancel_runs(app, session_id)  # first: a run's broadcast makes a hub
        await sessions_ws.close_deleted(session_id, by)
    elif kind == "learning":
        await learn_ws.close_deleted(session_id, by)
    else:
        await present_ws.close_deleted(session_id, by)
