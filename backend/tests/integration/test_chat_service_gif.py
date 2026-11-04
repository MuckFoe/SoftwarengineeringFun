"""Spec 007 task 14: `chat.service.send_gif` and GIF serialisation (FR-3, FR-4, FR-6, FR-8)."""

import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.chat import repo, service
from app.chat.rules import ChatError
from app.gifs.models import GifRef
from app.sessions.hub import Connection, SessionHub

GIF = GifRef(
    id="abc123",
    title="Happy cat",
    url="https://media.giphy.com/media/abc123/giphy.webp",
    still_url="https://media.giphy.com/media/abc123/giphy_s.gif",
    width=480,
    height=270,
)


class _Socket:
    def __init__(self) -> None:
        self.sent: list[object] = []

    async def send_json(self, data: object) -> None:
        self.sent.append(data)

    async def send_bytes(self, data: bytes) -> None:  # pragma: no cover
        raise AssertionError("no binary frames expected")


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    """A new session with one participant, Ada; returns (session_id, participant_id)."""
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
        "insert into participant (session_id, display_name) values ($1, 'Ada') returning id",
        session_id,
    )
    return session_id, participant_id


def _hub(participant_id: uuid.UUID) -> tuple[SessionHub, _Socket]:
    hub = SessionHub()
    socket = _Socket()
    hub.try_reserve()
    hub.add(Connection(websocket=socket, participant_id=participant_id, name="Ada"))
    return hub, socket


async def test_send_gif_broadcasts_a_gif_message_from_the_sender_now(
    migrated: asyncpg.Connection, frozen_clock: object
) -> None:
    session_id, participant_id = await _session(migrated)
    hub, socket = _hub(participant_id)

    refused = await service.send_gif(
        migrated, hub, session_id, participant_id, "Ada", GIF, "client-1"
    )

    assert refused is None
    (frame,) = socket.sent
    assert isinstance(frame, dict)
    assert frame["type"] == "chat_message"
    assert frame["client_id"] == "client-1"
    message = frame["message"]
    assert message["kind"] == "gif"
    assert message["sender_name"] == "Ada"
    assert "text" not in message
    assert message["gif"] == {
        "id": "abc123",
        "title": "Happy cat",
        "url": GIF.url,
        "still_url": GIF.still_url,
        "width": 480,
        "height": 270,
    }
    sent_at = datetime.fromisoformat(message["sent_at"])
    assert abs(sent_at - clock.now()) < timedelta(seconds=1)
    # Durable before broadcast: history has it.
    (stored,) = await repo.history(migrated, session_id)
    assert stored.id == message["id"]
    assert stored.kind == "gif"


async def test_gif_sorts_after_earlier_text_messages(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _session(migrated)
    hub, socket = _hub(participant_id)

    for text in ("one", "two"):
        assert (
            await service.send(migrated, hub, session_id, participant_id, "Ada", text, text) is None
        )
    assert (
        await service.send_gif(migrated, hub, session_id, participant_id, "Ada", GIF, "g") is None
    )

    first, second, gif = (frame["message"] for frame in socket.sent)  # type: ignore[index]
    assert gif["kind"] == "gif"
    assert gif["id"] > first["id"]
    assert gif["id"] > second["id"]
    assert [m.kind for m in await repo.history(migrated, session_id)] == ["text", "text", "gif"]


async def test_send_gif_on_a_stale_session_is_refused_and_stores_nothing(
    migrated: asyncpg.Connection,
) -> None:
    session_id, participant_id = await _session(migrated)
    await migrated.execute("update session set stale_at = now() where id = $1", session_id)
    hub, socket = _hub(participant_id)

    refused = await service.send_gif(migrated, hub, session_id, participant_id, "Ada", GIF, "c")

    assert refused is ChatError.STALE
    assert socket.sent == []
    count = await migrated.fetchval(
        "select count(*) from chat_message where session_id = $1", session_id
    )
    assert count == 0


async def test_text_message_dict_carries_kind_text(migrated: asyncpg.Connection) -> None:
    session_id, participant_id = await _session(migrated)
    hub, socket = _hub(participant_id)

    await service.send(migrated, hub, session_id, participant_id, "Ada", "hello", "c")

    (frame,) = socket.sent
    message = frame["message"]  # type: ignore[index]
    assert message["kind"] == "text"
    assert message["text"] == "hello"
    assert "gif" not in message
    assert set(message) == {
        "id",
        "sender_name",
        "sent_at",
        "kind",
        "text",
        "participant_id",
        "signed_in",
    }
