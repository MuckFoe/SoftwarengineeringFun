"""Task 41: persistence across leave and restart. FR-27, FR-28."""

import json
import os
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
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
from app.sessions import collab
from app.sessions import hub as hub_module
from app.sessions import repo as sessions_repo
from tests.conftest import FrozenClock

ADD = parse_signature("def add(a: int, b: int) -> int")
TESTS = [TestInput(args=[2, 3], expected=5), TestInput(args=[1, 1], expected=2)]

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


def _restart(monkeypatch: pytest.MonkeyPatch) -> None:
    """Drops every in-process cache a restarted api would not have."""
    monkeypatch.setattr(collab, "_active", {})
    monkeypatch.setattr(hub_module, "_hubs", {})


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _sync_client(ws, local_doc: pycrdt.Doc) -> None:
    ws.send_bytes(pycrdt.create_sync_message(local_doc))
    reply = ws.receive_bytes()
    pycrdt.handle_sync_message(reply[1:], local_doc)


def _code_text(doc: pycrdt.Doc, problem_id: uuid.UUID) -> pycrdt.Text:
    return doc.get(f"code:{problem_id}", type=pycrdt.Text)


def _set_code(ws, doc: pycrdt.Doc, problem_id: uuid.UUID, code: str) -> None:
    """Replaces the whole editor text with `code`, sent as one update."""
    before = doc.get_state()
    text = _code_text(doc, problem_id)
    with doc.transaction():
        del text[:]
        text += code
    ws.send_bytes(pycrdt.create_update_message(doc.get_update(before)))


def _run(ws_runner, ws_other) -> dict:
    ws_runner.send_text(json.dumps({"type": "run"}))
    finished = None
    for ws in (ws_runner, ws_other):
        assert ws.receive_json()["type"] == "run_started"
        finished = ws.receive_json()
        assert finished["type"] == "run_finished"
    assert finished is not None
    return finished["run"]


async def test_fr27_fr28_session_survives_everyone_leaving_and_a_restart(
    database_url: str,
    migrated: asyncpg.Connection,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    problem_id = await problems_repo.create(
        migrated,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=ADD,
        tests=TESTS,
        created_by_sub=None,
        created_by_name=None,
    )
    session = await sessions_repo.create(migrated, problem_id)
    wrong = f"{ADD.line}\n    return a * b\n"
    right = f"{ADD.line}\n    return a + b\n"

    # FR-27 scenario: Ada and Linus join, run a failing then a passing solution.
    _restart(monkeypatch)
    with TestClient(create_app(_settings(database_url))) as client:
        with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_ws:
            ada_ws.receive_json()  # welcome
            ada_doc = pycrdt.Doc()
            _sync_client(ada_ws, ada_doc)

            with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as linus_ws:
                linus_ws.receive_json()  # welcome
                ada_ws.receive_json()  # presence broadcast from Linus joining
                linus_doc = pycrdt.Doc()
                _sync_client(linus_ws, linus_doc)

                _set_code(ada_ws, ada_doc, problem_id, wrong)
                pycrdt.handle_sync_message(linus_ws.receive_bytes()[1:], linus_doc)
                first = _run(ada_ws, linus_ws)
                assert first["accepted"] is False

                frozen_clock.advance(timedelta(seconds=10))
                _set_code(linus_ws, linus_doc, problem_id, right)
                pycrdt.handle_sync_message(ada_ws.receive_bytes()[1:], ada_doc)
                second = _run(linus_ws, ada_ws)
                assert second["accepted"] is True

    # Everyone has left and the app is gone; a fresh instance starts on the same DB.
    _restart(monkeypatch)
    with TestClient(create_app(_settings(database_url))):
        runs = await migrated.fetch(
            "select id, code, status from run where session_id = $1 order by started_at",
            session.id,
        )
        assert [(r["code"], r["status"]) for r in runs] == [(wrong, "done"), (right, "done")]
        for run_row, outcomes in zip(
            runs, (["wrong_answer", "wrong_answer"], ["passed", "passed"]), strict=True
        ):
            results = await migrated.fetch(
                "select outcome from run_result where run_id = $1 order by test_position",
                run_row["id"],
            )
            assert [r["outcome"] for r in results] == outcomes

        accepted = await migrated.fetchval(
            "select accepted from session_problem where session_id = $1 and problem_id = $2",
            session.id,
            problem_id,
        )
        assert accepted is True

        names = await migrated.fetch(
            "select display_name, left_at from participant where session_id = $1", session.id
        )
        assert sorted(r["display_name"] for r in names) == ["Ada", "Linus"]
        assert all(r["left_at"] is not None for r in names)

        current = await sessions_repo.get_by_invite(migrated, session.invite_id)
        assert current is not None
        assert current.current_problem_id == problem_id
        replayed = await collab.load(migrated, session.id)
        assert replayed.get_code(str(problem_id)) == right

    # FR-28: 29 days later, someone opens the invite link on another fresh instance.
    frozen_clock.advance(timedelta(days=29))
    _restart(monkeypatch)
    with TestClient(create_app(_settings(database_url))) as client:
        with client.websocket_connect(_ws_url(session.invite_id, "Grace")) as ws:
            welcome = ws.receive_json()
            doc = pycrdt.Doc()
            _sync_client(ws, doc)

    assert welcome["type"] == "welcome"
    assert welcome["current_problem"]["id"] == str(problem_id)
    progress = welcome["problems"][str(problem_id)]
    assert progress["accepted"] is True
    assert progress["last_run"]["accepted"] is True
    assert [r["outcome"] for r in progress["last_run"]["results"]] == ["passed", "passed"]
    assert str(_code_text(doc, problem_id)) == right
    assert "return a + b" in str(_code_text(doc, problem_id))
