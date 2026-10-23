"""Task 30: sessions REST (create, status, reactivate).

FR-8, FR-11, FR-14, FR-30, FR-31, FR-32.
"""

import uuid
from collections.abc import AsyncIterator

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


async def _problem(conn: asyncpg.Connection, title: str = "Sum two") -> uuid.UUID:
    return await problems_repo.create(
        conn,
        title=title,
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )


async def test_fr11_an_anonymous_visitor_starts_a_session_with_distinct_invites(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(migrated)

    first = client.post("/api/sessions", json={"problem_id": str(problem_id)})
    second = client.post("/api/sessions", json={"problem_id": str(problem_id)})

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["invite_id"] != second.json()["invite_id"]


async def test_fr8_a_deleted_problem_gives_404(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(migrated)
    await problems_repo.soft_delete(migrated, problem_id)

    response = client.post("/api/sessions", json={"problem_id": str(problem_id)})

    assert response.status_code == 404


async def test_a_missing_problem_also_gives_404(client: TestClient) -> None:
    response = client.post("/api/sessions", json={"problem_id": str(uuid.uuid4())})

    assert response.status_code == 404


async def test_fr14_an_unknown_invite_gives_404_not_found_with_no_other_data(
    client: TestClient,
) -> None:
    response = client.get("/api/sessions/doesnotexist")

    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}


async def test_fr30_a_stale_session_gives_423_can_reactivate_false_for_an_anonymous_caller(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(migrated)
    session = await sessions_repo.create(migrated, problem_id)
    await sessions_repo.set_stale(migrated, session.id)

    response = client.get(f"/api/sessions/{session.invite_id}")

    assert response.status_code == 423
    assert response.json() == {"error": "stale", "can_reactivate": False}


async def test_fr31_an_admin_sees_can_reactivate_true(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    problem_id = await _problem(migrated)
    session = await sessions_repo.create(migrated, problem_id)
    await sessions_repo.set_stale(migrated, session.id)
    login_as(client, "admin1")

    response = client.get(f"/api/sessions/{session.invite_id}")

    assert response.status_code == 423
    assert response.json() == {"error": "stale", "can_reactivate": True}


async def test_fr32_an_admin_reactivates_then_get_gives_200(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    problem_id = await _problem(migrated)
    session = await sessions_repo.create(migrated, problem_id)
    await sessions_repo.set_stale(migrated, session.id)
    login_as(client, "admin1")

    reactivated = client.post(f"/api/sessions/{session.invite_id}/reactivate")
    assert reactivated.status_code == 200

    status_response = client.get(f"/api/sessions/{session.invite_id}")
    assert status_response.status_code == 200
    assert status_response.json() == {"state": "active"}


async def test_fr32_reactivating_as_plain_user_gives_403(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    problem_id = await _problem(migrated)
    session = await sessions_repo.create(migrated, problem_id)
    await sessions_repo.set_stale(migrated, session.id)
    login_as(client, "plain1")

    response = client.post(f"/api/sessions/{session.invite_id}/reactivate")

    assert response.status_code == 403
