"""Spec 013 task 13: presentation service — library, start, join/rejoin, place (FR-1, FR-4,
FR-5, FR-8, FR-9, FR-10, FR-11, FR-12, FR-14, FR-30).

AC-4 sessions keep their version across `replace_html`; AC-5 a removed presentation can't be
started; AC-8 a slides session starts at slide 0; AC-10/AC-11 a place persists and reads back;
AC-13 only the host moves, within range; AC-15e groundwork: a valid rejoin token reuses the
participant. A real database; nothing mocked.
"""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.present import repo, service
from app.present.html_check import Rejected
from tests.conftest import FrozenClock


def _slides(n: int) -> bytes:
    return "".join(f"<section>Slide {i}</section>" for i in range(n)).encode()


PAGE = b"<h1>One</h1><p>Long page</p><h2>Two</h2>"
ANCHOR = {"path": [0, 2], "fx": 0.5, "fy": 0.25}


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _add(conn: asyncpg.Connection, data: bytes = b"", **kw: str) -> repo.LibraryEntry:
    return await service.add_presentation(
        conn,
        title=kw.get("title", "Intro to DNS"),
        topic=kw.get("topic", "Networking"),
        data=data or _slides(4),
        by_sub="editor-sub",
    )


async def _hosted(
    conn: asyncpg.Connection, data: bytes = b""
) -> tuple[repo.PresentSession, service.Joined]:
    """A started session whose first joiner is made host (as connecting will do)."""
    entry = await _add(conn, data)
    session = await service.start_session(conn, entry.id)
    ana = await service.join(conn, session.id, "Ana", None)
    await repo.set_host(conn, session.id, ana.participant.id)
    return session, ana


# --- library ---------------------------------------------------------------------------------


async def test_add_presentation_analyzes_and_lists(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated, title="  Intro to DNS ", topic=" Networking ")

    assert (entry.title, entry.topic, entry.kind, entry.slide_count) == (
        "Intro to DNS",
        "Networking",
        "slides",
        4,
    )
    assert entry in await repo.list_presentations(migrated)


async def test_add_presentation_of_a_page(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated, PAGE)
    assert (entry.kind, entry.slide_count) == ("page", 0)


@pytest.mark.parametrize(
    ("title", "topic", "code"),
    [
        ("", "Networking", "invalid_title"),
        ("   ", "Networking", "invalid_title"),
        ("x" * 101, "Networking", "invalid_title"),
        ("Intro", "", "invalid_topic"),
        ("Intro", "y" * 61, "invalid_topic"),
    ],
)
async def test_add_refuses_bad_title_or_topic(
    migrated: asyncpg.Connection, title: str, topic: str, code: str
) -> None:
    before = await repo.list_presentations(migrated)
    with pytest.raises(service.PresentError) as raised:
        await _add(migrated, title=title, topic=topic)
    assert raised.value.code == code
    assert await repo.list_presentations(migrated) == before


async def test_add_accepts_limits(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated, title="x" * 100, topic="y" * 60)
    assert (len(entry.title), len(entry.topic)) == (100, 60)


async def test_add_refuses_bad_html_and_saves_nothing(migrated: asyncpg.Connection) -> None:
    before = await repo.list_presentations(migrated)
    with pytest.raises(Rejected) as raised:
        await _add(migrated, b"\x89PNG\r\n\x1a\n\x00\x00")
    assert raised.value.code == "not_html"
    assert await repo.list_presentations(migrated) == before


async def test_replace_keeps_running_sessions_on_old_version(
    migrated: asyncpg.Connection,
) -> None:
    """AC-4."""
    entry = await _add(migrated, _slides(4))
    before = await service.start_session(migrated, entry.id)

    replaced = await service.replace_html(migrated, entry.id, data=_slides(6), by_sub="ed")
    after = await service.start_session(migrated, entry.id)

    assert replaced.slide_count == 6
    assert (await service.session_state(migrated, before.invite_id)).slide_count == 4
    assert (await service.session_state(migrated, after.invite_id)).slide_count == 6


async def test_replace_unknown_or_removed_raises_not_found(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated)
    await service.remove_presentation(migrated, entry.id, by_sub="ed")
    with pytest.raises(service.PresentationNotFound) as raised:
        await service.replace_html(migrated, entry.id, data=_slides(2), by_sub="ed")
    assert raised.value.code == "not_found"


async def test_replace_refuses_bad_html(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated)
    with pytest.raises(Rejected):
        await service.replace_html(migrated, entry.id, data=b"   ", by_sub="ed")
    listed = {e.id: e for e in await repo.list_presentations(migrated)}
    assert listed[entry.id].slide_count == 4


async def test_remove_hides_and_returns_its_sessions(migrated: asyncpg.Connection) -> None:
    """AC-5: gone from the library; existing sessions report unavailable."""
    entry = await _add(migrated)
    session = await service.start_session(migrated, entry.id)

    sessions = await service.remove_presentation(migrated, entry.id, by_sub="ed")

    assert [s.id for s in sessions] == [session.id]
    assert entry.id not in {e.id for e in await repo.list_presentations(migrated)}
    assert (await service.session_state(migrated, session.invite_id)).available is False
    with pytest.raises(service.PresentationNotFound):
        await service.remove_presentation(migrated, entry.id, by_sub="ed")


async def test_start_on_removed_presentation_raises_not_found(
    migrated: asyncpg.Connection,
) -> None:
    """AC-5."""
    entry = await _add(migrated)
    await service.remove_presentation(migrated, entry.id, by_sub="ed")
    with pytest.raises(service.PresentationNotFound):
        await service.start_session(migrated, entry.id)


async def test_start_on_unknown_presentation_raises_not_found(
    migrated: asyncpg.Connection,
) -> None:
    with pytest.raises(service.PresentationNotFound):
        await service.start_session(migrated, uuid.uuid4())


# --- start and state ------------------------------------------------------------------------


async def test_slides_session_starts_at_slide_0(migrated: asyncpg.Connection) -> None:
    """AC-8."""
    entry = await _add(migrated)
    session = await service.start_session(migrated, entry.id)

    state = await service.session_state(migrated, session.invite_id)
    assert session.slide == 0
    assert (state.kind, state.slide, state.anchor, state.host_id, state.host_name) == (
        "slides",
        0,
        None,
        None,
        None,
    )
    assert (state.title, state.topic, state.available, state.stale) == (
        "Intro to DNS",
        "Networking",
        True,
        False,
    )


async def test_page_session_starts_with_no_slide(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated, PAGE)
    session = await service.start_session(migrated, entry.id)
    assert session.slide is None
    assert (await service.session_state(migrated, session.invite_id)).slide is None


async def test_session_state_unknown_invite_raises(migrated: asyncpg.Connection) -> None:
    with pytest.raises(service.SessionNotFound) as raised:
        await service.session_state(migrated, "no-such-invite")
    assert raised.value.code == "not_found"


async def test_session_state_shows_host_name(migrated: asyncpg.Connection) -> None:
    session, ana = await _hosted(migrated)
    state = await service.session_state(migrated, session.invite_id)
    assert (state.session_id, state.host_id, state.host_name) == (
        session.id,
        ana.participant.id,
        "Ana",
    )


# --- join -------------------------------------------------------------------------------------


async def test_join_new_participant_gets_fresh_token(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated)
    session = await service.start_session(migrated, entry.id)

    ana = await service.join(migrated, session.id, "  Ana ", None)
    ben = await service.join(migrated, session.id, "Ben", None)

    assert ana.participant.display_name == "Ana"
    assert ana.reused is False
    assert len(ana.token) >= 43  # 32 random bytes, base64url
    assert ana.token != ben.token
    assert ana.participant.id != ben.participant.id
    stored = await migrated.fetchval(
        "select rejoin_token_hash from presentation_participant where id = $1",
        ana.participant.id,
    )
    assert stored != ana.token


async def test_join_with_valid_token_reuses_participant(migrated: asyncpg.Connection) -> None:
    """AC-15e groundwork: same participant id and name, whatever name is sent."""
    entry = await _add(migrated)
    session = await service.start_session(migrated, entry.id)
    ana = await service.join(migrated, session.id, "Ana", None)

    again = await service.join(migrated, session.id, "", ana.token)

    assert again.reused is True
    assert again.participant.id == ana.participant.id
    assert again.participant.display_name == "Ana"
    assert again.token == ana.token


async def test_join_with_wrong_token_makes_new_participant(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated)
    session = await service.start_session(migrated, entry.id)
    ana = await service.join(migrated, session.id, "Ana", None)

    other = await service.join(migrated, session.id, "Ana", "not-the-token")

    assert other.reused is False
    assert other.participant.id != ana.participant.id
    assert other.token != "not-the-token"


async def test_token_of_another_session_does_not_rejoin(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated)
    first = await service.start_session(migrated, entry.id)
    second = await service.start_session(migrated, entry.id)
    ana = await service.join(migrated, first.id, "Ana", None)

    there = await service.join(migrated, second.id, "Ana", ana.token)

    assert there.reused is False
    assert there.participant.session_id == second.id


@pytest.mark.parametrize("name", ["", "   ", "x" * 31])
async def test_join_refuses_bad_name(migrated: asyncpg.Connection, name: str) -> None:
    entry = await _add(migrated)
    session = await service.start_session(migrated, entry.id)
    with pytest.raises(service.PresentError) as raised:
        await service.join(migrated, session.id, name, None)
    assert raised.value.code == "bad_name"


async def test_join_accepts_30_characters(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated)
    session = await service.start_session(migrated, entry.id)
    joined = await service.join(migrated, session.id, "x" * 30, None)
    assert joined.participant.display_name == "x" * 30


async def test_join_stale_session_refused(migrated: asyncpg.Connection) -> None:
    entry = await _add(migrated)
    session = await service.start_session(migrated, entry.id)
    await migrated.execute(
        "update presentation_session set stale_at = now() where id = $1", session.id
    )
    with pytest.raises(service.PresentError) as raised:
        await service.join(migrated, session.id, "Ana", None)
    assert raised.value.code == "session_stale"


# --- place ------------------------------------------------------------------------------------


async def test_set_place_persists_and_state_returns_it(migrated: asyncpg.Connection) -> None:
    """AC-10/AC-11: the host's move is stored; a (re)joiner reads it back."""
    session, ana = await _hosted(migrated)

    change = await service.set_place(migrated, session.id, ana.participant.id, 2, ANCHOR)
    assert (change.slide, change.anchor, change.slide_changed) == (2, ANCHOR, True)

    state = await service.session_state(migrated, session.invite_id)
    assert (state.slide, state.anchor) == (2, ANCHOR)

    back = await service.set_place(migrated, session.id, ana.participant.id, 1, None)
    assert back.slide_changed is True
    same = await service.set_place(migrated, session.id, ana.participant.id, 1, ANCHOR)
    assert same.slide_changed is False


async def test_set_place_on_a_page_keeps_slide_null(migrated: asyncpg.Connection) -> None:
    """AC-10 single page: only the anchor moves."""
    session, ana = await _hosted(migrated, PAGE)

    change = await service.set_place(migrated, session.id, ana.participant.id, None, ANCHOR)

    assert (change.slide, change.slide_changed) == (None, False)
    state = await service.session_state(migrated, session.invite_id)
    assert (state.slide, state.anchor) == (None, ANCHOR)
    with pytest.raises(service.PresentError) as raised:
        await service.set_place(migrated, session.id, ana.participant.id, 0, ANCHOR)
    assert raised.value.code == "bad_slide"


async def test_set_place_touches_activity(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session, ana = await _hosted(migrated)
    later = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(hours=3)
    frozen_clock.set(later)
    assert clock.now() == later

    await service.set_place(migrated, session.id, ana.participant.id, 1, None)

    stored = await migrated.fetchval(
        "select last_activity_at from presentation_session where id = $1", session.id
    )
    assert stored == later


async def test_set_place_by_non_host_refused_and_changes_nothing(
    migrated: asyncpg.Connection,
) -> None:
    """AC-13."""
    session, ana = await _hosted(migrated)
    await service.set_place(migrated, session.id, ana.participant.id, 1, ANCHOR)
    ben = await service.join(migrated, session.id, "Ben", None)

    with pytest.raises(service.NotHost) as raised:
        await service.set_place(migrated, session.id, ben.participant.id, 3, None)

    assert raised.value.code == "not_host"
    state = await service.session_state(migrated, session.invite_id)
    assert (state.slide, state.anchor) == (1, ANCHOR)


@pytest.mark.parametrize("slide", [4, -1, None])
async def test_set_place_out_of_range_refused(
    migrated: asyncpg.Connection, slide: int | None
) -> None:
    """AC-13: slide 4 of 4 (indices 0–3) is refused."""
    session, ana = await _hosted(migrated)

    with pytest.raises(service.BadSlide) as raised:
        await service.set_place(migrated, session.id, ana.participant.id, slide, None)

    assert raised.value.code == "bad_slide"
    assert (await service.session_state(migrated, session.invite_id)).slide == 0


async def test_set_place_on_stale_or_removed_refused(migrated: asyncpg.Connection) -> None:
    session, ana = await _hosted(migrated)
    entry_id = await migrated.fetchval(
        "select presentation_id from presentation_version where id = $1", session.version_id
    )
    await service.remove_presentation(migrated, entry_id, by_sub="ed")
    with pytest.raises(service.PresentError) as raised:
        await service.set_place(migrated, session.id, ana.participant.id, 1, None)
    assert raised.value.code == "presentation_unavailable"

    other, host = await _hosted(migrated)
    await migrated.execute(
        "update presentation_session set stale_at = now() where id = $1", other.id
    )
    with pytest.raises(service.PresentError) as raised:
        await service.set_place(migrated, other.id, host.participant.id, 1, None)
    assert raised.value.code == "session_stale"
