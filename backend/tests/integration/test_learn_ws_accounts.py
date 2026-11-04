"""Spec 012 task 8: account join on the learning socket, `4409`, `signed_in` on the wire.

FR-1, FR-3, FR-5, FR-6, FR-7, FR-14, NFR-2. Real Keycloak sign-ins (one cookie jar per
device), a real database and the real app; nothing mocked.
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from urllib.parse import quote

import asyncpg
import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.main import create_app
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)
from tests.integration.test_learn_ws import _session

APP_COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


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
        session_cookie_key=APP_COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _url(invite: str, name: str | None = None) -> str:
    query = "" if name is None else f"?name={quote(name)}"
    return f"/api/learn/sessions/{invite}/ws{query}"


def _next(ws, kind: str) -> dict:
    while (message := ws.receive_json())["type"] != kind:
        pass
    return message


@contextmanager
def _joined(
    client: TestClient, invite: str, *, name: str | None = None, jar: httpx.Cookies | None = None
) -> Iterator[tuple[object, dict, dict]]:
    """Joins; yields the socket, its `welcome` and its own first `presence`."""
    headers = cookie_header(jar) if jar is not None else {}
    with client.websocket_connect(_url(invite, name), headers=headers) as ws:
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome", welcome
        presence = ws.receive_json()
        assert presence["type"] == "presence"
        yield ws, welcome, presence


def _close_code(
    client: TestClient, invite: str, *, name: str | None = None, jar: httpx.Cookies | None = None
) -> int:
    headers = cookie_header(jar) if jar is not None else {}
    with client.websocket_connect(_url(invite, name), headers=headers) as ws:
        with pytest.raises(WebSocketDisconnect) as info:
            while True:
                ws.receive_json()
    return info.value.code


def _closed_with(ws) -> int:
    """Reads until the server closes the socket; returns the close code."""
    with pytest.raises(WebSocketDisconnect) as info:
        while True:
            ws.receive_json()
    return info.value.code


async def _account_rows(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """select id, display_name, account_sub, left_at, hidden_at from learning_participant
            where session_id = $1 and account_sub is not null""",
        session_id,
    )


# --- FR-1 / NFR-2 -----------------------------------------------------------------------------


async def test_fr1_signed_in_socket_without_name_joins_as_the_account(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")

    with _joined(client, session.invite_id, jar=jar) as (_, welcome, presence):
        pass

    you = welcome["you"]
    assert you == {"participant_id": you["participant_id"], "name": "newuser", "signed_in": True}
    assert presence["participants"] == [
        {"id": you["participant_id"], "name": "newuser", "signed_in": True}
    ]
    (row,) = await _account_rows(migrated, session.id)
    assert str(row["id"]) == you["participant_id"]
    assert row["display_name"] == "newuser"
    assert row["account_sub"]


async def test_nfr2_name_is_ignored_when_signed_in_and_a_forged_cookie_is_signed_out(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")

    with _joined(client, session.invite_id, name="admin", jar=jar) as (_, welcome, _p):
        assert welcome["you"]["name"] == "newuser"
        assert welcome["you"]["signed_in"] is True

    forged = httpx.Cookies()
    for cookie_name, value in jar.items():
        last = "A" if value[-1] != "A" else "B"
        forged.set(cookie_name, value[:-1] + last)
    assert _close_code(client, session.invite_id, jar=forged) == 4422
    with _joined(client, session.invite_id, name="Ann", jar=forged) as (_, welcome, _p):
        assert welcome["you"]["name"] == "Ann"
        assert welcome["you"]["signed_in"] is False


# --- FR-6 -------------------------------------------------------------------------------------


async def test_fr6_anonymous_join_is_unchanged_and_marked_not_signed_in(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    assert _close_code(client, session.invite_id) == 4422
    ids = []
    for _ in range(2):
        with _joined(client, session.invite_id, name="Ann") as (_, welcome, presence):
            you = welcome["you"]
            assert you == {
                "participant_id": you["participant_id"],
                "name": "Ann",
                "signed_in": False,
            }
            assert presence["participants"] == [
                {"id": you["participant_id"], "name": "Ann", "signed_in": False}
            ]
            ids.append(you["participant_id"])
    # A new participant per anonymous join, as today.
    assert ids[0] != ids[1]
    assert await _account_rows(migrated, session.id) == []


# --- FR-3 / FR-14 -----------------------------------------------------------------------------


async def test_fr3_fr14_reconnect_is_the_same_participant_and_clears_hidden_at(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    jar = signed_in_jar(client, "newuser")

    with _joined(client, session.invite_id, jar=jar) as (_, first, _p):
        pass
    (row,) = await _account_rows(migrated, session.id)
    assert row["left_at"] is not None

    with _joined(client, session.invite_id, jar=jar) as (_, second, _p):
        (row,) = await _account_rows(migrated, session.id)
        assert row["left_at"] is None
    assert second["you"]["participant_id"] == first["you"]["participant_id"]

    await migrated.execute(
        "update learning_participant set hidden_at = now() where id = $1", row["id"]
    )
    with _joined(client, session.invite_id, jar=jar) as (_, third, _p):
        pass
    assert third["you"]["participant_id"] == first["you"]["participant_id"]
    (row,) = await _account_rows(migrated, session.id)
    assert row["hidden_at"] is None


# --- FR-5 / FR-7 ------------------------------------------------------------------------------


async def test_fr5_second_device_replaces_the_first_with_4409(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    session = await _session(migrated)
    laptop, phone = signed_in_jar(client, "newuser"), signed_in_jar(client, "newuser")

    with _joined(client, session.invite_id, name="Ada") as (ada, _, _p):
        with _joined(client, session.invite_id, jar=laptop) as (first, welcome1, _p1):
            _next(ada, "presence")
            with _joined(client, session.invite_id, jar=phone) as (_, welcome2, presence):
                assert _closed_with(first) == 4409
                assert welcome2["you"]["participant_id"] == welcome1["you"]["participant_id"]
                names = sorted(p["name"] for p in presence["participants"])
                assert names == ["Ada", "newuser"]
                # The replaced socket's leave changes nothing: newuser is still present.
                (row,) = await _account_rows(migrated, session.id)
                assert row["left_at"] is None
                with _joined(client, session.invite_id, name="Bob") as (_, _w, after):
                    names = sorted(p["name"] for p in after["participants"])
                    assert names == ["Ada", "Bob", "newuser"]


async def test_fr7_a_second_device_takes_no_seat(
    client: TestClient,
    migrated: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    # Given L1 with 4 participants including newuser, and a limit of 5, when newuser
    # rejoins from a second device, then L1 still counts 4, and a fifth person can join.
    session = await _session(migrated)
    laptop, phone = signed_in_jar(client, "newuser"), signed_in_jar(client, "newuser")

    with ExitStack() as stack:
        for i in range(3):
            stack.enter_context(_joined(client, session.invite_id, name=f"user{i}"))
        first, _, _p = stack.enter_context(_joined(client, session.invite_id, jar=laptop))
        _, _, presence = stack.enter_context(_joined(client, session.invite_id, jar=phone))
        assert _closed_with(first) == 4409
        assert len(presence["participants"]) == 4

        _, welcome, fifth = stack.enter_context(_joined(client, session.invite_id, name="Fifth"))
        assert welcome["you"]["name"] == "Fifth"
        assert len(fifth["participants"]) == 5
        assert _close_code(client, session.invite_id, name="Sixth") == 4403
