"""Stale Rock Paper Siege sessions (spec 021 plan.md: `chess/stale.py` adapted). FR-2.

As chess: 30 days without activity marks an `rps_session` `stale_at`, checked hourly; deleted
sessions are skipped. Nothing is ever deleted. An admin reactivates it (`api.py`).
"""

import asyncio
import uuid
from datetime import datetime, timedelta

import asyncpg

from app import clock

STALE_AFTER = timedelta(days=30)
CHECK_INTERVAL_S = 3600


async def mark_stale(conn: asyncpg.Connection, now: datetime) -> list[uuid.UUID]:
    """Marks rps sessions inactive for more than 30 days stale; deleted ones never (FR-2)."""
    rows = await conn.fetch(
        """update rps_session set stale_at = $1
           where stale_at is null and deleted_at is null and last_activity_at < $2
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
