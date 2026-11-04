"""Spec 012 task 9: the presentation socket for signed-in users (plan.md "Join, all three
kinds", "Presentation tokens for accounts", "Presentation join touches activity",
"Signed-in mark on the wire").

FR-1, FR-3, FR-5, FR-6, FR-7, FR-14, NFR-2. A real database, the real app and the test
Keycloak; nothing mocked. Each signed-in jar is one device.
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import asyncpg
import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import clock
from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.present import repo
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


@pytest.fixture
async def client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
        await conn.execute(
            """truncate presentation_chat_message, presentation_participant,
                        presentation_session, presentation_version, presentation cascade"""
        )
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer=keycloak.issuer,
        oidc_client_id=keycloak.client_id,
        oidc_client_secret=keycloak.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
async def conn(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    connection = await asyncpg.connect(database_url)
    try:
        yield connection
    finally:
        await connection.close()


async def _invite(client: TestClient, conn: asyncpg.Connection) -> str:
    created = await repo.create_presentation(
        conn,
        title="Intro to DNS",
        topic="Networking",
        html="".join(f"<section><h1>Slide {i}</h1></section>" for i in range(3)),
        kind="slides",
        slide_count=3,
        created_by_sub="editor-sub",
    )
    response = client.post("/api/present/sessions", json={"presentation_id": str(created.id)})
    assert response.status_code == 201, response.text
    return response.json()["invite_id"]


def _url(invite: str, name: str | None = None, rejoin: str | None = None) -> str:
    query = []
    if name is not None:
        query.append(f"name={quote(name)}")
    if rejoin is not None:
        query.append(f"rejoin={quote(rejoin)}")
    return f"/api/present/sessions/{invite}/ws" + (f"?{'&'.join(query)}" if query else "")


class _Socket:
    def __init__(self, ws) -> None:
        self.ws = ws

    def json(self) -> dict:
        return self.ws.receive_json()

    def presence_of(self, count: int) -> list[dict]:
        while True:
            frame = self.json()
            if frame["type"] == "presence" and len(frame["participants"]) == count:
                return frame["participants"]


@contextmanager
def _joined(
    client: TestClient,
    invite: str,
    *,
    jar: httpx.Cookies | None = None,
    name: str | None = None,
    rejoin: str | None = None,
) -> Iterator[tuple[_Socket, dict]]:
    headers = cookie_header(jar) if jar is not None else {}
    with client.websocket_connect(_url(invite, name, rejoin), headers=headers) as ws:
        socket = _Socket(ws)
        welcome = socket.json()
        assert welcome["type"] == "welcome", welcome
        yield socket, welcome


# --- FR-1, NFR-2 ------------------------------------------------------------------------------


async def test_signed_in_joins_as_account_without_name(
    client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = await _invite(client, conn)
    jar = signed_in_jar(client, "newuser")

    with _joined(client, invite, jar=jar) as (socket, welcome):
        you = welcome["you"]
        assert you["name"] == "newuser"
        assert you["signed_in"] is True
        assert welcome["participants"] == [
            {"id": you["participant_id"], "name": "newuser", "color": 0, "signed_in": True}
        ]
        assert socket.presence_of(1)[0]["signed_in"] is True

    sub = await conn.fetchval(
        "select account_sub from presentation_participant where id = $1",
        uuid.UUID(you["participant_id"]),
    )
    assert sub is not None


async def test_name_is_ignored_when_signed_in(
    client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = await _invite(client, conn)
    jar = signed_in_jar(client, "newuser")

    with _joined(client, invite, jar=jar, name="admin") as (_, welcome):
        assert welcome["you"]["name"] == "newuser"
        assert welcome["participants"][0]["name"] == "newuser"


# --- FR-5, FR-7: a second device -----------------------------------------------------------------


async def test_second_device_reuses_participant_and_rotates_token(
    client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = await _invite(client, conn)
    laptop = signed_in_jar(client, "newuser")
    phone = signed_in_jar(client, "newuser")

    with ExitStack() as stack:
        first, first_welcome = stack.enter_context(_joined(client, invite, jar=laptop))
        old_token = first_welcome["you"]["rejoin_token"]
        second, second_welcome = stack.enter_context(_joined(client, invite, jar=phone))
        you = second_welcome["you"]
        assert you["participant_id"] == first_welcome["you"]["participant_id"]
        assert you["signed_in"] is True
        assert you["rejoin_token"] != old_token
        assert len(second_welcome["participants"]) == 1
        with pytest.raises(WebSocketDisconnect) as info:
            while True:
                first.json()
        assert info.value.code == 4409

    # The old token no longer rejoins: signed out with it, a new participant joins.
    with _joined(client, invite, name="Guest", rejoin=old_token) as (_, welcome):
        assert welcome["you"]["participant_id"] != you["participant_id"]
        assert welcome["you"]["name"] == "Guest"
        assert welcome["you"]["signed_in"] is False
    # The new one still does (the anonymous token rule is unchanged).
    with _joined(client, invite, name="Guest", rejoin=you["rejoin_token"]) as (_, welcome):
        assert welcome["you"]["participant_id"] == you["participant_id"]
        assert welcome["you"]["signed_in"] is True

    count = await conn.fetchval(
        "select count(*) from presentation_participant where account_sub is not null"
    )
    assert count == 1


async def test_two_accounts_are_two_participants(
    client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = await _invite(client, conn)
    newuser = signed_in_jar(client, "newuser")
    other = signed_in_jar(client, "other")

    with ExitStack() as stack:
        a, a_welcome = stack.enter_context(_joined(client, invite, jar=newuser))
        _, b_welcome = stack.enter_context(_joined(client, invite, jar=other))
        assert a_welcome["you"]["participant_id"] != b_welcome["you"]["participant_id"]
        names = sorted(p["name"] for p in a.presence_of(2))
        assert names == ["newuser", "other"]


# --- FR-14: rejoining clears a hide ------------------------------------------------------------


async def test_rejoin_clears_hidden_at(
    client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = await _invite(client, conn)
    jar = signed_in_jar(client, "newuser")
    with _joined(client, invite, jar=jar) as (_, welcome):
        participant_id = uuid.UUID(welcome["you"]["participant_id"])
    await conn.execute(
        "update presentation_participant set hidden_at = now() where id = $1", participant_id
    )

    with _joined(client, invite, jar=jar) as (_, welcome):
        assert welcome["you"]["participant_id"] == str(participant_id)
        row = await conn.fetchrow(
            "select hidden_at, left_at from presentation_participant where id = $1",
            participant_id,
        )
        assert row["hidden_at"] is None
        assert row["left_at"] is None


# --- FR-6: anonymous joins are unchanged --------------------------------------------------------


async def test_anonymous_join_is_not_signed_in(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)
    with _joined(client, invite, name="Ana") as (_, welcome):
        assert welcome["you"]["name"] == "Ana"
        assert welcome["you"]["signed_in"] is False
        assert welcome["participants"][0]["signed_in"] is False


async def test_anonymous_without_name_is_refused(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)
    with client.websocket_connect(_url(invite)) as ws:
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
    assert info.value.code == 4422


# --- FR-2 ordering input: a join is activity ----------------------------------------------------


@pytest.mark.parametrize("signed_in", [False, True])
async def test_join_touches_last_activity(
    client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
    signed_in: bool,
) -> None:
    invite = await _invite(client, conn)
    jar = signed_in_jar(client, "newuser") if signed_in else None
    # In the past, so the cookie's `exp` still lies ahead of the frozen clock.
    at = datetime.now(UTC).replace(microsecond=0) - timedelta(hours=1)
    await conn.execute(
        "update presentation_session set last_activity_at = $2 where invite_id = $1",
        invite,
        at - timedelta(days=1),
    )

    with clock.frozen(at), _joined(client, invite, jar=jar, name=None if jar else "Ana"):
        pass

    touched = await conn.fetchval(
        "select last_activity_at from presentation_session where invite_id = $1", invite
    )
    assert touched == at
