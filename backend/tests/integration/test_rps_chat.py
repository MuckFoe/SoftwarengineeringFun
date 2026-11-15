"""Spec 021 task 30: session chat over the Rock Paper Siege socket and REST (FR-2, as chess
in spec 014 and specs 002/007). Real Postgres, the real app and the fake GIPHY on a local port;
the admin test signs in through the test Keycloak (hold the stack lock).
"""

from collections.abc import AsyncIterator
from contextlib import ExitStack

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.chat.rules import MAX_CHAT_CHARS
from app.config import Settings
from app.games.rps import repo
from app.main import create_app
from tests.fakes.fake_giphy import FakeGiphy
from tests.integration.keycloak_fixtures import Keycloak, keycloak, login_as  # noqa: F401
from tests.integration.test_rps_ws import COOKIE_KEY, _invite, _joined


async def _migrated(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()


def _settings(database_url: str, giphy_url: str, kc: Keycloak | None = None) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer if kc else "http://unused",
        oidc_client_id=kc.client_id if kc else "unused",
        oidc_client_secret=kc.client_secret if kc else "unused",
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
        giphy_api_key="test-giphy-key",
        giphy_base_url=giphy_url,
    )


@pytest.fixture
async def client(database_url: str, fake_giphy: FakeGiphy) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
    with TestClient(create_app(_settings(database_url, fake_giphy.base_url))) as test_client:
        yield test_client


@pytest.fixture
async def kc_client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
    fake_giphy: FakeGiphy,
) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
    app = create_app(_settings(database_url, fake_giphy.base_url, keycloak))
    with TestClient(app) as test_client:
        yield test_client


def _chat_url(invite: str) -> str:
    return f"/api/games/rps/sessions/{invite}/chat"


def test_fr2_player_and_viewer_chat_and_gifs_reach_everyone_history_in_order(
    client: TestClient,
) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        # The first two joiners take the seats; the third is a viewer.
        ann, _ = stack.enter_context(_joined(client, invite, "Ann"))
        bob, _ = stack.enter_context(_joined(client, invite, "Bob"))
        cy, wc = stack.enter_context(_joined(client, invite, "Cy"))
        assert wc["state"]["you"] == "viewer"

        ann.send(type="chat_send", client_id="c1", text="from a player")
        for sock in (ann, bob, cy):
            frame = sock.next("chat_message")
            assert frame["client_id"] == "c1"
            assert frame["message"]["text"] == "from a player"
            assert frame["message"]["sender_name"] == "Ann"

        cy.send(type="chat_send", client_id="c2", text="from a viewer")
        for sock in (ann, bob, cy):
            frame = sock.next("chat_message")
            assert frame["client_id"] == "c2"
            assert frame["message"]["sender_name"] == "Cy"

        cy.send(type="chat_send_gif", client_id="g1", gif_id="cat-1")
        for sock in (ann, bob, cy):
            frame = sock.next("chat_message")
            assert frame["client_id"] == "g1"
            assert frame["message"]["kind"] == "gif"
            assert frame["message"]["gif"]["id"] == "cat-1"

        cy.send(type="gif_search", request_id="r1", q="cat")
        assert cy.next("gif_results")["request_id"] == "r1"

    history = client.get(_chat_url(invite)).json()["messages"]
    assert [(m["kind"], m["sender_name"]) for m in history] == [
        ("text", "Ann"),
        ("text", "Cy"),
        ("gif", "Cy"),
    ]


def test_over_length_message_is_refused_to_the_sender_only(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        ann, _ = stack.enter_context(_joined(client, invite, "Ann"))
        bob, _ = stack.enter_context(_joined(client, invite, "Bob"))
        bob.send(type="chat_send", client_id="e", text="x" * (MAX_CHAT_CHARS + 1))
        assert bob.next("error") == {
            "type": "error",
            "code": "chat_too_long",
            "client_id": "e",
            "limit": MAX_CHAT_CHARS,
        }
        bob.send(type="chat_send", client_id="ok", text="fine")
        # Ann's next chat frame is the accepted one: the refusal never reached her.
        assert ann.next("chat_message")["client_id"] == "ok"
    assert len(client.get(_chat_url(invite)).json()["messages"]) == 1


async def test_stale_session_refuses_chat_and_keeps_history(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite = _invite(client)
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    with _joined(client, invite, "Ann") as (ann, _):
        ann.send(type="chat_send", client_id="before", text="kept")
        ann.next("chat_message")
        await repo.set_stale(db, session.id, session.created_at)
        ann.send(type="chat_send", client_id="after", text="refused")
        assert ann.next("error")["code"] == "session_stale"
    assert [m["text"] for m in client.get(_chat_url(invite)).json()["messages"]] == ["kept"]


def test_admin_removal_broadcasts_and_non_admin_is_refused(
    kc_client: TestClient,
    login_as,  # noqa: F811
) -> None:
    invite = _invite(kc_client)
    with ExitStack() as stack:
        ann, _ = stack.enter_context(_joined(kc_client, invite, "Ann"))
        bob, _ = stack.enter_context(_joined(kc_client, invite, "Bob"))
        bob.send(type="chat_send", client_id="m", text="remove me")
        message_id = bob.next("chat_message")["message"]["id"]
        ann.next("chat_message")

        url = f"{_chat_url(invite)}/{message_id}"
        assert kc_client.delete(url).status_code in (401, 403)
        login_as(kc_client, "newuser")
        assert kc_client.delete(url).status_code == 403

        login_as(kc_client, "admin1")
        assert kc_client.delete(url).status_code == 204
        for sock in (ann, bob):
            assert sock.next("chat_removed") == {"type": "chat_removed", "id": message_id}
        # Already removed: nothing left to remove.
        assert kc_client.delete(url).status_code == 404
    assert kc_client.get(_chat_url(invite)).json() == {"messages": []}


async def test_chat_of_a_deleted_session_is_gone(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite = _invite(client)
    with _joined(client, invite, "Ann") as (ann, _):
        ann.send(type="chat_send", client_id="c", text="hello")
        ann.next("chat_message")
    assert len(client.get(_chat_url(invite)).json()["messages"]) == 1
    assert client.get("/api/games/rps/sessions/nope/chat").status_code == 404

    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.soft_delete(db, session.id, reason="starter", by_sub=None)
    response = client.get(_chat_url(invite))
    assert response.status_code == 410
    assert response.json() == {"error": "session_deleted"}
