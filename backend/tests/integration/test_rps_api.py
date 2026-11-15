"""Spec 021 task 21: Rock Paper Siege REST, start, pre-join check and reactivate
(`games/rps/api.py`). AC-1 (FR-1, FR-3) anyone starts a session; FR-2 check and reactivate
as chess. Real Postgres; the admin test uses the test Keycloak.
"""

from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import clock
from app import db as app_db
from app.config import Settings
from app.games.rps import repo
from app.main import create_app
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


async def _migrated(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
async def account_client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
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


def _invite(client: TestClient) -> str:
    created = client.post("/api/games/rps/sessions")
    assert created.status_code == 201
    return created.json()["invite_id"]


async def test_ac1_anonymous_start_then_check(client: TestClient, db: asyncpg.Connection) -> None:
    created = client.post("/api/games/rps/sessions")
    assert created.status_code == 201
    invite = created.json()["invite_id"]
    assert invite
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    assert (
        await db.fetchval("select started_by_sub from rps_session where id = $1", session.id)
        is None
    )
    checked = client.get(f"/api/games/rps/sessions/{invite}")
    assert checked.status_code == 200
    assert checked.json() == {"invite_id": invite, "stale": False, "full": False}


def test_unknown_invite_is_404(client: TestClient) -> None:
    response = client.get("/api/games/rps/sessions/nope")
    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}


async def test_deleted_invite_is_410(client: TestClient, db: asyncpg.Connection) -> None:
    invite = _invite(client)
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.soft_delete(db, session.id, reason="starter", by_sub=None)
    response = client.get(f"/api/games/rps/sessions/{invite}")
    assert response.status_code == 410
    assert response.json() == {"error": "session_deleted"}


async def test_fr2_stale_session_reports_stale(client: TestClient, db: asyncpg.Connection) -> None:
    invite = _invite(client)
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.set_stale(db, session.id, clock.now())
    assert client.get(f"/api/games/rps/sessions/{invite}").json()["stale"] is True


def test_fr2_full_reads_the_live_hub(client: TestClient) -> None:
    """`full` is computed from `app.state.rps_hubs`, which the app starts empty."""
    assert client.app.state.rps_hubs == {}  # type: ignore[attr-defined]
    invite = _invite(client)
    assert client.get(f"/api/games/rps/sessions/{invite}").json()["full"] is False


def test_reactivate_needs_sign_in(client: TestClient) -> None:
    invite = _invite(client)
    assert client.post(f"/api/games/rps/sessions/{invite}/reactivate").status_code == 401


async def test_fr2_admin_reactivates_a_stale_session(
    account_client: TestClient,
    db: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    kc = account_client
    invite = _invite(kc)
    login_as(kc, "admin1")
    fresh = kc.post(f"/api/games/rps/sessions/{invite}/reactivate")
    assert fresh.status_code == 409
    assert fresh.json() == {"error": "not_stale"}
    assert kc.post("/api/games/rps/sessions/nope/reactivate").status_code == 404

    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.set_stale(db, session.id, clock.now())
    login_as(kc, "plain1")
    assert kc.post(f"/api/games/rps/sessions/{invite}/reactivate").status_code == 403

    login_as(kc, "admin1")
    done = kc.post(f"/api/games/rps/sessions/{invite}/reactivate")
    assert done.status_code == 200
    assert done.json() == {"invite_id": invite, "stale": False}
    assert kc.get(f"/api/games/rps/sessions/{invite}").json()["stale"] is False
