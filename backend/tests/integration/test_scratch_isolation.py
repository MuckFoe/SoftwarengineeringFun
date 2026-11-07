"""Spec 011 task 14: isolation, no leak, test runs unchanged. FR-1, FR-6, FR-11, NFR-1, NFR-2.

Real channel, PostgreSQL and sandbox. The needle is the real hidden tests of a seeded
problem (`reverse-words`).
"""

import json
import os
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import quote

import asyncpg
import pycrdt
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.seed import load_seed
from app.sessions import repo as sessions_repo

RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")
SEED_DIR = Path(__file__).resolve().parents[3] / "seed" / "problems"
SOLVE = "    return ' '.join(reversed(s.split()))\n"


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


async def _seeded(conn: asyncpg.Connection) -> tuple[uuid.UUID, list[str]]:
    """The seeded reverse-words problem and the distinctive strings of its hidden tests."""
    await load_seed(conn, SEED_DIR)
    problem_id = await conn.fetchval(
        "select id from problem where title = 'Reverse Word Order' and deleted_at is null"
    )
    assert problem_id is not None
    problem = await problems_repo.get_with_tests(conn, problem_id)
    needles: set[str] = set()
    for t in problem.tests:
        for value in (*t.args, t.expected):
            if isinstance(value, str) and len(value) >= 10:
                needles.add(value)
    assert len(needles) >= 4
    return problem_id, sorted(needles)


def _records(problem_tests) -> list[str]:
    """How a test would look in a file: a whole record, which plain prose never contains."""
    out: list[str] = []
    for t in problem_tests:
        a, e = json.dumps(t.args), json.dumps(t.expected)
        out += [f'"args": {a}, "expected": {e}', f'"args":{a},"expected":{e}']
    return out


class _Joined:
    def __init__(self, client: TestClient, invite: str, name: str, problem_id, snippet):
        self._cm = client.websocket_connect(f"/api/sessions/{invite}/ws?name={quote(name)}")
        self._problem_id = problem_id
        self._snippet = snippet

    def __enter__(self):
        self.ws = self._cm.__enter__()
        assert self.ws.receive_json()["type"] == "welcome"
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


def _until(ws, stop: str) -> list[dict]:
    """All JSON messages up to and including the first of type `stop` (binary skipped)."""
    seen: list[dict] = []
    while True:
        message = ws.receive_json()
        seen.append(message)
        if message["type"] == stop:
            return seen


def _scratch(ws, text: str) -> tuple[list[dict], str]:
    ws.send_text(json.dumps({"type": "scratch_run", "input": text}))
    seen = _until(ws, "scratch_run_end")
    out = "".join(m["t"] for m in seen if m["type"] == "scratch_run_output")
    return seen, out


def _test_run(ws) -> tuple[list[dict], dict]:
    ws.send_text(json.dumps({"type": "run"}))
    seen = _until(ws, "run_finished")
    return seen, seen[-1]["run"]


async def _session(conn: asyncpg.Connection, problem_id: uuid.UUID):
    return await sessions_repo.create(conn, problem_id)


async def test_fr1_scratch_output_and_test_runs_unchanged(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, _ = await _seeded(migrated)
    session = await _session(migrated, problem_id)
    # The input() lines run only when stdin has data; a test run's stdin is at EOF.
    snippet = SOLVE + ("try:\n    print(input())\n    print(input())\nexcept EOFError:\n    pass\n")
    with _Joined(client, session.invite_id, "Ada", problem_id, snippet) as a:
        _, before = _test_run(a.ws)
        assert before["accepted"] is True
        seen, out = _scratch(a.ws, "3\n4\n")
        assert out == "3\n4\n"
        assert seen[-1]["status"] == "finished"
        _, after = _test_run(a.ws)
    strip = lambda r: [  # noqa: E731
        (x["position"], x["outcome"], x["error_message"], x["traceback"]) for x in r["results"]
    ]
    assert strip(after) == strip(before)
    assert after["accepted"] is True


async def test_fr6_input_without_data_ends_error_quickly(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, _ = await _seeded(migrated)
    session = await _session(migrated, problem_id)
    with _Joined(client, session.invite_id, "Ada", problem_id, "print(input())\n") as a:
        started = time.monotonic()
        seen, out = _scratch(a.ws, "")
        elapsed = time.monotonic() - started
    assert seen[-1]["status"] == "error"
    assert "EOFError" in out
    assert elapsed < 5


async def test_fr11_test_run_prints_never_reach_the_channel(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, needles = await _seeded(migrated)
    session = await _session(migrated, problem_id)
    snippet = "    print('PRINTED', s, flush=True)\n" + SOLVE
    with (
        _Joined(client, session.invite_id, "Ada", problem_id, snippet) as a,
        _Joined(client, session.invite_id, "Linus", problem_id, None) as b,
    ):
        seen_a, run = _test_run(a.ws)
        seen_b = _until(b.ws, "run_finished")
    assert run["accepted"] is True
    for seen in (seen_a, seen_b):
        assert not [m for m in seen if m["type"].startswith("scratch_run")]
        blob = json.dumps(seen)
        assert "PRINTED" not in blob
        assert not [n for n in needles if n in blob]


async def test_nfr1_network_connection_fails(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, _ = await _seeded(migrated)
    session = await _session(migrated, problem_id)
    code = (
        "import socket\n"
        "try:\n"
        "    socket.create_connection(('1.1.1.1', 53), timeout=3).close()\n"
        "    print('CONNECTED')\n"
        "except OSError as e:\n"
        "    print('FAILED', type(e).__name__)\n"
    )
    with _Joined(client, session.invite_id, "Ada", problem_id, code) as a:
        _, out = _scratch(a.ws, "")
    assert out.startswith("FAILED"), out


async def test_nfr2_hidden_tests_are_not_findable(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id, needles = await _seeded(migrated)
    records = _records((await problems_repo.get_with_tests(migrated, problem_id)).tests)
    session = await _session(migrated, problem_id)
    # Needles arrive on stdin, so the solution file itself does not contain them.
    code = (
        "import os, sys\n"
        "lines = [l.rstrip('\\n') for l in sys.stdin if l.strip()]\n"
        "needles = [l[2:] for l in lines if l.startswith('s:')]\n"
        "records = [l[2:] for l in lines if l.startswith('r:')]\n"
        "hits, scanned = [], 0\n"
        "for k, v in os.environ.items():\n"
        "    if any(n in k or n in v for n in needles):\n"
        "        hits.append('env:' + k)\n"
        "bn = [n.encode() for n in records]\n"
        "for root, dirs, files in os.walk('/'):\n"
        "    skip = ('/proc', '/sys', '/dev')\n"
        "    dirs[:] = [d for d in dirs if os.path.join(root, d) not in skip]\n"
        "    for f in files:\n"
        "        p = os.path.join(root, f)\n"
        "        try:\n"
        "            if os.path.islink(p) or os.path.getsize(p) > 8_000_000:\n"
        "                continue\n"
        "            data = open(p, 'rb').read()\n"
        "        except OSError:\n"
        "            continue\n"
        "        scanned += 1\n"
        "        if any(n in data for n in bn) or any(n.encode() in p.encode() for n in needles):\n"
        "            hits.append(p)\n"
        "print('scanned', scanned > 0)\n"
        "print('hits', hits)\n"
    )
    with _Joined(client, session.invite_id, "Ada", problem_id, code) as a:
        seen, out = _scratch(
            a.ws, "".join(f"s:{n}\n" for n in needles) + "".join(f"r:{r}\n" for r in records)
        )
    assert seen[-1]["status"] == "finished", out
    assert "scanned True" in out
    assert "hits []" in out, out
