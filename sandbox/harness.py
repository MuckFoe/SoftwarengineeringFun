"""Sandbox harness: runs one solution against a list of argument cases.

Reads `{code, function_name, cases: [[arg, ...], ...]}` as JSON on stdin and writes one
JSON line per case, in order, to stdout:
`{status: "ok"|"error"|"timeout"|"memory", value?, error_message?, traceback?}`.

Each case runs in its own forked child with output discarded and rlimits applied; the
parent enforces the wall-time limit. Stdlib only; run as `python -I harness.py`.
"""

import json
import linecache
import os
import resource
import select
import signal
import sys
import time
import traceback

FILENAME = "solution.py"
WALL_LIMIT_S = 3.0
CPU_LIMIT_S = 2
MEMORY_LIMIT_B = 256 * 1024 * 1024
FILE_SIZE_LIMIT_B = 1024 * 1024
MAX_RESULT_B = 1024 * 1024

MEMORY_RESULT = b'{"status": "memory"}'


def _limit(which: int, value: int, hard: int | None = None) -> None:
    resource.setrlimit(which, (value, value if hard is None else hard))


def _encode(result: dict) -> bytes:
    return json.dumps(result, allow_nan=False).encode()


def _error(exc: BaseException) -> dict:
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == FILENAME]
    lines = ["Traceback (most recent call last):\n"]
    lines += traceback.format_list(frames)
    lines += traceback.format_exception_only(type(exc), exc)
    return {"status": "error", "error_message": str(exc), "traceback": "".join(lines)}


def _write_all(fd: int, data: bytes) -> None:
    while data:
        data = data[os.write(fd, data) :]


def _child(code: str, function_name: str, args: list, out_fd: int) -> None:
    """Runs in the forked child. Never returns."""
    try:
        devnull = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(devnull, fd)
        if os.path.isdir("/scratch"):
            os.chdir("/scratch")
        _limit(resource.RLIMIT_CPU, CPU_LIMIT_S, CPU_LIMIT_S + 1)
        _limit(resource.RLIMIT_AS, MEMORY_LIMIT_B)
        _limit(resource.RLIMIT_FSIZE, FILE_SIZE_LIMIT_B)
        _limit(resource.RLIMIT_NPROC, 0)

        lines = code.splitlines(keepends=True)
        linecache.cache[FILENAME] = (len(code), None, lines, FILENAME)
        try:
            namespace: dict = {"__name__": "solution", "__file__": FILENAME}
            exec(compile(code, FILENAME, "exec"), namespace)  # noqa: S102
            fn = namespace.get(function_name)
            if not callable(fn):
                raise NameError(f"function {function_name!r} is not defined")
            value = fn(*args)
        except MemoryError:
            _write_all(out_fd, MEMORY_RESULT)
            os._exit(0)
        except BaseException as exc:  # noqa: BLE001 - user code may raise anything
            data = _encode(_error(exc))
        else:
            try:
                data = _encode({"status": "ok", "value": value})
            except (TypeError, ValueError, RecursionError) as exc:
                data = _encode(
                    {
                        "status": "error",
                        "error_message": f"return value is not JSON-serializable: {exc}",
                        "traceback": "",
                    }
                )
        _write_all(out_fd, data)
    except MemoryError:
        try:
            _write_all(out_fd, MEMORY_RESULT)
        except OSError:
            pass
    finally:
        os._exit(0)


def run_case(code: str, function_name: str, args: list) -> dict:
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        _child(code, function_name, args, write_fd)
    os.close(write_fd)

    chunks: list[bytes] = []
    size = 0
    timed_out = False
    deadline = time.monotonic() + WALL_LIMIT_S
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            break
        ready, _, _ = select.select([read_fd], [], [], remaining)
        if not ready:
            continue
        chunk = os.read(read_fd, 65536)
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if size > MAX_RESULT_B:
            break
    os.close(read_fd)
    if timed_out or size > MAX_RESULT_B:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    _, status = os.waitpid(pid, 0)

    if timed_out:
        return {"status": "timeout"}
    if size > MAX_RESULT_B:
        return {"status": "error", "error_message": "return value is too large", "traceback": ""}
    try:
        return json.loads(b"".join(chunks))
    except ValueError:
        pass
    if os.WIFSIGNALED(status):
        sig = os.WTERMSIG(status)
        if sig == signal.SIGXCPU:
            return {"status": "timeout"}
        if sig == signal.SIGKILL:
            # Not killed by us: the CPU hard limit fires only after the wall limit,
            # so this is the kernel's out-of-memory killer.
            return {"status": "memory"}
    return {
        "status": "error",
        "error_message": "process exited without a result",
        "traceback": "",
    }


def main() -> None:
    request = json.load(sys.stdin)
    code = request["code"]
    function_name = request["function_name"]
    for args in request["cases"]:
        result = run_case(code, function_name, args)
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
