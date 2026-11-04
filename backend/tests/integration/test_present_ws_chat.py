"""Spec 013 task 24: chat and GIFs over the presentation WebSocket (plan.md "Chat",
"Contracts — WebSocket"). FR-32; AC-15h.

`chat_send`, `chat_send_gif` and `gif_search` behave as on the coding-session socket
(specs 002, 007); `welcome.chat` carries the history. A real database, the real app and the
fake GIPHY on a local port; the admin removal test signs in through the test Keycloak.
Spec 012 task 12 (FR-3, FR-8, NFR-2): messages carry `participant_id` and `signed_in`.
"""

import asyncio
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient

import app.main as app_main
from app import db as app_db
from app.chat.rules import MAX_CHAT_CHARS
from app.config import Settings
from app.main import create_app
from app.present import repo
from app.present import ws as present_ws
from tests.fakes.fake_giphy import CAT_IDS, GONE_ID, R_RATED_ID, FakeGiphy
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
API_KEY = "test-giphy-key"


def _settings(database_url: str, giphy_url: str, kc: Keycloak | None = None) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer if kc else "http://unused",
        oidc_client_id=kc.client_id if kc else "unused",
        oidc_client_secret=kc.client_secret if kc else "unused",
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
        giphy_api_key=API_KEY,
        giphy_base_url=giphy_url,
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
async def client(database_url: str, fake_giphy: FakeGiphy) -> AsyncIterator[TestClient]:
    await _reset(database_url)
    with TestClient(create_app(_settings(database_url, fake_giphy.base_url))) as test_client:
        yield test_client


@pytest.fixture
async def kc_client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
    fake_giphy: FakeGiphy,
) -> AsyncIterator[TestClient]:
    await _reset(database_url)
    app = create_app(_settings(database_url, fake_giphy.base_url, keycloak))
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
async def conn(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    connection = await asyncpg.connect(database_url)
    try:
        yield connection
    finally:
        await connection.close()


async def _invite(client: TestClient, conn: asyncpg.Connection) -> str:
    html = "".join(f"<section><h1>Slide {i}</h1></section>" for i in range(3))
    created = await repo.create_presentation(
        conn,
        title="Intro to DNS",
        topic="Networking",
        html=html,
        kind="slides",
        slide_count=3,
        created_by_sub="editor-sub",
    )
    response = client.post("/api/present/sessions", json={"presentation_id": str(created.id)})
    assert response.status_code == 201, response.text
    return response.json()["invite_id"]


class _Socket:
    def __init__(self, ws) -> None:
        self.ws = ws

    def send(self, message: dict) -> None:
        self.ws.send_json(message)

    def next(self) -> dict:
        """The next frame that isn't presence or host."""
        while True:
            frame = self.ws.receive_json()
            if frame["type"] not in {"presence", "host"}:
                return frame


@contextmanager
def _joined(client: TestClient, invite: str, name: str) -> Iterator[tuple[_Socket, dict]]:
    with client.websocket_connect(f"/api/present/sessions/{invite}/ws?name={quote(name)}") as ws:
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome", welcome
        yield _Socket(ws), welcome


# --- AC-15h: text and GIF reach everyone and are in a later joiner's welcome ----------------


async def test_text_and_gif_reach_everyone_and_a_later_joiners_welcome(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, ana_welcome = stack.enter_context(_joined(client, invite, "Ana"))
        assert ana_welcome["chat"] == []
        ben, _ = stack.enter_context(_joined(client, invite, "Ben"))

        ben.send({"type": "chat_send", "client_id": "c1", "text": "Hello all"})
        for socket in (ana, ben):
            frame = socket.next()
            assert frame["type"] == "chat_message", frame
            assert frame["client_id"] == "c1"
            assert frame["message"]["text"] == "Hello all"
            assert frame["message"]["sender_name"] == "Ben"
            assert frame["message"]["kind"] == "text"

        ben.send({"type": "chat_send_gif", "client_id": "g1", "gif_id": "cat-1"})
        for socket in (ana, ben):
            frame = socket.next()
            assert frame["type"] == "chat_message", frame
            assert frame["client_id"] == "g1"
            assert frame["message"]["kind"] == "gif"
            assert frame["message"]["sender_name"] == "Ben"
            assert frame["message"]["gif"]["id"] == "cat-1"
            assert frame["message"]["gif"]["title"] == "Happy cat"

    with _joined(client, invite, "Cy") as (_, later):
        assert [(m["kind"], m["sender_name"]) for m in later["chat"]] == [
            ("text", "Ben"),
            ("gif", "Ben"),
        ]
        assert later["chat"][0]["text"] == "Hello all"
        assert later["chat"][1]["gif"]["id"] == "cat-1"


# --- GIF search answers the sender only -------------------------------------------------------


async def test_gif_search_answers_the_sender_only(
    client: TestClient, conn: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, _ = stack.enter_context(_joined(client, invite, "Ana"))
        ben, _ = stack.enter_context(_joined(client, invite, "Ben"))

        ben.send({"type": "gif_search", "request_id": "r1", "q": "cat"})
        reply = ben.next()
        assert reply["type"] == "gif_results", reply
        assert reply["request_id"] == "r1"
        assert reply["trending"] is False
        ids = [r["id"] for r in reply["results"]]
        assert set(ids) == set(CAT_IDS) - {R_RATED_ID}

        # Sentinel: the next frame Ana gets is this message, not Ben's results.
        ben.send({"type": "chat_send", "client_id": "s", "text": "sentinel"})
        frame = ana.next()
        assert frame["type"] == "chat_message", frame
        assert frame["client_id"] == "s"

    searches = [r for r in fake_giphy.requests if r.path.startswith("/v1/gifs/search")]
    assert len(searches) == 1


async def test_gif_search_failure_answers_the_sender_with_its_request_id(
    client: TestClient, conn: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    invite = await _invite(client, conn)
    fake_giphy.fail_with(500)

    with _joined(client, invite, "Ana") as (ana, _):
        ana.send({"type": "gif_search", "request_id": "r9", "q": "cat"})
        assert ana.next() == {"type": "error", "code": "gif_unavailable", "request_id": "r9"}


# --- refusals carry client_id -----------------------------------------------------------------


async def test_refusals_carry_client_id_and_go_to_the_sender_only(
    client: TestClient, conn: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, _ = stack.enter_context(_joined(client, invite, "Ana"))
        ben, _ = stack.enter_context(_joined(client, invite, "Ben"))

        ben.send({"type": "chat_send", "client_id": "e1", "text": "   "})
        assert ben.next() == {"type": "error", "code": "chat_empty", "client_id": "e1"}

        ben.send({"type": "chat_send", "client_id": "e2", "text": "x" * (MAX_CHAT_CHARS + 1)})
        assert ben.next() == {
            "type": "error",
            "code": "chat_too_long",
            "client_id": "e2",
            "limit": MAX_CHAT_CHARS,
        }

        ben.send({"type": "chat_send_gif", "client_id": "e3", "gif_id": GONE_ID})
        assert ben.next() == {"type": "error", "code": "gif_not_allowed", "client_id": "e3"}

        ben.send({"type": "chat_send_gif", "client_id": "e4", "gif_id": R_RATED_ID})
        assert ben.next() == {"type": "error", "code": "gif_not_allowed", "client_id": "e4"}

        fake_giphy.fail_with(500)
        ben.send({"type": "chat_send_gif", "client_id": "e5", "gif_id": "cat-1"})
        assert ben.next() == {"type": "error", "code": "gif_unavailable", "client_id": "e5"}
        fake_giphy.reset()

        # Malformed frames are ignored.
        ben.send({"type": "chat_send", "client_id": 5, "text": "hi"})
        ben.send({"type": "chat_send_gif", "client_id": "x", "gif_id": None})
        ben.send({"type": "gif_search", "request_id": "r", "q": 3})

        # Sentinel: none of the refusals reached Ana, and nothing was stored.
        ben.send({"type": "chat_send", "client_id": "ok", "text": "fine"})
        frame = ana.next()
        assert frame["type"] == "chat_message", frame
        assert frame["client_id"] == "ok"
        assert ben.next()["client_id"] == "ok"

    stored = await conn.fetchval("select count(*) from presentation_chat_message")
    assert stored == 1


async def test_a_session_gone_stale_refuses_chat_with_client_id(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _):
        await conn.execute(
            "update presentation_session set stale_at = now() where invite_id = $1", invite
        )
        ana.send({"type": "chat_send", "client_id": "t1", "text": "hi"})
        assert ana.next() == {"type": "error", "code": "session_stale", "client_id": "t1"}
        ana.send({"type": "chat_send_gif", "client_id": "t2", "gif_id": "cat-1"})
        assert ana.next() == {"type": "error", "code": "session_stale", "client_id": "t2"}


# --- AC-15h: admin removal through REST sends chat_removed ------------------------------------


async def test_admin_removal_sends_chat_removed_to_everyone_connected(
    kc_client: TestClient,
    conn: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    invite = await _invite(kc_client, conn)

    with ExitStack() as stack:
        ana, _ = stack.enter_context(_joined(kc_client, invite, "Ana"))
        ben, _ = stack.enter_context(_joined(kc_client, invite, "Ben"))
        ben.send({"type": "chat_send_gif", "client_id": "g", "gif_id": "cat-2"})
        message_id = ben.next()["message"]["id"]
        assert ana.next()["message"]["id"] == message_id

        login_as(kc_client, "admin1")
        removed = kc_client.delete(f"/api/present/sessions/{invite}/chat/{message_id}")
        assert removed.status_code == 204
        for socket in (ana, ben):
            assert socket.next() == {"type": "chat_removed", "id": message_id}

    with _joined(kc_client, invite, "Cy") as (_, later):
        assert later["chat"] == []


# --- spec 012 task 12: participant_id and signed_in on every message ------------------------


@contextmanager
def _signed_in(client: TestClient, invite: str, jar) -> Iterator[tuple[_Socket, dict]]:
    with client.websocket_connect(
        f"/api/present/sessions/{invite}/ws", headers=cookie_header(jar)
    ) as ws:
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome", welcome
        yield _Socket(ws), welcome


async def test_012_fr8_only_the_signed_in_newuser_has_the_mark_nfr2_client_cannot_set_it(
    kc_client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = await _invite(kc_client, conn)
    jar = signed_in_jar(kc_client, "newuser")

    with ExitStack() as stack:
        account, account_welcome = stack.enter_context(_signed_in(kc_client, invite, jar))
        visitor, visitor_welcome = stack.enter_context(_joined(kc_client, invite, "newuser"))
        account_id = account_welcome["you"]["participant_id"]
        visitor_id = visitor_welcome["you"]["participant_id"]

        account.send({"type": "chat_send", "client_id": "a", "text": "from the account"})
        frames = [account.next()["message"], visitor.next()["message"]]
        # NFR-2: a client-supplied signed_in is never read.
        visitor.send(
            {"type": "chat_send", "client_id": "v", "text": "from the visitor", "signed_in": True}
        )
        frames += [account.next()["message"], visitor.next()["message"]]
        visitor.send(
            {"type": "chat_send_gif", "client_id": "g", "gif_id": "cat-1", "signed_in": True}
        )
        frames += [account.next()["message"], visitor.next()["message"]]

    assert [(m["participant_id"], m["signed_in"]) for m in frames] == [
        (account_id, True),
        (account_id, True),
        (visitor_id, False),
        (visitor_id, False),
        (visitor_id, False),
        (visitor_id, False),
    ]
    assert [m["sender_name"] for m in frames] == ["newuser"] * 6

    history = kc_client.get(f"/api/present/sessions/{invite}/chat").json()["messages"]
    assert [(m["kind"], m["participant_id"], m["signed_in"]) for m in history] == [
        ("text", account_id, True),
        ("text", visitor_id, False),
        ("gif", visitor_id, False),
    ]


async def test_012_fr3_after_reconnect_the_earlier_message_is_their_own(
    kc_client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = await _invite(kc_client, conn)
    jar = signed_in_jar(kc_client, "newuser")
    with _signed_in(kc_client, invite, jar) as (first, _):
        first.send({"type": "chat_send", "client_id": "a", "text": "before reconnect"})
        first.next()

    with _signed_in(kc_client, invite, jar) as (_, welcome):
        you = welcome["you"]["participant_id"]
        (earlier,) = welcome["chat"]

    assert (earlier["participant_id"], earlier["signed_in"]) == (you, True)
    (rest,) = kc_client.get(f"/api/present/sessions/{invite}/chat").json()["messages"]
    assert rest["participant_id"] == you


# --- shutdown drains in-flight GIF calls ------------------------------------------------------


async def test_lifespan_drains_present_gif_tasks(
    database_url: str, fake_giphy: FakeGiphy, monkeypatch: pytest.MonkeyPatch
) -> None:
    drained: list[str] = []

    async def fake_drain() -> None:
        drained.append("drained")

    monkeypatch.setattr(app_main, "drain_present_gif_tasks", fake_drain)
    await _reset(database_url)
    with TestClient(create_app(_settings(database_url, fake_giphy.base_url))):
        assert drained == []
    assert drained == ["drained"]


async def test_drain_waits_for_an_in_flight_gif_call() -> None:
    finished = asyncio.Event()

    async def slow() -> None:
        await asyncio.sleep(0.05)
        finished.set()

    present_ws._spawn_gif_task(slow())
    await present_ws.drain_gif_tasks()
    assert finished.is_set()
    assert not present_ws._GIF_TASKS
