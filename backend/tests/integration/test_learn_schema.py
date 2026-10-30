"""Spec 006 task 1: migration 0004, the learning tables (FR-25, FR-28, NFR-5, NFR-6)."""

import shutil
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db

LEARN_TABLES = {
    "lesson_asset",
    "lesson_version",
    "lesson",
    "learning_session",
    "learning_participant",
    "learning_step",
    "learning_attempt",
    "learning_chat_message",
}


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _columns(conn: asyncpg.Connection) -> set[tuple[str, str, str]]:
    rows = await conn.fetch(
        """select table_name, column_name, data_type from information_schema.columns
           where table_schema = 'public' and table_name <> 'schema_migration'"""
    )
    return {(r["table_name"], r["column_name"], r["data_type"]) for r in rows}


async def test_nfr5_0004_applies_on_a_db_already_at_0003_and_leaves_old_tables_alone(
    database_url: str, tmp_path: Path
) -> None:
    # This module's database is fresh; bring it to 0003 only, using a copy of 0001-0003.
    for name in (
        "0001_init.sql",
        "0002_seed_key.sql",
        "0003_descriptions_and_chat.sql",
    ):
        shutil.copy(app_db.MIGRATIONS_DIR / name, tmp_path / name)
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn, tmp_path)
        before = await _columns(conn)
        assert not LEARN_TABLES & {t for t, _, _ in before}

        applied = await app_db.migrate(conn)

        assert applied == ["0004_learning_sessions.sql"]
        after = await _columns(conn)
        assert {c for c in after if c[0] not in LEARN_TABLES} == before
        assert LEARN_TABLES <= {t for t, _, _ in after}
    finally:
        await conn.close()


async def test_0004_applies_on_a_fresh_db_after_0001_to_0003(migrated: asyncpg.Connection) -> None:
    recorded = await migrated.fetch("select name from schema_migration order by name")
    assert [r["name"] for r in recorded][-1] == "0004_learning_sessions.sql"
    rows = await migrated.fetch(
        "select table_name from information_schema.tables where table_schema = 'public'"
    )
    assert LEARN_TABLES <= {r["table_name"] for r in rows}


async def test_learn_indexes_exist(migrated: asyncpg.Connection) -> None:
    names = await migrated.fetch("select indexname from pg_indexes where schemaname = 'public'")
    assert {"learning_attempt_step", "learning_chat_message_session"} <= {
        r["indexname"] for r in names
    }


async def test_nfr6_no_foreign_key_on_learn_tables_cascades(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        """select conname from pg_constraint
           where contype = 'f' and confdeltype <> 'a'
             and conrelid::regclass::text = any($1::text[])""",
        list(LEARN_TABLES),
    )
    assert rows == []


async def _version(conn: asyncpg.Connection, content_hash: str | None = None) -> uuid.UUID:
    return await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ('docker/01-basics', $1, '{}'::jsonb) returning id""",
        content_hash or uuid.uuid4().hex,
    )


async def _participant(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    version_id = await _version(conn)
    session_id = await conn.fetchval(
        "insert into learning_session (invite_id, lesson_version_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        version_id,
    )
    participant_id = await conn.fetchval(
        """insert into learning_participant (session_id, display_name)
           values ($1, 'Ana') returning id""",
        session_id,
    )
    return session_id, participant_id


async def test_fr28_lesson_version_key_and_hash_are_unique(migrated: asyncpg.Connection) -> None:
    await _version(migrated, "abc")

    with pytest.raises(asyncpg.UniqueViolationError):
        await _version(migrated, "abc")


async def test_lesson_asset_media_type_is_restricted(migrated: asyncpg.Connection) -> None:
    for i, media_type in enumerate(("image/png", "image/jpeg", "image/gif", "image/webp")):
        await migrated.execute(
            "insert into lesson_asset (sha256, media_type, data) values ($1, $2, 'x')",
            f"hash-{i}",
            media_type,
        )

    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "insert into lesson_asset (sha256, media_type, data) values ($1, $2, 'x')",
            "svg",
            "image/svg+xml",
        )


async def test_learning_step_passed_at_requires_passed_by_name(
    migrated: asyncpg.Connection,
) -> None:
    session_id, _ = await _participant(migrated)
    insert = """insert into learning_step (session_id, position, passed_at, passed_by_name)
                values ($1, $2, $3, $4)"""
    await migrated.execute(insert, session_id, 0, None, None)
    await migrated.execute(insert, session_id, 1, datetime.now(UTC), "Ana")

    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(insert, session_id, 2, datetime.now(UTC), None)
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(insert, session_id, 3, None, "Ana")


async def _insert_chat(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    body: str,
    removed_at: datetime | None = None,
    removed_by_sub: str | None = None,
) -> None:
    await conn.execute(
        """insert into learning_chat_message (session_id, participant_id, sender_name, body,
                                              sent_at, removed_at, removed_by_sub)
           values ($1, $2, 'Ana', $3, now(), $4, $5)""",
        session_id,
        participant_id,
        body,
        removed_at,
        removed_by_sub,
    )


async def test_learning_chat_body_is_1_to_2000_characters(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _participant(migrated)
    await _insert_chat(migrated, session_id, participant_id, "😀" * 2000)

    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, "x" * 2001)
    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, "")


async def test_learning_chat_removed_at_requires_removed_by_sub(
    migrated: asyncpg.Connection,
) -> None:
    session_id, participant_id = await _participant(migrated)
    now = datetime.now(UTC)
    await _insert_chat(migrated, session_id, participant_id, "ok", now, "admin-sub")

    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, "x", now, None)
    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, "x", None, "admin-sub")


async def test_learning_attempt_kind_is_restricted(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _participant(migrated)
    insert = """insert into learning_attempt (session_id, position, participant_id, actor_name,
                                              kind, submitted, correct)
                values ($1, 0, $2, 'Ana', $3, '[1]'::jsonb, false)"""
    for kind in ("choice", "text", "command"):
        await migrated.execute(insert, session_id, participant_id, kind)

    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(insert, session_id, participant_id, "essay")
