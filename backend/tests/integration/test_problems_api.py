"""Task 29: problems API (create, search, public get).

FR-1, FR-2, FR-2a, FR-3, FR-4, FR-5, FR-9, NFR-5.
"""

from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app
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


@pytest.fixture
async def client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


async def _problem_count(database_url: str) -> int:
    conn = await asyncpg.connect(database_url)
    try:
        return await conn.fetchval("select count(*) from problem")
    finally:
        await conn.close()


def _create_body(
    title: str = "Sum two", signature: str = ADD_SIGNATURE, tests: list | None = None
) -> dict:
    return {
        "title": title,
        "description": "d",
        "signature": signature,
        "tests": tests if tests is not None else [{"args": [2, 3], "expected": 5}],
    }


async def test_fr1_signed_out_post_gives_401_and_creates_no_row(
    client: TestClient, database_url: str
) -> None:
    response = client.post("/api/problems", json=_create_body())

    assert response.status_code == 401
    assert await _problem_count(database_url) == 0


async def test_fr2a_plain_user_post_gives_403_missing_role_and_creates_no_row(
    client: TestClient,
    login_as,  # noqa: F811
    database_url: str,
) -> None:
    login_as(client, "plain1")

    response = client.post("/api/problems", json=_create_body())

    assert response.status_code == 403
    assert response.json() == {"error": "missing_role", "role": "editor"}
    assert await _problem_count(database_url) == 0


async def test_fr3_editor_creates_a_problem_and_search_lists_it(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    login_as(client, "editor1")

    created = client.post("/api/problems", json=_create_body(title="Sum two"))

    assert created.status_code == 201
    assert "id" in created.json()
    found = client.get("/api/problems", params={"q": "Sum two"})
    assert [p["title"] for p in found.json()] == ["Sum two"]


async def test_fr4_zero_tests_gives_422_naming_the_tests(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    login_as(client, "editor1")

    response = client.post("/api/problems", json=_create_body(tests=[]))

    assert response.status_code == 422
    [error] = response.json()["errors"]
    assert error["field"] == "tests"
    assert "test" in error["message"].lower()


async def test_fr4_a_three_argument_test_gives_422_with_test_index(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    login_as(client, "editor1")

    response = client.post(
        "/api/problems", json=_create_body(tests=[{"args": [1, 2, 3], "expected": 1}])
    )

    assert response.status_code == 422
    [error] = response.json()["errors"]
    assert error["test_index"] == 0


async def test_fr5_search_reverse_lists_only_reverse_list(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    login_as(client, "editor1")
    client.post("/api/problems", json=_create_body(title="Two targets"))
    client.post(
        "/api/problems",
        json=_create_body(
            title="Reverse list",
            signature="def reverse(xs: list[int]) -> list[int]",
            tests=[{"args": [[1, 2, 3]], "expected": [3, 2, 1]}],
        ),
    )

    response = client.get("/api/problems", params={"q": "reverse"})

    assert [p["title"] for p in response.json()] == ["Reverse list"]


async def test_fr9_nfr5_get_by_id_has_no_tests_key(client: TestClient, login_as) -> None:  # noqa: F811
    login_as(client, "editor1")
    created = client.post("/api/problems", json=_create_body())
    problem_id = created.json()["id"]

    response = client.get(f"/api/problems/{problem_id}")

    assert response.status_code == 200
    body = response.json()
    assert "tests" not in body
    assert body["title"] == "Sum two"
    assert body["deleted"] is False
