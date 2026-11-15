"""Spec 021 task 26: stale Rock Paper Siege sessions (`rps/stale.py`). FR-2.

FR-2 "stale after 30 days, as chess": a session with `last_activity_at` 31 days ago is marked
stale by one sweep; a 29-day-old one is not; a deleted one never is. A real database.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.games.rps import repo, stale


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _aged(conn: asyncpg.Connection, days: int) -> repo.RpsSession:
    session = await repo.create_session(conn)
    await conn.execute(
        "update rps_session set last_activity_at = $2 where id = $1",
        session.id,
        clock.now() - timedelta(days=days),
    )
    return session


async def _stale_at(conn: asyncpg.Connection, session_id: uuid.UUID) -> object:
    return await conn.fetchval("select stale_at from rps_session where id = $1", session_id)


async def test_fr2_31_days_idle_is_marked_stale_29_days_is_not(
    migrated: asyncpg.Connection,
) -> None:
    old = await _aged(migrated, 31)
    recent = await _aged(migrated, 29)

    marked = await stale.mark_stale(migrated, clock.now())

    assert old.id in marked
    assert recent.id not in marked
    assert await _stale_at(migrated, old.id) is not None
    assert await _stale_at(migrated, recent.id) is None


async def test_deleted_session_is_never_marked_and_a_second_sweep_marks_nothing(
    migrated: asyncpg.Connection,
) -> None:
    deleted = await _aged(migrated, 31)
    await migrated.execute(
        "update rps_session set deleted_at = now(), deleted_reason = 'admin' where id = $1",
        deleted.id,
    )
    old = await _aged(migrated, 31)
    await stale.mark_stale(migrated, clock.now())

    again = await stale.mark_stale(migrated, clock.now())

    assert await _stale_at(migrated, deleted.id) is None
    assert old.id not in again


def test_nothing_is_ever_deleted() -> None:
    assert "delete from" not in Path(stale.__file__).read_text().lower()


async def test_run_periodically_runs_mark_stale_on_a_timer(
    migrated: asyncpg.Connection, database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = await _aged(migrated, 31)
    monkeypatch.setattr(stale, "CHECK_INTERVAL_S", 0.02)
    pool = await app_db.create_pool(database_url)
    task = asyncio.create_task(stale.run_periodically(pool))
    try:
        await asyncio.sleep(0.2)
    finally:
        task.cancel()
        await pool.close()

    assert await _stale_at(migrated, session.id) is not None
