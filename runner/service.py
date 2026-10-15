"""Runner service: executes one solution in a throwaway sandbox container.

`POST /execute` takes `{code: str, function_name: str, cases: [[arg, ...], ...]}` and
returns `{cases: [{status: "ok"|"error"|"timeout"|"memory", value?, error_message?,
traceback?}]}` (plan: Runner contract, run pipeline step 3). Infrastructure failure
returns 503. `GET /health` returns 200.

The runner knows nothing about problems, sessions or expected values. Stdlib and the
`docker` CLI only.

Environment:
  SANDBOX_IMAGE     sandbox image to run (required)
  SANDBOX_RUNTIME   container runtime, e.g. `runsc` for gVisor; empty for Docker's default
  RUNNER_TIMEOUT_S  outer timeout per call in seconds (default 20)
  RUNNER_HOST       listen address (default 0.0.0.0)
  RUNNER_PORT       listen port (default 8080)
"""

import json
import os
import subprocess
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONTAINER_LABEL = "collab-coding.runner"
MAX_REQUEST_B = 1024 * 1024
MAX_OUTPUT_B = 64 * 1024 * 1024


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

    def do_POST(self) -> None:  # noqa: N802 - http.server naming
        if self.path != "/execute":
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
        if not _valid_request(body):
            self._reply(400, {"error": "bad_request"})
            return
        try:
            cases = execute(body["code"], body["function_name"], body["cases"])
        except InfraError as exc:
            self.log_error("infra error: %s", exc)
            self._reply(503, {"error": "infra_error"})
            return
        self._reply(200, {"cases": cases})


def main() -> None:
    host = os.environ.get("RUNNER_HOST", "0.0.0.0")  # noqa: S104 - compose network only
    port = int(os.environ.get("RUNNER_PORT", "8080"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"runner listening on {host}:{port}", file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
