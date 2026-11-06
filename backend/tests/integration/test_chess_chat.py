"""Spec 014 task 27: session chat over the chess socket and REST. AC-27, AC-34 (FR-30, FR-34).
Real Postgres, the real app and the fake GIPHY on a local port; the admin test signs in
through the test Keycloak.
"""

from collections.abc import AsyncIterator
from contextlib import ExitStack

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.chat.rules import MAX_CHAT_CHARS
from app.config import Settings
from app.games.chess import repo
from app.main import create_app
from tests.fakes.fake_giphy import FakeGiphy
from tests.integration.keycloak_fixtures import Keycloak, keycloak, login_as  # noqa: F401
from tests.integration.test_chess_ws import COOKIE_KEY, _invite, _joined, _migrated


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


def test_ac27_player_and_viewer_chat_reaches_everyone(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        # The first two joiners take the seats; the third is a viewer.
        ann, _ = stack.enter_context(_joined(client, invite, "Ann"))
        bob, _ = stack.enter_context(_joined(client, invite, "Bob"))
        cy, _ = stack.enter_context(_joined(client, invite, "Cy"))

        ann.send(type="chat_send", client_id="c1", text="from a player")
        cy.send(type="chat_send", client_id="c2", text="from a viewer")
        for sock in (ann, bob, cy):
            seen = {}
            while len(seen) < 2:
                frame = sock.next("chat_message")
                seen[frame["client_id"]] = frame["message"]
            assert seen["c1"]["text"] == "from a player"
            assert seen["c1"]["sender_name"] == "Ann"
            assert seen["c2"]["text"] == "from a viewer"
            assert seen["c2"]["sender_name"] == "Cy"

        cy.send(type="chat_send_gif", client_id="g1", gif_id="cat-1")
        for sock in (ann, bob, cy):
            frame = sock.next("chat_message")
            assert frame["client_id"] == "g1"
            assert frame["message"]["kind"] == "gif"
            assert frame["message"]["gif"]["id"] == "cat-1"

        cy.send(type="gif_search", request_id="r1", q="cat")
        assert cy.next("gif_results")["request_id"] == "r1"

    history = client.get(f"/api/games/chess/sessions/{invite}/chat").json()["messages"]
    assert sorted((m["kind"], m["sender_name"]) for m in history) == [
        ("gif", "Cy"),
        ("text", "Ann"),
        ("text", "Cy"),
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
        assert ann.next("chat_message")["client_id"] == "ok"
    assert len(client.get(f"/api/games/chess/sessions/{invite}/chat").json()["messages"]) == 1


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

        login_as(kc_client, "newuser")
        url = f"/api/games/chess/sessions/{invite}/chat/{message_id}"
        assert kc_client.delete(url).status_code == 403

        login_as(kc_client, "admin1")
        assert kc_client.delete(url).status_code == 204
        for sock in (ann, bob):
            assert sock.next("chat_removed") == {"type": "chat_removed", "id": message_id}
    assert kc_client.get(f"/api/games/chess/sessions/{invite}/chat").json() == {"messages": []}


async def test_ac34_chat_history_of_a_deleted_session_is_gone(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite = _invite(client)
    assert client.get(f"/api/games/chess/sessions/{invite}/chat").status_code == 200
    assert client.get("/api/games/chess/sessions/nope/chat").status_code == 404
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.soft_delete(db, session.id, reason="starter", by_sub=None)
    response = client.get(f"/api/games/chess/sessions/{invite}/chat")
    assert response.status_code == 410
    assert response.json() == {"error": "session_deleted"}
