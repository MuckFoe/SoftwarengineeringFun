"""Task 35: WebSocket Yjs sync and awareness relay (`sessions/ws.py`, `sessions/hub.py`).

FR-16, FR-18, FR-19, FR-20.
"""

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
from app.problems.signature import TestInput, parse_signature, starter_code
from app.sessions import repo as sessions_repo

ADD = parse_signature("def add(a: int, b: int) -> int")


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
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


async def _session(conn: asyncpg.Connection) -> tuple[sessions_repo.Session, str]:
    problem_id = await problems_repo.create(
        conn,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    session = await sessions_repo.create(conn, problem_id)
    return session, str(problem_id)


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _sync_client(ws, local_doc: pycrdt.Doc) -> None:
    """Drives the y-websocket handshake: send our (empty) state, apply the server's reply."""
    ws.send_bytes(pycrdt.create_sync_message(local_doc))
    reply = ws.receive_bytes()
    pycrdt.handle_sync_message(reply[1:], local_doc)


def _code_text(doc: pycrdt.Doc, problem_id: str) -> pycrdt.Text:
    return doc.get(f"code:{problem_id}", type=pycrdt.Text)


def _update_message_for(doc: pycrdt.Doc, before_state: bytes) -> bytes:
    return pycrdt.create_update_message(doc.get_update(before_state))


async def test_fr16_a_new_clients_synced_doc_has_the_starter_code(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session, problem_id = await _session(migrated)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws:
        ws.receive_json()  # welcome
        local = pycrdt.Doc()
        _sync_client(ws, local)

    assert str(_code_text(local, problem_id)) == starter_code(ADD)


async def test_fr18_adas_update_reaches_linus(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session, problem_id = await _session(migrated)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
        ada_ws.receive_json()  # welcome
        ada_doc = pycrdt.Doc()
        _sync_client(ada_ws, ada_doc)

        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
            linus_ws.receive_json()  # welcome
            ada_ws.receive_json()  # presence broadcast from Linus joining
            linus_doc = pycrdt.Doc()
            _sync_client(linus_ws, linus_doc)

            before = ada_doc.get_state()
            ada_text = _code_text(ada_doc, problem_id)
            ada_text += "    return a + b\n"
            ada_ws.send_bytes(_update_message_for(ada_doc, before))

            relayed = linus_ws.receive_bytes()
            pycrdt.handle_sync_message(relayed[1:], linus_doc)

            assert "return a + b" in str(_code_text(linus_doc, problem_id))


async def test_fr19_concurrent_updates_converge(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session, problem_id = await _session(migrated)

    # Ada joins and syncs fully before Linus connects at all: connecting both "at once"
    # (e.g. via a combined `with (a, b):`) lets their join sequences race, since each
    # `websocket_connect().__enter__()` only waits for that socket's own accept, not for
    # the rest of its handler (DB writes, welcome) to finish.
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
        ada_ws.receive_json()  # welcome
        ada_doc = pycrdt.Doc()
        _sync_client(ada_ws, ada_doc)

        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
            linus_ws.receive_json()  # welcome
            ada_ws.receive_json()  # presence broadcast from Linus joining
            linus_doc = pycrdt.Doc()
            _sync_client(linus_ws, linus_doc)

            ada_before = ada_doc.get_state()
            _code_text(ada_doc, problem_id).insert(0, "# ada was here\n")
            ada_update = _update_message_for(ada_doc, ada_before)

            linus_before = linus_doc.get_state()
            linus_text = _code_text(linus_doc, problem_id)
            linus_text.insert(len(str(linus_text)), "# linus too\n")
            linus_update = _update_message_for(linus_doc, linus_before)

            ada_ws.send_bytes(ada_update)
            linus_ws.send_bytes(linus_update)

            # Each client receives the other's relayed update.
            from_linus = ada_ws.receive_bytes()
            pycrdt.handle_sync_message(from_linus[1:], ada_doc)
            from_ada = linus_ws.receive_bytes()
            pycrdt.handle_sync_message(from_ada[1:], linus_doc)

    merged = str(_code_text(ada_doc, problem_id))
    assert merged == str(_code_text(linus_doc, problem_id))
    assert "ada was here" in merged
    assert "linus too" in merged


async def test_fr20_linus_awareness_frame_reaches_ada(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session, _problem_id = await _session(migrated)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
        ada_ws.receive_json()  # welcome

        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
            linus_ws.receive_json()  # welcome
            ada_ws.receive_json()  # presence broadcast from Linus joining

            awareness_frame = pycrdt.create_awareness_message(b"cursor-on-line-3")
            linus_ws.send_bytes(awareness_frame)

            received = ada_ws.receive_bytes()
            assert received == awareness_frame
