"""Spec 019: a deleted session's invite answers "deleted", not "not found" (FR-8, AC-7).

A real database and the real app; nothing mocked. The tombstone is written directly with
`deletion.repo.tombstone`, as a profile deletion leaves it once the session is purged.
"""

import secrets
from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.deletion import repo as deletion_repo
from app.games.chess import repo as chess_repo
from app.main import create_app
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    LoginAs,
    keycloak,
    login_as,
)

# --- Task 11: WebSocket invite lookups close 4411 for a tombstoned invite ------------------

_T11_WS_URLS = {
    "coding": "/api/sessions/{invite}/ws?name=Ada",
    "learning": "/api/learn/sessions/{invite}/ws?name=Ada",
    "presentation": "/api/present/sessions/{invite}/ws?name=Ada",
}


def _t11_settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def _t11_migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
async def _t11_client(
    database_url: str, _t11_migrated: asyncpg.Connection
) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_t11_settings(database_url))) as test_client:
        yield test_client


def _t11_close_code(client: TestClient, url: str) -> int:
    with client.websocket_connect(url) as ws:
        with pytest.raises(WebSocketDisconnect) as info:
            while True:
                ws.receive_json()
    return info.value.code


@pytest.mark.parametrize("kind", sorted(_T11_WS_URLS))
async def test_ac7_ws_deleted_invite_closes_4411_and_unknown_closes_4404(
    kind: str, _t11_client: TestClient, _t11_migrated: asyncpg.Connection
) -> None:
    deleted = f"t11-{secrets.token_hex(6)}"
    await deletion_repo.tombstone(_t11_migrated, kind, deleted, "host")
    url = _T11_WS_URLS[kind]

    assert _t11_close_code(_t11_client, url.format(invite=deleted)) == 4411
    never = f"t11-never-{secrets.token_hex(6)}"
    assert _t11_close_code(_t11_client, url.format(invite=never)) == 4404


async def test_ac7_ws_a_tombstone_of_another_kind_still_closes_4404(
    _t11_client: TestClient, _t11_migrated: asyncpg.Connection
) -> None:
    invite = f"t11-{secrets.token_hex(6)}"
    await deletion_repo.tombstone(_t11_migrated, "chess", invite, "admin")

    for url in _T11_WS_URLS.values():
        assert _t11_close_code(_t11_client, url.format(invite=invite)) == 4404


# --- Task 12: chess, a tombstoned invite counts as deleted (AC-12, link part) ---------------


@pytest.fixture
async def _t12_client(database_url: str, db: asyncpg.Connection) -> AsyncIterator[TestClient]:
    await app_db.migrate(db)
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _t12_ws_close_code(client: TestClient, invite: str) -> int:
    url = f"/api/games/chess/sessions/{invite}/ws?name=Ann"
    with client.websocket_connect(url) as ws:
        with pytest.raises(WebSocketDisconnect) as info:
            while True:
                ws.receive_json()
    return info.value.code


async def _t12_profile_delete(db: asyncpg.Connection, invite: str) -> None:
    """What the profile deletion leaves: the session purged and its invite tombstoned."""
    session = await chess_repo.get_session_by_invite(db, invite)
    assert session is not None
    async with db.transaction():
        await deletion_repo.purge(db, "chess", session.id)
        await deletion_repo.tombstone(db, "chess", invite, "host")


async def test_ac12_chess_purged_invite_answers_410_and_closes_4411(
    _t12_client: TestClient, db: asyncpg.Connection
) -> None:
    invite = _t12_client.post("/api/games/chess/sessions").json()["invite_id"]
    with _t12_client.websocket_connect(f"/api/games/chess/sessions/{invite}/ws?name=Bob") as ws:
        ws.receive_json()
    await _t12_profile_delete(db, invite)
    assert await db.fetchval("select count(*) from chess_session where invite_id = $1", invite) == 0

    assert await chess_repo.is_deleted_invite(db, invite) is True
    response = _t12_client.get(f"/api/games/chess/sessions/{invite}")
    assert response.status_code == 410
    assert response.json() == {"error": "session_deleted"}
    assert _t12_client.get(f"/api/games/chess/sessions/{invite}/chat").status_code == 410
    assert _t12_ws_close_code(_t12_client, invite) == 4411


async def test_ac12_chess_tombstone_of_another_kind_or_none_is_not_found(
    _t12_client: TestClient, db: asyncpg.Connection
) -> None:
    other = f"t12-{secrets.token_hex(6)}"
    await deletion_repo.tombstone(db, "coding", other, "host")
    never = f"t12-never-{secrets.token_hex(6)}"
    for invite in (other, never):
        assert await chess_repo.is_deleted_invite(db, invite) is False
        assert _t12_client.get(f"/api/games/chess/sessions/{invite}").status_code == 404
        assert _t12_ws_close_code(_t12_client, invite) == 4404


# --- Task 10: REST invite lookups answer 410 session_deleted for a tombstoned invite --------

_T10_REST_URLS = {
    "coding": "/api/sessions/{invite}",
    "learning": "/api/learn/sessions/{invite}",
    "presentation": "/api/present/sessions/{invite}",
}


def _t10_settings(database_url: str, kc: Keycloak | None = None) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer if kc else "http://unused",
        oidc_client_id=kc.client_id if kc else "unused",
        oidc_client_secret=kc.client_secret if kc else "unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def _t10_migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
async def _t10_guest(
    database_url: str, _t10_migrated: asyncpg.Connection
) -> AsyncIterator[TestClient]:
    """Signed out: a guest or an invitee who only has the link. No Keycloak needed."""
    with TestClient(create_app(_t10_settings(database_url))) as test_client:
        yield test_client


@pytest.fixture
async def _t10_signed_in(
    keycloak: Keycloak,  # noqa: F811
    login_as: LoginAs,  # noqa: F811
    database_url: str,
    _t10_migrated: asyncpg.Connection,
) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_t10_settings(database_url, keycloak))) as test_client:
        login_as(test_client, "plain1")
        yield test_client


@pytest.mark.parametrize("kind", sorted(_T10_REST_URLS))
async def test_ac7_rest_deleted_invite_answers_410_and_unknown_404(
    kind: str, _t10_guest: TestClient, _t10_migrated: asyncpg.Connection
) -> None:
    deleted = f"t10-{secrets.token_hex(6)}"
    await deletion_repo.tombstone(_t10_migrated, kind, deleted, "host")
    url = _T10_REST_URLS[kind]

    gone = _t10_guest.get(url.format(invite=deleted))
    assert gone.status_code == 410
    assert gone.json()["error"] == "session_deleted"

    never = _t10_guest.get(url.format(invite=f"t10-never-{secrets.token_hex(6)}"))
    assert never.status_code == 404
    assert never.json()["error"] == "not_found"


async def test_ac7_rest_signed_in_user_gets_410_for_every_kind(
    _t10_signed_in: TestClient, _t10_migrated: asyncpg.Connection
) -> None:
    for kind, url in _T10_REST_URLS.items():
        deleted = f"t10-{secrets.token_hex(6)}"
        await deletion_repo.tombstone(_t10_migrated, kind, deleted, "admin")

        gone = _t10_signed_in.get(url.format(invite=deleted))
        assert gone.status_code == 410, kind
        assert gone.json()["error"] == "session_deleted"


async def test_ac7_rest_a_tombstone_of_another_kind_still_answers_404(
    _t10_guest: TestClient, _t10_migrated: asyncpg.Connection
) -> None:
    invite = f"t10-{secrets.token_hex(6)}"
    await deletion_repo.tombstone(_t10_migrated, "chess", invite, "admin")

    for url in _T10_REST_URLS.values():
        assert _t10_guest.get(url.format(invite=invite)).status_code == 404
