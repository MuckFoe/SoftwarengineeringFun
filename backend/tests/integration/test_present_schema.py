"""Spec 013 task 1: migration 0006, the presentation tables.

FR-1, FR-4, FR-5, FR-24, FR-30, FR-32.
"""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import asyncpg
import pytest

from app import db as app_db

PRESENT_TABLES = {
    "presentation",
    "presentation_version",
    "presentation_session",
    "presentation_participant",
    "presentation_chat_message",
}

MAX_HTML_BYTES = 5 * 1024 * 1024


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _presentation(
    conn: asyncpg.Connection, title: str = "Intro to Docker", topic: str = "docker"
) -> uuid.UUID:
    return await conn.fetchval(
        """insert into presentation (title, topic, created_by_sub)
           values ($1, $2, 'author-sub') returning id""",
        title,
        topic,
    )


async def _version(
    conn: asyncpg.Connection,
    presentation_id: uuid.UUID,
    html: str = "<section>One</section>",
    kind: str = "slides",
    slide_count: int = 1,
) -> uuid.UUID:
    return await conn.fetchval(
        """insert into presentation_version (presentation_id, html, kind, slide_count,
                                             created_by_sub)
           values ($1, $2, $3, $4, 'author-sub') returning id""",
        presentation_id,
        html,
        kind,
        slide_count,
    )


async def _session(conn: asyncpg.Connection, version_id: uuid.UUID) -> uuid.UUID:
    return await conn.fetchval(
        """insert into presentation_session (invite_id, version_id, slide)
           values ($1, $2, 0) returning id""",
        uuid.uuid4().hex,
        version_id,
    )


async def _participant(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    version_id = await _version(conn, await _presentation(conn))
    session_id = await _session(conn, version_id)
    participant_id = await conn.fetchval(
        """insert into presentation_participant (session_id, display_name, rejoin_token_hash)
           values ($1, 'Ana', $2) returning id""",
        session_id,
        uuid.uuid4().hex,
    )
    return session_id, participant_id


async def test_0006_creates_every_presentation_table(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        "select table_name from information_schema.tables where table_schema = 'public'"
    )
    assert PRESENT_TABLES <= {r["table_name"] for r in rows}
    names = [r["name"] for r in await migrated.fetch("select name from schema_migration")]
    assert "0006_presentations.sql" in names


async def test_ac1_title_is_1_to_100_and_topic_1_to_60_characters(
    migrated: asyncpg.Connection,
) -> None:
    await _presentation(migrated, "t" * 100, "p" * 60)

    for title, topic in (("t" * 101, "docker"), ("", "docker"), ("ok", "p" * 61), ("ok", "")):
        with pytest.raises(asyncpg.CheckViolationError):
            await _presentation(migrated, title, topic)


async def test_ac3_html_over_5_mib_is_refused(migrated: asyncpg.Connection) -> None:
    presentation_id = await _presentation(migrated)
    await _version(migrated, presentation_id, "x" * MAX_HTML_BYTES)

    with pytest.raises(asyncpg.CheckViolationError):
        await _version(migrated, presentation_id, "x" * (MAX_HTML_BYTES + 1))
    # bytes, not characters: 2-byte characters reach the limit at half the length
    with pytest.raises(asyncpg.CheckViolationError):
        await _version(migrated, presentation_id, "é" * (MAX_HTML_BYTES // 2 + 1))
    with pytest.raises(asyncpg.CheckViolationError):
        await _version(migrated, presentation_id, "")


async def test_ac4_two_versions_coexist_and_a_session_references_one(
    migrated: asyncpg.Connection,
) -> None:
    presentation_id = await _presentation(migrated)
    first = await _version(migrated, presentation_id)
    second = await _version(migrated, presentation_id, "<main>page</main>", "page", 0)
    await migrated.execute(
        "update presentation set current_version_id = $1 where id = $2", second, presentation_id
    )
    session_id = await _session(migrated, first)

    count = await migrated.fetchval(
        "select count(*) from presentation_version where presentation_id = $1", presentation_id
    )
    assert count == 2
    assert (
        await migrated.fetchval(
            "select version_id from presentation_session where id = $1", session_id
        )
        == first
    )
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await _session(migrated, uuid.uuid4())
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await migrated.execute(
            "update presentation set current_version_id = $1 where id = $2",
            uuid.uuid4(),
            presentation_id,
        )


async def test_slide_count_matches_kind(migrated: asyncpg.Connection) -> None:
    presentation_id = await _presentation(migrated)
    await _version(migrated, presentation_id, kind="slides", slide_count=3)
    await _version(migrated, presentation_id, kind="page", slide_count=0)

    for kind, slide_count in (("slides", 0), ("page", 3), ("deck", 1)):
        with pytest.raises(asyncpg.CheckViolationError):
            await _version(migrated, presentation_id, kind=kind, slide_count=slide_count)


async def test_presentation_removed_at_requires_removed_by_sub(
    migrated: asyncpg.Connection,
) -> None:
    presentation_id = await _presentation(migrated)
    await migrated.execute(
        "update presentation set removed_at = now(), removed_by_sub = 'admin' where id = $1",
        presentation_id,
    )
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "update presentation set removed_by_sub = null where id = $1", presentation_id
        )


async def test_session_invite_and_rejoin_hash_are_unique(migrated: asyncpg.Connection) -> None:
    session_id, _ = await _participant(migrated)
    invite = await migrated.fetchval(
        "select invite_id from presentation_session where id = $1", session_id
    )
    version_id = await migrated.fetchval(
        "select version_id from presentation_session where id = $1", session_id
    )
    with pytest.raises(asyncpg.UniqueViolationError):
        await migrated.execute(
            "insert into presentation_session (invite_id, version_id) values ($1, $2)",
            invite,
            version_id,
        )
    insert = """insert into presentation_participant (session_id, display_name, rejoin_token_hash)
                values ($1, 'Bo', 'same-hash')"""
    await migrated.execute(insert, session_id)
    with pytest.raises(asyncpg.UniqueViolationError):
        await migrated.execute(insert, session_id)


async def test_session_host_must_be_a_participant(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _participant(migrated)
    await migrated.execute(
        "update presentation_session set host_participant_id = $1 where id = $2",
        participant_id,
        session_id,
    )
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await migrated.execute(
            "update presentation_session set host_participant_id = $1 where id = $2",
            uuid.uuid4(),
            session_id,
        )


async def test_ac23_no_presentation_table_has_a_stroke_column(
    migrated: asyncpg.Connection,
) -> None:
    rows = await migrated.fetch(
        """select table_name, column_name from information_schema.columns
           where table_schema = 'public' and table_name like 'presentation%'
           order by table_name, ordinal_position"""
    )
    columns: dict[str, list[str]] = {}
    for r in rows:
        columns.setdefault(r["table_name"], []).append(r["column_name"])

    assert set(columns) == PRESENT_TABLES
    assert columns == {
        "presentation": [
            "id",
            "title",
            "topic",
            "current_version_id",
            "created_by_sub",
            "created_at",
            "removed_at",
            "removed_by_sub",
        ],
        "presentation_version": [
            "id",
            "presentation_id",
            "html",
            "kind",
            "slide_count",
            "created_by_sub",
            "created_at",
        ],
        "presentation_session": [
            "id",
            "invite_id",
            "version_id",
            "slide",
            "anchor",
            "host_participant_id",
            "host_away_since",
            "created_at",
            "last_activity_at",
            "stale_at",
        ],
        "presentation_participant": [
            "id",
            "session_id",
            "display_name",
            "rejoin_token_hash",
            "joined_at",
            "left_at",
            "account_sub",  # spec 012, migration 0007
            "hidden_at",
        ],
        "presentation_chat_message": [
            "id",
            "session_id",
            "participant_id",
            "sender_name",
            "body",
            "sent_at",
            "removed_at",
            "removed_by_sub",
            "kind",
            "gif_id",
            "gif_title",
            "gif_url",
            "gif_still_url",
            "gif_width",
            "gif_height",
        ],
    }
    for names in columns.values():
        assert not [n for n in names if "stroke" in n or "draw" in n]


async def test_fr24_no_drawing_table_exists(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        "select table_name from information_schema.tables where table_schema = 'public'"
    )
    assert not [
        r["table_name"] for r in rows if "stroke" in r["table_name"] or "draw" in r["table_name"]
    ]


async def test_no_foreign_key_on_presentation_tables_cascades(
    migrated: asyncpg.Connection,
) -> None:
    rows = await migrated.fetch(
        """select conname from pg_constraint
           where contype = 'f' and (confdeltype <> 'a' or confupdtype <> 'a')
             and conrelid::regclass::text = any($1::text[])""",
        list(PRESENT_TABLES),
    )
    assert rows == []


async def test_presentation_chat_index_exists(migrated: asyncpg.Connection) -> None:
    names = await migrated.fetch("select indexname from pg_indexes where schemaname = 'public'")
    assert "presentation_chat_message_session" in {r["indexname"] for r in names}


async def _insert_chat(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    *,
    kind: str = "text",
    body: str | None = "hi",
    gif: tuple[str | None, str | None, str | None, str | None, int | None, int | None] = (
        None,
        None,
        None,
        None,
        None,
        None,
    ),
    removed_at: datetime | None = None,
    removed_by_sub: str | None = None,
) -> None:
    await conn.execute(
        """insert into presentation_chat_message
               (session_id, participant_id, sender_name, body, sent_at, removed_at,
                removed_by_sub, kind, gif_id, gif_title, gif_url, gif_still_url,
                gif_width, gif_height)
           values ($1, $2, 'Ana', $3, now(), $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
        session_id,
        participant_id,
        body,
        removed_at,
        removed_by_sub,
        kind,
        *gif,
    )


GIF = ("abc", "Cat", "https://media.example/cat.gif", "https://media.example/cat.png", 200, 150)


async def test_fr32_chat_text_is_1_to_2000_characters(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _participant(migrated)
    await _insert_chat(migrated, session_id, participant_id, body="😀" * 2000)

    for body in ("x" * 2001, "", None):
        with pytest.raises(asyncpg.CheckViolationError):
            await _insert_chat(migrated, session_id, participant_id, body=body)


async def test_fr32_chat_gif_shape(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _participant(migrated)
    await _insert_chat(migrated, session_id, participant_id, kind="gif", body=None, gif=GIF)
    await _insert_chat(
        migrated, session_id, participant_id, kind="gif", body=None, gif=("a", "", *GIF[2:])
    )

    bad = [
        dict(kind="gif", body="text too", gif=GIF),
        dict(kind="gif", body=None, gif=(None, *GIF[1:])),
        dict(kind="gif", body=None, gif=(*GIF[:2], "javascript:x", *GIF[3:])),
        dict(kind="gif", body=None, gif=(*GIF[:4], 0, 150)),
        dict(kind="text", body="hi", gif=GIF),
        dict(kind="sticker", body="hi"),
    ]
    for kwargs in bad:
        with pytest.raises(asyncpg.CheckViolationError):
            await _insert_chat(migrated, session_id, participant_id, **kwargs)  # type: ignore[arg-type]


async def test_chat_removed_at_requires_removed_by_sub(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _participant(migrated)
    now = datetime.now(UTC)
    await _insert_chat(migrated, session_id, participant_id, removed_at=now, removed_by_sub="adm")

    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, removed_at=now)
    with pytest.raises(asyncpg.CheckViolationError):
        await _insert_chat(migrated, session_id, participant_id, removed_by_sub="adm")


async def test_chat_references_a_presentation_session_and_participant(
    migrated: asyncpg.Connection,
) -> None:
    session_id, participant_id = await _participant(migrated)
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await _insert_chat(migrated, uuid.uuid4(), participant_id)
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await _insert_chat(migrated, session_id, uuid.uuid4())
