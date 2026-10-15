"""Task 3: the sandbox image and harness, run with the plan's `docker run` flags.

Covers FR-22, FR-24, FR-25 and NFR-2 at the harness level.
"""

import json
import subprocess
import textwrap
from pathlib import Path

import pytest

SANDBOX_DIR = Path(__file__).resolve().parents[3] / "sandbox"
IMAGE = "collab-sandbox:test"

# The plan's flags (Run pipeline, step 3). `--runtime runsc` is optional and omitted here.
DOCKER_RUN = [
    "docker",
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/scratch:size=16m,mode=1777",
    "--memory",
    "256m",
    "--memory-swap",
    "256m",
    "--pids-limit",
    "64",
    "--cpus",
    "1",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "65534:65534",
]

OUTER_TIMEOUT_S = 20


@pytest.fixture(scope="module")
def sandbox_image() -> str:
    subprocess.run(  # noqa: S603
        ["docker", "build", "-q", "-t", IMAGE, str(SANDBOX_DIR)],  # noqa: S607
        check=True,
        capture_output=True,
        timeout=300,
    )
    return IMAGE


def run_raw(image: str, code: str, function_name: str, cases: list[list]) -> tuple[str, str]:
    payload = json.dumps(
        {"code": textwrap.dedent(code), "function_name": function_name, "cases": cases}
    )
    proc = subprocess.run(  # noqa: S603
        [*DOCKER_RUN, image],
        input=payload,
        capture_output=True,
        text=True,
        timeout=OUTER_TIMEOUT_S,
    )
    assert proc.returncode == 0, proc.stderr
    return proc.stdout, proc.stderr


def run_cases(image: str, code: str, function_name: str, cases: list[list]) -> list[dict]:
    stdout, _ = run_raw(image, code, function_name, cases)
    lines = stdout.splitlines()
    assert len(lines) == len(cases), stdout
    return [json.loads(line) for line in lines]


def run_one(image: str, code: str, function_name: str = "f", args: list | None = None) -> dict:
    return run_cases(image, code, function_name, [args or []])[0]


# --- FR-22 -------------------------------------------------------------------

PRINTING_CODE = """
import sys

def mul(a, b):
    print(a)
    print("PRINTED-SENTINEL")
    print("STDERR-SENTINEL", file=sys.stderr)
    return a * b
"""


def test_fr22_returns_value_and_discards_printed_output(sandbox_image):
    stdout, stderr = run_raw(sandbox_image, PRINTING_CODE, "mul", [[2, 3]])
    results = [json.loads(line) for line in stdout.splitlines()]
    assert results == [{"status": "ok", "value": 6}]
    for text in ("PRINTED-SENTINEL", "STDERR-SENTINEL"):
        assert text not in stdout
        assert text not in stderr


def test_fr22_one_result_line_per_case_in_order(sandbox_image):
    results = run_cases(sandbox_image, PRINTING_CODE, "mul", [[2, 3], [1, 1], [4, 5]])
    assert [r["value"] for r in results] == [6, 1, 20]


def test_fr22_exception_gives_error_with_message_and_solution_only_traceback(sandbox_image):
    code = """
    def helper():
        raise ValueError("bad")

    def f():
        helper()
    """
    result = run_one(sandbox_image, code)
    assert result["status"] == "error"
    assert result["error_message"] == "bad"
    tb = result["traceback"]
    assert "ValueError: bad" in tb
    frame_lines = [line for line in tb.splitlines() if line.strip().startswith("File ")]
    assert len(frame_lines) == 2
    assert all('File "solution.py"' in line for line in frame_lines)
    assert "harness" not in tb


def test_fr22_unserializable_return_value_is_error(sandbox_image):
    result = run_one(sandbox_image, "def f():\n    return object()\n")
    assert result["status"] == "error"
    assert "value" not in result


def test_fr22_missing_function_is_error(sandbox_image):
    result = run_one(sandbox_image, "def g():\n    return 1\n")
    assert result["status"] == "error"


# --- FR-24 -------------------------------------------------------------------


def test_fr24_infinite_loop_gives_timeout(sandbox_image):
    result = run_one(sandbox_image, "def f():\n    while True:\n        pass\n")
    assert result["status"] == "timeout"


def test_fr24_sleeping_past_wall_limit_gives_timeout(sandbox_image):
    code = "import time\n\ndef f():\n    time.sleep(10)\n"
    result = run_one(sandbox_image, code)
    assert result["status"] == "timeout"


def test_fr24_unbounded_allocation_gives_memory(sandbox_image):
    code = """
    def f():
        chunks = []
        while True:
            chunks.append(bytearray(10 * 1024 * 1024))
    """
    result = run_one(sandbox_image, code)
    assert result["status"] == "memory"


def test_fr24_limits_apply_per_case(sandbox_image):
    code = """
    def f(n):
        while n:
            pass
        return "done"
    """
    results = run_cases(sandbox_image, code, "f", [[1], [0]])
    assert results[0]["status"] == "timeout"
    assert results[1] == {"status": "ok", "value": "done"}


# --- FR-25 / NFR-2 -----------------------------------------------------------


def attempt(body: str) -> str:
    """Solution code that returns "escaped" if `body` succeeds, "blocked" if it raises."""
    indented = textwrap.indent(textwrap.dedent(body).strip(), " " * 8)
    return (
        "import os, socket\n\ndef f():\n    try:\n"
        f"{indented}\n"
        "    except OSError:\n        return 'blocked'\n    return 'escaped'\n"
    )


def assert_blocked(result: dict) -> None:
    # Fails inside the case: either the code sees the failure, or the case errors.
    assert result.get("value") != "escaped", result
    assert result["status"] in ("ok", "error"), result


def test_fr25_network_connection_fails(sandbox_image):
    body = """
    s = socket.create_connection(("1.1.1.1", 53), timeout=1)
    s.close()
    """
    assert_blocked(run_one(sandbox_image, attempt(body)))


def test_fr25_writing_outside_scratch_fails(sandbox_image):
    for path in ("/tmp/x", "/sandbox/x", "/etc/x", "/x"):  # noqa: S108 - paths inside the sandbox
        body = f"open({path!r}, 'w').write('x')"
        assert_blocked(run_one(sandbox_image, attempt(body)))


def test_fr25_writing_inside_scratch_works(sandbox_image):
    code = """
    def f():
        with open("/scratch/x", "w") as fh:
            fh.write("hi")
        with open("/scratch/x") as fh:
            return fh.read()
    """
    assert run_one(sandbox_image, code) == {"status": "ok", "value": "hi"}


def test_fr25_reading_host_path_fails(sandbox_image):
    # This very test file exists on the host; it must not be visible in the sandbox.
    body = f"open({str(Path(__file__).resolve())!r}).read()"
    assert_blocked(run_one(sandbox_image, attempt(body)))


def test_fr25_os_system_fails(sandbox_image):
    body = """
    if os.system("echo hi > /scratch/pwned") != 0:
        raise OSError("system failed")
    """
    assert_blocked(run_one(sandbox_image, attempt(body)))


def test_fr25_fork_bomb_fails(sandbox_image):
    body = """
    while True:
        os.fork()
    """
    assert_blocked(run_one(sandbox_image, attempt(body)))


def test_fr25_reading_stdlib_succeeds(sandbox_image):
    # The image's stdlib lives under /usr/local (python:3.12-slim), not /usr/lib.
    code = """
    def f():
        with open("/usr/local/lib/python3.12/os.py") as fh:
            return "def makedirs" in fh.read()
    """
    assert run_one(sandbox_image, code) == {"status": "ok", "value": True}


def test_nfr2_file_size_is_capped(sandbox_image):
    body = """
    with open("/scratch/big", "wb") as fh:
        fh.write(b"x" * (2 * 1024 * 1024))
    """
    assert_blocked(run_one(sandbox_image, attempt(body)))
