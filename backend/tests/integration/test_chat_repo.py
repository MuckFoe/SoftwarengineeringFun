"""Spec 002 task 11: chat repository (FR11, FR12, FR17, FR19)."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app import db as app_db
from app.chat import repo

T0 = datetime(2026, 10, 25, 9, 0, tzinfo=UTC)


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    """A new session with one participant, Ana; returns (session_id, participant_id)."""
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ('Add', 'Add', 'def add(a: int, b: int) -> int', 'add', '[]'::jsonb, 'int')
           returning id"""
    )
    session_id = await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        problem_id,
    )
    participant_id = await conn.fetchval(
        "insert into participant (session_id, display_name) values ($1, 'Ana') returning id",
        session_id,
    )
    return session_id, participant_id


async def _send(
    conn: asyncpg.Connection, session: tuple[uuid.UUID, uuid.UUID], *texts: str
) -> list[repo.ChatMessage]:
    session_id, participant_id = session
    return [
        await repo.insert(conn, session_id, participant_id, "Ana", text, T0 + timedelta(seconds=i))
        for i, text in enumerate(texts)
    ]


async def test_insert_returns_the_stored_message(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)

    (message,) = await _send(migrated, session, "  <b>hi</b>\n")

    assert isinstance(message.id, int)
    assert message.sender_name == "Ana"
    assert message.text == "  <b>hi</b>\n"  # stored exactly as typed
    assert message.sent_at == T0


async def test_fr11_history_survives_a_new_connection_in_send_order(
    migrated: asyncpg.Connection, database_url: str
) -> None:
    session = await _session(migrated)
    await _send(migrated, session, "one", "two", "three")

    pool = await app_db.create_pool(database_url)
    try:
        async with pool.acquire() as fresh:
            history = await repo.history(fresh, session[0])
    finally:
        await pool.close()

    assert [m.text for m in history] == ["one", "two", "three"]
    assert [m.id for m in history] == sorted(m.id for m in history)


async def test_fr12_history_holds_every_message(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    await _send(migrated, session, *(f"m{i}" for i in range(50)))

    history = await repo.history(migrated, session[0])

    assert [m.text for m in history] == [f"m{i}" for i in range(50)]


async def test_fr17_sessions_never_see_each_others_messages(
    migrated: asyncpg.Connection,
) -> None:
    a, b = await _session(migrated), await _session(migrated)
    (from_a,) = await _send(migrated, a, "for A only")
    await _send(migrated, b, "for B")

    assert [m.text for m in await repo.history(migrated, b[0])] == ["for B"]
    assert await repo.mark_removed(migrated, b[0], from_a.id, "admin-sub") is False
    assert [m.text for m in await repo.history(migrated, a[0])] == ["for A only"]


async def test_fr19_a_removed_message_is_hidden_but_kept(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    _, two, _ = await _send(migrated, session, "one", "two", "three")

    assert await repo.mark_removed(migrated, session[0], two.id, "admin-sub") is True

    assert [m.text for m in await repo.history(migrated, session[0])] == ["one", "three"]
    row = await migrated.fetchrow(
        "select body, removed_at, removed_by_sub from chat_message where id = $1", two.id
    )
    assert row["body"] == "two"
    assert row["removed_at"] is not None
    assert row["removed_by_sub"] == "admin-sub"


async def test_fr19_removing_twice_or_an_unknown_id_is_false(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    (message,) = await _send(migrated, session, "one")

    assert await repo.mark_removed(migrated, session[0], message.id, "admin-sub") is True
    assert await repo.mark_removed(migrated, session[0], message.id, "other-admin") is False
    assert await repo.mark_removed(migrated, session[0], 999_999_999, "admin-sub") is False

    by = await migrated.fetchval(
        "select removed_by_sub from chat_message where id = $1", message.id
    )
    assert by == "admin-sub"
