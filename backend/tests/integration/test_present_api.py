"""Spec 013 task 18: presentation library REST (plan.md "Contracts — REST"). FR-1–FR-7.

AC-1 add by raw upload and by pasted markup, title/topic rules; AC-2 analyze reports slides
or page; AC-3 too large / not HTML save nothing; AC-5 remove hides; AC-6 list carries
topics; AC-7 plain user 403, signed out 401. Real Postgres, real test Keycloak (`login_as`).
"""

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
LIMIT = 5 * 1024 * 1024

FOUR_SLIDES = "".join(f"<section><h1>Slide {i}</h1></section>" for i in range(4)).encode()
PAGE = b"<!doctype html><h1>One</h1><p>A single long page</p>"
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
        await conn.execute(
            """truncate presentation_chat_message, presentation_participant,
                        presentation_session, presentation_version, presentation cascade"""
        )
    finally:
        await conn.close()
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


@pytest.fixture
def editor(client: TestClient, login_as) -> TestClient:  # noqa: F811
    login_as(client, "editor1")
    return client


async def _counts(database_url: str) -> tuple[int, int, int]:
    """(presentations, versions, removed) — to prove a refusal saved nothing."""
    conn = await asyncpg.connect(database_url)
    try:
        row = await conn.fetchrow(
            """select (select count(*) from presentation) as p,
                      (select count(*) from presentation_version) as v,
                      (select count(*) from presentation where removed_at is not null) as r"""
        )
        return row["p"], row["v"], row["r"]
    finally:
        await conn.close()


def _add(client: TestClient, data: bytes, title: str = "Intro to DNS", topic: str = "Networking"):
    return client.post(
        "/api/present/presentations",
        params={"title": title, "topic": topic},
        content=data,
        headers={"Content-Type": "text/html"},
    )


# --- AC-1, AC-6 -------------------------------------------------------------------------------


async def test_add_upload_and_paste(editor: TestClient) -> None:
    uploaded = _add(editor, FOUR_SLIDES)
    assert uploaded.status_code == 201
    body = uploaded.json()
    uuid.UUID(body["id"])
    assert body | {"id": None} == {
        "id": None,
        "title": "Intro to DNS",
        "topic": "Networking",
        "kind": "slides",
        "slide_count": 4,
    }

    # Pasted markup: a UTF-8 string body, sent as text/plain.
    pasted = editor.post(
        "/api/present/presentations",
        params={"title": "  Compose basics ", "topic": " Docker "},
        content="<h1>Compose — ünïcode</h1><p>page</p>",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    assert pasted.status_code == 201
    assert pasted.json()["kind"] == "page"
    assert pasted.json()["slide_count"] == 0

    listed = editor.get("/api/present/presentations")
    assert listed.status_code == 200
    assert [(r["title"], r["topic"], r["kind"], r["slide_count"]) for r in listed.json()] == [
        ("Compose basics", "Docker", "page", 0),
        ("Intro to DNS", "Networking", "slides", 4),
    ]
    assert {r["id"] for r in listed.json()} == {body["id"], pasted.json()["id"]}


async def test_list_is_public(client: TestClient, editor: TestClient) -> None:
    _add(editor, PAGE, title="A", topic="Docker")
    editor.post("/api/auth/logout")
    listed = client.get("/api/present/presentations")
    assert listed.status_code == 200
    assert [(r["title"], r["topic"]) for r in listed.json()] == [("A", "Docker")]


@pytest.mark.parametrize(
    ("title", "topic", "error"),
    [
        ("", "Networking", "invalid_title"),
        ("   ", "Networking", "invalid_title"),
        ("x" * 101, "Networking", "invalid_title"),
        ("Intro", "", "invalid_topic"),
        ("Intro", "y" * 61, "invalid_topic"),
    ],
)
async def test_add_refuses_empty_or_long_title_topic(
    editor: TestClient, database_url: str, title: str, topic: str, error: str
) -> None:
    response = _add(editor, FOUR_SLIDES, title=title, topic=topic)
    assert response.status_code == 422
    assert response.json() == {"error": error}
    assert await _counts(database_url) == (0, 0, 0)


async def test_add_without_title_or_topic_is_refused(editor: TestClient, database_url: str) -> None:
    response = editor.post("/api/present/presentations", content=FOUR_SLIDES)
    assert response.status_code == 422
    assert await _counts(database_url) == (0, 0, 0)


async def test_add_accepts_100_char_title_and_60_char_topic(editor: TestClient) -> None:
    response = _add(editor, PAGE, title="x" * 100, topic="y" * 60)
    assert response.status_code == 201


# --- AC-2 -------------------------------------------------------------------------------------


async def test_analyze(editor: TestClient, database_url: str) -> None:
    slides = editor.post("/api/present/analyze", content=FOUR_SLIDES)
    assert slides.status_code == 200
    assert slides.json() == {"kind": "slides", "slide_count": 4}

    page = editor.post("/api/present/analyze", content=PAGE)
    assert page.status_code == 200
    assert page.json() == {"kind": "page", "slide_count": 0}

    assert await _counts(database_url) == (0, 0, 0)


# --- AC-3 -------------------------------------------------------------------------------------


async def test_too_large_and_not_html_save_nothing(editor: TestClient, database_url: str) -> None:
    six_mb = b"<p>" + b"a" * (6 * 1024 * 1024) + b"</p>"
    existing = _add(editor, FOUR_SLIDES).json()
    before = await _counts(database_url)

    for path in ("/api/present/analyze", "/api/present/presentations"):
        too_large = editor.post(
            path, params={"title": "Big", "topic": "Networking"}, content=six_mb
        )
        assert too_large.status_code == 413, path
        assert too_large.json() == {"error": "too_large", "limit_bytes": LIMIT}

        png = editor.post(path, params={"title": "Png", "topic": "Networking"}, content=PNG)
        assert png.status_code == 422, path
        assert png.json() == {"error": "not_html"}

    replace = f"/api/present/presentations/{existing['id']}/html"
    assert editor.put(replace, content=six_mb).status_code == 413
    assert editor.put(replace, content=PNG).json() == {"error": "not_html"}

    assert await _counts(database_url) == before
    listed = editor.get("/api/present/presentations").json()
    assert [(r["title"], r["slide_count"]) for r in listed] == [("Intro to DNS", 4)]


async def test_exactly_the_limit_is_not_too_large(editor: TestClient) -> None:
    body = b"<p>" + b"a" * (LIMIT - 7) + b"</p>"
    assert len(body) == LIMIT
    response = editor.post("/api/present/analyze", content=body)
    assert response.status_code == 200


# --- replace (FR-4) ---------------------------------------------------------------------------


async def test_replace_html(editor: TestClient, database_url: str) -> None:
    created = _add(editor, FOUR_SLIDES).json()
    six = "".join(f"<section>{i}</section>" for i in range(6)).encode()
    response = editor.put(f"/api/present/presentations/{created['id']}/html", content=six)
    assert response.status_code == 200
    assert response.json() == {
        "id": created["id"],
        "title": "Intro to DNS",
        "topic": "Networking",
        "kind": "slides",
        "slide_count": 6,
    }
    assert await _counts(database_url) == (1, 2, 0)
    listed = editor.get("/api/present/presentations").json()
    assert [r["slide_count"] for r in listed] == [6]


async def test_replace_or_remove_unknown_is_404(editor: TestClient) -> None:
    missing = uuid.uuid4()
    put = editor.put(f"/api/present/presentations/{missing}/html", content=PAGE)
    assert put.status_code == 404
    assert put.json() == {"error": "not_found"}
    delete = editor.delete(f"/api/present/presentations/{missing}")
    assert delete.status_code == 404
    assert delete.json() == {"error": "not_found"}


# --- AC-5 -------------------------------------------------------------------------------------


async def test_remove_hides(editor: TestClient, database_url: str) -> None:
    kept = _add(editor, PAGE, title="Kept").json()
    gone = _add(editor, FOUR_SLIDES, title="Gone").json()

    response = editor.delete(f"/api/present/presentations/{gone['id']}")
    assert response.status_code == 204

    listed = editor.get("/api/present/presentations").json()
    assert [r["id"] for r in listed] == [kept["id"]]
    assert await _counts(database_url) == (2, 2, 1)
    # Removing again, or replacing a removed one, finds nothing.
    assert editor.delete(f"/api/present/presentations/{gone['id']}").status_code == 404
    replaced = editor.put(f"/api/present/presentations/{gone['id']}/html", content=PAGE)
    assert replaced.status_code == 404


# --- AC-7 -------------------------------------------------------------------------------------


async def test_non_editor_refused(client: TestClient, login_as, database_url: str) -> None:  # noqa: F811
    login_as(client, "editor1")
    existing = _add(client, FOUR_SLIDES).json()
    client.post("/api/auth/logout")
    before = await _counts(database_url)
    target = f"/api/present/presentations/{existing['id']}"

    def attempts() -> list:
        return [
            client.post("/api/present/analyze", content=PAGE),
            _add(client, PAGE, title="Sneaky"),
            client.put(f"{target}/html", content=PAGE),
            client.delete(target),
        ]

    for response in attempts():
        assert response.status_code == 401, response.request.url

    login_as(client, "plain1")
    for response in attempts():
        assert response.status_code == 403, response.request.url
        assert response.json() == {"error": "missing_role", "role": "editor"}

    assert await _counts(database_url) == before
    listed = client.get("/api/present/presentations").json()
    assert [(r["title"], r["slide_count"]) for r in listed] == [("Intro to DNS", 4)]
