"""Spec 013 task 14: presentation chat, text and GIF (`present/chat.py`). FR-32.

AC-15h: text and GIF messages are stored and come back in id order with the spec 007 wire
shape; an admin's removal hides one and a second removal is false. AC-15g: a stale session
refuses `send` and `send_gif` with `session_stale`. Messages are scoped to their session.
A real database; the hub's sockets are recording fakes.
"""

import hashlib
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.chat.rules import ChatError
from app.gifs.models import GifRef
from app.present import chat, repo
from app.present.hub import PresentHub
from tests.conftest import FrozenClock

GIF = GifRef(
    id="abc123",
    title="Happy cat",
    url="https://media.giphy.com/media/abc123/giphy.webp",
    still_url="https://media.giphy.com/media/abc123/giphy_s.gif",
    width=480,
    height=270,
)
# Spec 012: every message also names its sender's participant and whether it is signed in.
TEXT_KEYS = {"id", "sender_name", "sent_at", "kind", "text", "participant_id", "signed_in"}
GIF_KEYS = {"id", "sender_name", "sent_at", "kind", "gif", "participant_id", "signed_in"}


class _Socket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, data: dict) -> None:
        self.sent.append(data)


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> repo.PresentSession:
    presentation = await repo.create_presentation(
        conn,
        title="Intro to DNS",
        topic="Networking",
        html="<section>One</section>",
        kind="slides",
        slide_count=1,
        created_by_sub="editor-sub",
    )
    assert presentation.current_version_id is not None
    return await repo.create_session(conn, presentation.current_version_id, slide=0)


async def _participant(
    conn: asyncpg.Connection, session: repo.PresentSession, name: str
) -> repo.Participant:
    token_hash = hashlib.sha256(secrets.token_bytes(32)).hexdigest()
    return await repo.add_participant(conn, session.id, name, token_hash)


def _hub(*participants: repo.Participant) -> tuple[PresentHub, list[_Socket]]:
    hub = PresentHub()
    sockets = []
    for participant in participants:
        socket = _Socket()
        assert hub.try_reserve()
        hub.add(participant.id, socket, participant.display_name, clock.now())
        sockets.append(socket)
    return hub, sockets


async def _stale(conn: asyncpg.Connection, session: repo.PresentSession) -> None:
    await conn.execute(
        "update presentation_session set stale_at = $2 where id = $1", session.id, clock.now()
    )


async def _activity(conn: asyncpg.Connection, session: repo.PresentSession) -> datetime:
    return await conn.fetchval(
        "select last_activity_at from presentation_session where id = $1", session.id
    )


async def _count(conn: asyncpg.Connection, session: repo.PresentSession) -> int:
    return await conn.fetchval(
        "select count(*) from presentation_chat_message where session_id = $1", session.id
    )


# --- AC-15h: send, history, wire shape -------------------------------------------------------


async def test_ac15h_text_and_gif_reach_everyone_and_come_back_in_id_order(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    ana, ben = (
        await _participant(migrated, session, "Ana"),
        await _participant(migrated, session, "Ben"),
    )
    hub, (ana_socket, ben_socket) = _hub(ana, ben)

    assert await chat.send(migrated, hub, session.id, ben.id, "Ben", "hello", "c1") is None
    assert await chat.send_gif(migrated, hub, session.id, ben.id, "Ben", GIF, "c2") is None

    assert ana_socket.sent == ben_socket.sent
    text_frame, gif_frame = ben_socket.sent
    assert text_frame["type"] == gif_frame["type"] == "chat_message"
    assert text_frame["client_id"] == "c1"
    assert gif_frame["client_id"] == "c2"
    text, gif = text_frame["message"], gif_frame["message"]
    assert set(text) == TEXT_KEYS
    assert (text["kind"], text["text"], text["sender_name"]) == ("text", "hello", "Ben")
    assert set(gif) == GIF_KEYS
    assert gif["kind"] == "gif"
    assert gif["gif"] == {
        "id": "abc123",
        "title": "Happy cat",
        "url": GIF.url,
        "still_url": GIF.still_url,
        "width": 480,
        "height": 270,
    }
    assert gif["id"] > text["id"]
    sent_at = datetime.fromisoformat(gif["sent_at"])
    assert abs(sent_at - clock.now()) < timedelta(seconds=5)

    # Durable: history (what a reload reads) has both, in id order, with the same wire shape.
    history = await chat.history(migrated, session.id)
    assert [chat.message_dict(m) for m in history] == [text, gif]


async def test_ac15h_text_rules_are_spec_002s(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    ana = await _participant(migrated, session, "Ana")
    hub, (socket,) = _hub(ana)

    assert await chat.send(migrated, hub, session.id, ana.id, "Ana", "   ", "c") == ChatError.EMPTY
    too_long = "x" * 2001
    assert (
        await chat.send(migrated, hub, session.id, ana.id, "Ana", too_long, "c")
        == ChatError.TOO_LONG
    )
    assert await chat.send(migrated, hub, session.id, ana.id, "Ana", "x" * 2000, "c") is None

    assert len(socket.sent) == 1
    assert await _count(migrated, session) == 1


async def test_ac15h_admin_removal_hides_one_and_a_second_removal_is_false(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    ana = await _participant(migrated, session, "Ana")
    hub, (socket,) = _hub(ana)
    ids = []
    for text in ("one", "abuse", "three"):
        await chat.send(migrated, hub, session.id, ana.id, "Ana", text, text)
        ids.append(socket.sent[-1]["message"]["id"])
    await chat.send_gif(migrated, hub, session.id, ana.id, "Ana", GIF, "g")
    gif_id = socket.sent[-1]["message"]["id"]
    socket.sent.clear()

    assert await chat.remove(migrated, hub, session.id, ids[1], "admin-sub") is True
    assert socket.sent == [{"type": "chat_removed", "id": ids[1]}]
    assert await chat.remove(migrated, None, session.id, gif_id, "admin-sub") is True
    assert await chat.remove(migrated, hub, session.id, ids[1], "admin-sub") is False
    assert len(socket.sent) == 1

    history = await chat.history(migrated, session.id)
    assert [m.text for m in history] == ["one", "three"]
    # Hidden, not erased, and attributed to the admin.
    row = await migrated.fetchrow(
        """select body, removed_at, removed_by_sub from presentation_chat_message
           where id = $1""",
        ids[1],
    )
    assert row["body"] == "abuse"
    assert row["removed_at"] is not None
    assert row["removed_by_sub"] == "admin-sub"


async def test_insert_and_insert_gif_store_rows_directly(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    ana = await _participant(migrated, session, "Ana")

    text = await chat.insert(migrated, session.id, ana.id, "Ana", "hi", clock.now())
    gif = await chat.insert_gif(migrated, session.id, ana.id, "Ana", GIF)

    assert (text.kind, text.text, text.gif) == ("text", "hi", None)
    assert (gif.kind, gif.text, gif.gif) == ("gif", None, GIF)
    assert await chat.history(migrated, session.id) == [text, gif]
    assert await chat.mark_removed(migrated, session.id, text.id, "admin-sub") is True
    assert await chat.mark_removed(migrated, session.id, text.id, "admin-sub") is False
    assert await chat.history(migrated, session.id) == [gif]


# --- AC-15g: stale sessions refuse -----------------------------------------------------------


async def test_ac15g_a_stale_session_refuses_send_and_send_gif(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    ana = await _participant(migrated, session, "Ana")
    await chat.insert(migrated, session.id, ana.id, "Ana", "before", clock.now())
    await _stale(migrated, session)
    hub, (socket,) = _hub(ana)

    assert await chat.send(migrated, hub, session.id, ana.id, "Ana", "x", "c") == ChatError.STALE
    assert (
        await chat.send_gif(migrated, hub, session.id, ana.id, "Ana", GIF, "g") == ChatError.STALE
    )
    assert ChatError.STALE == "session_stale"

    assert socket.sent == []
    assert await _count(migrated, session) == 1
    # History stays readable (read-only, not gone).
    assert [m.text for m in await chat.history(migrated, session.id)] == ["before"]


# --- activity ---------------------------------------------------------------------------------


async def test_sending_touches_activity_at_most_once_a_minute(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    ana = await _participant(migrated, session, "Ana")
    hub, _ = _hub(ana)
    old = datetime.fromisoformat("2020-01-01T00:00:00+00:00")

    async def reset() -> None:
        await migrated.execute(
            "update presentation_session set last_activity_at = $2 where id = $1",
            session.id,
            old,
        )

    await reset()
    await chat.send(migrated, hub, session.id, ana.id, "Ana", "one", "c")
    assert await _activity(migrated, session) == clock.now()

    await reset()
    frozen_clock.advance(timedelta(seconds=30))
    await chat.send_gif(migrated, hub, session.id, ana.id, "Ana", GIF, "g")
    assert await _activity(migrated, session) == old

    frozen_clock.advance(timedelta(seconds=31))
    await chat.send_gif(migrated, hub, session.id, ana.id, "Ana", GIF, "g")
    assert await _activity(migrated, session) == clock.now()


# --- scoping ----------------------------------------------------------------------------------


async def test_messages_are_scoped_to_their_session(migrated: asyncpg.Connection) -> None:
    a, b = await _session(migrated), await _session(migrated)
    ana, ben = await _participant(migrated, a, "Ana"), await _participant(migrated, b, "Ben")
    hub_a, _ = _hub(ana)
    hub_b, _ = _hub(ben)
    await chat.send(migrated, hub_a, a.id, ana.id, "Ana", "in A", "c")
    await chat.send(migrated, hub_b, b.id, ben.id, "Ben", "in B", "c")
    (b_message,) = await chat.history(migrated, b.id)

    # Removing B's message through A's session does nothing.
    assert await chat.remove(migrated, hub_a, a.id, b_message.id, "admin-sub") is False
    assert [m.text for m in await chat.history(migrated, a.id)] == ["in A"]
    assert [m.text for m in await chat.history(migrated, b.id)] == ["in B"]
    assert await chat.history(migrated, uuid.uuid4()) == []


async def test_presentation_chat_is_separate_from_coding_session_chat(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    ana = await _participant(migrated, session, "Ana")
    hub, _ = _hub(ana)
    await chat.send(migrated, hub, session.id, ana.id, "Ana", "present only", "c")

    assert await migrated.fetchval("select count(*) from chat_message") == 0
