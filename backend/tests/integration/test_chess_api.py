"""Spec 014 task 20: chess REST, create session and pre-join check (`games/chess/api.py`).
AC-2 (FR-3) start without signing in; FR-32 `full`; FR-34 unknown 404, deleted 410.
Real Postgres only; no sign-in is involved.
"""

from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.games.chess import repo
from app.main import create_app


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="test-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_ac2_start_without_auth_then_check(client: TestClient) -> None:
    created = client.post("/api/games/chess/sessions")
    assert created.status_code == 201
    invite = created.json()["invite_id"]
    assert invite
    checked = client.get(f"/api/games/chess/sessions/{invite}")
    assert checked.status_code == 200
    assert checked.json() == {"invite_id": invite, "stale": False, "full": False}


def test_unknown_invite_is_404(client: TestClient) -> None:
    assert client.get("/api/games/chess/sessions/nope").status_code == 404


async def test_deleted_invite_is_410(client: TestClient, db: asyncpg.Connection) -> None:
    invite = client.post("/api/games/chess/sessions").json()["invite_id"]
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.soft_delete(db, session.id, reason="starter", by_sub=None)
    response = client.get(f"/api/games/chess/sessions/{invite}")
    assert response.status_code == 410
    assert response.json() == {"error": "session_deleted"}


async def test_stale_session_reports_stale(client: TestClient, db: asyncpg.Connection) -> None:
    from app import clock

    invite = client.post("/api/games/chess/sessions").json()["invite_id"]
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.set_stale(db, session.id, clock.now())
    assert client.get(f"/api/games/chess/sessions/{invite}").json()["stale"] is True
