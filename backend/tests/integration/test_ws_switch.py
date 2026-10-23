"""Task 38: WebSocket problem switching and deleted-problem handling.

FR-10, FR-17.
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
from app.problems.signature import TestInput, parse_signature, starter_code
from app.runs import repo as runs_repo
from app.runs.grading import TestResult
from app.sessions import repo as sessions_repo
from app.sessions import service as sessions_service

ADD = parse_signature("def add(a: int, b: int) -> int")
REVERSE = parse_signature("def reverse_list(xs: list[int]) -> list[int]")


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


async def _two_problems(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    sum_two = await problems_repo.create(
        conn,
        title=f"Sum two {uuid.uuid4().hex[:8]}",
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    reverse_list = await problems_repo.create(
        conn,
        title=f"Reverse list {uuid.uuid4().hex[:8]}",
        description="d",
        sig=REVERSE,
        tests=[TestInput(args=[[1, 2]], expected=[2, 1])],
        created_by_sub=None,
        created_by_name=None,
    )
    return sum_two, reverse_list


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _sync_client(ws, local_doc: pycrdt.Doc) -> None:
    ws.send_bytes(pycrdt.create_sync_message(local_doc))
    reply = ws.receive_bytes()
    pycrdt.handle_sync_message(reply[1:], local_doc)


def _code_text(doc: pycrdt.Doc, problem_id: uuid.UUID) -> pycrdt.Text:
    return doc.get(f"code:{problem_id}", type=pycrdt.Text)


def _switch(ws, problem_id: uuid.UUID) -> None:
    ws.send_text(json.dumps({"type": "switch_problem", "problem_id": str(problem_id)}))


async def test_fr17_switching_problems_and_back_preserves_code_and_last_run(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    sum_two, reverse_list = await _two_problems(migrated)
    session = await sessions_repo.create(migrated, sum_two)
    participant = await sessions_repo.add_participant(migrated, session.id, "seed")
    run_id = await runs_repo.start_run(
        migrated, session.id, sum_two, "return a + b", participant.id
    )
    await runs_repo.finish_run(migrated, run_id, status="done", results=[TestResult(1, "passed")])

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
        ada_ws.receive_json()  # welcome
        ada_doc = pycrdt.Doc()
        _sync_client(ada_ws, ada_doc)

        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
            linus_ws.receive_json()  # welcome
            ada_ws.receive_json()  # presence broadcast from Linus joining
            linus_doc = pycrdt.Doc()
            _sync_client(linus_ws, linus_doc)

            # Edit sum_two's code to "return a + b" and relay it to Linus.
            before = ada_doc.get_state()
            ada_text = _code_text(ada_doc, sum_two)
            ada_text += "    return a + b\n"
            ada_ws.send_bytes(pycrdt.create_update_message(ada_doc.get_update(before)))
            relayed = linus_ws.receive_bytes()
            pycrdt.handle_sync_message(relayed[1:], linus_doc)

            # Ada switches to "Reverse list": both get problem_switched and its starter text.
            _switch(ada_ws, reverse_list)
            ada_switched = ada_ws.receive_json()
            linus_switched = linus_ws.receive_json()
            for msg in (ada_switched, linus_switched):
                assert msg["type"] == "problem_switched"
                assert msg["problem"]["id"] == str(reverse_list)
                assert msg["by"] == "Ada"
            ada_update = ada_ws.receive_bytes()
            pycrdt.handle_sync_message(ada_update[1:], ada_doc)
            linus_update = linus_ws.receive_bytes()
            pycrdt.handle_sync_message(linus_update[1:], linus_doc)
            assert str(_code_text(ada_doc, reverse_list)) == starter_code(REVERSE)
            assert str(_code_text(linus_doc, reverse_list)) == starter_code(REVERSE)

            # Linus switches back to "Sum two": both see the previous code and last run.
            _switch(linus_ws, sum_two)
            ada_back = ada_ws.receive_json()
            linus_back = linus_ws.receive_json()
            for msg in (ada_back, linus_back):
                assert msg["type"] == "problem_switched"
                assert msg["problem"]["id"] == str(sum_two)
                assert msg["by"] == "Linus"
                assert msg["state"]["last_run"] is not None
                assert msg["state"]["last_run"]["results"] == [
                    {"position": 1, "outcome": "passed", "error_message": None, "traceback": None}
                ]

    assert "return a + b" in str(_code_text(ada_doc, sum_two))
    assert "return a + b" in str(_code_text(linus_doc, sum_two))


async def test_fr10_deleting_the_current_problem_notifies_and_switching_still_works(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    sum_two, reverse_list = await _two_problems(migrated)
    session = await sessions_repo.create(migrated, sum_two)

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
            ada_text = _code_text(ada_doc, sum_two)
            ada_text += "    return a + b\n"
            ada_ws.send_bytes(pycrdt.create_update_message(ada_doc.get_update(before)))
            relayed = linus_ws.receive_bytes()
            pycrdt.handle_sync_message(relayed[1:], linus_doc)

            # An editor deletes "Sum two" while the session is on it.
            await problems_repo.soft_delete(migrated, sum_two)
            await sessions_service.on_problem_deleted(migrated, sum_two)

            for ws in (ada_ws, linus_ws):
                msg = ws.receive_json()
                assert msg == {"type": "problem_deleted", "problem_id": str(sum_two)}

            assert "return a + b" in str(_code_text(ada_doc, sum_two))
            assert "return a + b" in str(_code_text(linus_doc, sum_two))

            # switch_problem still works afterwards.
            _switch(ada_ws, reverse_list)
            ada_switched = ada_ws.receive_json()
            linus_switched = linus_ws.receive_json()
            assert ada_switched["type"] == "problem_switched"
            assert linus_switched["type"] == "problem_switched"
            assert ada_switched["problem"]["id"] == str(reverse_list)


async def test_switching_to_an_unknown_problem_errors_and_keeps_the_connection(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    sum_two, reverse_list = await _two_problems(migrated)
    session = await sessions_repo.create(migrated, sum_two)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws:
        ws.receive_json()  # welcome
        ws.send_text(json.dumps({"type": "switch_problem", "problem_id": str(uuid.uuid4())}))
        assert ws.receive_json() == {"type": "error", "code": "problem_not_found"}

        ws.send_text(json.dumps({"type": "switch_problem", "problem_id": str(reverse_list)}))
        assert ws.receive_json()["type"] == "problem_switched"
