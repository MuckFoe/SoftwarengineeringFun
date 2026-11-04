"""Spec 012 task 7: the coding socket joins a signed-in user as their account (plan.md
"Join, all three kinds", "One connection per participant, newest wins", "Signed-in mark on
the wire"). FR-1, FR-3, FR-5, FR-6, FR-7, FR-14, NFR-2. Real Postgres and the test Keycloak.
"""

import uuid
from collections.abc import AsyncIterator
from urllib.parse import quote

import asyncpg
import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.sessions import repo as sessions_repo
from app.sessions.ws import CLOSE_INVALID_NAME, CLOSE_REPLACED
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)

ADD = parse_signature("def add(a: int, b: int) -> int")
COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


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


def _url(invite: str, name: str | None = None) -> str:
    url = f"/api/sessions/{invite}/ws"
    return url if name is None else f"{url}?name={quote(name)}"


def _connect(client: TestClient, invite: str, jar: httpx.Cookies | None, name: str | None = None):
    headers = cookie_header(jar) if jar is not None else {}
    return client.websocket_connect(_url(invite, name), headers=headers)


def _closed_with(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as exc_info:
        ws.receive_json()
    return exc_info.value.code


async def test_fr1_signed_in_socket_without_name_joins_as_the_account(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")

    with _connect(client, session.invite_id, jar) as ws:
        welcome = ws.receive_json()

    assert welcome["type"] == "welcome"
    you = welcome["you"]
    assert you == {"participant_id": you["participant_id"], "name": "newuser", "signed_in": True}
    assert welcome["presence"] == [
        {"id": you["participant_id"], "name": "newuser", "signed_in": True}
    ]


async def test_nfr2_a_signed_in_name_param_is_ignored(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")

    with _connect(client, session.invite_id, jar, name="admin") as ws:
        welcome = ws.receive_json()

    assert welcome["you"]["name"] == "newuser"
    assert [p["name"] for p in welcome["presence"]] == ["newuser"]


async def test_nfr2_a_badly_signed_cookie_is_signed_out(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    forged = {"cookie": "collab_session=eyJzdWIiOiAieCJ9.forged.signature"}

    with client.websocket_connect(_url(session.invite_id), headers=forged) as ws:
        assert _closed_with(ws) == CLOSE_INVALID_NAME


async def test_fr3_reconnecting_is_the_same_participant(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")

    with _connect(client, session.invite_id, jar) as ws:
        first = ws.receive_json()["you"]["participant_id"]
    with _connect(client, session.invite_id, jar) as ws:
        second = ws.receive_json()["you"]["participant_id"]

    assert first == second
    rows = await migrated.fetch("select id from participant where session_id = $1", session.id)
    assert [str(r["id"]) for r in rows] == [first]


async def test_fr5_a_second_device_replaces_the_first_closing_it_4409(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    laptop = signed_in_jar(client, "newuser")
    phone = signed_in_jar(client, "newuser")

    with _connect(client, session.invite_id, laptop) as ws1:
        first = ws1.receive_json()
        with _connect(client, session.invite_id, phone) as ws2:
            second = ws2.receive_json()
            assert _closed_with(ws1) == CLOSE_REPLACED

            assert second["you"]["participant_id"] == first["you"]["participant_id"]
            assert [p["name"] for p in second["presence"]] == ["newuser"]

            # The replaced socket's leave changes nothing: the phone is still present.
            with _connect(client, session.invite_id, None, name="Ann") as ws3:
                presence = ws3.receive_json()["presence"]
            assert sorted(p["name"] for p in presence) == ["Ann", "newuser"]


async def test_fr14_rejoining_a_hidden_session_unhides_it(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")

    with _connect(client, session.invite_id, jar) as ws:
        first = ws.receive_json()["you"]["participant_id"]
    await migrated.execute(
        "update participant set hidden_at = now() where id = $1", uuid.UUID(first)
    )
    with _connect(client, session.invite_id, jar) as ws:
        second = ws.receive_json()["you"]["participant_id"]

    assert second == first
    row = await migrated.fetchrow(
        "select hidden_at, account_sub from participant where id = $1", uuid.UUID(first)
    )
    assert row["hidden_at"] is None
    assert row["account_sub"] is not None


async def test_fr6_signed_out_without_name_closes_4422(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    with _connect(client, session.invite_id, None) as ws:
        assert _closed_with(ws) == CLOSE_INVALID_NAME


async def test_fr6_signed_out_with_name_is_a_new_anonymous_participant_each_join(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    with _connect(client, session.invite_id, None, name="Ann") as ws:
        first = ws.receive_json()
    with _connect(client, session.invite_id, None, name="Ann") as ws:
        second = ws.receive_json()

    assert first["you"]["signed_in"] is False
    assert first["you"]["name"] == "Ann"
    assert [p["signed_in"] for p in first["presence"]] == [False]
    assert first["you"]["participant_id"] != second["you"]["participant_id"]
    subs = await migrated.fetch(
        "select account_sub from participant where session_id = $1", session.id
    )
    assert [r["account_sub"] for r in subs] == [None, None]
