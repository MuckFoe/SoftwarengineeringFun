"""Task 9: DB pool, migration runner and schema (FR-26, FR-27, NFR-8, NFR-9)."""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db

TABLES = {
    "problem",
    "problem_test",
    "session",
    "session_problem",
    "participant",
    "yjs_update",
    "run",
    "run_result",
    "session_event",
}


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session_with_problem(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter)
           values ('Add', 'Add two ints', 'def add(a: int, b: int) -> int', 'add',
                   '[]'::jsonb, 'int', true)
           returning id"""
    )
    session_id = await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        problem_id,
    )
    return session_id, problem_id


async def _insert_run(
    conn: asyncpg.Connection, session_id: uuid.UUID, problem_id: uuid.UUID, status: str
) -> uuid.UUID:
    participant_id = await conn.fetchval(
        "insert into participant (session_id, display_name) values ($1, 'Ada') returning id",
        session_id,
    )
    return await conn.fetchval(
        """insert into run (session_id, problem_id, code, participant_id, status)
           values ($1, $2, 'def add(a, b): return a + b', $3, $4) returning id""",
        session_id,
        problem_id,
        participant_id,
        status,
    )


async def test_migrations_applied_twice_apply_once(db: asyncpg.Connection) -> None:
    await app_db.migrate(db)
    second = await app_db.migrate(db)

    assert second == []
    recorded = await db.fetch("select name from schema_migration")
    assert [r["name"] for r in recorded] == ["0001_init.sql"]


async def test_fr27_schema_has_every_table_from_the_plan(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        "select table_name from information_schema.tables where table_schema = 'public'"
    )
    assert TABLES <= {r["table_name"] for r in rows}


async def test_fr26_second_running_run_for_one_session_fails(
    migrated: asyncpg.Connection,
) -> None:
    session_id, problem_id = await _session_with_problem(migrated)
    await _insert_run(migrated, session_id, problem_id, "running")

    with pytest.raises(asyncpg.UniqueViolationError, match="run_one_active"):
        await _insert_run(migrated, session_id, problem_id, "running")


async def test_fr26_finished_runs_do_not_block_a_new_running_run(
    migrated: asyncpg.Connection,
) -> None:
    session_id, problem_id = await _session_with_problem(migrated)
    await _insert_run(migrated, session_id, problem_id, "done")
    await _insert_run(migrated, session_id, problem_id, "infra_error")

    await _insert_run(migrated, session_id, problem_id, "running")


async def test_fr26_run_status_is_restricted(migrated: asyncpg.Connection) -> None:
    session_id, problem_id = await _session_with_problem(migrated)

    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_run(migrated, session_id, problem_id, "queued")


async def test_nfr8_no_column_name_contains_password(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        """select table_name, column_name from information_schema.columns
           where table_schema = 'public' and column_name ilike '%password%'"""
    )
    assert rows == []


async def test_nfr9_no_foreign_key_cascades_deletes(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        """select conname from pg_constraint
           where contype = 'f' and confdeltype in ('c', 'n', 'd')"""
    )
    assert rows == []


async def test_pool_connects_to_the_database(database_url: str) -> None:
    pool = await app_db.create_pool(database_url)
    try:
        assert await pool.fetchval("select 1") == 1
    finally:
        await pool.close()
