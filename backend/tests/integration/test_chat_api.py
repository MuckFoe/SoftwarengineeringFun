"""Spec 002 task 17: chat REST, history and admin removal (`chat/api.py`, `chat/service.py`).

FR16 (stale history read-only, writable after reactivation), FR17 (no access without the
invite, no cross-session removal), FR19 (admin removal, live and for later joiners; nobody
else can remove). Real Postgres, the real Keycloak test realm, TestClient WebSockets.
"""

import json
import time
import uuid
from collections.abc import AsyncIterator
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import clock
from app import db as app_db
from app.chat import repo as chat_repo
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.sessions import repo as sessions_repo
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
ADD = parse_signature("def add(a: int, b: int) -> int")


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
async def client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
    migrated: asyncpg.Connection,
) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
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


async def _message(conn: asyncpg.Connection, session: sessions_repo.Session, text: str) -> int:
    participant = await sessions_repo.add_participant(conn, session.id, "Ben")
    message = await chat_repo.insert(conn, session.id, participant.id, "Ben", text, clock.now())
    return message.id


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _send(ws, text: str) -> None:
    ws.send_text(json.dumps({"type": "chat_send", "client_id": uuid.uuid4().hex, "text": text}))


def _next(ws) -> dict:
    """The next message that isn't a presence update."""
    while True:
        message = ws.receive_json()
        if message["type"] != "presence":
            return message


def _texts(client: TestClient, invite: str) -> list[str]:
    response = client.get(f"/api/sessions/{invite}/chat")
    assert response.status_code == 200
    return [m["text"] for m in response.json()["messages"]]


async def test_fr16_stale_history_is_read_only_until_an_admin_reactivates(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    await _message(migrated, session, "before stale")
    await sessions_repo.set_stale(migrated, session.id)

    stale = client.get(f"/api/sessions/{session.invite_id}/chat")
    assert stale.status_code == 200
    body = stale.json()
    assert body["read_only"] is True
    assert [m["text"] for m in body["messages"]] == ["before stale"]
    assert set(body["messages"][0]) == {"id", "sender_name", "text", "sent_at"}
    assert body["messages"][0]["sender_name"] == "Ben"
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ws:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
    assert exc_info.value.code == 4410

    login_as(client, "admin1")
    assert client.post(f"/api/sessions/{session.invite_id}/reactivate").status_code == 200

    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        assert _next(ana)["type"] == "welcome"
        _send(ana, "after reactivation")
        assert _next(ana)["type"] == "chat_message"
    active = client.get(f"/api/sessions/{session.invite_id}/chat").json()
    assert active["read_only"] is False
    assert [m["text"] for m in active["messages"]] == ["before stale", "after reactivation"]


async def test_fr17_an_unknown_invite_gets_404(client: TestClient) -> None:
    response = client.get("/api/sessions/doesnotexist/chat")

    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}


async def test_fr17_removing_another_sessions_message_through_this_invite_gets_404(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    a, b = await _session(migrated), await _session(migrated)
    await _message(migrated, a, "in A")
    b_message = await _message(migrated, b, "in B")
    login_as(client, "admin1")

    response = client.delete(f"/api/sessions/{a.invite_id}/chat/{b_message}")

    assert response.status_code == 404
    assert client.delete(f"/api/sessions/doesnotexist/chat/{b_message}").status_code == 404
    assert _texts(client, a.invite_id) == ["in A"]
    assert _texts(client, b.invite_id) == ["in B"]


async def test_fr19_admin_removal_reaches_everyone_within_1s_and_later_joiners(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    login_as(client, "admin1")
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        assert _next(ana)["type"] == "welcome"
        assert _next(ben)["type"] == "welcome"
        ids = {}
        for text in ("one", "abuse", "three"):
            _send(ben, text)
            ids[text] = _next(ben)["message"]["id"]
            assert _next(ana)["message"]["id"] == ids[text]

        start = time.monotonic()
        response = client.delete(f"/api/sessions/{session.invite_id}/chat/{ids['abuse']}")
        # Checked before reading the sockets, which would otherwise wait forever.
        assert response.status_code == 204
        to_ana, to_ben = _next(ana), _next(ben)
        elapsed = time.monotonic() - start

    assert elapsed < 1
    assert to_ana == to_ben == {"type": "chat_removed", "id": ids["abuse"]}

    with client.websocket_connect(_ws_url(session.invite_id, "Cy")) as cy:
        welcome = _next(cy)
    assert [m["text"] for m in welcome["chat"]] == ["one", "three"]
    assert _texts(client, session.invite_id) == ["one", "three"]
    # Hidden, not erased (spec Decisions), and attributed to the admin.
    row = await migrated.fetchrow(
        "select body, removed_at, removed_by_sub from chat_message where id = $1", ids["abuse"]
    )
    assert row["body"] == "abuse"
    assert row["removed_at"] is not None
    assert row["removed_by_sub"]

    # Already removed: nothing left to remove.
    again = client.delete(f"/api/sessions/{session.invite_id}/chat/{ids['abuse']}")
    assert again.status_code == 404


async def test_fr19_removal_with_no_one_connected_still_hides_the_message(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    keep = await _message(migrated, session, "keep")
    drop = await _message(migrated, session, "drop")
    login_as(client, "admin1")

    assert client.delete(f"/api/sessions/{session.invite_id}/chat/{drop}").status_code == 204

    messages = client.get(f"/api/sessions/{session.invite_id}/chat").json()["messages"]
    assert [m["id"] for m in messages] == [keep]


@pytest.mark.parametrize(("user", "status"), [(None, 401), ("plain1", 403), ("editor1", 403)])
async def test_fr19_only_an_admin_can_remove(
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

    response = client.delete(f"/api/sessions/{session.invite_id}/chat/{message_id}")

    assert response.status_code == status
    assert _texts(client, session.invite_id) == ["stays"]


async def test_fr19_a_websocket_remove_frame_is_ignored(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    message_id = await _message(migrated, session, "stays")
    with client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben:
        assert _next(ben)["type"] == "welcome"
        ben.send_text(json.dumps({"type": "chat_remove", "id": message_id}))
        _send(ben, "next")
        # The frame produced nothing: the next message is the chat that followed it.
        reply = _next(ben)

    assert reply["type"] == "chat_message"
    assert reply["message"]["text"] == "next"
    assert _texts(client, session.invite_id) == ["stays", "next"]
