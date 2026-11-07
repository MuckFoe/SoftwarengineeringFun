"""Spec 011 task 4: `RunSandbox` client against the real runner (host process, Docker sandbox)."""

import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.runs.runner_client import RunnerUnavailable
from app.scratch.sandbox import Exited, TimeLimit, run

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


async def collect(url: str, code: str, stdin: str = ""):
    pieces = []
    outcome = None
    async for item in run(url, code, stdin):
        if isinstance(item, tuple):
            pieces.append(item)
        else:
            outcome = item
    return pieces, outcome


async def test_first_piece_arrives_while_still_running(runner_url):
    code = "import time\nprint('a', flush=True)\ntime.sleep(2)\nprint('b', flush=True)\n"
    seen_b = False
    first_before_b = False
    start = time.monotonic()
    async for item in run(runner_url, code, ""):
        if isinstance(item, tuple):
            stream, text = item
            if not seen_b and stream == "out" and text.startswith("a"):
                first_before_b = time.monotonic() - start < 2
            if "b" in text:
                seen_b = True
    assert first_before_b
    assert seen_b


async def test_exception_goes_to_err_with_exit_1(runner_url):
    pieces, outcome = await collect(runner_url, "raise ValueError('bad')\n")
    err = "".join(t for s, t in pieces if s == "err")
    assert "ValueError: bad" in err
    assert outcome == Exited(1)


async def test_outcomes_exit_error_and_time_limit(runner_url):
    _, ok = await collect(runner_url, "print(input())\n", "hi")
    _, bad = await collect(runner_url, "raise SystemExit(1)\n")
    _, slow = await collect(runner_url, "while True:\n    pass\n")
    assert (ok, bad, slow) == (Exited(0), Exited(1), TimeLimit())


async def test_multibyte_char_written_byte_by_byte_is_not_split(runner_url):
    code = (
        "import sys, time\n"
        "for b in 'é'.encode():\n"
        "    sys.stdout.buffer.write(bytes([b])); sys.stdout.buffer.flush(); time.sleep(0.3)\n"
    )
    pieces, outcome = await collect(runner_url, code)
    out = "".join(t for s, t in pieces if s == "out")
    assert out == "é"
    assert outcome == Exited(0)


async def test_unreachable_runner_raises_runner_unavailable():
    with pytest.raises(RunnerUnavailable):
        await collect(f"http://127.0.0.1:{_free_port()}", "print(1)\n")
