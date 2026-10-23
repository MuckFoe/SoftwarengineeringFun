"""Task 17: the runner client (`runs/runner_client.py`), plan "Runner" contract. FR-21."""

import os
import socket
from urllib.parse import urlsplit

import pytest

from app.runs.runner_client import CaseOutcome, RunnerUnavailable, execute

RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")


@pytest.fixture
def runner_url() -> str:
    parts = urlsplit(RUNNER_URL)
    try:
        socket.create_connection((parts.hostname, parts.port), timeout=2).close()
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


async def test_fr21_execute_against_the_real_runner_returns_ok_with_the_value(
    runner_url: str,
) -> None:
    outcomes = await execute(runner_url, "def add(a, b):\n    return a + b\n", "add", [[2, 3]])

    assert outcomes == [CaseOutcome(status="ok", value=5)]


async def test_fr21_runs_every_case_in_order(runner_url: str) -> None:
    outcomes = await execute(
        runner_url, "def mul(a, b):\n    return a * b\n", "mul", [[2, 3], [4, 5]]
    )

    assert outcomes == [CaseOutcome(status="ok", value=6), CaseOutcome(status="ok", value=20)]


async def test_runner_unavailable_when_nothing_is_listening() -> None:
    unreachable = f"http://127.0.0.1:{_free_port()}"

    with pytest.raises(RunnerUnavailable):
        await execute(unreachable, "def f():\n    return 1\n", "f", [[]])
