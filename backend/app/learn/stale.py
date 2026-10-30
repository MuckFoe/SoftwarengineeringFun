"""Stale learning sessions (spec 006 plan.md "Concurrency and state"). FR-27, NFR-5.

Mirrors `sessions.stale` on `learning_session`: 30 days without activity marks a session
`stale_at`, checked hourly. Nothing is ever deleted. Also the admin list and reactivation.
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

import asyncpg

from app import clock
from app.learn import repo

STALE_AFTER = timedelta(days=30)
CHECK_INTERVAL_S = 3600


class SessionNotFound(LookupError):
    pass


class SessionNotStale(Exception):
    pass


@dataclass(frozen=True)
class StaleSessionRow:
    invite_id: str
    lesson_title: str
    stale_at: datetime
    last_activity_at: datetime


async def mark_stale(conn: asyncpg.Connection, now: datetime) -> list[uuid.UUID]:
    """Marks learning sessions inactive for 30+ days stale (FR-27)."""
    rows = await conn.fetch(
        """update learning_session set stale_at = $1
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


async def list_stale(conn: asyncpg.Connection) -> list[StaleSessionRow]:
    """The admin list of stale learning sessions, most recently stale first."""
    rows = await conn.fetch(
        """select s.invite_id, v.content->>'title' as lesson_title, s.stale_at,
                  s.last_activity_at
           from learning_session s join lesson_version v on v.id = s.lesson_version_id
           where s.stale_at is not null
           order by s.stale_at desc"""
    )
    return [
        StaleSessionRow(
            invite_id=r["invite_id"],
            lesson_title=r["lesson_title"],
            stale_at=r["stale_at"],
            last_activity_at=r["last_activity_at"],
        )
        for r in rows
    ]


async def reactivate(conn: asyncpg.Connection, invite_id: str) -> None:
    """Clears `stale_at` and touches activity; the group resumes at its current step."""
    session = await repo.get_session_by_invite(conn, invite_id)
    if session is None:
        raise SessionNotFound(invite_id)
    if session.stale_at is None:
        raise SessionNotStale(invite_id)
    async with conn.transaction():
        await conn.execute("update learning_session set stale_at = null where id = $1", session.id)
        await repo.touch_activity(conn, session.id)
