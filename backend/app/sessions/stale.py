"""Stale-session job (plan.md "Inactivity and stale sessions"). FR-29, NFR-9.

Nothing is ever deleted (NFR-9): a stale session is only marked `stale_at` and logged.
"""

import asyncio
import uuid
from datetime import datetime, timedelta

import asyncpg

from app import clock
from app.sessions import repo as sessions_repo

STALE_AFTER = timedelta(days=30)
CHECK_INTERVAL_S = 3600


async def mark_stale(conn: asyncpg.Connection, now: datetime) -> list[uuid.UUID]:
    """Marks sessions inactive for 30+ days stale, logging one `stale` event each (FR-29)."""
    rows = await conn.fetch(
        """update session set stale_at = $1
           where stale_at is null and last_activity_at < $2
           returning id""",
        now,
        now - STALE_AFTER,
    )
    session_ids = [r["id"] for r in rows]
    for session_id in session_ids:
        await sessions_repo.append_event(conn, session_id, "stale", "system")
    return session_ids


async def run_periodically(pool: asyncpg.Pool) -> None:
    """Runs `mark_stale` on a timer (every `CHECK_INTERVAL_S`) until cancelled."""
    while True:
        await asyncio.sleep(CHECK_INTERVAL_S)
        async with pool.acquire() as conn:
            await mark_stale(conn, clock.now())
