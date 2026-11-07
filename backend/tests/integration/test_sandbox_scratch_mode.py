"""Spec 011 task 2: the sandbox harness's scratch (stdin) run mode.

Covers FR-1, FR-3, FR-6, FR-7 and NFR-1 at the harness level.
"""

import json
import subprocess
import textwrap
import time

import pytest

from tests.integration.test_sandbox_harness import DOCKER_RUN, sandbox_image  # noqa: F401

TIME_LIMIT_EXIT = 124


def run_scratch(
    image: str, code: str, stdin: str = ""
) -> tuple[subprocess.CompletedProcess, float]:
    payload = json.dumps({"mode": "scratch", "code": textwrap.dedent(code), "stdin": stdin})
    start = time.monotonic()
    proc = subprocess.run(  # noqa: S603
        [*DOCKER_RUN, image],
        input=payload.encode(),
        capture_output=True,
        timeout=30,
        check=False,
    )
    return proc, time.monotonic() - start


def test_fr1_input_lines_echoed(sandbox_image):  # noqa: F811
    proc, _ = run_scratch(sandbox_image, "print(input())\nprint(input())\n", "3\n4\n")
    assert proc.returncode == 0
    assert proc.stdout.decode() == "3\n4\n"


def test_fr6_no_input_gives_eoferror_at_once(sandbox_image):  # noqa: F811
    proc, elapsed = run_scratch(sandbox_image, "input()\n", "")
    assert proc.returncode == 1
    assert b"EOFError" in proc.stderr
    assert elapsed < 2.5


def test_fr3_error_goes_to_stderr_only(sandbox_image):  # noqa: F811
    proc, _ = run_scratch(sandbox_image, 'raise ValueError("bad")\n')
    assert proc.stdout == b""
    assert b"ValueError: bad" in proc.stderr
    assert b"Traceback" in proc.stderr


def test_fr7_infinite_loop_hits_time_limit(sandbox_image):  # noqa: F811
    proc, elapsed = run_scratch(sandbox_image, "while True:\n    pass\n")
    assert proc.returncode == TIME_LIMIT_EXIT
    assert 2 <= elapsed < 8


def test_nfr1_network_fails(sandbox_image):  # noqa: F811
    code = """
        import socket
        try:
            socket.create_connection(("1.1.1.1", 80), timeout=2)
            print("connected")
        except OSError:
            print("blocked")
    """
    proc, _ = run_scratch(sandbox_image, code)
    assert proc.stdout.decode().strip() == "blocked"


def test_stdout_and_stderr_unmerged_in_order(sandbox_image):  # noqa: F811
    code = 'import sys\nprint("o")\nprint("e", file=sys.stderr)\n'
    proc, _ = run_scratch(sandbox_image, code)
    assert proc.stdout == b"o\n"
    assert proc.stderr == b"e\n"


def test_output_is_unbuffered(sandbox_image):  # noqa: F811
    # Output printed before a hang is delivered even though the run is killed.
    proc, _ = run_scratch(sandbox_image, 'print("early")\nwhile True:\n    pass\n')
    assert proc.stdout == b"early\n"
    assert proc.returncode == TIME_LIMIT_EXIT


@pytest.mark.parametrize("code", ["import sys; sys.exit(124)"])
def test_user_exit_124_not_confused_with_time_limit(sandbox_image, code):  # noqa: F811
    proc, _ = run_scratch(sandbox_image, code)
    assert proc.returncode != TIME_LIMIT_EXIT
