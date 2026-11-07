"""Sandbox harness: runs one solution against a list of argument cases.

Reads `{code, function_name, cases: [[arg, ...], ...]}` as JSON on stdin and writes one
JSON line per case, in order, to stdout:
`{status: "ok"|"error"|"timeout"|"memory", value?, error_message?, traceback?}`.

Each case runs in a fresh interpreter (`harness.py --case`), given only that case's
arguments, with output discarded and rlimits applied; the parent enforces the wall-time
limit. A fresh process rather than a fork, so a case can't reach the other cases' arguments
(the tests' inputs) in memory, and the parent is non-dumpable, so a case can't read them
through `/proc/<ppid>/mem` either (FR-25). Stdlib only; run as `python -I harness.py`.
"""

import ctypes
import json
import linecache
import os
import resource
import select
import signal
import subprocess
import sys
import threading
import time
import traceback

FILENAME = "solution.py"
WALL_LIMIT_S = 3.0
CPU_LIMIT_S = 2
MEMORY_LIMIT_B = 256 * 1024 * 1024
FILE_SIZE_LIMIT_B = 1024 * 1024
MAX_RESULT_B = 1024 * 1024

TIME_LIMIT_EXIT = 124  # scratch mode: the wall limit (or CPU limit) ended the run
USER_EXIT_CLASH = 1  # a program's own exit 124 is reported as this, so 124 stays unambiguous

MEMORY_RESULT = b'{"status": "memory"}'
PR_SET_DUMPABLE = 4


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
    """Runs in the case process. Never returns."""
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


def _make_undumpable() -> None:
    """Makes this process's `/proc/<pid>` files (memory, fds) unreadable to the cases."""
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "prctl(PR_SET_DUMPABLE) failed")


def _case_main() -> None:
    """`harness.py --case`: reads `{code, function_name, args}` for one case on stdin."""
    request = json.load(sys.stdin)
    out_fd = os.dup(1)  # the result pipe; fd 1 itself is pointed at /dev/null
    _child(request["code"], request["function_name"], request["args"], out_fd)


def run_case(code: str, function_name: str, args: list) -> dict:
    proc = subprocess.Popen(  # noqa: S603
        [sys.executable, "-I", os.path.abspath(__file__), "--case"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    proc.stdin.write(
        json.dumps({"code": code, "function_name": function_name, "args": args}).encode()
    )
    proc.stdin.close()
    read_fd = proc.stdout.fileno()

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
    proc.stdout.close()
    if timed_out or size > MAX_RESULT_B:
        proc.kill()
    returncode = proc.wait()

    if timed_out:
        return {"status": "timeout"}
    if size > MAX_RESULT_B:
        return {"status": "error", "error_message": "return value is too large", "traceback": ""}
    try:
        return json.loads(b"".join(chunks))
    except ValueError:
        pass
    if returncode < 0:
        sig = -returncode
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


def _scratch_child(code_fd: int) -> None:
    """`harness.py --scratch <fd>`: runs the code read from `code_fd`. fd 0 is the user's input."""
    with os.fdopen(code_fd, "rb") as f:
        code = f.read().decode()
    if os.path.isdir("/scratch"):
        os.chdir("/scratch")
    _limit(resource.RLIMIT_CPU, CPU_LIMIT_S, CPU_LIMIT_S + 1)
    _limit(resource.RLIMIT_AS, MEMORY_LIMIT_B)
    _limit(resource.RLIMIT_FSIZE, FILE_SIZE_LIMIT_B)
    _limit(resource.RLIMIT_NPROC, 0)
    linecache.cache[FILENAME] = (len(code), None, code.splitlines(keepends=True), FILENAME)
    try:
        exec(compile(code, FILENAME, "exec"), {"__name__": "__main__", "__file__": FILENAME})  # noqa: S102
    except SystemExit as exc:
        sys.stdout.flush()
        os._exit(exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1))
    except BaseException as exc:  # noqa: BLE001 - user code may raise anything
        sys.stdout.flush()
        sys.stderr.write(_error(exc)["traceback"])
        sys.stderr.flush()
        os._exit(1)
    sys.stdout.flush()
    os._exit(0)


def _feed(fd: int, data: bytes) -> None:
    try:
        _write_all(fd, data)
    except OSError:
        pass  # the program exited or closed its input without reading it all
    finally:
        os.close(fd)


def run_scratch(code: str, stdin_text: str) -> int:
    """Runs `code` with `stdin_text` then EOF as its input. Its stdout and stderr are this
    process's own, unmerged and unbuffered. Returns the exit code for the container."""
    code_r, code_w = os.pipe()
    proc = subprocess.Popen(  # noqa: S603
        [sys.executable, "-I", "-u", os.path.abspath(__file__), "--scratch", str(code_r)],
        stdin=subprocess.PIPE,
        pass_fds=(code_r,),
    )
    os.close(code_r)
    threading.Thread(target=_feed, args=(code_w, code.encode()), daemon=True).start()
    threading.Thread(
        target=_feed, args=(os.dup(proc.stdin.fileno()), stdin_text.encode()), daemon=True
    ).start()
    proc.stdin.close()
    try:
        returncode = proc.wait(timeout=WALL_LIMIT_S)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        return TIME_LIMIT_EXIT
    if returncode < 0:
        return TIME_LIMIT_EXIT if -returncode == signal.SIGXCPU else 128 - returncode
    return USER_EXIT_CLASH if returncode == TIME_LIMIT_EXIT else returncode


def main() -> None:
    if sys.argv[1:2] == ["--scratch"]:
        _scratch_child(int(sys.argv[2]))
        return
    if sys.argv[1:] == ["--case"]:
        _case_main()
        return
    _make_undumpable()
    request = json.load(sys.stdin)
    if request.get("mode") == "scratch":
        sys.exit(run_scratch(request["code"], request["stdin"]))
    code = request["code"]
    function_name = request["function_name"]
    for args in request["cases"]:
        result = run_case(code, function_name, args)
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
