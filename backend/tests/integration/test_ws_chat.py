"""Spec 002 task 15: chat over the session WebSocket (`chat/service.py`, `sessions/ws.py`).

FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR18. Two TestClient WebSocket clients,
real Postgres.
"""

import json
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.sessions import repo as sessions_repo

ADD = parse_signature("def add(a: int, b: int) -> int")


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
async def client(database_url: str, migrated: asyncpg.Connection) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


async def _session(conn: asyncpg.Connection) -> sessions_repo.Session:
    problem_id = await problems_repo.create(
        conn,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    return await sessions_repo.create(conn, problem_id)


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _send(ws, text: str, client_id: str | None = None) -> str:
    client_id = client_id or uuid.uuid4().hex
    ws.send_text(json.dumps({"type": "chat_send", "client_id": client_id, "text": text}))
    return client_id


def _next(ws) -> dict:
    """The next message that isn't a presence update. Concurrent joiners can get each
    other's presence broadcast before their own welcome, so welcome is read this way too."""
    while True:
        message = ws.receive_json()
        if message["type"] != "presence":
            return message


async def _rows(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[str]:
    rows = await conn.fetch(
        "select body from chat_message where session_id = $1 order by id", session_id
    )
    return [r["body"] for r in rows]


async def test_fr10_both_participants_get_anas_message_labelled_within_1s(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        assert _next(ana)["type"] == "welcome"
        assert _next(ben)["type"] == "welcome"

        start = time.monotonic()
        client_id = _send(ana, "try a hashmap")
        to_ben = _next(ben)
        elapsed = time.monotonic() - start
        to_ana = _next(ana)

    assert elapsed < 1
    for received in (to_ana, to_ben):
        assert received["type"] == "chat_message"
        assert received["client_id"] == client_id
        message = received["message"]
        assert message["text"] == "try a hashmap"
        assert message["sender_name"] == "Ana"
        assert isinstance(message["id"], int)
        assert datetime.fromisoformat(message["sent_at"]).utcoffset().total_seconds() == 0
    assert to_ana["message"] == to_ben["message"]


async def test_fr11_order_survives_a_restart(
    database_url: str, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        TestClient(create_app(_settings(database_url))) as first,
        first.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
    ):
        _next(ana)  # welcome
        for text in ("one", "two", "three"):
            _send(ana, text)
            assert _next(ana)["type"] == "chat_message"

    with (
        TestClient(create_app(_settings(database_url))) as restarted,
        restarted.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        welcome = _next(ben)

    assert [m["text"] for m in welcome["chat"]] == ["one", "two", "three"]


async def test_fr12_a_joiner_sees_50_earlier_messages_then_new_ones_after(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        _next(ana)  # welcome
        for i in range(50):
            _send(ana, f"m{i}")
            _next(ana)

        with client.websocket_connect(_ws_url(session.invite_id, "Cleo")) as cleo:
            welcome = _next(cleo)
            _send(ana, "after")
            later = _next(cleo)

    history = welcome["chat"]
    assert [m["text"] for m in history] == [f"m{i}" for i in range(50)]
    assert later["message"]["text"] == "after"
    assert later["message"]["id"] > history[-1]["id"]


async def test_fr13_whitespace_only_is_refused_to_the_sender_only(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _next(ana)
        _next(ben)

        client_id = _send(ana, "  \n")
        refusal = _next(ana)
        _send(ana, "marker")
        first_for_ben = _next(ben)

    assert refusal == {"type": "error", "code": "chat_empty", "client_id": client_id}
    assert first_for_ben["message"]["text"] == "marker"  # nothing arrived before it
    assert await _rows(migrated, session.id) == ["marker"]


async def test_fr14_2001_characters_are_refused_and_2000_delivered(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    exactly = "😀" * 2000  # 2000 code points
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _next(ana)
        _next(ben)

        too_long = _send(ana, "x" * 2001)
        refusal = _next(ana)
        _send(ana, exactly)
        to_ben = _next(ben)
        to_ana = _next(ana)

    assert refusal == {
        "type": "error",
        "code": "chat_too_long",
        "limit": 2000,
        "client_id": too_long,
    }
    assert to_ben["message"]["text"] == exactly
    assert to_ana["message"]["text"] == exactly
    assert await _rows(migrated, session.id) == [exactly]


async def test_fr15_markup_is_delivered_and_stored_byte_exact(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    text = "  <script>alert(1)</script> **bold** <b>x</b>\n\t"
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _next(ana)
        _next(ben)
        _send(ana, text)
        to_ben = _next(ben)

    assert to_ben["message"]["text"] == text
    assert await _rows(migrated, session.id) == [text]


async def test_fr16_a_session_gone_stale_while_connected_refuses_chat(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _next(ana)
        _next(ben)
        await sessions_repo.set_stale(migrated, session.id)

        client_id = _send(ana, "hello")
        refusal = _next(ana)

    assert refusal == {"type": "error", "code": "session_stale", "client_id": client_id}
    assert await _rows(migrated, session.id) == []


async def test_fr17_another_session_never_receives_the_message(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    a, b = await _session(migrated), await _session(migrated)
    with (
        client.websocket_connect(_ws_url(a.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(b.invite_id, "Bea")) as bea,
    ):
        _next(ana)
        _next(bea)

        _send(ana, "for A")
        assert _next(ana)["message"]["text"] == "for A"
        _send(bea, "for B")
        first_for_bea = _next(bea)

        with client.websocket_connect(_ws_url(b.invite_id, "Bo")) as bo:
            b_history = _next(bo)["chat"]

    assert first_for_bea["message"]["text"] == "for B"
    assert [m["text"] for m in b_history] == ["for B"]


async def test_fr18_a_reconnect_shows_missed_messages_once_in_order(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben:
        _next(ben)
        with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
            _next(ana)
            _send(ana, "before the drop")
            _next(ana)
            _next(ben)
        # Ana is gone; Ben sends two.
        for text in ("missed one", "missed two"):
            _send(ben, text)
            _next(ben)

        with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana_again:
            welcome = _next(ana_again)

    texts = [m["text"] for m in welcome["chat"]]
    assert texts == ["before the drop", "missed one", "missed two"]
    ids = [m["id"] for m in welcome["chat"]]
    assert ids == sorted(set(ids))


@pytest.mark.parametrize(
    "frame",
    [
        {"type": "chat_send", "client_id": "c1"},
        {"type": "chat_send", "client_id": "c1", "text": 42},
        {"type": "chat_send", "text": "no client id"},
    ],
)
async def test_malformed_chat_send_is_ignored(
    client: TestClient, migrated: asyncpg.Connection, frame: dict
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        _next(ana)
        ana.send_text(json.dumps(frame))
        _send(ana, "marker")
        first = _next(ana)

    assert first["message"]["text"] == "marker"
    assert await _rows(migrated, session.id) == ["marker"]
