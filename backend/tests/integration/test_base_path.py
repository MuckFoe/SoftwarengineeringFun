"""005 task 10: the backend mounted under BASE_PATH (`backend/app/asgi.py`, `main.py`).
005 task 14: description image URLs under the base path.

FR1. The app is built through `asgi.build_app`, the same mount uvicorn serves.
"""

import base64
import uuid
from collections.abc import AsyncIterator
from urllib.parse import quote

import asyncpg
import pycrdt
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.asgi import build_app
from app.config import Settings
from app.main import FRONTEND_DIST
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature, starter_code
from app.sessions import repo as sessions_repo
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

ADD = parse_signature("def add(a: int, b: int) -> int")


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
        base_path="/collab",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    with TestClient(build_app(_settings(database_url))) as test_client:
        yield test_client


async def test_the_api_answers_under_the_base_path(client: TestClient) -> None:
    response = client.get("/collab/api/problems")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == []


async def test_me_answers_under_the_base_path(client: TestClient) -> None:
    response = client.get("/collab/api/me")

    assert response.status_code == 200
    assert response.json() == {"signed_in": False, "roles": []}


async def test_the_api_at_the_root_is_404(client: TestClient) -> None:
    assert client.get("/api/problems").status_code == 404
    assert client.get("/api/me").status_code == 404


async def test_a_path_outside_the_base_is_404_not_the_spa_shell(client: TestClient) -> None:
    response = client.get("/s/abc")

    assert response.status_code == 404
    assert "<!doctype html" not in response.text.lower()


async def test_the_spa_shell_is_served_for_an_app_route(client: TestClient) -> None:
    response = client.get("/collab/s/x")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<!doctype html" in response.text.lower()


async def test_the_base_without_a_slash_redirects_to_the_base_with_one(
    client: TestClient,
) -> None:
    response = client.get("/collab", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].endswith("/collab/")


async def test_the_base_with_a_slash_serves_the_spa_shell(client: TestClient) -> None:
    response = client.get("/collab/")

    assert response.status_code == 200
    assert "<!doctype html" in response.text.lower()


async def test_assets_are_served_under_the_base_path(client: TestClient) -> None:
    asset = next((FRONTEND_DIST / "assets").iterdir()).name

    response = client.get(f"/collab/assets/{asset}")

    assert response.status_code == 200
    assert "<!doctype html" not in response.text[:200].lower()


async def test_an_unknown_api_path_under_the_base_is_an_api_404(client: TestClient) -> None:
    response = client.get("/collab/api/x")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


async def test_the_websocket_under_the_base_path_joins_and_syncs(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await problems_repo.create(
        migrated,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    session = await sessions_repo.create(migrated, problem_id)

    url = f"/collab/api/sessions/{session.invite_id}/ws?name={quote('Ada')}"
    with client.websocket_connect(url) as ws:
        welcome = ws.receive_json()
        local = pycrdt.Doc()
        ws.send_bytes(pycrdt.create_sync_message(local))
        reply = ws.receive_bytes()
        pycrdt.handle_sync_message(reply[1:], local)

    assert welcome["type"] == "welcome"
    code = local.get(f"code:{problem_id}", type=pycrdt.Text)
    assert str(code) == starter_code(ADD)


# --- task 14: description image URLs under the base path --------------------------

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABXvMqGgAAAABJRU5ErkJggg=="
)


@pytest.fixture
async def editor(
    keycloak: Keycloak,  # noqa: F811
    login_as,  # noqa: F811
    database_url: str,
) -> AsyncIterator[TestClient]:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer=keycloak.issuer,
        oidc_client_id=keycloak.client_id,
        oidc_client_secret=keycloak.client_secret,
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
        base_path="/collab",
    )
    with TestClient(build_app(settings)) as test_client:
        login_as(test_client, "editor1", start="/collab/api/auth/login")
        yield test_client


def _problem_with_image(editor: TestClient) -> tuple[str, str, str]:
    """-> (problem id, description source, uploaded image url)."""
    uploaded = editor.post("/collab/api/images", content=PNG, headers={"Content-Type": "image/png"})
    assert uploaded.status_code == 201
    url = uploaded.json()["url"]
    source = f"A diagram:\n\n![diagram]({url})\n"
    created = editor.post(
        "/collab/api/problems",
        json={
            "title": f"Sum two {uuid.uuid4().hex[:8]}",
            "description": source,
            "signature": "def add(a: int, b: int) -> int",
            "tests": [{"args": [2, 3], "expected": 5}],
        },
    )
    assert created.status_code == 201, created.json()
    return created.json()["id"], source, url


async def test_fr1_upload_url_and_stored_source_keep_the_unprefixed_form(
    editor: TestClient,
) -> None:
    problem_id, source, url = _problem_with_image(editor)

    assert url.startswith("/api/images/")
    assert editor.get(f"/collab/api/problems/{problem_id}").json()["description"] == source


async def test_fr1_problem_api_description_html_points_under_the_base(
    editor: TestClient,
) -> None:
    problem_id, _, url = _problem_with_image(editor)

    html = editor.get(f"/collab/api/problems/{problem_id}").json()["description_html"]

    assert f'src="/collab{url}"' in html


async def test_fr1_preview_description_html_points_under_the_base(editor: TestClient) -> None:
    _, source, url = _problem_with_image(editor)

    preview = editor.post("/collab/api/problems/preview", json={"description": source})

    assert preview.status_code == 200
    assert f'src="/collab{url}"' in preview.json()["html"]


async def test_fr1_session_websocket_description_html_points_under_the_base(
    editor: TestClient,
) -> None:
    problem_id, _, url = _problem_with_image(editor)
    invite = editor.post("/collab/api/sessions", json={"problem_id": problem_id}).json()[
        "invite_id"
    ]

    with editor.websocket_connect(f"/collab/api/sessions/{invite}/ws?name=Ada") as ws:
        welcome = ws.receive_json()

    assert f'src="/collab{url}"' in welcome["current_problem"]["description_html"]


async def test_fr1_the_prefixed_src_returns_the_image(editor: TestClient) -> None:
    _, _, url = _problem_with_image(editor)

    response = editor.get(f"/collab{url}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == PNG
