"""Spec 011 task 3: the runner's `POST /execute-stream` (chunked NDJSON, real sandbox).

Starts `runner/service.py` directly on the host, against the real Docker sandbox image.
"""

import base64
import http.client
import json
import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
SERVICE = REPO / "runner" / "service.py"
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "collab-sandbox:test")
CONTAINER_LABEL = "collab-coding.runner"


@pytest.fixture(scope="module")
def runner() -> Iterator[tuple[str, int]]:
    subprocess.run(  # noqa: S603
        ["docker", "build", "-q", "-t", SANDBOX_IMAGE, str(REPO / "sandbox")],  # noqa: S607
        check=True,
        capture_output=True,
        timeout=300,
    )
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
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
        yield "127.0.0.1", port
    finally:
        proc.terminate()
        proc.wait(timeout=10)


@contextmanager
def stream(runner: tuple[str, int], code: str, stdin: str = "") -> Iterator[tuple[int, Iterator]]:
    conn = http.client.HTTPConnection(*runner, timeout=60)
    conn.request(
        "POST",
        "/execute-stream",
        body=json.dumps({"code": code, "stdin": stdin}),
        headers={"Content-Type": "application/json"},
    )
    resp = conn.getresponse()

    def lines() -> Iterator[tuple[float, dict]]:
        while raw := resp.readline():
            if raw.strip():
                yield time.monotonic(), json.loads(raw)

    try:
        yield resp.status, lines()
    finally:
        conn.close()


def containers() -> list[str]:
    return subprocess.run(  # noqa: S603
        ["docker", "ps", "-q", "--filter", f"label={CONTAINER_LABEL}"],  # noqa: S607
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()


def test_first_chunk_arrives_before_the_run_ends(runner):
    code = "import time\nprint('a', flush=True)\ntime.sleep(2)\nprint('b', flush=True)\n"
    start = time.monotonic()
    with stream(runner, code) as (status, lines):
        assert status == 200
        t_a, first = next(lines)
        assert first["s"] == "out"
        assert base64.b64decode(first["b"]).startswith(b"a")
        assert t_a - start < 2  # received before the sandbox had run for 2 s
        rest = list(lines)
    assert rest[-1][1] == {"end": "exited", "code": 0}
    assert t_a < rest[-1][0]
    out = b"".join(base64.b64decode(m["b"]) for _, m in rest if m.get("s") == "out")
    assert b"b" in out


def test_stdout_stderr_stdin_and_exit_code(runner):
    code = "import sys\nsys.stderr.write('bad')\nprint(sys.stdin.read())\nsys.exit(3)\n"
    with stream(runner, code, stdin="hello") as (status, lines):
        msgs = [m for _, m in lines]
    assert status == 200
    got = {"out": b"", "err": b""}
    for m in msgs[:-1]:
        got[m["s"]] += base64.b64decode(m["b"])
    assert got["out"] == b"hello\n"
    assert got["err"] == b"bad"
    assert msgs[-1] == {"end": "exited", "code": 3}


def test_silent_loop_ends_with_time_limit(runner):
    with stream(runner, "while True:\n    pass\n") as (status, lines):
        msgs = [m for _, m in lines]
    assert status == 200
    assert msgs[-1] == {"end": "time_limit"}


def test_closing_the_connection_removes_the_container(runner):
    before = set(containers())
    conn = http.client.HTTPConnection(*runner, timeout=60)
    conn.request(
        "POST",
        "/execute-stream",
        body=json.dumps({"code": "while True:\n    print('x' * 1000, flush=True)\n", "stdin": ""}),
    )
    resp = conn.getresponse()
    resp.readline()
    assert set(containers()) - before
    conn.close()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and set(containers()) - before:
        time.sleep(0.2)
    assert not set(containers()) - before


def test_bad_request_is_400(runner):
    conn = http.client.HTTPConnection(*runner, timeout=10)
    conn.request("POST", "/execute-stream", body=json.dumps({"code": 1}))
    assert conn.getresponse().status == 400
    conn.close()
