"""Spec 011 task 6: `RunManager` against real PostgreSQL and the real runner/sandbox.

FR-1, FR-2, FR-4, FR-7..FR-10, NFR-3, NFR-5. The recording broadcast callback is the only seam.
"""

import asyncio
import os
import socket
import subprocess
import sys
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db
from app.scratch import repo
from app.scratch.manager import Refused, RunManager, Started
from app.scratch.output import OUTPUT_LIMIT_B

REPO = Path(__file__).resolve().parents[3]
SERVICE = REPO / "runner" / "service.py"
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "collab-sandbox:test")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def runner_url() -> Iterator[str]:
    subprocess.run(  # noqa: S603
        ["docker", "build", "-q", "-t", SANDBOX_IMAGE, str(REPO / "sandbox")],  # noqa: S607
        check=True,
        capture_output=True,
        timeout=300,
    )
    port = _free_port()
    proc = subprocess.Popen(  # noqa: S603
        [sys.executable, "-I", str(SERVICE)],
        env={
            **os.environ,
            "RUNNER_HOST": "127.0.0.1",
            "RUNNER_PORT": str(port),
            "SANDBOX_IMAGE": SANDBOX_IMAGE,
        },
    )
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                socket.create_connection(("127.0.0.1", port), timeout=1).close()
                break
            except OSError:
                if proc.poll() is not None or time.monotonic() > deadline:
                    pytest.fail("local runner did not start", pytrace=False)
                time.sleep(0.1)
        yield f"http://127.0.0.1:{port}"
    finally:
        proc.terminate()
        proc.wait(timeout=10)


@pytest.fixture
async def pool(database_url: str, db: asyncpg.Connection) -> AsyncIterator[asyncpg.Pool]:
    await app_db.migrate(db)
    p = await asyncpg.create_pool(database_url, min_size=1, max_size=6)
    try:
        yield p
    finally:
        await p.close()


class Harness:
    def __init__(self, pool: asyncpg.Pool, runner_url: str) -> None:
        self.codes: dict[uuid.UUID, str] = {}
        self.sent: list[tuple[float, uuid.UUID, dict]] = []
        self.manager = RunManager(pool, runner_url, self._broadcast, self.codes.__getitem__)
        self.pool = pool

    async def _broadcast(self, session_id: uuid.UUID, message: dict) -> None:
        self.sent.append((time.monotonic(), session_id, message))

    async def session(self, code: str) -> uuid.UUID:
        async with self.pool.acquire() as conn:
            problem = await conn.fetchval("select id from problem limit 1")
            if problem is None:
                problem = await conn.fetchval(
                    "insert into problem (title, description, signature, function_name, params, "
                    "return_type) values ('t', 'd', 's', 'f', '[]', 'int') returning id"
                )
            sid = await conn.fetchval(
                "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
                uuid.uuid4().hex,
                problem,
            )
        self.codes[sid] = code
        return sid

    def of(self, sid: uuid.UUID, kind: str) -> list[dict]:
        return [m for _, s, m in self.sent if s == sid and m["type"] == kind]


@pytest.fixture
def h(pool: asyncpg.Pool, runner_url: str) -> Harness:
    return Harness(pool, runner_url)


def _text(run, stream: str | None = None) -> str:
    return "".join(s["t"] for s in run.output if stream in (None, s["s"]))


async def test_input_twice_finished(h: Harness):
    sid = await h.session("print(input())\nprint(input())\n")
    assert isinstance(await h.manager.start(sid, "A", "3\n4\n"), Started)
    await h.manager.join(sid)
    run = await h.manager.snapshot(sid)
    assert run.status == "finished"
    assert _text(run) == "3\n4\n"
    assert run.started_by == "A"
    assert h.of(sid, "scratch_run_started")[0]["run"]["status"] == "running"
    assert h.of(sid, "scratch_run_end")[0] == {
        "type": "scratch_run_end",
        "status": "finished",
        "exit_code": 0,
    }


async def test_statuses_finished_error_time_limit(h: Harness):
    got = []
    for code in ("print(1)\n", "raise ValueError('bad')\n", "while True:\n    pass\n"):
        sid = await h.session(code)
        await h.manager.start(sid, "A", "")
        await h.manager.join(sid)
        run = await h.manager.snapshot(sid)
        got.append(run.status)
        if run.status == "error":
            assert "ValueError: bad" in _text(run, "err")
    assert got == ["finished", "error", "time_limit"]


async def test_output_limit_exactly_64kb(h: Harness):
    sid = await h.session("while True:\n    print('x' * 1000)\n")
    began = time.monotonic()
    await h.manager.start(sid, "A", "")
    await h.manager.join(sid)
    run = await h.manager.snapshot(sid)
    assert run.status == "output_limit"
    assert len(_text(run).encode()) == OUTPUT_LIMIT_B
    assert run.seq == OUTPUT_LIMIT_B
    assert time.monotonic() - began < 8  # well before the time limit


async def test_new_run_replaces_old(h: Harness):
    sid = await h.session("print('old')\n")
    await h.manager.start(sid, "A", "")
    await h.manager.join(sid)
    h.codes[sid] = "print('new')\n"
    await h.manager.start(sid, "A", "")
    await h.manager.join(sid)
    assert _text(await h.manager.snapshot(sid)) == "new\n"


async def test_refused_while_running_and_double_start(h: Harness):
    sid = await h.session("import time\nprint('a', flush=True)\ntime.sleep(2)\nprint('b')\n")
    first, second = await asyncio.gather(
        h.manager.start(sid, "A", ""), h.manager.start(sid, "B", "")
    )
    results = [first, second]
    assert sum(isinstance(r, Started) for r in results) == 1
    refused = next(r for r in results if isinstance(r, Refused))
    winner = "A" if isinstance(first, Started) else "B"
    assert refused.by == winner
    await h.manager.join(sid)
    assert _text(await h.manager.snapshot(sid)) == "a\nb\n"
    assert len(h.of(sid, "scratch_run_started")) == 1
    assert isinstance(await h.manager.start(sid, "B", ""), Started)
    await h.manager.join(sid)


async def test_snapshot_mid_run_and_seq_continuity(h: Harness):
    sid = await h.session("import time\nprint('a', flush=True)\ntime.sleep(2)\nprint('b')\n")
    await h.manager.start(sid, "A", "")
    for _ in range(100):
        snap = await h.manager.snapshot(sid)
        if snap.seq > 0:
            break
        await asyncio.sleep(0.1)
    assert snap.status == "running"
    assert _text(snap) == "a\n"
    assert snap.seq == 2
    await h.manager.join(sid)
    later = [m for m in h.of(sid, "scratch_run_output") if m["seq"] >= snap.seq]
    assert later[0]["seq"] == snap.seq
    assert "".join(m["t"] for m in later) == "b\n"


async def test_batching_first_piece_immediate_and_rate_limited(h: Harness):
    sid = await h.session("import time\ntime.sleep(1)\nprint('a', flush=True)\n")
    began = time.monotonic()
    await h.manager.start(sid, "A", "")
    await h.manager.join(sid)
    first = next(t for t, s, m in h.sent if s == sid and m["type"] == "scratch_run_output")
    assert first - began < 3  # delivered without waiting for a further tick

    sid = await h.session("for i in range(5000):\n    print(i)\n")
    await h.manager.start(sid, "A", "")
    await h.manager.join(sid)
    times = [t for t, s, m in h.sent if s == sid and m["type"] == "scratch_run_output"]
    assert times
    assert all(b - a >= 0.09 for a, b in zip(times, times[1:], strict=False))
    msgs = h.of(sid, "scratch_run_output")
    assert "".join(m["t"] for m in msgs) == "".join(f"{i}\n" for i in range(5000))
    seq = 0
    for m in msgs:
        assert m["seq"] == seq
        seq += len(m["t"].encode())


async def test_runner_failure_ends_error(pool: asyncpg.Pool):
    mgr_h = Harness(pool, "http://127.0.0.1:1")
    sid = await mgr_h.session("print(1)\n")
    await mgr_h.manager.start(sid, "A", "")
    await mgr_h.manager.join(sid)
    run = await mgr_h.manager.snapshot(sid)
    assert run.status == "error"
    assert _text(run, "err")


async def test_reconcile_after_restart(h: Harness):
    sid = await h.session("print(1)\n")
    async with h.pool.acquire() as conn:
        await repo.claim(conn, sid, "A", "")
    await h.manager.reconcile_after_restart()
    run = await h.manager.snapshot(sid)
    assert run.status == "interrupted"
    assert isinstance(await h.manager.start(sid, "B", ""), Started)
    await h.manager.join(sid)
