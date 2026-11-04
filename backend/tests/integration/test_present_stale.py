"""Spec 013 task 15: stale presentation sessions (`present/stale.py`). FR-31.

AC-15g (the stale part): with a frozen clock, 30 days + 1 s without activity marks a session
stale, 29 days doesn't; reactivating clears it and touches activity; reactivating a session
that isn't stale raises `SessionNotStale`. Nothing is ever deleted. A real database.
"""

import asyncio
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.present import repo, stale
from tests.conftest import FrozenClock

SLIDES = "".join(f"<section>Slide {i}</section>" for i in range(3))
PRESENT_TABLES = (
    "presentation",
    "presentation_version",
    "presentation_session",
    "presentation_participant",
    "presentation_chat_message",
)


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    await db.execute("truncate presentation_session cascade")
    yield db


async def _session(conn: asyncpg.Connection) -> repo.PresentSession:
    presentation = await repo.create_presentation(
        conn,
        title="Stale deck",
        topic="Testing",
        html=SLIDES,
        kind="slides",
        slide_count=3,
        created_by_sub="editor-sub",
    )
    assert presentation.current_version_id is not None
    return await repo.create_session(conn, presentation.current_version_id, slide=1)


async def _read(conn: asyncpg.Connection, invite_id: str) -> repo.PresentSession:
    row = await repo.get_session_by_invite(conn, invite_id)
    assert row is not None
    return row


async def _row_counts(conn: asyncpg.Connection) -> dict[str, int]:
    return {t: await conn.fetchval(f"select count(*) from {t}") for t in PRESENT_TABLES}  # noqa: S608


# --- mark_stale ------------------------------------------------------------------------------


async def test_ac15g_30_days_and_a_second_idle_marks_stale_and_deletes_nothing(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    frozen_clock.advance(timedelta(days=30, seconds=1))
    before = await _row_counts(migrated)

    marked = await stale.mark_stale(migrated, clock.now())

    assert marked == [session.id]
    row = await _read(migrated, session.invite_id)
    assert row.stale_at == clock.now()
    assert row.slide == 1  # the last place is kept
    assert await _row_counts(migrated) == before


async def test_ac15g_29_days_idle_is_not_marked(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    frozen_clock.advance(timedelta(days=29))

    assert await stale.mark_stale(migrated, clock.now()) == []
    assert (await _read(migrated, session.invite_id)).stale_at is None


async def test_an_already_stale_session_keeps_its_stale_at(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    frozen_clock.advance(timedelta(days=31))
    first = clock.now()
    assert await stale.mark_stale(migrated, first) == [session.id]
    frozen_clock.advance(timedelta(days=5))

    assert await stale.mark_stale(migrated, clock.now()) == []
    assert (await _read(migrated, session.invite_id)).stale_at == first


def test_nothing_is_ever_deleted() -> None:
    assert "delete from" not in Path(stale.__file__).read_text().lower()


async def test_run_periodically_runs_mark_stale_on_a_timer(
    migrated: asyncpg.Connection, database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = await _session(migrated)
    await migrated.execute(
        "update presentation_session set last_activity_at = $2 where id = $1",
        session.id,
        clock.now() - timedelta(days=31),
    )
    monkeypatch.setattr(stale, "CHECK_INTERVAL_S", 0.02)
    pool = await app_db.create_pool(database_url)
    task = asyncio.create_task(stale.run_periodically(pool))
    try:
        await asyncio.sleep(0.2)
    finally:
        task.cancel()
        await pool.close()

    assert (await _read(migrated, session.invite_id)).stale_at is not None


# --- reactivate ------------------------------------------------------------------------------


async def test_ac15g_reactivate_clears_stale_and_touches_activity(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    frozen_clock.advance(timedelta(days=30, seconds=1))
    assert await stale.mark_stale(migrated, clock.now()) == [session.id]
    frozen_clock.advance(timedelta(days=2))

    await stale.reactivate(migrated, session.invite_id)

    row = await _read(migrated, session.invite_id)
    assert row.stale_at is None
    assert row.last_activity_at == clock.now()
    assert row.slide == 1


async def test_ac15g_reactivating_a_session_that_is_not_stale_raises(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)

    with pytest.raises(stale.SessionNotStale):
        await stale.reactivate(migrated, session.invite_id)


async def test_reactivating_an_unknown_invite_raises_not_found(
    migrated: asyncpg.Connection,
) -> None:
    with pytest.raises(stale.SessionNotFound):
        await stale.reactivate(migrated, "no-such-invite")
