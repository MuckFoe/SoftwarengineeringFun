"""Spec 006 task 29: learning-session chat (`learn/chat.py`, REST, WebSocket). FR-29, FR-27.

AC-32: two participants; 2000 characters are delivered to both, 2001 refused `chat_too_long`,
empty refused `chat_empty`; an admin's removal reaches both as `chat_removed`, nobody else
may remove; a stale session's chat is read-only (REST `read_only`, WebSocket closed 4410).
Messages survive a restart (`welcome.chat`). Completed sessions keep chat open. The rules and
wire shapes are spec 002's. A real database, Keycloak and the real app; nothing mocked.
Spec 012 task 12 (FR-3, FR-8, NFR-2): messages carry `participant_id` and `signed_in`.
"""

import dataclasses
import json
import secrets
import uuid
from collections.abc import AsyncIterator
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import clock
from app import db as app_db
from app.config import Settings
from app.learn import chat, repo, service
from app.learn.lesson_file import ChoiceCheck, Lesson, Step
from app.main import create_app
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)

LESSON = Lesson(
    title="Chat basics",
    summary="Two steps.",
    minutes=5,
    images=(),
    steps=(
        Step(kind="explanation", title="Intro", body="Read this.", hint=None, check=None),
        Step(
            kind="quiz",
            title="Pick",
            body="Pick the second.",
            hint=None,
            check=ChoiceCheck(options=("a", "b"), correct=(2,), multiple=False),
        ),
    ),
)

MESSAGE_KEYS = {"id", "sender_name", "text", "sent_at", "participant_id", "signed_in"}


def _settings(kc: Keycloak, database_url: str) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
def settings(keycloak: Keycloak, database_url: str) -> Settings:  # noqa: F811
    return _settings(keycloak, database_url)


@pytest.fixture
async def client(settings: Settings, migrated: asyncpg.Connection) -> AsyncIterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


async def _session(conn: asyncpg.Connection) -> repo.LearningSession:
    key = f"zz-chat/{secrets.token_hex(4)}"
    content = {**dataclasses.asdict(LESSON), "images": {}}
    version_id = await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $2, $3::jsonb) returning id""",
        key,
        secrets.token_hex(16),
        json.dumps(content),
    )
    await conn.execute(
        """insert into lesson (key, topic_key, topic_title, current_version_id)
           values ($1, 'zz-chat', 'Chat', $2)""",
        key,
        version_id,
    )
    return await service.create_session(conn, key)


async def _message(conn: asyncpg.Connection, session: repo.LearningSession, text: str) -> int:
    participant = await repo.add_participant(conn, session.id, "Ben")
    message = await chat.insert(conn, session.id, participant.id, "Ben", text, clock.now())
    return message.id


def _ws_url(invite: str, name: str) -> str:
    return f"/api/learn/sessions/{invite}/ws?name={quote(name)}"


def _send(ws, text: str) -> str:
    client_id = uuid.uuid4().hex
    ws.send_text(json.dumps({"type": "chat_send", "client_id": client_id, "text": text}))
    return client_id


def _next(ws) -> dict:
    """The next message that isn't a presence update."""
    while True:
        message = ws.receive_json()
        if message["type"] != "presence":
            return message


def _chat(client: TestClient, invite: str) -> dict:
    response = client.get(f"/api/learn/sessions/{invite}/chat")
    assert response.status_code == 200
    return response.json()


def _texts(client: TestClient, invite: str) -> list[str]:
    return [m["text"] for m in _chat(client, invite)["messages"]]


# --- AC-32 ---------------------------------------------------------------------------------


async def test_ac32_2000_chars_reach_both_2001_and_empty_are_refused_to_the_sender_only(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        assert _next(ana)["type"] == "welcome"
        assert _next(ben)["type"] == "welcome"

        long_ok = "x" * 2000
        client_id = _send(ana, long_ok)
        to_ana, to_ben = _next(ana), _next(ben)
        assert to_ana == to_ben
        assert to_ana["type"] == "chat_message"
        assert to_ana["client_id"] == client_id
        assert set(to_ana["message"]) == MESSAGE_KEYS
        assert to_ana["message"]["text"] == long_ok
        assert to_ana["message"]["sender_name"] == "Ana"

        too_long = _send(ana, "x" * 2001)
        assert _next(ana) == {
            "type": "error",
            "code": "chat_too_long",
            "client_id": too_long,
            "limit": 2000,
        }
        empty = _send(ana, "   ")
        assert _next(ana) == {"type": "error", "code": "chat_empty", "client_id": empty}

        # Ben saw neither refusal: his next message is the one sent after them.
        _send(ana, "after")
        assert _next(ana)["message"]["text"] == "after"
        assert _next(ben)["message"]["text"] == "after"

    assert _texts(client, session.invite_id) == [long_ok, "after"]


async def test_ac32_admin_removal_reaches_both_and_later_joiners(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    # Ana and Ben join signed out: two sockets signed in as one account would be one
    # participant, the second replacing the first (spec 012 FR-5). The admin signs in after.
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        assert _next(ana)["type"] == "welcome"
        assert _next(ben)["type"] == "welcome"
        ids = {}
        for text in ("one", "abuse", "three"):
            _send(ana, text)
            ids[text] = _next(ana)["message"]["id"]
            assert _next(ben)["message"]["id"] == ids[text]

        login_as(client, "admin1")
        response = client.delete(f"/api/learn/sessions/{session.invite_id}/chat/{ids['abuse']}")
        assert response.status_code == 204
        assert _next(ana) == _next(ben) == {"type": "chat_removed", "id": ids["abuse"]}

    with client.websocket_connect(_ws_url(session.invite_id, "Cy")) as cy:
        welcome = _next(cy)
    assert [m["text"] for m in welcome["chat"]] == ["one", "three"]
    assert _texts(client, session.invite_id) == ["one", "three"]
    # Hidden, not erased, and attributed to the admin.
    row = await migrated.fetchrow(
        "select body, removed_at, removed_by_sub from learning_chat_message where id = $1",
        ids["abuse"],
    )
    assert row["body"] == "abuse"
    assert row["removed_at"] is not None
    assert row["removed_by_sub"]

    again = client.delete(f"/api/learn/sessions/{session.invite_id}/chat/{ids['abuse']}")
    assert again.status_code == 404


@pytest.mark.parametrize(("user", "status"), [(None, 401), ("plain1", 403), ("editor1", 403)])
async def test_ac32_only_an_admin_can_remove(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
    user: str | None,
    status: int,
) -> None:
    session = await _session(migrated)
    message_id = await _message(migrated, session, "stays")
    if user is not None:
        login_as(client, user)

    response = client.delete(f"/api/learn/sessions/{session.invite_id}/chat/{message_id}")

    assert response.status_code == status
    assert _texts(client, session.invite_id) == ["stays"]


async def test_ac32_a_stale_sessions_chat_is_read_only(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _message(migrated, session, "before stale")
    assert _chat(client, session.invite_id)["read_only"] is False
    await migrated.execute(
        "update learning_session set stale_at = $2 where id = $1", session.id, clock.now()
    )

    body = _chat(client, session.invite_id)
    assert body["read_only"] is True
    assert [m["text"] for m in body["messages"]] == ["before stale"]
    assert set(body["messages"][0]) == MESSAGE_KEYS
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4410


async def test_a_socket_open_when_the_session_goes_stale_has_its_chat_refused(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        assert _next(ana)["type"] == "welcome"
        await migrated.execute(
            "update learning_session set stale_at = $2 where id = $1", session.id, clock.now()
        )
        client_id = _send(ana, "too late")
        assert _next(ana) == {"type": "error", "code": "session_stale", "client_id": client_id}

    assert _texts(client, session.invite_id) == []


# --- durability, completed sessions, activity ----------------------------------------------


async def test_messages_survive_a_restart_and_come_back_in_welcome(
    settings: Settings, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with TestClient(create_app(settings)) as first:
        with first.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
            assert _next(ana)["type"] == "welcome"
            _send(ana, "hello")
            sent = _next(ana)["message"]

    with TestClient(create_app(settings)) as second:
        with second.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
            welcome = _next(ana)

    assert welcome["type"] == "welcome"
    assert welcome["chat"] == [sent]


async def test_a_completed_session_keeps_chat_open(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await migrated.execute(
        "update learning_session set completed_at = $2 where id = $1", session.id, clock.now()
    )
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        assert _next(ana)["record"]["completed"] is True
        _send(ana, "well done")
        assert _next(ana)["message"]["text"] == "well done"

    assert _chat(client, session.invite_id)["read_only"] is False


async def test_sending_a_message_touches_activity(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        assert _next(ana)["type"] == "welcome"
        await migrated.execute(
            "update learning_session set last_activity_at = '2020-01-01' where id = $1",
            session.id,
        )
        _send(ana, "ping")
        assert _next(ana)["type"] == "chat_message"

    after = await migrated.fetchval(
        "select last_activity_at from learning_session where id = $1", session.id
    )
    assert after.year > 2020


async def test_malformed_chat_frames_are_ignored(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        assert _next(ana)["type"] == "welcome"
        ana.send_text(json.dumps({"type": "chat_send", "text": "no client id"}))
        ana.send_text(json.dumps({"type": "chat_send", "client_id": "c", "text": 5}))
        ana.send_text(json.dumps({"type": "chat_remove", "id": 1}))
        _send(ana, "next")
        assert _next(ana)["message"]["text"] == "next"

    assert _texts(client, session.invite_id) == ["next"]


# --- scoping -------------------------------------------------------------------------------


async def test_an_unknown_invite_gets_404(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    response = client.get("/api/learn/sessions/doesnotexist/chat")
    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}
    login_as(client, "admin1")
    assert client.delete("/api/learn/sessions/doesnotexist/chat/1").status_code == 404


async def test_removing_another_sessions_message_through_this_invite_gets_404(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    a, b = await _session(migrated), await _session(migrated)
    await _message(migrated, a, "in A")
    b_message = await _message(migrated, b, "in B")
    login_as(client, "admin1")

    response = client.delete(f"/api/learn/sessions/{a.invite_id}/chat/{b_message}")

    assert response.status_code == 404
    assert _texts(client, a.invite_id) == ["in A"]
    assert _texts(client, b.invite_id) == ["in B"]


async def test_coding_session_chat_does_not_see_learning_chat(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    """NFR-5: a learning session's invite is unknown to the coding-session chat."""
    session = await _session(migrated)
    await _message(migrated, session, "learning only")

    assert client.get(f"/api/sessions/{session.invite_id}/chat").status_code == 404


# --- spec 012 task 12: participant_id and signed_in on every message ------------------------


def _signed_in_ws(client: TestClient, invite: str, jar):
    return client.websocket_connect(f"/api/learn/sessions/{invite}/ws", headers=cookie_header(jar))


async def test_012_fr8_only_the_signed_in_newuser_has_the_mark_nfr2_client_cannot_set_it(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")
    with (
        _signed_in_ws(client, session.invite_id, jar) as account,
        client.websocket_connect(_ws_url(session.invite_id, "newuser")) as visitor,
    ):
        account_id = _next(account)["you"]["participant_id"]
        visitor_id = _next(visitor)["you"]["participant_id"]

        _send(account, "from the account")
        frames = [_next(account)["message"], _next(visitor)["message"]]
        # NFR-2: a client-supplied signed_in is never read.
        visitor.send_text(
            json.dumps(
                {
                    "type": "chat_send",
                    "client_id": "x",
                    "text": "from the visitor",
                    "signed_in": True,
                }
            )
        )
        frames += [_next(account)["message"], _next(visitor)["message"]]

    assert [(m["participant_id"], m["signed_in"]) for m in frames] == [
        (account_id, True),
        (account_id, True),
        (visitor_id, False),
        (visitor_id, False),
    ]
    assert [m["sender_name"] for m in frames] == ["newuser"] * 4

    history = _chat(client, session.invite_id)["messages"]
    assert [(m["text"], m["participant_id"], m["signed_in"]) for m in history] == [
        ("from the account", account_id, True),
        ("from the visitor", visitor_id, False),
    ]


async def test_012_fr3_after_reconnect_the_earlier_message_is_their_own(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")
    with _signed_in_ws(client, session.invite_id, jar) as first:
        _next(first)
        _send(first, "before reconnect")
        _next(first)

    with _signed_in_ws(client, session.invite_id, jar) as again:
        welcome = _next(again)

    you = welcome["you"]["participant_id"]
    (earlier,) = welcome["chat"]
    assert (earlier["participant_id"], earlier["signed_in"]) == (you, True)
    (rest,) = _chat(client, session.invite_id)["messages"]
    assert rest["participant_id"] == you
