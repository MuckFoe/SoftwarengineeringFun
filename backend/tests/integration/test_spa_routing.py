"""Task 36: serving the built frontend with an SPA fallback (`backend/app/main.py`).

FR-1, FR-11, FR-12.
"""

from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


async def test_an_spa_route_returns_index_html(client: TestClient) -> None:
    response = client.get("/s/abc")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<!doctype html" in response.text.lower()


async def test_the_api_still_returns_json(client: TestClient) -> None:
    response = client.get("/api/problems")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == []


async def test_an_unknown_api_path_gives_404_not_html(client: TestClient) -> None:
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
