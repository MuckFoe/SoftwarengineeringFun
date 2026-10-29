"""Spec 002 task 12: description validation, `description_html` and preview.

FR1, FR3, FR4, FR5, FR6.
"""

import base64
import re
import uuid
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

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABXvMqGgAAAABJRU5ErkJggg=="
)


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


@pytest.fixture
def editor(client: TestClient, login_as) -> TestClient:  # noqa: F811
    login_as(client, "editor1")
    return client


def _body(description: str, title: str | None = None) -> dict:
    return {
        "title": title or f"Sum two {uuid.uuid4().hex[:8]}",
        "description": description,
        "signature": "def add(a: int, b: int) -> int",
        "tests": [{"args": [2, 3], "expected": 5}],
    }


def _upload(client: TestClient) -> str:
    response = client.post("/api/images", content=PNG, headers={"Content-Type": "image/png"})
    assert response.status_code == 201
    return response.json()["url"]


def _create(client: TestClient, description: str) -> str:
    response = client.post("/api/problems", json=_body(description))
    assert response.status_code == 201, response.json()
    return response.json()["id"]


async def _problem_count(database_url: str) -> int:
    conn = await asyncpg.connect(database_url)
    try:
        return await conn.fetchval("select count(*) from problem")
    finally:
        await conn.close()


@pytest.mark.parametrize("empty", ["", "  \n", "\t\n \n"])
async def test_fr1_empty_description_is_refused_and_nothing_created(
    editor: TestClient, database_url: str, empty: str
) -> None:
    before = await _problem_count(database_url)

    response = editor.post("/api/problems", json=_body(empty))

    assert response.status_code == 422
    assert response.json() == {"error": "description_required"}
    assert await _problem_count(database_url) == before


async def test_fr1_empty_description_on_update_leaves_the_problem_unchanged(
    editor: TestClient,
) -> None:
    problem_id = _create(editor, "Keep me.")

    response = editor.put(f"/api/problems/{problem_id}", json=_body("   "))

    assert response.status_code == 422
    assert response.json() == {"error": "description_required"}
    assert editor.get(f"/api/problems/{problem_id}").json()["description"] == "Keep me."


async def test_fr4_eleven_images_are_refused_and_ten_are_saved(editor: TestClient) -> None:
    urls = [_upload(editor) for _ in range(11)]
    eleven = "\n\n".join(f"![i{i}]({u})" for i, u in enumerate(urls))
    ten = "\n\n".join(f"![i{i}]({u})" for i, u in enumerate(urls[:10]))

    refused = editor.post("/api/problems", json=_body(eleven))
    assert refused.status_code == 422
    assert refused.json() == {"error": "too_many_images", "limit": 10}

    assert editor.post("/api/problems", json=_body(ten)).status_code == 201


async def test_fr4_the_same_image_twice_counts_once(editor: TestClient) -> None:
    urls = [_upload(editor) for _ in range(10)]
    source = "\n\n".join(f"![i{i}]({u})" for i, u in enumerate(urls)) + f"\n\n![again]({urls[0]})"

    assert editor.post("/api/problems", json=_body(source)).status_code == 201


async def test_fr4_eleven_images_on_update_are_refused(editor: TestClient) -> None:
    problem_id = _create(editor, "Before.")
    urls = [_upload(editor) for _ in range(11)]
    eleven = "\n\n".join(f"![i{i}]({u})" for i, u in enumerate(urls))

    response = editor.put(f"/api/problems/{problem_id}", json=_body(eleven))

    assert response.status_code == 422
    assert response.json() == {"error": "too_many_images", "limit": 10}
    assert editor.get(f"/api/problems/{problem_id}").json()["description"] == "Before."


async def test_an_unknown_image_id_is_refused(editor: TestClient) -> None:
    known = _upload(editor)
    unknown = uuid.uuid4()

    response = editor.post(
        "/api/problems", json=_body(f"![a]({known})\n\n![b](/api/images/{unknown})")
    )

    assert response.status_code == 422
    assert response.json() == {"error": "image_not_found", "id": str(unknown)}


@pytest.mark.parametrize(
    "source",
    ["![x](https://example.com/a.png)", "![x](/static/a.png)", "![x](/api/images/not-a-uuid)"],
)
async def test_an_image_source_other_than_an_upload_is_refused(
    editor: TestClient, database_url: str, source: str
) -> None:
    before = await _problem_count(database_url)

    response = editor.post("/api/problems", json=_body(f"Text.\n\n{source}"))

    assert response.status_code == 422
    assert response.json() == {"error": "image_source_not_allowed"}
    assert await _problem_count(database_url) == before


async def test_fr3_fr6_an_image_between_paragraphs_2_and_3_is_served_there(
    editor: TestClient,
) -> None:
    url = _upload(editor)
    problem_id = _create(editor, f"One.\n\nTwo.\n\n![diagram]({url})\n\nThree.")

    html = editor.get(f"/api/problems/{problem_id}").json()["description_html"]

    paragraphs = [m.start() for m in re.finditer("<p>", html)]
    image = html.index(f'<img src="{url}"')
    assert len(paragraphs) == 4  # One, Two, the image's own paragraph, Three
    assert html.index("Two.") < image < html.index("Three.")
    assert paragraphs[2] < image < paragraphs[3]


async def test_fr6_public_get_has_description_html_without_signing_in(
    editor: TestClient,
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
) -> None:
    problem_id = _create(editor, "## Task\n\nAdd `a` and `b`.")

    with TestClient(create_app(_settings(keycloak, database_url))) as anonymous:
        body = anonymous.get(f"/api/problems/{problem_id}").json()

    assert (
        body["description_html"] == "<h2>Task</h2>\n<p>Add <code>a</code> and <code>b</code>.</p>\n"
    )
    assert "tests" not in body


async def test_fr5_preview_matches_the_saved_view_and_saves_nothing(editor: TestClient) -> None:
    url = _upload(editor)
    problem_id = _create(editor, "Old description.")
    draft = f"## Task\n\n1. **Add** them\n2. Return\n\n![d]({url})\n\n```\n  x\n```\n"

    preview = editor.post("/api/problems/preview", json={"description": draft})

    assert preview.status_code == 200
    assert editor.get(f"/api/problems/{problem_id}").json()["description"] == "Old description."

    saved = editor.put(f"/api/problems/{problem_id}", json=_body(draft))
    assert saved.status_code == 200
    served = editor.get(f"/api/problems/{problem_id}").json()["description_html"]
    assert preview.json() == {"html": served}


async def test_fr5_preview_renders_even_a_draft_that_save_would_refuse(
    editor: TestClient, database_url: str
) -> None:
    before = await _problem_count(database_url)

    response = editor.post(
        "/api/problems/preview", json={"description": "![x](https://example.com/a.png)"}
    )

    assert response.status_code == 200
    assert response.json() == {"html": "<p>x</p>\n"}
    assert await _problem_count(database_url) == before


async def test_preview_needs_the_editor_role(client: TestClient, login_as) -> None:  # noqa: F811
    assert client.post("/api/problems/preview", json={"description": "x"}).status_code == 401

    login_as(client, "plain1")
    response = client.post("/api/problems/preview", json={"description": "x"})

    assert response.status_code == 403
    assert response.json() == {"error": "missing_role", "role": "editor"}
