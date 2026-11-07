"""Spec 017 task 8: the code excerpt for a session tile (plan.md "Contracts", preview
endpoint). FR-4, Privacy, Performance.

The excerpt comes from the session's current collaborative document (the same source the
editor and scratch runs read), so `has_preview` in the snapshot and the preview endpoint
cannot disagree.
"""

import uuid
from typing import Any

import asyncpg

from app.auth.deps import User
from app.sessions import collab

EXCERPT_LINES = 8
EXCERPT_WIDTH = 80
LANGUAGE = "python"  # the only language a coding session has today


async def may_open(
    conn: asyncpg.Connection, user: User | None, session_id: uuid.UUID, guest: Any = None
) -> bool:
    """The task 1 visibility rule: a non-hidden participant row of this account, or of this
    guest."""
    from app.home import service  # noqa: PLC0415  (service imports this module)

    rows = await conn.fetch(
        service._VISIBLE,  # noqa: SLF001
        user.sub if user else None,
        guest.participant_id if guest else None,
    )
    return any(r["id"] == session_id for r in rows)


async def current_code(conn: asyncpg.Connection, session_id: uuid.UUID) -> str | None:
    """The current code of a coding session, or None when it is not one."""
    problem_id = await conn.fetchval(
        "select current_problem_id from session where id = $1", session_id
    )
    if problem_id is None:
        return None
    return (await collab.get_or_load(conn, session_id)).get_code(str(problem_id))


def excerpt(code: str) -> str:
    lines = code.splitlines()[:EXCERPT_LINES]
    return "\n".join(line[:EXCERPT_WIDTH] for line in lines)


async def preview(
    conn: asyncpg.Connection, user: User | None, session_id: uuid.UUID
) -> dict[str, Any] | None:
    """None when the session has no code to show; the caller has checked `may_open`."""
    code = await current_code(conn, session_id)
    if not code or not code.strip():
        return None
    return {"session_id": str(session_id), "language": LANGUAGE, "excerpt": excerpt(code)}


async def has_code(conn: asyncpg.Connection, session_id: uuid.UUID) -> bool:
    code = await current_code(conn, session_id)
    return bool(code and code.strip())
