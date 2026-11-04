"""Spec 012 task 1: migration 0007, accounts on participants and account preferences.

FR-1, FR-5, FR-7, FR-13, FR-15, NFR-3.
"""

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

import asyncpg
import pytest

from app import db as app_db

PARTICIPANT_TABLES = ("participant", "learning_participant", "presentation_participant")


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _pair_session(conn: asyncpg.Connection) -> uuid.UUID:
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter)
           values ('Add', 'Add two ints', 'def add(a: int, b: int) -> int', 'add',
                   '[]'::jsonb, 'int', false)
           returning id"""
    )
    return await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        problem_id,
    )


async def _learning_session(conn: asyncpg.Connection) -> uuid.UUID:
    version_id = await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ('docker/01-basics', $1, '{}'::jsonb) returning id""",
        uuid.uuid4().hex,
    )
    return await conn.fetchval(
        "insert into learning_session (invite_id, lesson_version_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        version_id,
    )


async def _presentation_session(conn: asyncpg.Connection) -> uuid.UUID:
    presentation_id = await conn.fetchval(
        """insert into presentation (title, topic, created_by_sub)
           values ('Intro', 'docker', 'author-sub') returning id"""
    )
    version_id = await conn.fetchval(
        """insert into presentation_version (presentation_id, html, kind, slide_count,
                                             created_by_sub)
           values ($1, '<section>One</section>', 'slides', 1, 'author-sub') returning id""",
        presentation_id,
    )
    return await conn.fetchval(
        """insert into presentation_session (invite_id, version_id, slide)
           values ($1, $2, 0) returning id""",
        uuid.uuid4().hex,
        version_id,
    )


SESSION_MAKERS: dict[str, Callable[[asyncpg.Connection], Awaitable[uuid.UUID]]] = {
    "participant": _pair_session,
    "learning_participant": _learning_session,
    "presentation_participant": _presentation_session,
}


async def _add_participant(
    conn: asyncpg.Connection,
    table: str,
    session_id: uuid.UUID,
    account_sub: str | None,
    hidden: bool = False,
) -> uuid.UUID:
    if table == "presentation_participant":
        return await conn.fetchval(
            """insert into presentation_participant
                   (session_id, display_name, rejoin_token_hash, account_sub, hidden_at)
               values ($1, 'Ana', $2, $3, case when $4 then now() end) returning id""",
            session_id,
            uuid.uuid4().hex,
            account_sub,
            hidden,
        )
    return await conn.fetchval(
        f"""insert into {table} (session_id, display_name, account_sub, hidden_at)
            values ($1, 'Ana', $2, case when $3 then now() end) returning id""",  # noqa: S608
        session_id,
        account_sub,
        hidden,
    )


async def test_0007_is_recorded_after_0006(migrated: asyncpg.Connection) -> None:
    names = [
        r["name"] for r in await migrated.fetch("select name from schema_migration order by name")
    ]
    assert names.index("0007_accounts.sql") == names.index("0006_presentations.sql") + 1


async def test_participant_tables_have_nullable_account_sub_and_hidden_at(
    migrated: asyncpg.Connection,
) -> None:
    rows = await migrated.fetch(
        """select table_name, column_name, data_type, is_nullable
           from information_schema.columns
           where table_schema = 'public' and column_name in ('account_sub', 'hidden_at')"""
    )
    found = {(r["table_name"], r["column_name"]): (r["data_type"], r["is_nullable"]) for r in rows}
    for table in PARTICIPANT_TABLES:
        assert found[(table, "account_sub")] == ("text", "YES")
        assert found[(table, "hidden_at")] == ("timestamp with time zone", "YES")


@pytest.mark.parametrize("table", PARTICIPANT_TABLES)
async def test_fr5_fr7_second_participant_for_one_account_in_one_session_fails(
    migrated: asyncpg.Connection, table: str
) -> None:
    session_id = await SESSION_MAKERS[table](migrated)
    await _add_participant(migrated, table, session_id, "sub-ana")

    with pytest.raises(asyncpg.UniqueViolationError):
        await _add_participant(migrated, table, session_id, "sub-ana")


@pytest.mark.parametrize("table", PARTICIPANT_TABLES)
async def test_one_account_may_join_different_sessions(
    migrated: asyncpg.Connection, table: str
) -> None:
    for _ in range(2):
        session_id = await SESSION_MAKERS[table](migrated)
        await _add_participant(migrated, table, session_id, "sub-ana")


@pytest.mark.parametrize("table", PARTICIPANT_TABLES)
async def test_fr6_two_anonymous_participants_in_one_session_succeed(
    migrated: asyncpg.Connection, table: str
) -> None:
    session_id = await SESSION_MAKERS[table](migrated)
    await _add_participant(migrated, table, session_id, None)
    await _add_participant(migrated, table, session_id, None)

    count = await migrated.fetchval(
        f"select count(*) from {table} where session_id = $1 and account_sub is null",  # noqa: S608
        session_id,
    )
    assert count == 2


@pytest.mark.parametrize("table", PARTICIPANT_TABLES)
async def test_fr13_hidden_at_on_an_anonymous_participant_fails(
    migrated: asyncpg.Connection, table: str
) -> None:
    session_id = await SESSION_MAKERS[table](migrated)
    with pytest.raises(asyncpg.CheckViolationError):
        await _add_participant(migrated, table, session_id, None, hidden=True)

    participant_id = await _add_participant(migrated, table, session_id, None)
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            f"update {table} set hidden_at = now() where id = $1",  # noqa: S608
            participant_id,
        )


@pytest.mark.parametrize("table", PARTICIPANT_TABLES)
async def test_fr13_hidden_at_on_an_account_participant_succeeds(
    migrated: asyncpg.Connection, table: str
) -> None:
    session_id = await SESSION_MAKERS[table](migrated)
    participant_id = await _add_participant(migrated, table, session_id, "sub-ana")
    await migrated.execute(
        f"update {table} set hidden_at = now() where id = $1",  # noqa: S608
        participant_id,
    )

    assert await migrated.fetchval(
        f"select hidden_at from {table} where id = $1",  # noqa: S608
        participant_id,
    )


async def test_fr15_appearance_accepts_light_dark_system(migrated: asyncpg.Connection) -> None:
    for i, appearance in enumerate(("light", "dark", "system")):
        await migrated.execute(
            """insert into account_preference (account_sub, appearance, chat_visible)
               values ($1, $2, true)""",
            f"sub-{i}",
            appearance,
        )
    updated_at = await migrated.fetchval(
        "select updated_at from account_preference where account_sub = 'sub-0'"
    )
    assert updated_at is not None


async def test_fr15_appearance_outside_the_three_values_fails(
    migrated: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            """insert into account_preference (account_sub, appearance, chat_visible)
               values ('sub-x', 'sepia', true)"""
        )


async def test_nfr3_one_preference_row_per_account(migrated: asyncpg.Connection) -> None:
    await migrated.execute(
        """insert into account_preference (account_sub, appearance, chat_visible)
           values ('sub-one', 'dark', false)"""
    )
    with pytest.raises(asyncpg.UniqueViolationError):
        await migrated.execute(
            """insert into account_preference (account_sub, appearance, chat_visible)
               values ('sub-one', 'light', true)"""
        )


async def test_preference_columns_are_required(migrated: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.NotNullViolationError):
        await migrated.execute(
            "insert into account_preference (account_sub, appearance) values ('sub-n', 'dark')"
        )


async def test_0007_adds_no_cascading_foreign_keys(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        """select conname from pg_constraint
           where contype = 'f' and confdeltype <> 'a'
             and conrelid::regclass::text = any($1::text[])""",
        [*PARTICIPANT_TABLES, "account_preference"],
    )
    assert rows == []
