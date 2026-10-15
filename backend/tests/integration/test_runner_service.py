"""Task 10: the runner service (`POST /execute`), plan "Runner contract" and run pipeline step 3.

Covers FR-24, FR-25 and NFR-2 through the runner, plus its infrastructure-failure path.

Most tests call the `runner` from `docker-compose.test.yml` (RUNNER_URL, default
http://127.0.0.1:58080). Tests that need a different environment (Docker unreachable,
a short outer timeout) start `runner/service.py` directly on the host.
"""

import json
import os
import socket
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
SERVICE = REPO / "runner" / "service.py"
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "collab-sandbox:test")
RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")
CONTAINER_LABEL = "collab-coding.runner"
OUTER_TIMEOUT_S = 20


@pytest.fixture(scope="module")
def sandbox_image() -> str:
    subprocess.run(  # noqa: S603
        ["docker", "build", "-q", "-t", SANDBOX_IMAGE, str(REPO / "sandbox")],  # noqa: S607
        check=True,
        capture_output=True,
        timeout=300,
    )
    return SANDBOX_IMAGE


@pytest.fixture(scope="module")
def runner_url(sandbox_image: str) -> str:
    try:
        urllib.request.urlopen(f"{RUNNER_URL}/health", timeout=2).close()  # noqa: S310
    except OSError:
        pytest.fail(
            f"runner not reachable at {RUNNER_URL}; start it with "
            "`docker compose -f docker-compose.test.yml up -d --wait runner`",
            pytrace=False,
        )
    return RUNNER_URL


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def _local_runner(**env: str) -> Iterator[str]:
    port = _free_port()
    proc = subprocess.Popen(  # noqa: S603
        [sys.executable, "-I", str(SERVICE)],
        env={
            **os.environ,
            "RUNNER_HOST": "127.0.0.1",
            "RUNNER_PORT": str(port),
            "SANDBOX_IMAGE": SANDBOX_IMAGE,
            **env,
        },
    )
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                urllib.request.urlopen(f"{url}/health", timeout=1).close()  # noqa: S310
                break
            except OSError:
                if proc.poll() is not None or time.monotonic() > deadline:
                    pytest.fail("local runner did not start", pytrace=False)
                time.sleep(0.1)
        yield url
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def execute(url: str, code: str, function_name: str, cases: list[list]) -> tuple[int, dict]:
    body = json.dumps(
        {"code": textwrap.dedent(code), "function_name": function_name, "cases": cases}
    ).encode()
    request = urllib.request.Request(  # noqa: S310
        f"{url}/execute", data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=OUTER_TIMEOUT_S + 10) as resp:  # noqa: S310
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        return exc.code, json.loads(raw) if raw else {}


def runner_containers() -> list[str]:
    out = subprocess.run(  # noqa: S603
        ["docker", "ps", "-a", "-q", "--filter", f"label={CONTAINER_LABEL}"],  # noqa: S607
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return out.split()


# --- contract ----------------------------------------------------------------


def test_contract_returns_one_result_per_case_in_order(runner_url):
    status, body = execute(
        runner_url, "def mul(a, b):\n    return a * b\n", "mul", [[2, 3], [4, 5]]
    )
    assert status == 200
    assert body == {"cases": [{"status": "ok", "value": 6}, {"status": "ok", "value": 20}]}


def test_contract_exception_gives_error(runner_url):
    status, body = execute(runner_url, "def f():\n    raise ValueError('bad')\n", "f", [[]])
    assert status == 200
    [case] = body["cases"]
    assert case["status"] == "error"
    assert case["error_message"] == "bad"
    assert "ValueError: bad" in case["traceback"]


def test_contract_malformed_request_is_400(runner_url):
    status, _ = execute(runner_url, "def f():\n    return 1\n", "f", "not a list")  # type: ignore[arg-type]
    assert status == 400


# --- FR-24 -------------------------------------------------------------------


def test_fr24_infinite_loop_gives_timeout_within_outer_limit(runner_url):
    start = time.monotonic()
    status, body = execute(runner_url, "def f():\n    while True:\n        pass\n", "f", [[]])
    elapsed = time.monotonic() - start
    assert status == 200
    assert body == {"cases": [{"status": "timeout"}]}
    assert elapsed < OUTER_TIMEOUT_S


def test_fr24_outer_timeout_stops_container_and_reports_timeout(sandbox_image):
    # Three looping cases need ~9 s in the harness; a 4 s outer limit must cut them off.
    with _local_runner(RUNNER_TIMEOUT_S="4") as url:
        start = time.monotonic()
        status, body = execute(url, "def f():\n    while True:\n        pass\n", "f", [[], [], []])
        elapsed = time.monotonic() - start
        assert status == 200
        assert body == {"cases": [{"status": "timeout"}] * 3}
        assert elapsed < 8
        assert runner_containers() == []


# --- FR-25 -------------------------------------------------------------------


def test_fr25_opening_a_socket_gives_error(runner_url):
    code = """
    import socket

    def f():
        s = socket.create_connection(("1.1.1.1", 53), timeout=1)
        s.close()
        return "escaped"
    """
    status, body = execute(runner_url, code, "f", [[]])
    assert status == 200
    [case] = body["cases"]
    assert case["status"] == "error", case


# --- NFR-2 -------------------------------------------------------------------


def test_nfr2_container_is_gone_after_the_call(runner_url):
    status, body = execute(runner_url, "def f():\n    return 1\n", "f", [[]])
    assert status == 200
    assert body == {"cases": [{"status": "ok", "value": 1}]}
    assert runner_containers() == []


def test_nfr2_container_is_gone_after_a_timeout(runner_url):
    status, _ = execute(runner_url, "def f():\n    while True:\n        pass\n", "f", [[]])
    assert status == 200
    assert runner_containers() == []


# --- infrastructure failure --------------------------------------------------


def test_docker_unreachable_returns_503(sandbox_image):
    with _local_runner(DOCKER_HOST="unix:///nonexistent/docker.sock") as url:
        status, _ = execute(url, "def f():\n    return 1\n", "f", [[]])
        assert status == 503


def test_missing_sandbox_image_returns_503(sandbox_image):
    with _local_runner(SANDBOX_IMAGE="collab-sandbox:does-not-exist") as url:
        status, _ = execute(url, "def f():\n    return 1\n", "f", [[]])
        assert status == 503
