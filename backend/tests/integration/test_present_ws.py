"""Spec 013 task 22: the presentation WebSocket core `/api/present/sessions/{invite}/ws`
(plan.md "Contracts — WebSocket", "Hosting", "Following", "Session lifetime").

FR-5, FR-8–FR-16, FR-25–FR-31; AC-5, AC-8–AC-13, AC-15, AC-15b, AC-15c, AC-15e, AC-15g.
A real database and the real app, nothing mocked; the host grace is shortened to 0.3 s so
the host timer runs in real time. "Reaches nobody" is shown with a sentinel: the next frame
the socket gets is a later, known one. The removal test signs in through the test Keycloak.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.present import repo
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

GRACE = 0.3
COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
ANCHOR = {"path": [1, 0], "dx": 0.25, "dy": 0.5}


def _settings(database_url: str, kc: Keycloak | None = None) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer if kc else "http://unused",
        oidc_client_id=kc.client_id if kc else "unused",
        oidc_client_secret=kc.client_secret if kc else "unused",
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
        present_host_grace_seconds=GRACE,
    )


async def _reset(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
        await conn.execute(
            """truncate presentation_chat_message, presentation_participant,
                        presentation_session, presentation_version, presentation cascade"""
        )
    finally:
        await conn.close()


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    await _reset(database_url)
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


@pytest.fixture
async def kc_client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    await _reset(database_url)
    with TestClient(create_app(_settings(database_url, keycloak))) as test_client:
        yield test_client


@pytest.fixture
async def conn(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    connection = await asyncpg.connect(database_url)
    try:
        yield connection
    finally:
        await connection.close()


async def _presentation(conn: asyncpg.Connection, slides: int = 4) -> uuid.UUID:
    html = "".join(f"<section><h1>Slide {i}</h1></section>" for i in range(slides))
    created = await repo.create_presentation(
        conn,
        title="Intro to DNS",
        topic="Networking",
        html=html,
        kind="slides",
        slide_count=slides,
        created_by_sub="editor-sub",
    )
    return created.id


async def _invite(client: TestClient, conn: asyncpg.Connection) -> tuple[uuid.UUID, str]:
    presentation_id = await _presentation(conn)
    response = client.post("/api/present/sessions", json={"presentation_id": str(presentation_id)})
    assert response.status_code == 201, response.text
    return presentation_id, response.json()["invite_id"]


def _url(invite: str, name: str, rejoin: str | None = None) -> str:
    url = f"/api/present/sessions/{invite}/ws?name={quote(name)}"
    return url if rejoin is None else f"{url}&rejoin={quote(rejoin)}"


class _Socket:
    def __init__(self, ws) -> None:
        self.ws = ws

    def json(self) -> dict:
        return self.ws.receive_json()

    def send(self, message: dict) -> None:
        self.ws.send_json(message)

    def until(self, msg_type: str) -> dict:
        """The next frame of `msg_type`, skipping presence, host and drawings_cleared only."""
        while True:
            frame = self.json()
            if frame["type"] == msg_type:
                return frame
            assert frame["type"] in {"presence", "host", "drawings_cleared"}, frame

    def presence_of(self, count: int) -> list[dict]:
        while True:
            frame = self.until("presence")
            if len(frame["participants"]) == count:
                return frame["participants"]


@contextmanager
def _joined(
    client: TestClient, invite: str, name: str, rejoin: str | None = None
) -> Iterator[tuple[_Socket, dict]]:
    """Joins and consumes the joiner's own `welcome`."""
    with client.websocket_connect(_url(invite, name, rejoin)) as ws:
        socket = _Socket(ws)
        welcome = socket.json()
        assert welcome["type"] == "welcome", welcome
        yield socket, welcome


def _close_code(client: TestClient, url: str) -> int:
    with client.websocket_connect(url) as ws:
        with pytest.raises(WebSocketDisconnect) as info:
            while True:
                ws.receive_json()
    return info.value.code


# --- AC-8, AC-9: join -------------------------------------------------------------------------


async def test_starter_becomes_host_on_slide_0(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    _, invite = await _invite(client, conn)

    with _joined(client, invite, " Ana ") as (ana, welcome):
        me = welcome["you"]
        assert me["name"] == "Ana"
        assert len(me["rejoin_token"]) >= 32
        assert welcome["host"] == {
            "id": me["participant_id"],
            "name": "Ana",
            "away": False,
            "signed_in": False,
        }
        assert welcome["place"] == {"slide": 0, "anchor": None}
        assert welcome["available"] is True
        assert welcome["kind"] == "slides"
        assert welcome["slide_count"] == 4
        assert me["signed_in"] is False
        assert welcome["participants"] == [
            {"id": me["participant_id"], "name": "Ana", "color": 0, "signed_in": False}
        ]
        assert welcome["strokes"] == []
        assert welcome["chat"] == []
        assert ana.presence_of(1)[0]["name"] == "Ana"

    state = client.get(f"/api/present/sessions/{invite}").json()
    assert state["host_name"] == "Ana"


async def test_join_without_account_and_cap(client: TestClient, conn: asyncpg.Connection) -> None:
    _, invite = await _invite(client, conn)

    assert _close_code(client, _url("no-such-invite", "Ana")) == 4404
    assert _close_code(client, _url(invite, "a" * 31)) == 4422
    assert _close_code(client, _url(invite, "   ")) == 4422
    with ExitStack() as stack:
        sockets = [stack.enter_context(_joined(client, invite, f"user{i}")) for i in range(5)]
        colours = sorted(w["participants"][-1]["color"] for _, w in sockets)
        assert colours == [0, 1, 2, 3, 4]
        assert _close_code(client, _url(invite, "user5")) == 4403
        names = sorted(p["name"] for p in sockets[0][0].presence_of(5))
        assert names == [f"user{i}" for i in range(5)]


# --- AC-10, AC-11, AC-12, AC-13: following ----------------------------------------------------


async def test_place_broadcast_and_welcome_place(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    _, invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        ana.send({"type": "place", "slide": 2, "anchor": ANCHOR})
        assert ben.until("place") == {"type": "place", "slide": 2, "anchor": ANCHOR}
        assert ana.until("place") == {"type": "place", "slide": 2, "anchor": ANCHOR}

        with _joined(client, invite, "Cleo") as (_, welcome):
            assert welcome["place"] == {"slide": 2, "anchor": ANCHOR}

        ana.send({"type": "place", "slide": 4, "anchor": None})
        assert ana.until("error") == {"type": "error", "code": "bad_slide"}


async def test_pointer_relayed_to_others_only(client: TestClient, conn: asyncpg.Connection) -> None:
    _, invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        ana.send({"type": "pointer", "anchor": ANCHOR})
        assert ben.until("pointer") == {"type": "pointer", "anchor": ANCHOR}
        ana.send({"type": "pointer", "anchor": None})
        assert ben.until("pointer") == {"type": "pointer", "anchor": None}

        ben.send({"type": "pointer", "anchor": ANCHOR})
        ana.send({"type": "place", "slide": 1, "anchor": None})
        # Neither her own pointers nor Ben's reached Ana; Ben's own pointer didn't echo.
        assert ana.until("place")["slide"] == 1
        assert ben.until("place")["slide"] == 1


async def test_non_host_place_refused(client: TestClient, conn: asyncpg.Connection) -> None:
    _, invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        ben.send({"type": "place", "slide": 3, "anchor": None})
        assert ben.until("error") == {"type": "error", "code": "not_host"}

        ana.send({"type": "place", "slide": 1, "anchor": None})
        assert ana.until("place")["slide"] == 1
        assert ben.until("place")["slide"] == 1

    state = client.get(f"/api/present/sessions/{invite}").json()
    assert state["place"]["slide"] == 1


# --- AC-15, AC-15b, AC-15c, AC-15e: hosting ---------------------------------------------------


async def test_host_away_and_returned_within_grace(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    _, invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, ana_welcome = stack.enter_context(_joined(client, invite, "Ana"))
        ana_id = ana_welcome["you"]["participant_id"]
        token = ana_welcome["you"]["rejoin_token"]
        ben, _ = stack.enter_context(_joined(client, invite, "Ben"))
        ben.presence_of(2)

        ana.ws.close()
        away = ben.until("host")
        assert away == {
            "type": "host",
            "host": {"id": ana_id, "name": "Ana", "away": True, "signed_in": False},
            "reason": "away",
        }

        with _joined(client, invite, "ignored", rejoin=token) as (ana2, welcome):
            assert welcome["you"]["participant_id"] == ana_id
            assert welcome["you"]["name"] == "Ana"
            assert welcome["host"] == {
                "id": ana_id,
                "name": "Ana",
                "away": False,
                "signed_in": False,
            }
            back = ben.until("host")
            assert back["reason"] == "returned"
            assert back["host"] == {"id": ana_id, "name": "Ana", "away": False, "signed_in": False}

            await asyncio.sleep(GRACE + 0.3)  # the timer was cancelled: no timeout follows
            ana2.send({"type": "place", "slide": 3, "anchor": None})
            # The very next frame: no `host timeout` came in between.
            assert ben.json() == {"type": "place", "slide": 3, "anchor": None}


async def test_host_timer(client: TestClient, conn: asyncpg.Connection) -> None:
    _, invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, ana_welcome = stack.enter_context(_joined(client, invite, "Ana"))
        token = ana_welcome["you"]["rejoin_token"]
        ben, ben_welcome = stack.enter_context(_joined(client, invite, "Ben"))
        ben_id = ben_welcome["you"]["participant_id"]
        cleo, _ = stack.enter_context(_joined(client, invite, "Cleo"))
        ana.presence_of(3)
        ana.send({"type": "place", "slide": 2, "anchor": ANCHOR})
        ben.until("place")
        cleo.until("place")

        ana.ws.close()
        assert ben.until("host")["reason"] == "away"
        assert cleo.until("host")["reason"] == "away"
        # Ben joined before Cleo, so Ben hosts once the grace runs out (FR-26).
        promoted = {
            "type": "host",
            "host": {"id": ben_id, "name": "Ben", "away": False, "signed_in": False},
        }
        assert ben.until("host") == {**promoted, "reason": "timeout"}
        assert cleo.until("host") == {**promoted, "reason": "timeout"}

        # The place is untouched (FR-29); the former host returns as a follower (FR-28).
        with _joined(client, invite, "Ana", rejoin=token) as (ana2, welcome):
            assert welcome["host"] == {
                "id": ben_id,
                "name": "Ben",
                "away": False,
                "signed_in": False,
            }
            assert welcome["place"] == {"slide": 2, "anchor": ANCHOR}
            ana2.send({"type": "place", "slide": 0, "anchor": None})
            assert ana2.until("error")["code"] == "not_host"


async def test_hand_over(client: TestClient, conn: asyncpg.Connection) -> None:
    _, invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, _ = stack.enter_context(_joined(client, invite, "Ana"))
        ben, _ = stack.enter_context(_joined(client, invite, "Ben"))
        cleo, cleo_welcome = stack.enter_context(_joined(client, invite, "Cleo"))
        cleo_id = cleo_welcome["you"]["participant_id"]
        ana.presence_of(3)
        ben.presence_of(3)

        ben.send({"type": "hand_over", "participant_id": cleo_id})
        assert ben.until("error") == {"type": "error", "code": "not_host"}
        ana.send({"type": "hand_over", "participant_id": str(uuid.uuid4())})
        assert ana.until("error") == {"type": "error", "code": "not_connected"}

        ana.send({"type": "hand_over", "participant_id": cleo_id})
        expected = {
            "type": "host",
            "host": {"id": cleo_id, "name": "Cleo", "away": False, "signed_in": False},
            "reason": "handover",
        }
        for socket in (ana, ben, cleo):
            assert socket.until("host") == expected

        ana.send({"type": "place", "slide": 1, "anchor": None})
        assert ana.until("error")["code"] == "not_host"
        cleo.send({"type": "place", "slide": 1, "anchor": None})
        assert ben.until("place")["slide"] == 1


async def test_newer_connection_replaces_older_with_4409(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    _, invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, ana_welcome = stack.enter_context(_joined(client, invite, "Ana"))
        ana_id = ana_welcome["you"]["participant_id"]
        ben, _ = stack.enter_context(_joined(client, invite, "Ben"))
        ben.presence_of(2)

        token = ana_welcome["you"]["rejoin_token"]
        ana2, welcome = stack.enter_context(_joined(client, invite, "Ana", rejoin=token))
        assert welcome["you"]["participant_id"] == ana_id
        assert welcome["host"]["id"] == ana_id
        with pytest.raises(WebSocketDisconnect) as info:
            while True:
                ana.json()
        assert info.value.code == 4409

        # Ana stayed connected throughout: still host, never away, still two present.
        ana2.send({"type": "place", "slide": 2, "anchor": None})
        assert ben.until("place")["slide"] == 2
        assert len(welcome["participants"]) == 2


# --- AC-15g: stale ----------------------------------------------------------------------------


async def test_stale_refuses_join_and_actions(client: TestClient, conn: asyncpg.Connection) -> None:
    _, invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, _ = stack.enter_context(_joined(client, invite, "Ana"))
        ben, ben_welcome = stack.enter_context(_joined(client, invite, "Ben"))
        ana.presence_of(2)
        await conn.execute(
            "update presentation_session set stale_at = now() where invite_id = $1", invite
        )

        ana.send({"type": "place", "slide": 1, "anchor": None})
        assert ana.until("error") == {"type": "error", "code": "session_stale"}
        ana.send({"type": "pointer", "anchor": ANCHOR})
        assert ana.until("error") == {"type": "error", "code": "session_stale"}
        ana.send({"type": "hand_over", "participant_id": ben_welcome["you"]["participant_id"]})
        assert ana.until("error") == {"type": "error", "code": "session_stale"}

        assert _close_code(client, _url(invite, "Cleo")) == 4410


# --- AC-5: removal ----------------------------------------------------------------------------


async def test_remove_notifies_live_session(
    kc_client: TestClient,
    conn: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    presentation_id, invite = await _invite(kc_client, conn)

    with (
        _joined(kc_client, invite, "Ana") as (ana, _),
        _joined(kc_client, invite, "Ben") as (ben, _),
    ):
        ana.presence_of(2)
        login_as(kc_client, "editor1")
        assert kc_client.delete(f"/api/present/presentations/{presentation_id}").status_code == 204

        assert ana.until("presentation_removed") == {"type": "presentation_removed"}
        assert ben.until("presentation_removed") == {"type": "presentation_removed"}
        ana.send({"type": "place", "slide": 1, "anchor": None})
        assert ana.until("error") == {"type": "error", "code": "presentation_unavailable"}

        with _joined(kc_client, invite, "Cleo") as (_, welcome):
            assert welcome["available"] is False
