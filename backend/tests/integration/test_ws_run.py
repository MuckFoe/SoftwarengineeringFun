"""Task 40: WebSocket run. FR-10, FR-21, FR-22, FR-23, FR-24, FR-26."""

import dataclasses
import json
import os
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
from app.problems.signature import Signature, TestInput, parse_signature
from app.sessions import repo as sessions_repo

ADD = parse_signature("def add(a: int, b: int) -> int")
NO_ARGS = parse_signature("def f() -> int")

RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url=RUNNER_URL,
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


async def _problem(conn: asyncpg.Connection, sig: Signature, tests: list[TestInput]) -> uuid.UUID:
    return await problems_repo.create(
        conn,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=sig,
        tests=tests,
        created_by_sub=None,
        created_by_name=None,
    )


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _sync_client(ws, local_doc: pycrdt.Doc) -> None:
    ws.send_bytes(pycrdt.create_sync_message(local_doc))
    reply = ws.receive_bytes()
    pycrdt.handle_sync_message(reply[1:], local_doc)


def _code_text(doc: pycrdt.Doc, problem_id: uuid.UUID) -> pycrdt.Text:
    return doc.get(f"code:{problem_id}", type=pycrdt.Text)


def _append_code(ws, doc: pycrdt.Doc, problem_id: uuid.UUID, snippet: str) -> None:
    """Appends an (already indented) snippet to the starter body as one update."""
    before = doc.get_state()
    text = _code_text(doc, problem_id)
    text += snippet
    ws.send_bytes(pycrdt.create_update_message(doc.get_update(before)))


async def test_fr21_fr23_a_passing_run_is_broadcast_to_both_and_marks_accepted(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(migrated, ADD, [TestInput(args=[2, 3], expected=5)])
    session = await sessions_repo.create(migrated, problem_id)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
        ada_ws.receive_json()  # welcome
        ada_doc = pycrdt.Doc()
        _sync_client(ada_ws, ada_doc)

        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
            linus_ws.receive_json()  # welcome
            ada_ws.receive_json()  # presence broadcast from Linus joining
            linus_doc = pycrdt.Doc()
            _sync_client(linus_ws, linus_doc)

            _append_code(ada_ws, ada_doc, problem_id, "    return a + b\n")
            relayed = linus_ws.receive_bytes()
            pycrdt.handle_sync_message(relayed[1:], linus_doc)

            ada_ws.send_text(json.dumps({"type": "run"}))

            for ws in (ada_ws, linus_ws):
                started = ws.receive_json()
                assert started["type"] == "run_started"
                assert started["by"] == "Ada"
                finished = ws.receive_json()
                assert finished["type"] == "run_finished"
                assert finished["run"]["problem_id"] == str(problem_id)
                assert finished["run"]["accepted"] is True
                assert finished["run"]["results"] == [
                    {
                        "position": 1,
                        "outcome": "passed",
                        "error_message": None,
                        "traceback": None,
                    }
                ]

    row = await migrated.fetchrow(
        "select accepted from session_problem where session_id = $1 and problem_id = $2",
        session.id,
        problem_id,
    )
    assert row is not None
    assert row["accepted"] is True


async def test_fr22_wrong_answers_and_printed_output_carry_no_values(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(
        migrated,
        ADD,
        [TestInput(args=[2, 3], expected=5), TestInput(args=[1, 1], expected=2)],
    )
    session = await sessions_repo.create(migrated, problem_id)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws:
        ws.receive_json()  # welcome
        doc = pycrdt.Doc()
        _sync_client(ws, doc)
        _append_code(ws, doc, problem_id, "    print('printed-marker-x7f3')\n    return a * b\n")

        ws.send_text(json.dumps({"type": "run"}))
        ws.receive_json()  # run_started
        raw = ws.receive_text()

    finished = json.loads(raw)
    assert finished["type"] == "run_finished"
    assert [r["outcome"] for r in finished["run"]["results"]] == [
        "wrong_answer",
        "wrong_answer",
    ]
    assert "printed-marker-x7f3" not in raw
    results_raw = json.dumps(finished["run"]["results"])
    for forbidden in ("5", "6", "2, 3", "1, 1"):
        assert forbidden not in results_raw


async def test_fr22_an_error_gives_message_and_traceback(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(migrated, ADD, [TestInput(args=[2, 3], expected=5)])
    session = await sessions_repo.create(migrated, problem_id)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws:
        ws.receive_json()  # welcome
        doc = pycrdt.Doc()
        _sync_client(ws, doc)
        _append_code(ws, doc, problem_id, "    raise ValueError('bad')\n")

        ws.send_text(json.dumps({"type": "run"}))
        ws.receive_json()  # run_started
        finished = ws.receive_json()

    result = finished["run"]["results"][0]
    assert result["outcome"] == "error"
    assert result["error_message"] == "bad"
    assert "solution.py" in result["traceback"]


async def test_fr10_running_a_deleted_problem_gives_error(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(migrated, ADD, [TestInput(args=[2, 3], expected=5)])
    session = await sessions_repo.create(migrated, problem_id)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws:
        ws.receive_json()  # welcome
        await problems_repo.soft_delete(migrated, problem_id)

        ws.send_text(json.dumps({"type": "run"}))
        error = ws.receive_json()

    assert error == {"type": "error", "code": "problem_deleted"}


async def test_fr26_two_concurrent_runs_exactly_one_wins(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(migrated, NO_ARGS, [TestInput(args=[], expected=0)])
    session = await sessions_repo.create(migrated, problem_id)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
        ada_ws.receive_json()  # welcome
        ada_doc = pycrdt.Doc()
        _sync_client(ada_ws, ada_doc)

        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
            linus_ws.receive_json()  # welcome
            ada_ws.receive_json()  # presence broadcast from Linus joining
            linus_doc = pycrdt.Doc()
            _sync_client(linus_ws, linus_doc)

            _append_code(ada_ws, ada_doc, problem_id, "    while True:\n        pass\n")
            linus_ws.receive_bytes()  # relayed code edit

            ada_ws.send_text(json.dumps({"type": "run"}))
            linus_ws.send_text(json.dumps({"type": "run"}))

            ada_first = ada_ws.receive_json()
            linus_first = linus_ws.receive_json()
            firsts = {"ada": ada_first, "linus": linus_first}
            sockets = {"ada": ada_ws, "linus": linus_ws}

            losers = [who for who, msg in firsts.items() if msg["type"] == "error"]
            winners = [who for who, msg in firsts.items() if msg["type"] == "run_started"]
            assert len(losers) == 1
            assert len(winners) == 1
            assert firsts[losers[0]] == {"type": "error", "code": "run_in_progress"}

            loser_socket = sockets[losers[0]]
            winner_socket = sockets[winners[0]]

            # The winner's run_started is also broadcast to the loser.
            loser_started = loser_socket.receive_json()
            assert loser_started["type"] == "run_started"

            winner_finished = winner_socket.receive_json()
            loser_finished = loser_socket.receive_json()
            assert winner_finished["type"] == "run_finished"
            assert loser_finished["type"] == "run_finished"
            assert winner_finished["run"]["results"][0]["outcome"] == "time_limit_exceeded"


async def _session_with_infinite_loop(
    client: TestClient, conn: asyncpg.Connection
) -> sessions_repo.Session:
    problem_id = await _problem(conn, NO_ARGS, [TestInput(args=[], expected=0)])
    session = await sessions_repo.create(conn, problem_id)
    # Put the looping code in the doc through one short-lived connection.
    with client.websocket_connect(_ws_url(session.invite_id, "Setup")) as ws:
        ws.receive_json()  # welcome
        doc = pycrdt.Doc()
        _sync_client(ws, doc)
        _append_code(ws, doc, problem_id, "    while True:\n        pass\n")
    return session


async def test_fr26_joining_mid_run_reports_run_in_progress(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session_with_infinite_loop(client, migrated)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
        ada_ws.receive_json()  # welcome
        ada_ws.send_text(json.dumps({"type": "run"}))
        assert ada_ws.receive_json()["type"] == "run_started"

        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
            welcome = linus_ws.receive_json()
            assert welcome["run_in_progress"] is True
            assert linus_ws.receive_json()["type"] == "run_finished"

        ada_ws.receive_json()  # presence broadcast from Linus joining
        ada_ws.receive_json()  # run_finished


async def test_fr18_the_runners_own_edits_are_relayed_during_a_run(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session_with_infinite_loop(client, migrated)
    problem_id = session.current_problem_id

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
        ada_ws.receive_json()  # welcome
        ada_doc = pycrdt.Doc()
        _sync_client(ada_ws, ada_doc)

        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
            linus_ws.receive_json()  # welcome
            ada_ws.receive_json()  # presence broadcast from Linus joining

            ada_ws.send_text(json.dumps({"type": "run"}))
            assert linus_ws.receive_json()["type"] == "run_started"
            _append_code(ada_ws, ada_doc, problem_id, "# typed during the run\n")

            # The edit reaches Linus before the (3 s) run finishes.
            relayed = linus_ws.receive()
            assert relayed.get("bytes") is not None, relayed
            assert json.loads(linus_ws.receive_text())["type"] == "run_finished"


async def test_fr26_a_runner_failure_ends_the_run_for_everyone(
    database_url: str, migrated: asyncpg.Connection
) -> None:
    problem_id = await _problem(migrated, ADD, [TestInput(args=[2, 3], expected=5)])
    session = await sessions_repo.create(migrated, problem_id)
    unreachable = dataclasses.replace(_settings(database_url), runner_url="http://127.0.0.1:1")

    with TestClient(create_app(unreachable)) as client:
        with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
            ada_ws.receive_json()  # welcome
            with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
                linus_ws.receive_json()  # welcome
                ada_ws.receive_json()  # presence broadcast from Linus joining

                ada_ws.send_text(json.dumps({"type": "run"}))
                for ws in (ada_ws, linus_ws):
                    started = ws.receive_json()
                    assert started["type"] == "run_started"
                    failed = ws.receive_json()
                    assert failed == {
                        "type": "run_failed",
                        "run_id": started["run_id"],
                        "reason": "infra_error",
                    }
