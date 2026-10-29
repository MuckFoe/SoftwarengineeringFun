"""Spec 003 task 4: GET /api/sessions/stale (FR-9, FR-12, AC-10b)."""

import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.sessions import repo as sessions_repo
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
ADD = parse_signature("def add(a: int, b: int) -> int")


def _settings(kc: Keycloak, database_url: str) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    await db.execute("truncate session cascade")
    yield db


@pytest.fixture
async def client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


async def _problem(conn: asyncpg.Connection, title: str) -> uuid.UUID:
    return await problems_repo.create(
        conn,
        title=title,
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )


async def _stale(conn: asyncpg.Connection, title: str, stale_at: datetime) -> str:
    session = await sessions_repo.create(conn, await _problem(conn, title))
    await conn.execute("update session set stale_at = $2 where id = $1", session.id, stale_at)
    return session.invite_id


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


async def test_ac10b_admin_gets_only_stale_sessions_newest_stale_first(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    base = datetime.fromisoformat("2026-10-01T12:00:00+00:00")
    older = await _stale(migrated, "Older stale", base)
    newer = await _stale(migrated, "Newer stale", base + timedelta(hours=1))
    active = await sessions_repo.create(migrated, await _problem(migrated, "Active"))
    login_as(client, "admin1")

    response = client.get("/api/sessions/stale")

    assert response.status_code == 200
    rows = response.json()
    assert [r["invite_id"] for r in rows] == [newer, older]
    assert active.invite_id not in {r["invite_id"] for r in rows}
    first = rows[0]
    assert set(first) == {"invite_id", "problem_title", "stale_at", "last_activity_at"}
    assert first["problem_title"] == "Newer stale"
    assert _parse(first["stale_at"]) == base + timedelta(hours=1)
    _parse(first["last_activity_at"])


async def test_ac10b_a_reactivated_session_leaves_the_list(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    invite = await _stale(migrated, "Stale", datetime.fromisoformat("2026-10-01T12:00:00+00:00"))
    login_as(client, "admin1")
    assert [r["invite_id"] for r in client.get("/api/sessions/stale").json()] == [invite]

    assert client.post(f"/api/sessions/{invite}/reactivate").status_code == 200

    assert client.get("/api/sessions/stale").json() == []


async def test_an_editor_gets_403(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    login_as(client, "editor1")

    response = client.get("/api/sessions/stale")

    # The existing require_role shape (plan: "existing require_role shapes").
    assert response.status_code == 403
    assert response.json() == {"error": "missing_role", "role": "admin"}


async def test_an_anonymous_caller_gets_401(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    response = client.get("/api/sessions/stale")

    assert response.status_code == 401


async def test_stale_is_not_routed_to_the_invite_handler(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    # An invite literally named "stale" must not shadow the list endpoint.
    session = await sessions_repo.create(migrated, await _problem(migrated, "Named stale"))
    await migrated.execute("update session set invite_id = 'stale' where id = $1", session.id)
    login_as(client, "admin1")

    response = client.get("/api/sessions/stale")

    assert response.status_code == 200
    assert response.json() == []
