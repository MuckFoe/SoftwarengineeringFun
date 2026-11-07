"""Spec 011 task 7: the session channel's `scratch_run`. FR-5, FR-9, FR-10, FR-12."""

import json
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any
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


async def _session(conn: asyncpg.Connection) -> tuple[uuid.UUID, Any]:
    problem_id = await problems_repo.create(
        conn,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=NO_ARGS,
        tests=[TestInput(args=[], expected=1)],
        created_by_sub=None,
        created_by_name=None,
    )
    return problem_id, await sessions_repo.create(conn, problem_id)


def _url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _join(client: TestClient, invite: str, name: str, problem_id: uuid.UUID, snippet: str | None):
    """Context manager; returns (ws, welcome). Writes `snippet` (top-level code) if given."""
    return _Joined(client, invite, name, problem_id, snippet)


class _Joined:
    def __init__(self, client, invite, name, problem_id, snippet):
        self._cm = client.websocket_connect(_url(invite, name))
        self._problem_id = problem_id
        self._snippet = snippet

    def __enter__(self):
        self.ws = self._cm.__enter__()
        self.welcome = self.ws.receive_json()
        assert self.welcome["type"] == "welcome"
        doc = pycrdt.Doc()
        self.ws.send_bytes(pycrdt.create_sync_message(doc))
        pycrdt.handle_sync_message(self.ws.receive_bytes()[1:], doc)
        if self._snippet is not None:
            before = doc.get_state()
            text = doc.get(f"code:{self._problem_id}", type=pycrdt.Text)
            text += self._snippet
            self.ws.send_bytes(pycrdt.create_update_message(doc.get_update(before)))
        return self

    def __exit__(self, *exc):
        return self._cm.__exit__(*exc)


def _scratch_until(ws, stop: str) -> list[dict]:
    """Collects `scratch_run*` messages up to and including the one of type `stop`."""
    seen: list[dict] = []
    while True:
        message = ws.receive_json()
        if message["type"].startswith("scratch_run"):
            seen.append(message)
            if message["type"] == stop:
                return seen


SQUARE = "print(int(input()) ** 2)\n"
SLOW = "import time\nprint('a', flush=True)\ntime.sleep(2)\nprint('b')\n"


async def test_fr5_every_participant_sees_started_output_end(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, session = await _session(migrated)
    with (
        _join(client, session.invite_id, "Ada", problem_id, SQUARE) as a,
        _join(client, session.invite_id, "Linus", problem_id, None) as b,
    ):
        assert a.welcome["scratch_run"] is None
        a.ws.send_text(json.dumps({"type": "scratch_run", "input": "3\n"}))
        for joined in (a, b):
            seen = _scratch_until(joined.ws, "scratch_run_end")
            assert seen[0]["type"] == "scratch_run_started"
            assert seen[0]["run"]["started_by"] == "Ada"
            assert seen[0]["run"]["input"] == "3\n"
            outputs = [m for m in seen if m["type"] == "scratch_run_output"]
            assert "".join(m["t"] for m in outputs if m["s"] == "out") == "9\n"
            assert outputs[0]["seq"] == 0
            assert seen[-1]["status"] == "finished"
            assert seen[-1]["exit_code"] == 0


async def test_fr9_second_claim_refused_to_sender_only(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, session = await _session(migrated)
    with (
        _join(client, session.invite_id, "Ada", problem_id, SLOW) as a,
        _join(client, session.invite_id, "Linus", problem_id, None) as b,
    ):
        a.ws.send_text(json.dumps({"type": "scratch_run", "input": ""}))
        started = _scratch_until(b.ws, "scratch_run_started")
        assert started[-1]["run"]["started_by"] == "Ada"
        b.ws.send_text(json.dumps({"type": "scratch_run", "input": "x"}))
        rest = _scratch_until(b.ws, "scratch_run_refused")
        assert rest[-1] == {"type": "scratch_run_refused", "reason": "in_progress", "by": "Ada"}
        seen = _scratch_until(a.ws, "scratch_run_end")
        assert all(m["type"] != "scratch_run_refused" for m in seen)
        text = "".join(m["t"] for m in seen if m["type"] == "scratch_run_output")
        assert text == "a\nb\n"
        assert seen[-1]["status"] == "finished"


async def test_fr10_late_joiner_gets_the_finished_run(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, session = await _session(migrated)
    with _join(client, session.invite_id, "Ada", problem_id, SQUARE) as a:
        a.ws.send_text(json.dumps({"type": "scratch_run", "input": "3\n"}))
        _scratch_until(a.ws, "scratch_run_end")
        with _join(client, session.invite_id, "Cleo", problem_id, None) as c:
            run = c.welcome["scratch_run"]
            assert run["input"] == "3\n"
            assert run["output"] == [{"s": "out", "t": "9\n"}]
            assert run["status"] == "finished"
            assert run["started_by"] == "Ada"


async def test_fr10_late_joiner_mid_run_has_no_gap_or_duplicate(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, session = await _session(migrated)
    with _join(client, session.invite_id, "Ada", problem_id, SLOW) as a:
        a.ws.send_text(json.dumps({"type": "scratch_run", "input": ""}))
        first = _scratch_until(a.ws, "scratch_run_output")[-1]
        assert first["t"] == "a\n"
        with _join(client, session.invite_id, "Cleo", problem_id, None) as c:
            run = c.welcome["scratch_run"]
            assert run["status"] == "running"
            have = "".join(s["t"] for s in run["output"])
            assert have == "a\n"
            assert run["seq"] == len(have.encode())
            rest = _scratch_until(c.ws, "scratch_run_end")
            later = [m for m in rest if m["type"] == "scratch_run_output"]
            assert [m["seq"] for m in later] == [run["seq"]]
            assert have + "".join(m["t"] for m in later) == "a\nb\n"


async def test_fr12_stale_session_is_refused_and_no_run_row(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, session = await _session(migrated)
    with _join(client, session.invite_id, "Ada", problem_id, SQUARE) as a:
        await sessions_repo.set_stale(migrated, session.id)
        a.ws.send_text(json.dumps({"type": "scratch_run", "input": "3\n"}))
        seen = _scratch_until(a.ws, "scratch_run_refused")
        assert seen == [{"type": "scratch_run_refused", "reason": "stale"}]
    count = await migrated.fetchval(
        "select count(*) from session_scratch_run where session_id = $1", session.id
    )
    assert count == 0


async def test_malformed_scratch_run_is_ignored(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, session = await _session(migrated)
    with _join(client, session.invite_id, "Ada", problem_id, SQUARE) as a:
        a.ws.send_text(json.dumps({"type": "scratch_run", "input": 5}))
        a.ws.send_text(json.dumps({"type": "scratch_run"}))
        a.ws.send_text(json.dumps({"type": "scratch_run", "input": "4\n"}))
        seen = _scratch_until(a.ws, "scratch_run_end")
        assert seen[0]["run"]["input"] == "4\n"
