"""A fake GIPHY API for tests (007).

A real HTTP server on a local socket (stdlib `ThreadingHTTPServer`, no dependency), so
the backend's real `httpx` path, timeouts and connection refusal are exercised.

Endpoints, shaped like GIPHY's v1 API:
  GET /v1/gifs/search?q=...   the "cat" fixture set for q == "cat", `[]` for anything else
  GET /v1/gifs/trending       the trending fixture set
  GET /v1/gifs/{id}           any fixture by id; `GONE_ID` and unknown ids answer 404
  GET /media/{id}/{name}.gif  a tiny GIF; the `BROKEN_MEDIA_ID` item's media answer 404

The cat set includes one item rated `r` (`R_RATED_ID`), one with an empty title
(`UNTITLED_ID`) and one whose media URLs are 404 paths (`BROKEN_MEDIA_ID`). The fake does
not filter by `rating`: dropping the `r` item is the backend's job. Width and height are
strings, as GIPHY sends them.

Controls: `refuse_connections()`, `accept_connections()`, `fail_with(status)`,
`delay(seconds)`, `reset()`. Every request is recorded in `requests` (path, query,
lower-cased headers).

With `control_port` set, a second server (on its own port, so it stays reachable while the
API refuses connections) exposes some of those controls over HTTP for the E2E stack:
  GET  /health     200 "ok"
  GET  /requests   the recorded requests as JSON: [{path, query, headers}]
  POST /off        refuse_connections()                       204
  POST /on         accept_connections(), recordings are kept  204
  POST /reset      reset()                                    204
Control traffic is not recorded.

Pytest uses it through the `fake_giphy` fixture in `tests/conftest.py`. It also runs on
its own for the E2E stack:
  python -m tests.fakes.fake_giphy --host 0.0.0.0 --port 8080 --control-port 8081 \
      --media-base http://localhost:8080
"""

import argparse
import json
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qsl, urlsplit

CAT_IDS: tuple[str, ...] = (
    "cat-1",
    "cat-2",
    "cat-3",
    "cat-r",
    "cat-untitled",
    "cat-broken-media",
)
R_RATED_ID = "cat-r"
UNTITLED_ID = "cat-untitled"
BROKEN_MEDIA_ID = "cat-broken-media"
TRENDING_IDS: tuple[str, ...] = ("trend-1", "trend-2", "trend-3")
GONE_ID = "gone"

_TITLES = {
    "cat-1": "Happy cat",
    "cat-2": "Sleepy cat",
    "cat-3": "Cat dance",
    "cat-r": "Rude cat",
    "cat-untitled": "",
    "cat-broken-media": "Vanished cat",
    "trend-1": "Happy dance",
    "trend-2": "Thumbs up",
    "trend-3": "Wave",
}
_RATINGS = {"cat-r": "r", "cat-2": "pg", "cat-3": "pg-13"}  # everything else "g"

# The smallest valid GIF: 1x1, one transparent pixel.
_GIF_BYTES = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00"
    b"\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
)


@dataclass(frozen=True)
class RecordedRequest:
    path: str
    query: dict[str, str]
    query_pairs: list[tuple[str, str]]
    headers: dict[str, str]  # names lower-cased

    @property
    def url(self) -> str:
        return self.path + ("?" + "&".join(f"{k}={v}" for k, v in self.query_pairs))


class FakeGiphy:
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 0,
        media_base: str | None = None,
        control_port: int | None = None,
    ):
        self._host = host
        self._port = port
        self._media_base = media_base
        self._control_port = control_port
        self._control: ThreadingHTTPServer | None = None
        self._lock = threading.Lock()
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._requests: list[RecordedRequest] = []
        self._fail_status: int | None = None
        self._delay_s = 0.0

    # -- lifecycle -------------------------------------------------------------------

    def start(self) -> "FakeGiphy":
        self._serve()
        if self._control_port is not None:
            control = ThreadingHTTPServer((self._host, self._control_port), _control_for(self))
            control.daemon_threads = True
            self._control_port = control.server_address[1]
            self._control = control
            threading.Thread(target=control.serve_forever, daemon=True).start()
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
        self._thread = threading.Thread(target=server.serve_forever, daemon=True)
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
    def base_url(self) -> str:
        return f"http://{self._local_host}:{self._port}"

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

    @property
    def media_base(self) -> str:
        return self._media_base or self.base_url

    # -- controls --------------------------------------------------------------------

    def refuse_connections(self) -> None:
        """Close the listening socket: connections are refused until `reset()`."""
        self._shutdown()

    def accept_connections(self) -> None:
        """Listen again after `refuse_connections()`, same port; recordings are kept."""
        if self._server is None:
            self._serve()

    def fail_with(self, status: int = 500) -> None:
        with self._lock:
            self._fail_status = status

    def delay(self, seconds: float) -> None:
        with self._lock:
            self._delay_s = seconds

    def reset(self) -> None:
        """Answer normally again, on the same port, with no recorded requests."""
        with self._lock:
            self._fail_status = None
            self._delay_s = 0.0
            self._requests.clear()
        if self._server is None:
            self._serve()

    @property
    def requests(self) -> list[RecordedRequest]:
        with self._lock:
            return list(self._requests)

    # -- behaviour -------------------------------------------------------------------

    def _record(self, request: RecordedRequest) -> tuple[int | None, float]:
        with self._lock:
            self._requests.append(request)
            return self._fail_status, self._delay_s

    def item(self, gif_id: str) -> dict[str, Any]:
        def rendition(name: str, width: int, height: int) -> dict[str, str]:
            media_id = "missing" if gif_id == BROKEN_MEDIA_ID else gif_id
            url = f"{self.media_base}/media/{media_id}/{name}.gif"
            return {"url": url, "width": str(width), "height": str(height)}

        return {
            "type": "gif",
            "id": gif_id,
            "title": _TITLES[gif_id],
            "rating": _RATINGS.get(gif_id, "g"),
            "images": {
                "fixed_width": rendition("200w", 200, 150),
                "fixed_width_still": rendition("200w_s", 200, 150),
            },
        }


def _handler_for(fake: FakeGiphy) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            pass  # keep test output quiet

        def do_GET(self) -> None:  # noqa: N802
            parts = urlsplit(self.path)
            pairs = parse_qsl(parts.query, keep_blank_values=True)
            fail_status, delay_s = fake._record(
                RecordedRequest(
                    path=parts.path,
                    query=dict(pairs),
                    query_pairs=pairs,
                    headers={k.lower(): v for k, v in self.headers.items()},
                )
            )
            if delay_s:
                time.sleep(delay_s)
            if fail_status is not None:
                self._json(fail_status, {"meta": {"status": fail_status, "msg": "Error"}})
                return
            self._route(parts.path, dict(pairs))

        def _route(self, path: str, query: dict[str, str]) -> None:
            segments = path.strip("/").split("/")
            if segments[:1] == ["media"]:
                if len(segments) == 3 and segments[1] in _TITLES:
                    self._send(200, "image/gif", _GIF_BYTES)
                else:
                    self._json(404, {"meta": {"status": 404, "msg": "Not Found"}})
                return
            if segments[:2] != ["v1", "gifs"] or len(segments) != 3:
                self._json(404, {"meta": {"status": 404, "msg": "Not Found"}})
                return
            if "api_key" not in query:
                self._json(401, {"meta": {"status": 401, "msg": "No API key found"}})
                return
            what = segments[2]
            if what in ("search", "trending"):
                if what == "trending":
                    ids = TRENDING_IDS
                else:
                    ids = CAT_IDS if query.get("q", "").strip().lower() == "cat" else ()
                limit = int(query["limit"]) if query.get("limit", "").isdigit() else len(ids)
                data = [fake.item(i) for i in ids[:limit]]
                self._json(200, {"data": data, "meta": {"status": 200, "msg": "OK"}})
            elif what in _TITLES:
                self._json(200, {"data": fake.item(what), "meta": {"status": 200, "msg": "OK"}})
            else:
                self._json(404, {"meta": {"status": 404, "msg": "Not Found"}})

        def _json(self, status: int, body: dict[str, Any]) -> None:
            self._send(status, "application/json", json.dumps(body).encode())

        def _send(self, status: int, content_type: str, payload: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return Handler


def _control_for(fake: FakeGiphy) -> type[BaseHTTPRequestHandler]:
    actions = {
        "/off": fake.refuse_connections,
        "/on": fake.accept_connections,
        "/reset": fake.reset,
    }

    class Control(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            pass

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._send(200, "text/plain", b"ok")
            elif self.path == "/requests":
                body = [
                    {"path": r.path, "query": r.query, "headers": r.headers} for r in fake.requests
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
    parser = argparse.ArgumentParser(description="Fake GIPHY API for tests")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--control-port", type=int, default=None, help="HTTP control port")
    parser.add_argument("--media-base", default=None, help="host prefix for fixture media URLs")
    args = parser.parse_args()
    fake = FakeGiphy(args.host, args.port, args.media_base, args.control_port).start()
    control = f", control on {fake.control_url}" if fake.has_control else ""
    print(f"fake GIPHY on {fake.base_url}, media at {fake.media_base}{control}", flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        fake.stop()


if __name__ == "__main__":
    main()
