"""Spec 002 task 11: chat repository (FR11, FR12, FR17, FR19); spec 007 task 8: GIF rows."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app import db as app_db
from app.chat import repo
from app.gifs.models import GifRef

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


# Spec 007 task 8: GIF rows (FR-6, FR-12).

DANCE = GifRef(
    id="abc123",
    title="Happy dance",
    url="https://media.giphy.com/media/abc123/200w.gif",
    still_url="https://media.giphy.com/media/abc123/200w_s.gif",
    width=200,
    height=150,
)


async def test_fr12_a_gif_row_holds_a_reference_and_no_body(
    migrated: asyncpg.Connection,
) -> None:
    session_id, participant_id = await _session(migrated)

    message = await repo.insert_gif(migrated, session_id, participant_id, "Ana", DANCE)

    assert message.kind == "gif"
    assert message.gif == DANCE
    assert message.text is None
    assert message.sender_name == "Ana"
    row = await migrated.fetchrow(
        """select kind, body, gif_id, gif_title, gif_url, gif_still_url, gif_width, gif_height
           from chat_message where id = $1""",
        message.id,
    )
    assert dict(row) == {
        "kind": "gif",
        "body": None,
        "gif_id": "abc123",
        "gif_title": "Happy dance",
        "gif_url": DANCE.url,
        "gif_still_url": DANCE.still_url,
        "gif_width": 200,
        "gif_height": 150,
    }


async def test_fr12_chat_message_has_no_binary_column(migrated: asyncpg.Connection) -> None:
    types = await migrated.fetch(
        """select data_type from information_schema.columns
           where table_name = 'chat_message'"""
    )
    assert types
    assert "bytea" not in {t["data_type"] for t in types}


async def test_fr6_history_returns_text_and_gif_in_id_order(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    (first,) = await _send(migrated, session, "before")
    gif = await repo.insert_gif(migrated, session[0], session[1], "Ana", DANCE)
    (last,) = await _send(migrated, session, "after")

    history = await repo.history(migrated, session[0])

    assert [m.kind for m in history] == ["text", "gif", "text"]
    assert [m.id for m in history] == [first.id, gif.id, last.id]
    assert [m.text for m in history] == ["before", None, "after"]
    assert history[1].gif == DANCE
    assert history[0].gif is None


async def test_existing_text_rows_still_follow_002s_length_rule(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    (message,) = await _send(migrated, session, "x" * 2000)
    assert message.kind == "text"

    for body in ("", "x" * 2001):
        with pytest.raises(asyncpg.CheckViolationError):
            await _send(migrated, session, body)


@pytest.mark.parametrize(
    "columns",
    [
        {"gif_url": "javascript:alert(1)"},
        {"gif_still_url": "javascript:alert(1)"},
        {"body": "a caption"},
        {"gif_width": 0},
        {"gif_id": None},
        {"gif_url": None},
        {"gif_still_url": None},
        {"gif_width": None},
        {"gif_height": None},
    ],
)
async def test_the_constraint_rejects_a_malformed_gif_row(
    migrated: asyncpg.Connection, columns: dict[str, object]
) -> None:
    session_id, participant_id = await _session(migrated)
    values: dict[str, object] = {
        "body": None,
        "gif_id": DANCE.id,
        "gif_title": DANCE.title,
        "gif_url": DANCE.url,
        "gif_still_url": DANCE.still_url,
        "gif_width": DANCE.width,
        "gif_height": DANCE.height,
    } | columns

    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            """insert into chat_message (session_id, participant_id, sender_name, sent_at, kind,
                   body, gif_id, gif_title, gif_url, gif_still_url, gif_width, gif_height)
               values ($1, $2, 'Ana', $3, 'gif', $4, $5, $6, $7, $8, $9, $10)""",
            session_id,
            participant_id,
            T0,
            *values.values(),
        )


async def test_a_text_row_with_gif_fields_is_rejected(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _session(migrated)

    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            """insert into chat_message (session_id, participant_id, sender_name, sent_at, body,
                   gif_id)
               values ($1, $2, 'Ana', $3, 'hi', 'abc123')""",
            session_id,
            participant_id,
            T0,
        )


async def test_a_text_row_without_a_body_is_rejected(migrated: asyncpg.Connection) -> None:
    # A check that evaluates to NULL passes in Postgres; the shape check must not.
    session_id, participant_id = await _session(migrated)

    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            """insert into chat_message (session_id, participant_id, sender_name, sent_at, body)
               values ($1, $2, 'Ana', $3, null)""",
            session_id,
            participant_id,
            T0,
        )
