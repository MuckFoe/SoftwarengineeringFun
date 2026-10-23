"""Task 33: problems API — edit, update, delete. FR-2, FR-7, FR-8, FR-9."""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo, service
from app.problems.signature import TestInput, parse_signature
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
ADD_SIGNATURE = "def add(a: int, b: int) -> int"


def _settings(kc: Keycloak, database_url: str) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture(autouse=True)
def _reset_deletion_callbacks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "_on_problem_deleted", [])


@pytest.fixture
async def client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


def _unique_title(base: str) -> str:
    # The test database is shared across this module's tests (conftest.py), so each test
    # needs a title that can't collide with another test's rows in a search.
    return f"{base} {uuid.uuid4().hex[:8]}"


def _body(title: str, tests: list | None = None, description: str = "d") -> dict:
    return {
        "title": title,
        "description": description,
        "signature": ADD_SIGNATURE,
        "tests": tests if tests is not None else [{"args": [2, 3], "expected": 5}],
    }


async def test_fr7_an_editor_adds_a_test_and_get_edit_shows_both(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    title = _unique_title("Sum two")
    login_as(client, "editor1")
    created = client.post("/api/problems", json=_body(title=title))
    problem_id = created.json()["id"]
    login_as(client, "editor2")

    updated = client.put(
        f"/api/problems/{problem_id}",
        json=_body(
            title=title,
            tests=[{"args": [2, 3], "expected": 5}, {"args": [0, 0], "expected": 0}],
        ),
    )
    assert updated.status_code == 200

    edit = client.get(f"/api/problems/{problem_id}/edit")
    assert edit.status_code == 200
    assert len(edit.json()["tests"]) == 2


async def test_fr7_editing_a_starter_problems_description_is_saved(
    client: TestClient,
    database_url: str,
    login_as,  # noqa: F811
) -> None:
    title = _unique_title("Starter problem")
    conn = await asyncpg.connect(database_url)
    try:
        problem_id = await repo.create(
            conn,
            title=title,
            description="original",
            sig=parse_signature(ADD_SIGNATURE),
            tests=[TestInput(args=[2, 3], expected=5)],
            created_by_sub=None,
            created_by_name=None,
            is_starter=True,
        )
    finally:
        await conn.close()
    login_as(client, "editor1")

    response = client.put(
        f"/api/problems/{problem_id}",
        json=_body(title=title, description="updated description"),
    )
    assert response.status_code == 200

    edit = client.get(f"/api/problems/{problem_id}/edit")
    assert edit.json()["description"] == "updated description"


async def test_fr8_deleting_removes_it_from_search_and_invokes_the_callback_once(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    title = _unique_title("Sum two")
    login_as(client, "editor1")
    created = client.post("/api/problems", json=_body(title=title))
    problem_id = created.json()["id"]

    calls: list[uuid.UUID] = []

    async def record(pid: uuid.UUID) -> None:
        calls.append(pid)

    service.register_on_problem_deleted(record)
    login_as(client, "editor2")

    response = client.delete(f"/api/problems/{problem_id}")

    assert response.status_code == 204
    found = client.get("/api/problems", params={"q": title})
    assert found.json() == []
    assert calls == [uuid.UUID(problem_id)]


async def test_fr8_deleting_a_starter_problem_behaves_the_same(
    client: TestClient,
    database_url: str,
    login_as,  # noqa: F811
) -> None:
    title = _unique_title("Starter problem")
    conn = await asyncpg.connect(database_url)
    try:
        problem_id = await repo.create(
            conn,
            title=title,
            description="d",
            sig=parse_signature(ADD_SIGNATURE),
            tests=[TestInput(args=[2, 3], expected=5)],
            created_by_sub=None,
            created_by_name=None,
            is_starter=True,
        )
    finally:
        await conn.close()
    calls: list[uuid.UUID] = []

    async def record(pid: uuid.UUID) -> None:
        calls.append(pid)

    service.register_on_problem_deleted(record)
    login_as(client, "editor1")

    response = client.delete(f"/api/problems/{problem_id}")

    assert response.status_code == 204
    found = client.get("/api/problems", params={"q": title})
    assert found.json() == []
    assert calls == [problem_id]


async def test_fr9_signed_out_is_refused_and_changes_nothing(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    title = _unique_title("Sum two")
    login_as(client, "editor1")
    created = client.post("/api/problems", json=_body(title=title))
    problem_id = created.json()["id"]
    client.post("/api/auth/logout")

    assert client.get(f"/api/problems/{problem_id}/edit").status_code == 401
    assert client.put(f"/api/problems/{problem_id}", json=_body(title=title)).status_code == 401
    assert client.delete(f"/api/problems/{problem_id}").status_code == 401

    found = client.get("/api/problems", params={"q": title})
    assert len(found.json()) == 1


async def test_fr9_plain_user_is_refused_and_changes_nothing(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    title = _unique_title("Sum two")
    login_as(client, "editor1")
    created = client.post("/api/problems", json=_body(title=title))
    problem_id = created.json()["id"]
    login_as(client, "plain1")

    assert client.get(f"/api/problems/{problem_id}/edit").status_code == 403
    assert client.put(f"/api/problems/{problem_id}", json=_body(title=title)).status_code == 403
    assert client.delete(f"/api/problems/{problem_id}").status_code == 403

    found = client.get("/api/problems", params={"q": title})
    assert len(found.json()) == 1
