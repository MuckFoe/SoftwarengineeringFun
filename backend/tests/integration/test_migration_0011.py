"""Spec 019 task 1: who started a session, and the deleted-session tombstone. FR-0, FR-8."""

import asyncpg
import pytest

from app import db as app_db


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> asyncpg.Connection:
    await db.execute("drop schema public cascade; create schema public")
    await app_db.migrate(db)
    return db


@pytest.mark.parametrize("table", ["session", "learning_session", "chess_session"])
async def test_fr0_each_session_table_has_a_nullable_started_by_sub(
    migrated: asyncpg.Connection, table: str
) -> None:
    row = await migrated.fetchrow(
        """select data_type, is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = $1 and column_name = 'started_by_sub'""",
        table,
    )
    assert row is not None
    assert row["data_type"] == "text"
    assert row["is_nullable"] == "YES"


async def test_fr8_deleted_session_accepts_a_tombstone_and_defaults_deleted_at(
    migrated: asyncpg.Connection,
) -> None:
    await migrated.execute(
        "insert into deleted_session (kind, invite_id, deleted_by) values ('coding', 'x', 'host')"
    )
    row = await migrated.fetchrow("select * from deleted_session")
    assert (row["kind"], row["invite_id"], row["deleted_by"]) == ("coding", "x", "host")
    assert row["deleted_at"] is not None


@pytest.mark.parametrize(
    ("kind", "deleted_by"),
    [("nonsense", "host"), ("Coding", "host"), ("coding", "someone"), ("chess", "Admin")],
)
async def test_fr8_deleted_session_rejects_an_unknown_kind_or_deleted_by(
    migrated: asyncpg.Connection, kind: str, deleted_by: str
) -> None:
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "insert into deleted_session (kind, invite_id, deleted_by) values ($1, 'x', $2)",
            kind,
            deleted_by,
        )


async def test_fr8_deleted_session_accepts_every_kind_and_rejects_a_duplicate(
    migrated: asyncpg.Connection,
) -> None:
    for kind in ("coding", "learning", "presentation", "chess"):
        await migrated.execute(
            "insert into deleted_session (kind, invite_id, deleted_by) values ($1, 'y', 'admin')",
            kind,
        )
    with pytest.raises(asyncpg.UniqueViolationError):
        await migrated.execute(
            "insert into deleted_session (kind, invite_id, deleted_by)"
            " values ('chess', 'y', 'host')"
        )
