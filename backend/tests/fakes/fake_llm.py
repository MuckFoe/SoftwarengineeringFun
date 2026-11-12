"""A fake OpenAI-compatible model server (Ollama-shaped) for tests (020).

The user's model is a service this project doesn't run or control, so it may be faked
(constitution rule 4). A real HTTP server on a local socket (stdlib `ThreadingHTTPServer`,
no dependency), so the backend's real `httpx` path, timeouts and connection refusal are
exercised.

Endpoints:
  POST /v1/chat/completions  {"choices":[{"message":{"role":"assistant","content": ...}}]}
  GET  /api/ps               {"models":[{"name": M, "model": M}]} while loaded,
                             {"models":[]} while cold

What a completion answers, first match wins:
  1. a reply queued with `reply_with(*texts)`, in order;
  2. a note directive found in the last user message:
       fake:slow      sleeps `slow_seconds` (10), then a default hint
       fake:error     500
       fake:solution  a full `def` of the function named in the prompt's signature
       fake:markup    `MARKUP_REPLY`
       fake:cold      sleeps `cold_seconds` (about 2), then a default hint
  3. otherwise a safe one-step hint cycling through `DEFAULT_HINTS`, so two in a row differ.
`fail_with`, `garbage` and `delay` apply before any of that.

Controls: `reply_with(*texts)`, `fail_with(status)`, `delay(seconds)`, `garbage()` (a 200
with no `choices`), `set_cold(bool)`, `ps_fail_with(status)`, `cold_once()`,
`refuse_connections()`, `accept_connections()`, `reset()`. Every request is recorded in
`requests` (path, lower-cased headers, JSON body).

With `control_port` set, a second server (on its own port, so it stays reachable while the
API refuses connections) exposes some controls over HTTP for the E2E stack:
  GET  /health     200 "ok"
  GET  /requests   the recorded requests as JSON: [{path, headers, body}]
  POST /reset      reset()                                          204
  POST /cold       cold_once(): the next single /api/ps reports cold  204
Control traffic is not recorded.

Pytest uses it through the `fake_llm` fixture in `tests/conftest.py`. It also runs on its
own for the E2E stack:
  python -m tests.fakes.fake_llm --host 0.0.0.0 --port 8080 --control-port 8081
"""

import argparse
import json
import re
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

DEFAULT_MODEL = "fake-model"
DEFAULT_HINTS: tuple[str, ...] = (
    "Start by handling the empty input before the main loop.",
    "Check what your function returns when the loop never runs.",
    "Try tracing your code by hand with the smallest example that fails.",
)
MARKUP_REPLY = "<img src=x onerror=alert(1)> try the empty case"

_POLL_S = 0.05  # serve_forever poll interval: shutdown (every fixture teardown) waits up to this
_SIGNATURE = re.compile(r"def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)")


@dataclass(frozen=True)
class RecordedRequest:
    path: str
    headers: dict[str, str]  # names lower-cased
    body: Any  # the parsed JSON body; None when there was none or it was not JSON


class FakeLlm:
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 0,
        control_port: int | None = None,
        model: str = DEFAULT_MODEL,
        slow_seconds: float = 10.0,
        cold_seconds: float = 2.0,
    ):
        self._host = host
        self._port = port
        self._control_port = control_port
        self.model = model
        self.slow_seconds = slow_seconds
        self.cold_seconds = cold_seconds
        self._control: ThreadingHTTPServer | None = None
        self._lock = threading.Lock()
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._requests: list[RecordedRequest] = []
        self._replies: list[str] = []
        self._fail_status: int | None = None
        self._delay_s = 0.0
        self._garbage = False
        self._cold = False
        self._cold_once = False
        self._ps_fail_status: int | None = None
        self._next_default = 0

    # -- lifecycle -------------------------------------------------------------------

    def start(self) -> "FakeLlm":
        self._serve()
        if self._control_port is not None:
            control = ThreadingHTTPServer((self._host, self._control_port), _control_for(self))
            control.daemon_threads = True
            self._control_port = control.server_address[1]
            self._control = control
            threading.Thread(target=control.serve_forever, args=(_POLL_S,), daemon=True).start()
        return self

    def stop(self) -> None:
        self._shutdown()
        if self._control is not None:
            self._control.shutdown()
            self._control.server_close()
            self._control = None

    def _serve(self) -> None:
        server = ThreadingHTTPServer((self._host, self._port), _handler_for(self))
        server.daemon_threads = True
        self._port = server.server_address[1]  # pin the port so a restart reuses it
        self._server = server
        self._thread = threading.Thread(target=server.serve_forever, args=(_POLL_S,), daemon=True)
        self._thread.start()

    def _shutdown(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    @property
    def root_url(self) -> str:
        """Ollama's root, where `/api/ps` lives."""
        return f"http://{self._local_host}:{self._port}"

    @property
    def base_url(self) -> str:
        """The OpenAI-compatible base, including `/v1`, as `HINTS_LLM_BASE_URL` takes it."""
        return f"{self.root_url}/v1"

    @property
    def control_url(self) -> str:
        if self._control is None:
            raise RuntimeError("started without a control_port")
        return f"http://{self._local_host}:{self._control_port}"

    @property
    def has_control(self) -> bool:
        return self._control is not None

    @property
    def _local_host(self) -> str:
        return "127.0.0.1" if self._host in ("0.0.0.0", "") else self._host  # noqa: S104

    # -- controls --------------------------------------------------------------------

    def reply_with(self, *texts: str) -> None:
        """Queue completion contents, served in order before any directive or default."""
        with self._lock:
            self._replies.extend(texts)

    def fail_with(self, status: int = 500) -> None:
        with self._lock:
            self._fail_status = status

    def delay(self, seconds: float) -> None:
        with self._lock:
            self._delay_s = seconds

    def garbage(self) -> None:
        """Completions answer 200 with a JSON body that has no `choices`."""
        with self._lock:
            self._garbage = True

    def set_cold(self, cold: bool) -> None:
        with self._lock:
            self._cold = cold

    def cold_once(self) -> None:
        """The next single `/api/ps` call reports cold, then the fake is loaded again."""
        with self._lock:
            self._cold_once = True

    def ps_fail_with(self, status: int = 500) -> None:
        with self._lock:
            self._ps_fail_status = status

    def refuse_connections(self) -> None:
        """Close the listening socket: connections are refused until `accept_connections()`
        or `reset()`."""
        self._shutdown()

    def accept_connections(self) -> None:
        """Listen again after `refuse_connections()`, same port; recordings are kept."""
        if self._server is None:
            self._serve()

    def reset(self) -> None:
        """Answer normally again, on the same port, loaded, nothing queued or recorded."""
        with self._lock:
            self._replies.clear()
            self._fail_status = None
            self._delay_s = 0.0
            self._garbage = False
            self._cold = False
            self._cold_once = False
            self._ps_fail_status = None
            self._next_default = 0
            self._requests.clear()
        if self._server is None:
            self._serve()

    @property
    def requests(self) -> list[RecordedRequest]:
        with self._lock:
            return list(self._requests)

    # -- behaviour -------------------------------------------------------------------

    def _record(self, request: RecordedRequest) -> None:
        with self._lock:
            self._requests.append(request)

    def _ps(self) -> tuple[int, dict[str, Any]]:
        with self._lock:
            if self._ps_fail_status is not None:
                return self._ps_fail_status, {"error": "fake failure"}
            cold = self._cold or self._cold_once
            self._cold_once = False
        if cold:
            return 200, {"models": []}
        return 200, {"models": [{"name": self.model, "model": self.model}]}

    def _completion(self, body: Any) -> tuple[int, dict[str, Any]]:
        """The status and JSON to answer one completion with; sleeps as configured."""
        with self._lock:
            fail_status, delay_s, garbage = self._fail_status, self._delay_s, self._garbage
            queued = self._replies.pop(0) if self._replies else None
        if delay_s:
            time.sleep(delay_s)
        if fail_status is not None:
            return fail_status, {"error": {"message": "fake failure"}}
        if garbage:
            return 200, {"object": "chat.completion", "garbage": True}
        if queued is not None:
            return 200, _choice(queued)
        prompt = _last_user_message(body)
        if "fake:error" in prompt:
            return 500, {"error": {"message": "fake:error"}}
        if "fake:solution" in prompt:
            return 200, _choice(_solution_for(prompt))
        if "fake:markup" in prompt:
            return 200, _choice(MARKUP_REPLY)
        if "fake:slow" in prompt:
            time.sleep(self.slow_seconds)
        elif "fake:cold" in prompt:
            time.sleep(self.cold_seconds)
        return 200, _choice(self._next_default_hint())

    def _next_default_hint(self) -> str:
        with self._lock:
            text = DEFAULT_HINTS[self._next_default % len(DEFAULT_HINTS)]
            self._next_default += 1
        return text


def _choice(content: str) -> dict[str, Any]:
    return {
        "object": "chat.completion",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": content}},
        ],
    }


def _last_user_message(body: Any) -> str:
    messages = body.get("messages") if isinstance(body, dict) else None
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            content = message.get("content")
            return content if isinstance(content, str) else ""
    return ""


def _solution_for(prompt: str) -> str:
    """A full definition of the function whose signature the prompt names."""
    match = _SIGNATURE.search(prompt)
    name, params = (match.group(1), match.group(2)) if match else ("solution", "")
    first = params.split(",")[0].split(":")[0].split("=")[0].strip()
    result = first or "None"
    return f"def {name}({params}):\n    result = {result}\n    return result"


def _handler_for(fake: FakeLlm) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            pass  # keep test output quiet

        def _take(self) -> str:
            path = urlsplit(self.path).path
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                body = json.loads(raw) if raw else None
            except ValueError:
                body = None
            headers = {k.lower(): v for k, v in self.headers.items()}
            fake._record(RecordedRequest(path=path, headers=headers, body=body))
            self._body = body
            return path

        def do_GET(self) -> None:  # noqa: N802
            path = self._take()
            if path == "/api/ps":
                self._json(*fake._ps())
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            path = self._take()
            if path == "/v1/chat/completions":
                self._json(*fake._completion(self._body))
            else:
                self._json(404, {"error": "not found"})

        def _json(self, status: int, body: dict[str, Any]) -> None:
            payload = json.dumps(body).encode()
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the client gave up (its timeout); nothing to answer

    return Handler


def _control_for(fake: FakeLlm) -> type[BaseHTTPRequestHandler]:
    actions = {"/reset": fake.reset, "/cold": fake.cold_once}

    class Control(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            pass

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._send(200, "text/plain", b"ok")
            elif self.path == "/requests":
                body = [
                    {"path": r.path, "headers": r.headers, "body": r.body} for r in fake.requests
                ]
                self._send(200, "application/json", json.dumps(body).encode())
            else:
                self._send(404, "text/plain", b"not found")

        def do_POST(self) -> None:  # noqa: N802
            action = actions.get(self.path)
            if action is None:
                self._send(404, "text/plain", b"not found")
                return
            action()
            self.send_response(204)
            self.end_headers()

        def _send(self, status: int, content_type: str, payload: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return Control


def main() -> None:
    parser = argparse.ArgumentParser(description="Fake OpenAI-compatible model for tests")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--control-port", type=int, default=None, help="HTTP control port")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="model name /api/ps lists")
    args = parser.parse_args()
    fake = FakeLlm(args.host, args.port, args.control_port, args.model).start()
    control = f", control on {fake.control_url}" if fake.has_control else ""
    print(f"fake LLM on {fake.base_url}{control}", flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        fake.stop()


if __name__ == "__main__":
    main()
