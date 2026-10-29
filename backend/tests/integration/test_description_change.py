"""Spec 002 task 18: a description change reaches every session and touches nothing else.

FR7. The description belongs to the problem; code and chat belong to the session. Real
Postgres, the real Keycloak test realm (editor1 saves), TestClient WebSockets.
"""

import json
import uuid
from collections.abc import AsyncIterator
from urllib.parse import quote

import asyncpg
import pycrdt
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
SIGNATURE = "def add(a: int, b: int) -> int"


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
async def client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
    migrated: asyncpg.Connection,
) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _next_json(ws) -> dict:
    """The next JSON message that isn't a presence update, skipping Yjs frames."""
    while True:
        message = ws.receive()
        if message.get("text") is None:
            continue
        payload = json.loads(message["text"])
        if payload["type"] != "presence":
            return payload


def _synced_doc(ws) -> pycrdt.Doc:
    """The session's shared document, as the server holds it (sync step 1 -> step 2)."""
    doc = pycrdt.Doc()
    ws.send_bytes(pycrdt.create_sync_message(doc))
    pycrdt.handle_sync_message(ws.receive_bytes()[1:], doc)
    return doc


def _code(doc: pycrdt.Doc, problem_id: uuid.UUID) -> str:
    return str(doc.get(f"code:{problem_id}", type=pycrdt.Text))


def _set_code(ws, doc: pycrdt.Doc, problem_id: uuid.UUID, code: str) -> None:
    before = doc.get_state()
    text = doc.get(f"code:{problem_id}", type=pycrdt.Text)
    del text[0 : len(text)]
    text += code
    ws.send_bytes(pycrdt.create_update_message(doc.get_update(before)))


async def test_fr7_a_new_description_shows_in_both_sessions_and_leaves_code_and_chat(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    problem_id = await problems_repo.create(
        migrated,
        title=f"Add {uuid.uuid4().hex[:8]}",
        description="Old description.",
        sig=parse_signature(SIGNATURE),
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    sessions = {
        "A": await sessions_repo.create(migrated, problem_id),
        "B": await sessions_repo.create(migrated, problem_id),
    }
    code = {
        name: f"def add(a: int, b: int) -> int:\n    return a + b  # session {name}\n"
        for name in sessions
    }
    for name, session in sessions.items():
        with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ws:
            welcome = _next_json(ws)
            assert "Old description." in welcome["current_problem"]["description_html"]
            _set_code(ws, _synced_doc(ws), problem_id, code[name])
            # Frames are handled in order, so the code is stored once the chat comes back.
            ws.send_text(
                json.dumps({"type": "chat_send", "client_id": name, "text": f"hi from {name}"})
            )
            assert _next_json(ws)["type"] == "chat_message"

    login_as(client, "editor1")
    body = client.get(f"/api/problems/{problem_id}/edit").json()
    body["description"] = "New description, now **bold**."
    del body["id"]
    saved = client.put(f"/api/problems/{problem_id}", json=body)
    assert saved.status_code == 200, saved.text

    for name, session in sessions.items():
        with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ws:
            welcome = _next_json(ws)
            doc = _synced_doc(ws)
        html = welcome["current_problem"]["description_html"]
        assert "New description, now <strong>bold</strong>." in html
        assert "Old description." not in html
        assert _code(doc, problem_id) == code[name]
        assert [m["text"] for m in welcome["chat"]] == [f"hi from {name}"]
