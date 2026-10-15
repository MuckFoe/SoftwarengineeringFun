"""Smoke test for the test stack (task 6): Postgres from docker-compose.test.yml via fixtures."""

from datetime import UTC, datetime, timedelta

from app import clock


async def test_db_fixture_runs_select_1(db):
    assert await db.fetchval("select 1") == 1


async def test_db_fixture_gives_a_database_of_its_own(db, database_url):
    name = await db.fetchval("select current_database()")
    assert name.startswith("test_")
    assert name in database_url
    await db.execute("create table scratch (id int)")


async def test_db_fixture_state_is_shared_within_the_module(db):
    # Same module, same database: the table from the previous test is still there.
    assert await db.fetchval("select to_regclass('scratch') is not null")


def test_clock_fixture_overrides_now(frozen_clock):
    start = datetime(2026, 1, 1, tzinfo=UTC)
    frozen_clock.set(start)
    assert clock.now() == start
    frozen_clock.advance(timedelta(days=29))
    assert clock.now() == start + timedelta(days=29)
