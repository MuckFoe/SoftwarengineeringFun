"""Spec 002 task 10: image upload and serving API (FR3, FR4, NFR Security)."""

import base64
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
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
LIMIT = 2 * 1024 * 1024


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
        await conn.execute("delete from problem_image")
    finally:
        await conn.close()
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


@pytest.fixture
def editor(client: TestClient, login_as) -> TestClient:  # noqa: F811
    login_as(client, "editor1")
    return client


async def _image_count(database_url: str) -> int:
    conn = await asyncpg.connect(database_url)
    try:
        return await conn.fetchval("select count(*) from problem_image")
    finally:
        await conn.close()


def _upload(client: TestClient, data: bytes, content_type: str = "image/png"):
    return client.post("/api/images", content=data, headers={"Content-Type": content_type})


async def test_fr3_png_upload_returns_an_id_and_get_serves_the_same_bytes(
    editor: TestClient,
) -> None:
    response = _upload(editor, PNG)

    assert response.status_code == 201
    body = response.json()
    image_id = uuid.UUID(body["id"])
    assert body["url"] == f"/api/images/{image_id}"

    served = editor.get(body["url"])
    assert served.status_code == 200
    assert served.content == PNG
    assert served.headers["content-type"] == "image/png"
    assert served.headers["x-content-type-options"] == "nosniff"
    assert served.headers["content-security-policy"] == "default-src 'none'"
    assert served.headers["content-disposition"] == "inline"
    assert served.headers["cache-control"] == "public, max-age=31536000, immutable"


async def test_fr3_images_are_served_without_signing_in(
    editor: TestClient,
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
) -> None:
    url = _upload(editor, PNG).json()["url"]

    with TestClient(create_app(_settings(keycloak, database_url))) as anonymous:
        served = anonymous.get(url)

    assert served.status_code == 200
    assert served.content == PNG


async def test_fr4_a_3_mb_image_is_refused_with_the_2_mb_limit(
    editor: TestClient, database_url: str
) -> None:
    big = PNG + b"\0" * (3 * 1024 * 1024 - len(PNG))

    response = _upload(editor, big)

    assert response.status_code == 413
    assert response.json() == {"error": "image_too_large", "limit_bytes": LIMIT}
    assert await _image_count(database_url) == 0


async def test_fr4_exactly_2_mib_is_accepted_and_one_byte_more_is_refused(
    editor: TestClient,
) -> None:
    at_limit = PNG + b"\0" * (LIMIT - len(PNG))

    assert _upload(editor, at_limit).status_code == 201
    assert _upload(editor, at_limit + b"\0").status_code == 413


async def test_fr4_a_pdf_is_refused_listing_the_accepted_formats(
    editor: TestClient, database_url: str
) -> None:
    response = _upload(editor, PDF, "application/pdf")

    assert response.status_code == 415
    assert response.json() == {
        "error": "image_format",
        "accepted": ["png", "jpeg", "gif", "webp"],
    }
    assert await _image_count(database_url) == 0


async def test_fr4_format_comes_from_the_bytes_not_the_declared_type(
    editor: TestClient,
) -> None:
    png_as_pdf = _upload(editor, PNG, "application/pdf")
    assert png_as_pdf.status_code == 201
    served = editor.get(png_as_pdf.json()["url"])
    assert served.headers["content-type"] == "image/png"

    assert _upload(editor, PDF, "image/png").status_code == 415


async def test_an_empty_body_is_refused(editor: TestClient) -> None:
    assert _upload(editor, b"").status_code == 415


async def test_an_unknown_image_id_gives_404(client: TestClient) -> None:
    response = client.get(f"/api/images/{uuid.uuid4()}")

    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}


async def test_anonymous_upload_gives_401(client: TestClient, database_url: str) -> None:
    assert _upload(client, PNG).status_code == 401
    assert await _image_count(database_url) == 0


async def test_plain_user_upload_gives_403(
    client: TestClient,
    login_as,  # noqa: F811
    database_url: str,
) -> None:
    login_as(client, "plain1")

    response = _upload(client, PNG)

    assert response.status_code == 403
    assert response.json() == {"error": "missing_role", "role": "editor"}
    assert await _image_count(database_url) == 0


async def test_the_uploader_is_recorded(editor: TestClient, database_url: str) -> None:
    image_id = _upload(editor, PNG).json()["id"]

    conn = await asyncpg.connect(database_url)
    try:
        sub = await conn.fetchval(
            "select uploaded_by_sub from problem_image where id = $1", uuid.UUID(image_id)
        )
    finally:
        await conn.close()
    assert sub
