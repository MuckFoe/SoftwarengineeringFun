"""Task 9: DB pool, migration runner and schema (FR-26, FR-27, NFR-8, NFR-9).

Spec 002 task 1: `problem_image` and `chat_message` (FR3, FR11, FR19).
"""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

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
    "problem_image",
    "chat_message",
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
    recorded = await db.fetch("select name from schema_migration order by name")
    assert [r["name"] for r in recorded] == [
        "0001_init.sql",
        "0002_seed_key.sql",
        "0003_descriptions_and_chat.sql",
    ]


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


async def _participant(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    session_id, _ = await _session_with_problem(conn)
    participant_id = await conn.fetchval(
        "insert into participant (session_id, display_name) values ($1, 'Ana') returning id",
        session_id,
    )
    return session_id, participant_id


async def _insert_chat(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    body: str,
    removed_at: datetime | None = None,
    removed_by_sub: str | None = None,
) -> int:
    return await conn.fetchval(
        """insert into chat_message (session_id, participant_id, sender_name, body, sent_at,
                                     removed_at, removed_by_sub)
           values ($1, $2, 'Ana', $3, now(), $4, $5) returning id""",
        session_id,
        participant_id,
        body,
        removed_at,
        removed_by_sub,
    )


async def _insert_image(conn: asyncpg.Connection, media_type: str, data: bytes) -> None:
    await conn.execute(
        "insert into problem_image (media_type, data, uploaded_by_sub) values ($1, $2, 'ed')",
        media_type,
        data,
    )


async def test_002_chat_index_exists(migrated: asyncpg.Connection) -> None:
    names = await migrated.fetch("select indexname from pg_indexes where schemaname = 'public'")
    assert "chat_message_session_id_idx" in {r["indexname"] for r in names}


async def test_002_fr14_chat_body_over_2000_characters_is_refused(
    migrated: asyncpg.Connection,
) -> None:
    session_id, participant_id = await _participant(migrated)
    await _insert_chat(migrated, session_id, participant_id, "😀" * 2000)

    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, "x" * 2001)
    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, "")


async def test_002_fr19_removed_at_and_removed_by_sub_are_set_together(
    migrated: asyncpg.Connection,
) -> None:
    session_id, participant_id = await _participant(migrated)
    now = datetime.now(UTC)
    await _insert_chat(migrated, session_id, participant_id, "ok", now, "admin-sub")

    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, "x", now, None)
    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, "x", None, "admin-sub")


async def test_002_fr3_image_media_type_is_restricted(migrated: asyncpg.Connection) -> None:
    for media_type in ("image/png", "image/jpeg", "image/gif", "image/webp"):
        await _insert_image(migrated, media_type, b"x")

    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_image(migrated, "image/svg+xml", b"<svg/>")


async def test_002_fr4_image_size_is_1_to_2097152_bytes(migrated: asyncpg.Connection) -> None:
    await _insert_image(migrated, "image/png", b"x" * 2097152)

    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_image(migrated, "image/png", b"x" * 2097153)
    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_image(migrated, "image/png", b"")


async def test_002_fr11_chat_ids_increase_in_insert_order(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _participant(migrated)
    for body in ("one", "two", "three"):
        await _insert_chat(migrated, session_id, participant_id, body)

    rows = await migrated.fetch(
        "select body from chat_message where session_id = $1 order by id", session_id
    )
    assert [r["body"] for r in rows] == ["one", "two", "three"]


async def test_pool_connects_to_the_database(database_url: str) -> None:
    pool = await app_db.create_pool(database_url)
    try:
        assert await pool.fetchval("select 1") == 1
    finally:
        await pool.close()
