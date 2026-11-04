"""Spec 013 task 9: presentation repository (FR-1, FR-4, FR-5, FR-6, FR-8, FR-9, FR-30).

AC-1 created rows read back; AC-4 a session keeps its version after `add_version`; AC-5
removed presentations are not listed but their sessions and versions still read; AC-6 the
listing carries the topic per row; AC-15f place and host persist and read back.
"""

import hashlib
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.present import repo
from tests.conftest import FrozenClock

MODULE_SOURCE = Path(repo.__file__).read_text()

FOUR_SLIDES = "".join(f"<section>Slide {i}</section>" for i in range(4))
SIX_SLIDES = "".join(f"<section>Slide {i}</section>" for i in range(6))


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


def _token_hash() -> str:
    return hashlib.sha256(secrets.token_bytes(32)).hexdigest()


async def _presentation(
    conn: asyncpg.Connection,
    title: str = "Intro to DNS",
    topic: str = "Networking",
    html: str = FOUR_SLIDES,
    kind: str = "slides",
    slide_count: int = 4,
) -> repo.Presentation:
    return await repo.create_presentation(
        conn,
        title=title,
        topic=topic,
        html=html,
        kind=kind,
        slide_count=slide_count,
        created_by_sub="editor-sub",
    )


async def _session(conn: asyncpg.Connection) -> repo.PresentSession:
    presentation = await _presentation(conn)
    assert presentation.current_version_id is not None
    return await repo.create_session(conn, presentation.current_version_id, slide=0)


def test_the_module_has_no_delete_statement() -> None:
    assert "delete " not in MODULE_SOURCE.lower()


# --- presentations and versions ----------------------------------------------------------


async def test_create_presentation_reads_back_with_its_first_version(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    created = await _presentation(migrated)

    read = await repo.get_presentation(migrated, created.id)
    assert read == created
    assert read.title == "Intro to DNS"
    assert read.topic == "Networking"
    assert read.created_by_sub == "editor-sub"
    assert read.removed_at is None and read.removed_by_sub is None

    assert read.current_version_id is not None
    version = await repo.get_version(migrated, read.current_version_id)
    assert version is not None
    assert version.presentation_id == created.id
    assert version.html == FOUR_SLIDES
    assert (version.kind, version.slide_count) == ("slides", 4)
    assert version.created_by_sub == "editor-sub"


async def test_create_presentation_is_one_transaction(migrated: asyncpg.Connection) -> None:
    before = await migrated.fetchval("select count(*) from presentation")
    with pytest.raises(asyncpg.CheckViolationError):
        # The version insert fails (a page has no slides), so the presentation row goes too.
        await _presentation(migrated, kind="page", slide_count=3)
    assert await migrated.fetchval("select count(*) from presentation") == before


async def test_a_page_presentation_reads_back(migrated: asyncpg.Connection) -> None:
    created = await _presentation(migrated, html="<p>Hello</p>", kind="page", slide_count=0)
    assert created.current_version_id is not None
    version = await repo.get_version(migrated, created.current_version_id)
    assert version is not None
    assert (version.kind, version.slide_count) == ("page", 0)


async def test_get_presentation_and_version_return_none_when_absent(
    migrated: asyncpg.Connection,
) -> None:
    assert await repo.get_presentation(migrated, uuid.uuid4()) is None
    assert await repo.get_version(migrated, uuid.uuid4()) is None


async def test_add_version_repoints_but_a_session_keeps_its_version(
    migrated: asyncpg.Connection,
) -> None:
    """AC-4: the old session still has 4 slides; a session started afterwards has 6."""
    presentation = await _presentation(migrated)
    first_version_id = presentation.current_version_id
    assert first_version_id is not None
    old_session = await repo.create_session(migrated, first_version_id, slide=0)

    new_version = await repo.add_version(
        migrated,
        presentation.id,
        html=SIX_SLIDES,
        kind="slides",
        slide_count=6,
        created_by_sub="other-editor",
    )

    assert new_version is not None
    assert new_version.id != first_version_id
    assert (new_version.slide_count, new_version.created_by_sub) == (6, "other-editor")
    repointed = await repo.get_presentation(migrated, presentation.id)
    assert repointed is not None and repointed.current_version_id == new_version.id

    kept = await repo.get_session_by_invite(migrated, old_session.invite_id)
    assert kept is not None and kept.version_id == first_version_id
    old_version = await repo.get_version(migrated, kept.version_id)
    assert old_version is not None and old_version.slide_count == 4

    later = await repo.create_session(migrated, new_version.id, slide=0)
    assert later.version_id == new_version.id


async def test_add_version_to_a_missing_or_removed_presentation_returns_none(
    migrated: asyncpg.Connection,
) -> None:
    assert (
        await repo.add_version(
            migrated, uuid.uuid4(), html="<p>x</p>", kind="page", slide_count=0, created_by_sub="e"
        )
        is None
    )
    presentation = await _presentation(migrated)
    assert await repo.mark_removed(migrated, presentation.id, "editor-sub")
    assert (
        await repo.add_version(
            migrated,
            presentation.id,
            html="<p>x</p>",
            kind="page",
            slide_count=0,
            created_by_sub="e",
        )
        is None
    )
    after = await repo.get_presentation(migrated, presentation.id)
    assert after is not None and after.current_version_id == presentation.current_version_id


async def test_list_presentations_by_title_with_topic_kind_and_slide_count(
    migrated: asyncpg.Connection,
) -> None:
    """AC-6: each row carries its title and topic (and the current version's shape)."""
    zebra = await _presentation(migrated, title="zz Zebra DNS", topic="Networking")
    alpha = await _presentation(
        migrated,
        title="zz Alpha Docker",
        topic="Docker",
        html="<p>p</p>",
        kind="page",
        slide_count=0,
    )

    listed = [p for p in await repo.list_presentations(migrated) if p.title.startswith("zz ")]

    assert listed == [
        repo.LibraryEntry(
            id=alpha.id, title="zz Alpha Docker", topic="Docker", kind="page", slide_count=0
        ),
        repo.LibraryEntry(
            id=zebra.id, title="zz Zebra DNS", topic="Networking", kind="slides", slide_count=4
        ),
    ]


async def test_list_presentations_shows_the_current_version_after_a_replacement(
    migrated: asyncpg.Connection,
) -> None:
    presentation = await _presentation(migrated, title="zz Replaced")
    await repo.add_version(
        migrated,
        presentation.id,
        html=SIX_SLIDES,
        kind="slides",
        slide_count=6,
        created_by_sub="editor-sub",
    )
    listed = [p for p in await repo.list_presentations(migrated) if p.id == presentation.id]
    assert [p.slide_count for p in listed] == [6]


async def test_removed_presentations_are_not_listed_but_their_rows_still_read(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    """AC-5."""
    presentation = await _presentation(migrated, title="zz Removed")
    assert presentation.current_version_id is not None
    session = await repo.create_session(migrated, presentation.current_version_id, slide=0)

    assert await repo.mark_removed(migrated, presentation.id, "remover-sub") is True

    assert presentation.id not in {p.id for p in await repo.list_presentations(migrated)}
    removed = await repo.get_presentation(migrated, presentation.id)
    assert removed is not None
    assert removed.removed_by_sub == "remover-sub"
    assert removed.removed_at == clock.now()
    assert await repo.get_version(migrated, presentation.current_version_id) is not None
    assert await repo.get_session_by_invite(migrated, session.invite_id) == session
    assert [s.id for s in await repo.sessions_of_presentation(migrated, presentation.id)] == [
        session.id
    ]


async def test_mark_removed_is_false_when_missing_or_already_removed(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    assert await repo.mark_removed(migrated, uuid.uuid4(), "x") is False
    presentation = await _presentation(migrated)
    assert await repo.mark_removed(migrated, presentation.id, "first") is True
    frozen_clock.advance(timedelta(minutes=5))
    assert await repo.mark_removed(migrated, presentation.id, "second") is False
    removed = await repo.get_presentation(migrated, presentation.id)
    assert removed is not None and removed.removed_by_sub == "first"


# --- sessions ------------------------------------------------------------------------------


async def test_create_session_reads_back_by_invite(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    """FR-8: a fresh session at the first slide, with a 128-bit invite id and no host."""
    session = await _session(migrated)

    assert len(session.invite_id) >= 22
    assert session.slide == 0
    assert session.anchor is None
    assert session.host_participant_id is None and session.host_away_since is None
    assert session.created_at == session.last_activity_at == clock.now()
    assert session.stale_at is None
    assert await repo.get_session_by_invite(migrated, session.invite_id) == session
    assert await repo.get_session_by_invite(migrated, "no-such-invite") is None


async def test_a_page_session_has_no_slide(migrated: asyncpg.Connection) -> None:
    presentation = await _presentation(migrated, html="<p>x</p>", kind="page", slide_count=0)
    assert presentation.current_version_id is not None
    session = await repo.create_session(migrated, presentation.current_version_id, slide=None)
    assert session.slide is None


async def test_invite_ids_differ(migrated: asyncpg.Connection) -> None:
    presentation = await _presentation(migrated)
    assert presentation.current_version_id is not None
    a = await repo.create_session(migrated, presentation.current_version_id, slide=0)
    b = await repo.create_session(migrated, presentation.current_version_id, slide=0)
    assert a.invite_id != b.invite_id


async def test_place_and_host_persist_and_read_back(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    """AC-15f: Cleo is host, slide 3 last shown; everyone leaves; the row still says so."""
    session = await _session(migrated)
    cleo = await repo.add_participant(migrated, session.id, "Cleo", _token_hash())
    anchor = {"path": [0, 2, 1], "fx": 0.5, "fy": 0.25}

    frozen_clock.advance(timedelta(minutes=1))
    await repo.set_host(migrated, session.id, cleo.id)
    await repo.set_place(migrated, session.id, 3, anchor)
    away_at = clock.now() + timedelta(seconds=10)
    await repo.set_host_away(migrated, session.id, away_at)
    await repo.leave_participant(migrated, cleo.id)

    read = await repo.get_session_by_invite(migrated, session.invite_id)
    assert read is not None
    assert read.host_participant_id == cleo.id
    assert read.host_away_since == away_at
    assert (read.slide, read.anchor) == (3, anchor)
    assert read.last_activity_at == clock.now()  # a place change is activity


async def test_set_host_clears_away_and_set_host_away_none_clears_it(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    a = await repo.add_participant(migrated, session.id, "Ann", _token_hash())
    b = await repo.add_participant(migrated, session.id, "Ben", _token_hash())

    await repo.set_host(migrated, session.id, a.id)
    await repo.set_host_away(migrated, session.id, clock.now())
    await repo.set_host(migrated, session.id, b.id)
    read = await repo.get_session_by_invite(migrated, session.invite_id)
    assert read is not None
    assert (read.host_participant_id, read.host_away_since) == (b.id, None)

    await repo.set_host_away(migrated, session.id, clock.now())
    await repo.set_host_away(migrated, session.id, None)
    read = await repo.get_session_by_invite(migrated, session.invite_id)
    assert read is not None and read.host_away_since is None


async def test_set_place_with_a_null_anchor(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    await repo.set_place(migrated, session.id, 1, {"path": [], "fx": 0, "fy": 0})
    await repo.set_place(migrated, session.id, 2, None)
    read = await repo.get_session_by_invite(migrated, session.invite_id)
    assert read is not None and (read.slide, read.anchor) == (2, None)


async def test_touch_activity(migrated: asyncpg.Connection, frozen_clock: FrozenClock) -> None:
    session = await _session(migrated)
    frozen_clock.advance(timedelta(hours=2))
    await repo.touch_activity(migrated, session.id)
    read = await repo.get_session_by_invite(migrated, session.invite_id)
    assert read is not None and read.last_activity_at == clock.now()


async def test_sessions_of_presentation_spans_its_versions_only(
    migrated: asyncpg.Connection,
) -> None:
    presentation = await _presentation(migrated)
    assert presentation.current_version_id is not None
    first = await repo.create_session(migrated, presentation.current_version_id, slide=0)
    version = await repo.add_version(
        migrated,
        presentation.id,
        html=SIX_SLIDES,
        kind="slides",
        slide_count=6,
        created_by_sub="e",
    )
    assert version is not None
    second = await repo.create_session(migrated, version.id, slide=0)
    await _session(migrated)  # another presentation's

    found = await repo.sessions_of_presentation(migrated, presentation.id)

    assert sorted(s.id for s in found) == sorted([first.id, second.id])


# --- participants -----------------------------------------------------------------------------


async def test_participants_read_back_by_token_hash_within_their_session(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    """FR-9; plan "Hosting": the server keeps only the token's hash."""
    session = await _session(migrated)
    other = await _session(migrated)
    token_hash = _token_hash()

    added = await repo.add_participant(migrated, session.id, "Dana", token_hash)

    assert added.session_id == session.id
    assert added.display_name == "Dana"
    assert added.joined_at == clock.now()
    assert added.left_at is None
    assert await repo.get_participant_by_token_hash(migrated, session.id, token_hash) == added
    assert await repo.get_participant_by_token_hash(migrated, other.id, token_hash) is None
    assert await repo.get_participant_by_token_hash(migrated, session.id, _token_hash()) is None


async def test_leave_participant_sets_left_at(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    token_hash = _token_hash()
    added = await repo.add_participant(migrated, session.id, "Eve", token_hash)
    frozen_clock.advance(timedelta(minutes=3))

    await repo.leave_participant(migrated, added.id)

    read = await repo.get_participant_by_token_hash(migrated, session.id, token_hash)
    assert read is not None and read.left_at == clock.now()
