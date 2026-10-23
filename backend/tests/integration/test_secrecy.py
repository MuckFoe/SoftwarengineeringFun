"""Task 42: test-secrecy sweep. NFR-5, FR-9, FR-22.

A problem's tests are unique sentinel strings. Every public HTTP endpoint and every
WebSocket message type is exercised as an anonymous visitor and as `plain1`, and every
response body, header and message (JSON and binary) is scanned: none may contain a
sentinel, or a `tests`, `args` or `expected` key. Only `editor1` sees the sentinels,
through `GET /api/problems/{id}/edit`.

"Every" is grounded in code, not a hand-kept list: the test reads the app's own route
table and fails if a route exists that the sweep did not exercise.

HTTP routes (app/main.py, app/problems/api.py, app/sessions/api.py, app/sessions/ws.py):
  GET    /api/auth/login, /api/auth/callback (via login_as), POST /api/auth/logout
  GET    /api/me
  GET    /api/problems, /api/problems/{id}, /api/problems/{id}/edit (refused)
  POST   /api/problems (refused), PUT/DELETE /api/problems/{id} (refused)
  POST   /api/sessions, GET /api/sessions/{invite},
  POST   /api/sessions/{invite}/reactivate (refused)
  WS     /api/sessions/{invite}/ws
  FastAPI's /openapi.json, /docs, /docs/oauth2-redirect, /redoc, and the SPA fallback.

WebSocket messages, server -> client (app/sessions/ws.py, app/sessions/service.py):
  JSON: welcome, presence, problem_switched (with and without a last run), run_started,
        run_finished (wrong answer and error outcomes), problem_deleted, error.
        `error` is built from a literal code only; it is exercised here via
        `problem_deleted` (the `run_in_progress` and `infra_error` codes share the shape).
  Binary (Yjs): sync step 2 (reply to step 1), update, awareness relay.
Client -> server: switch_problem, run, sync step 1, update, awareness.

FR-22: a run result never shows inputs, expected or actual values, so run_finished must
not carry a sentinel either. The code under test returns a value derived from the input
argument, so a leak of the actual value would also show up. The accepted NFR-5 leak (an
exception message containing a test input) is avoided by raising a fixed message.
"""

import json
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import quote

import asyncpg
import httpx
import pycrdt
import pytest
from fastapi.routing import APIRoute, APIWebSocketRoute
from fastapi.testclient import TestClient
from starlette.routing import Mount

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.sessions import service as sessions_service
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")
SIGNATURE = "def shout(word: str) -> str"
FORBIDDEN_KEYS = {"tests", "args", "expected"}

# Routes whose body is a schema description, not data: their field *names* include
# "tests", "args" and "expected" (ProblemIn's schema), so only the sentinel check applies.
SCHEMA_ROUTES = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}

EXPECTED_WS_JSON = {
    "welcome",
    "presence",
    "problem_switched",
    "run_started",
    "run_finished",
    "problem_deleted",
    "error",
}
EXPECTED_WS_BINARY = {"sync_step2", "update", "awareness"}


def _settings(kc: Keycloak, database_url: str) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url=RUNNER_URL,
    )


@pytest.fixture
async def client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


@pytest.fixture
async def conn(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    c = await asyncpg.connect(database_url)
    try:
        yield c
    finally:
        await c.close()


class Sweep:
    """Records every response and message the observer receives, and what's wrong with it."""

    def __init__(self, sentinels: list[str]) -> None:
        self.sentinels = sentinels
        self.violations: list[str] = []
        self.routes_hit: set[tuple[str, str]] = set()
        self.ws_json: set[str] = set()
        self.ws_binary: set[str] = set()

    def _scan_text(self, label: str, text: str) -> None:
        for s in self.sentinels:
            if s in text:
                self.violations.append(f"{label}: contains sentinel {s!r}")

    def _scan_keys(self, label: str, value: Any) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                if k in FORBIDDEN_KEYS:
                    self.violations.append(f"{label}: has key {k!r}")
                self._scan_keys(label, v)
        elif isinstance(value, list):
            for v in value:
                self._scan_keys(label, v)

    def http(self, route: tuple[str, str], response: httpx.Response) -> httpx.Response:
        self.routes_hit.add(route)
        label = f"{route[0]} {route[1]} -> {response.status_code}"
        self._scan_text(label, response.text)
        self._scan_text(label + " headers", str(dict(response.headers)))
        if route[1] not in SCHEMA_ROUTES and "json" in response.headers.get("content-type", ""):
            self._scan_keys(label, response.json())
        return response

    def ws_text(self, msg: dict) -> dict:
        label = f"ws {msg.get('type')}"
        self.ws_json.add(str(msg.get("type")))
        self._scan_text(label, json.dumps(msg))
        self._scan_keys(label, msg)
        return msg

    def ws_bytes(self, data: bytes) -> bytes:
        if data[0] == pycrdt.YMessageType.AWARENESS:
            kind = "awareness"
        elif data[1] == pycrdt.YSyncMessageType.SYNC_STEP1:
            kind = "sync_step1"
        elif data[1] == pycrdt.YSyncMessageType.SYNC_STEP2:
            kind = "sync_step2"
        else:
            kind = "update"
        self.ws_binary.add(kind)
        for s in self.sentinels:
            if s.encode() in data:
                self.violations.append(f"ws binary {kind}: contains sentinel {s!r}")
        return data


def _next_json(ws, sweep: Sweep) -> dict:
    """The next JSON message, scanning (and skipping) any Yjs binary frames before it."""
    while True:
        message = ws.receive()
        if message.get("bytes") is not None:
            sweep.ws_bytes(message["bytes"])
            continue
        return sweep.ws_text(json.loads(message["text"]))


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _problem_body(title: str, arg: str, expected: str) -> dict:
    return {
        "title": title,
        "description": "Shout a word.",
        "signature": SIGNATURE,
        "tests": [{"args": [arg], "expected": expected}],
    }


def _set_code(ws, doc: pycrdt.Doc, problem_id: str, code: str) -> None:
    before = doc.get_state()
    text = doc.get(f"code:{problem_id}", type=pycrdt.Text)
    del text[0 : len(text)]
    text += code
    ws.send_bytes(pycrdt.create_update_message(doc.get_update(before)))


def _app_routes(client: TestClient) -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    for route in client.app.routes:
        if isinstance(route, APIWebSocketRoute):
            routes.add(("WS", route.path))
        elif isinstance(route, Mount):
            continue  # /assets: static frontend build files, no data
        elif isinstance(route, APIRoute) or hasattr(route, "methods"):
            for method in route.methods or ():
                if method != "HEAD":
                    routes.add((method, route.path))
    return routes


@pytest.mark.parametrize("observer", ["anonymous", "plain1"])
async def test_nfr5_fr9_tests_reach_only_editors(
    client: TestClient,
    conn: asyncpg.Connection,
    login_as,  # noqa: F811
    observer: str,
) -> None:
    tag = uuid.uuid4().hex
    secret = {
        "arg_p": f"SENTINEL-ARG-P-{tag}",
        "exp_p": f"SENTINEL-EXPECTED-P-{tag}",
        "arg_q": f"SENTINEL-ARG-Q-{tag}",
        "exp_q": f"SENTINEL-EXPECTED-Q-{tag}",
    }
    sweep = Sweep(list(secret.values()))

    # --- editor1 creates two problems with sentinel tests and sees them (FR-9). ---
    login_as(client, "editor1")
    created_p = client.post(
        "/api/problems", json=_problem_body(f"Shout {tag[:8]}", secret["arg_p"], secret["exp_p"])
    )
    assert created_p.status_code == 201, created_p.text
    created_q = client.post(
        "/api/problems",
        json=_problem_body(f"Whisper {tag[:8]}", secret["arg_q"], secret["exp_q"]),
    )
    assert created_q.status_code == 201, created_q.text
    p, q = created_p.json()["id"], created_q.json()["id"]
    edit = client.get(f"/api/problems/{p}/edit")
    assert edit.status_code == 200
    assert edit.json()["tests"] == [{"args": [secret["arg_p"]], "expected": secret["exp_p"]}]
    # The scanner itself flags the editor's view, so a clean sweep below means something.
    probe = Sweep(sweep.sentinels)
    probe.http(("GET", "/api/problems/{problem_id}/edit"), edit)
    assert len(probe.violations) == 5  # two sentinels, plus tests/args/expected keys

    # --- switch to the observer; everything from here on is scanned. ---
    sweep.http(("POST", "/api/auth/logout"), client.post("/api/auth/logout"))
    client.cookies.clear()
    sweep.http(("GET", "/api/auth/login"), client.get("/api/auth/login", follow_redirects=False))
    if observer == "plain1":
        sweep.http(("GET", "/api/auth/callback"), login_as(client, "plain1"))
    else:
        # The callback is only reachable by completing a login; its response for plain1
        # is scanned in the other parametrization.
        sweep.routes_hit.add(("GET", "/api/auth/callback"))

    me = sweep.http(("GET", "/api/me"), client.get("/api/me"))
    assert me.json()["signed_in"] is (observer == "plain1")

    listing = sweep.http(("GET", "/api/problems"), client.get("/api/problems"))
    assert any(row["id"] == p for row in listing.json())
    sweep.http(("GET", "/api/problems"), client.get("/api/problems", params={"q": tag[:8]}))
    sweep.http(("GET", "/api/problems/{problem_id}"), client.get(f"/api/problems/{p}"))

    # FR-9: viewing tests, creating, editing and deleting are all refused.
    refused_edit = sweep.http(
        ("GET", "/api/problems/{problem_id}/edit"), client.get(f"/api/problems/{p}/edit")
    )
    harmless = _problem_body("Other", "x", "y")
    refused = [
        refused_edit,
        sweep.http(("POST", "/api/problems"), client.post("/api/problems", json=harmless)),
        sweep.http(
            ("PUT", "/api/problems/{problem_id}"),
            client.put(f"/api/problems/{p}", json=harmless),
        ),
        sweep.http(("DELETE", "/api/problems/{problem_id}"), client.delete(f"/api/problems/{p}")),
    ]
    expected_status = 401 if observer == "anonymous" else 403
    assert [r.status_code for r in refused] == [expected_status] * 4

    started = sweep.http(
        ("POST", "/api/sessions"), client.post("/api/sessions", json={"problem_id": p})
    )
    assert started.status_code == 201
    invite = started.json()["invite_id"]
    sweep.http(("GET", "/api/sessions/{invite}"), client.get(f"/api/sessions/{invite}"))
    sweep.http(
        ("POST", "/api/sessions/{invite}/reactivate"),
        client.post(f"/api/sessions/{invite}/reactivate"),
    )

    for path in SCHEMA_ROUTES:
        sweep.http(("GET", path), client.get(path))
    sweep.http(("GET", "/{spa}"), client.get(f"/sessions/{invite}"))
    sweep.http(("GET", "/api/{unknown}"), client.get("/api/does-not-exist"))

    # --- the session WebSocket, two participants. ---
    sweep.routes_hit.add(("WS", "/api/sessions/{invite}/ws"))
    with client.websocket_connect(_ws_url(invite, "Ada")) as ada:
        assert sweep.ws_text(ada.receive_json())["type"] == "welcome"
        ada_doc = pycrdt.Doc()
        ada.send_bytes(pycrdt.create_sync_message(ada_doc))
        reply = sweep.ws_bytes(ada.receive_bytes())
        pycrdt.handle_sync_message(reply[1:], ada_doc)

        with client.websocket_connect(_ws_url(invite, "Linus")) as linus:
            assert sweep.ws_text(linus.receive_json())["type"] == "welcome"
            assert sweep.ws_text(ada.receive_json())["type"] == "presence"
            linus_doc = pycrdt.Doc()
            linus.send_bytes(pycrdt.create_sync_message(linus_doc))
            pycrdt.handle_sync_message(sweep.ws_bytes(linus.receive_bytes())[1:], linus_doc)

            # Awareness relay.
            linus.send_bytes(bytes([pycrdt.YMessageType.AWARENESS, 0]))
            sweep.ws_bytes(ada.receive_bytes())

            # Wrong answer: the actual value is built from the sentinel input (FR-22).
            _set_code(ada, ada_doc, p, 'def shout(word: str) -> str:\n    return word + "!"\n')
            pycrdt.handle_sync_message(sweep.ws_bytes(linus.receive_bytes())[1:], linus_doc)
            ada.send_text(json.dumps({"type": "run"}))
            for ws in (ada, linus):
                assert sweep.ws_text(ws.receive_json())["type"] == "run_started"
                finished = sweep.ws_text(ws.receive_json())
                assert finished["type"] == "run_finished"
                assert [r["outcome"] for r in finished["run"]["results"]] == ["wrong_answer"]

            # Error outcome with a fixed message: message and traceback are shown.
            _set_code(
                ada, ada_doc, p, 'def shout(word: str) -> str:\n    raise ValueError("bad")\n'
            )
            pycrdt.handle_sync_message(sweep.ws_bytes(linus.receive_bytes())[1:], linus_doc)
            linus.send_text(json.dumps({"type": "run"}))
            for ws in (ada, linus):
                assert sweep.ws_text(ws.receive_json())["type"] == "run_started"
                finished = sweep.ws_text(ws.receive_json())
                (result,) = finished["run"]["results"]
                assert result["outcome"] == "error"
                assert result["error_message"] is not None and "bad" in result["error_message"]

            # Switch to Q (no last run) and back to P (with a last run).
            for target in (q, p):
                ada.send_text(json.dumps({"type": "switch_problem", "problem_id": target}))
                for ws in (ada, linus):
                    msg = _next_json(ws, sweep)
                    assert msg["type"] == "problem_switched"
            assert msg["state"]["last_run"] is not None

            # An editor deletes P while the session is on it (FR-10), then a run is refused.
            await problems_repo.soft_delete(conn, uuid.UUID(p))
            await sessions_service.on_problem_deleted(conn, uuid.UUID(p))
            for ws in (ada, linus):
                # Skips Q's starter-code update, which follows its problem_switched.
                assert _next_json(ws, sweep)["type"] == "problem_deleted"
            ada.send_text(json.dumps({"type": "run"}))
            assert sweep.ws_text(ada.receive_json()) == {
                "type": "error",
                "code": "problem_deleted",
            }

        # Linus leaves: presence update.
        assert sweep.ws_text(ada.receive_json())["type"] == "presence"

    # A deleted problem's public view, after runs exist.
    sweep.http(("GET", "/api/problems/{problem_id}"), client.get(f"/api/problems/{p}"))

    # Coverage: every route in the app and every message type was exercised.
    app_routes = _app_routes(client)
    sweep.routes_hit.discard(("GET", "/{spa}"))
    sweep.routes_hit.discard(("GET", "/api/{unknown}"))
    assert app_routes - sweep.routes_hit == set()
    assert sweep.ws_json >= EXPECTED_WS_JSON
    assert sweep.ws_binary >= EXPECTED_WS_BINARY

    assert sweep.violations == []
