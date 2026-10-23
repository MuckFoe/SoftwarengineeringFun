"""Task 26: the stale-session job (`sessions/stale.py`, main.py). FR-29, NFR-9."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.config import Settings
from app.main import create_app, lifespan
from app.sessions import repo as sessions_repo
from app.sessions import stale

TABLES = (
    "problem",
    "problem_test",
    "session",
    "session_problem",
    "participant",
    "yjs_update",
    "run",
    "run_result",
    "session_event",
)


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> uuid.UUID:
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter)
           values ('p', 'd', 'def add(a: int, b: int) -> int', 'add', '[]'::jsonb, 'int', false)
           returning id"""
    )
    session = await sessions_repo.create(conn, problem_id)
    return session.id


async def _age_session(conn: asyncpg.Connection, session_id: uuid.UUID, age: timedelta) -> None:
    await conn.execute(
        "update session set last_activity_at = $2 where id = $1",
        session_id,
        clock.now() - age,
    )


async def _row_counts(conn: asyncpg.Connection) -> dict[str, int]:
    return {t: await conn.fetchval(f"select count(*) from {t}") for t in TABLES}  # noqa: S608


async def test_fr29_a_session_inactive_for_31_days_is_marked_stale(
    migrated: asyncpg.Connection, frozen_clock
) -> None:
    session_id = await _session(migrated)
    await _age_session(migrated, session_id, timedelta(days=31))
    before = await _row_counts(migrated)

    marked = await stale.mark_stale(migrated, clock.now())

    assert marked == [session_id]
    row = await migrated.fetchrow("select stale_at from session where id = $1", session_id)
    assert row is not None
    assert row["stale_at"] is not None
    after = await _row_counts(migrated)
    expected = dict(before)
    expected["session_event"] += 1
    assert after == expected
    event = await migrated.fetchrow(
        "select kind from session_event where session_id = $1", session_id
    )
    assert event is not None
    assert event["kind"] == "stale"


async def test_a_session_inactive_for_29_days_is_not_marked(
    migrated: asyncpg.Connection, frozen_clock
) -> None:
    session_id = await _session(migrated)
    await _age_session(migrated, session_id, timedelta(days=29))

    marked = await stale.mark_stale(migrated, clock.now())

    assert marked == []
    row = await migrated.fetchrow("select stale_at from session where id = $1", session_id)
    assert row is not None
    assert row["stale_at"] is None


def test_nfr9_nothing_is_deleted() -> None:
    source = Path(stale.__file__).read_text()
    assert "delete from" not in source.lower()


async def test_run_periodically_runs_mark_stale_on_a_timer(
    migrated: asyncpg.Connection,
    database_url: str,
    frozen_clock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_id = await _session(migrated)
    await _age_session(migrated, session_id, timedelta(days=31))
    monkeypatch.setattr(stale, "CHECK_INTERVAL_S", 0.02)
    pool = await app_db.create_pool(database_url)
    task = asyncio.create_task(stale.run_periodically(pool))
    try:
        await asyncio.sleep(0.2)
    finally:
        task.cancel()
        await pool.close()

    row = await migrated.fetchrow("select stale_at from session where id = $1", session_id)
    assert row is not None
    assert row["stale_at"] is not None


async def test_main_schedules_the_stale_job_at_startup(
    database_url: str, frozen_clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    conn = await asyncpg.connect(database_url)
    await app_db.migrate(conn)
    session_id = await _session(conn)
    await _age_session(conn, session_id, timedelta(days=31))
    await conn.close()
    monkeypatch.setattr(stale, "CHECK_INTERVAL_S", 0.02)

    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )
    app = create_app(settings)
    async with lifespan(app):
        await asyncio.sleep(0.2)

    check = await asyncpg.connect(database_url)
    try:
        row = await check.fetchrow("select stale_at from session where id = $1", session_id)
    finally:
        await check.close()
    assert row is not None
    assert row["stale_at"] is not None
