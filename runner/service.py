"""Runner service: executes one solution in a throwaway sandbox container.

`POST /execute` takes `{code: str, function_name: str, cases: [[arg, ...], ...]}` and
returns `{cases: [{status: "ok"|"error"|"timeout"|"memory", value?, error_message?,
traceback?}]}` (plan: Runner contract, run pipeline step 3). Infrastructure failure
returns 503, as does waiting too long for a sandbox slot (`{"error": "busy"}`).
`GET /health` returns 200.

`POST /execute-stream` takes `{code: str, stdin: str}`, runs the code as a program in the same
sandbox limits and answers with chunked NDJSON: `{"s": "out"|"err", "b": <base64>}` per chunk
as bytes arrive, then `{"end": "exited", "code": n}` or `{"end": "time_limit"}`. A client that
closes the connection gets the container removed.

The runner knows nothing about problems, sessions or expected values. Stdlib and the
`docker` CLI only.

Environment:
  SANDBOX_IMAGE     sandbox image to run (required)
  SANDBOX_RUNTIME   container runtime, e.g. `runsc` for gVisor; empty for Docker's default
  RUNNER_TIMEOUT_S  outer timeout per call in seconds (default 20)
  SANDBOX_MAX_CONCURRENT     sandboxes allowed at once; 0 means unlimited (default 0)
  SANDBOX_SLOT_WAIT_SECONDS  how long a call waits for a free slot (default 10)
  RUNNER_HOST       listen address (default 0.0.0.0)
  RUNNER_PORT       listen port (default 8080)
"""

import base64
import json
import os
import queue
import select
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONTAINER_LABEL = "collab-coding.runner"
MAX_REQUEST_B = 1024 * 1024
MAX_OUTPUT_B = 64 * 1024 * 1024
TIME_LIMIT_EXIT = 124  # the sandbox harness's exit code for the wall or CPU limit
DOCKER_RUN_FAILED = 125  # `docker run` itself failed
CHUNK_B = 16 * 1024


# Set in main() from SANDBOX_MAX_CONCURRENT; None means no cap.
_slots: threading.BoundedSemaphore | None = None
_slot_wait_s = 10.0


class InfraError(Exception):
    """The sandbox could not be run; reported as 503."""


def docker_command(name: str, image: str, runtime: str) -> list[str]:
    cmd = [
        "docker",
        "run",
        "--rm",
        "-i",
        "--name",
        name,
        "--label",
        CONTAINER_LABEL,
        "--pull",
        "never",
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
    if runtime:
        cmd += ["--runtime", runtime]
    return [*cmd, image]


def _remove_container(name: str) -> None:
    subprocess.run(  # noqa: S603
        ["docker", "rm", "-f", name],  # noqa: S607
        capture_output=True,
        timeout=30,
        check=False,
    )


def _parse_lines(stdout: bytes) -> list[dict]:
    results = []
    for line in stdout.splitlines():
        try:
            result = json.loads(line)
        except ValueError:
            break  # a line cut off by the outer timeout
        if not isinstance(result, dict) or "status" not in result:
            raise InfraError("sandbox wrote an unexpected result")
        results.append(result)
    return results


def execute(code: str, function_name: str, cases: list[list]) -> list[dict]:
    image = os.environ.get("SANDBOX_IMAGE", "")
    if not image:
        raise InfraError("SANDBOX_IMAGE is not set")
    runtime = os.environ.get("SANDBOX_RUNTIME", "")
    timeout_s = float(os.environ.get("RUNNER_TIMEOUT_S", "20"))
    name = f"collab-sandbox-{uuid.uuid4().hex}"
    payload = json.dumps({"code": code, "function_name": function_name, "cases": cases})

    try:
        proc = subprocess.run(  # noqa: S603
            docker_command(name, image, runtime),
            input=payload.encode(),
            capture_output=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        # Killing the `docker run` client does not stop the container.
        _remove_container(name)
        done = _parse_lines(exc.stdout or b"")
        return done + [{"status": "timeout"}] * (len(cases) - len(done))
    except OSError as exc:
        raise InfraError(f"cannot start docker: {exc}") from exc

    if proc.returncode != 0:
        _remove_container(name)
        stderr = proc.stderr.decode(errors="replace").strip()
        raise InfraError(f"docker run exited {proc.returncode}: {stderr[-500:]}")
    results = _parse_lines(proc.stdout)
    if len(results) != len(cases):
        raise InfraError(f"sandbox returned {len(results)} results for {len(cases)} cases")
    return results


def _pump(pipe, stream: str, events: "queue.Queue") -> None:
    """Forwards each read from `pipe` to `events` as it arrives; None marks end of stream."""
    try:
        while chunk := pipe.read1(CHUNK_B):
            events.put((stream, chunk))
    except (OSError, ValueError):
        pass
    finally:
        events.put((stream, None))


def execute_stream(code: str, stdin: str, send, client_gone) -> None:
    """Runs `code` as a program and calls `send(message)` for each output chunk and the end
    line. `client_gone()` says whether the caller disconnected. `send` is not called before the
    first byte of output or the end, so an infrastructure failure can still raise InfraError."""
    image = os.environ.get("SANDBOX_IMAGE", "")
    if not image:
        raise InfraError("SANDBOX_IMAGE is not set")
    runtime = os.environ.get("SANDBOX_RUNTIME", "")
    timeout_s = float(os.environ.get("RUNNER_TIMEOUT_S", "20"))
    name = f"collab-sandbox-{uuid.uuid4().hex}"
    payload = json.dumps({"mode": "scratch", "code": code, "stdin": stdin}).encode()
    try:
        proc = subprocess.Popen(  # noqa: S603
            docker_command(name, image, runtime),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise InfraError(f"cannot start docker: {exc}") from exc
    events: queue.Queue = queue.Queue()
    try:
        for pipe, stream in ((proc.stdout, "out"), (proc.stderr, "err")):
            threading.Thread(target=_pump, args=(pipe, stream, events), daemon=True).start()
        try:
            proc.stdin.write(payload)
            proc.stdin.close()
        except OSError:
            pass  # the container died early; its exit code tells
        deadline = time.monotonic() + timeout_s
        open_pipes = 2
        sent = False
        while open_pipes:
            if time.monotonic() > deadline:
                send({"end": "time_limit"})
                return
            try:
                stream, chunk = events.get(timeout=0.25)
            except queue.Empty:
                if client_gone():
                    return
                continue
            if chunk is None:
                open_pipes -= 1
                continue
            send({"s": stream, "b": base64.b64encode(chunk).decode()})
            sent = True
        try:
            code_n = proc.wait(timeout=max(0.0, deadline - time.monotonic()) + 1)
        except subprocess.TimeoutExpired:
            send({"end": "time_limit"})
            return
        if code_n == DOCKER_RUN_FAILED and not sent:
            raise InfraError("docker run failed")
        if code_n == TIME_LIMIT_EXIT:
            send({"end": "time_limit"})
        else:
            send({"end": "exited", "code": code_n})
    finally:
        proc.kill()
        _remove_container(name)
        proc.wait()


def _valid_request(body: object) -> bool:
    return (
        isinstance(body, dict)
        and isinstance(body.get("code"), str)
        and isinstance(body.get("function_name"), str)
        and isinstance(body.get("cases"), list)
        and all(isinstance(case, list) for case in body["cases"])
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _reply(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        if self.path == "/health":
            self._reply(200, {"status": "ok"})
        else:
            self._reply(404, {"error": "not_found"})

    def _client_gone(self) -> bool:
        readable, _, _ = select.select([self.connection], [], [], 0)
        if not readable:
            return False
        try:
            return self.connection.recv(1, 2) == b""  # MSG_PEEK
        except OSError:
            return True

    def _stream(self, body: dict) -> None:
        started = False

        def send(message: dict) -> None:
            nonlocal started
            if not started:
                started = True
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
            line = json.dumps(message).encode() + b"\n"
            self.wfile.write(f"{len(line):x}\r\n".encode() + line + b"\r\n")
            self.wfile.flush()

        try:
            execute_stream(body["code"], body["stdin"], send, self._client_gone)
            if started:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
        except InfraError as exc:
            self.log_error("infra error: %s", exc)
            if started:
                self.close_connection = True
            else:
                self._reply(503, {"error": "infra_error"})
        except OSError:
            self.close_connection = True  # the client went away mid-stream

    def do_POST(self) -> None:  # noqa: N802 - http.server naming
        if self.path not in ("/execute", "/execute-stream"):
            self._reply(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._reply(411, {"error": "length_required"})
            return
        if length > MAX_REQUEST_B:
            self._reply(413, {"error": "too_large"})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            body = None
        streaming = self.path == "/execute-stream"
        valid = (
            isinstance(body, dict)
            and isinstance(body.get("code"), str)
            and isinstance(body.get("stdin"), str)
            if streaming
            else _valid_request(body)
        )
        if not valid:
            self._reply(400, {"error": "bad_request"})
            return
        if _slots is not None and not _slots.acquire(timeout=_slot_wait_s):
            self._reply(503, {"error": "busy"})
            return
        if streaming:
            try:
                self._stream(body)
            finally:
                if _slots is not None:
                    _slots.release()
            return
        try:
            cases = execute(body["code"], body["function_name"], body["cases"])
        except InfraError as exc:
            self.log_error("infra error: %s", exc)
            self._reply(503, {"error": "infra_error"})
            return
        finally:
            if _slots is not None:
                _slots.release()
        self._reply(200, {"cases": cases})


def main() -> None:
    global _slots, _slot_wait_s  # noqa: PLW0603 - process-wide config, set once at startup
    max_concurrent = int(os.environ.get("SANDBOX_MAX_CONCURRENT", "0"))
    if max_concurrent > 0:
        _slots = threading.BoundedSemaphore(max_concurrent)
    _slot_wait_s = float(os.environ.get("SANDBOX_SLOT_WAIT_SECONDS", "10"))
    host = os.environ.get("RUNNER_HOST", "0.0.0.0")  # noqa: S104 - compose network only
    port = int(os.environ.get("RUNNER_PORT", "8080"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"runner listening on {host}:{port}", file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
