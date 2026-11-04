"""Stale presentation sessions (spec 013 plan.md "Session lifetime, stale, removal"). FR-31.

Mirrors `learn.stale` on `presentation_session`: 30 days without activity marks a session
`stale_at`, checked hourly. Nothing is ever deleted. An admin reactivates it.
"""

import asyncio
import uuid
from datetime import datetime, timedelta

import asyncpg

from app import clock
from app.present import repo

STALE_AFTER = timedelta(days=30)
CHECK_INTERVAL_S = 3600


class SessionNotFound(LookupError):
    pass


class SessionNotStale(Exception):
    pass


async def mark_stale(conn: asyncpg.Connection, now: datetime) -> list[uuid.UUID]:
    """Marks presentation sessions inactive for more than 30 days stale (FR-31)."""
    rows = await conn.fetch(
        """update presentation_session set stale_at = $1
           where stale_at is null and last_activity_at < $2
           returning id""",
        now,
        now - STALE_AFTER,
    )
    return [r["id"] for r in rows]


async def run_periodically(pool: asyncpg.Pool) -> None:
    """Runs `mark_stale` on a timer (every `CHECK_INTERVAL_S`) until cancelled."""
    while True:
        await asyncio.sleep(CHECK_INTERVAL_S)
        async with pool.acquire() as conn:
            await mark_stale(conn, clock.now())


async def reactivate(conn: asyncpg.Connection, invite_id: str) -> None:
    """Clears `stale_at` and touches activity; the session resumes at its stored place."""
    session = await repo.get_session_by_invite(conn, invite_id)
    if session is None:
        raise SessionNotFound(invite_id)
    if session.stale_at is None:
        raise SessionNotStale(invite_id)
    async with conn.transaction():
        await conn.execute(
            "update presentation_session set stale_at = null where id = $1", session.id
        )
        await repo.touch_activity(conn, session.id)
