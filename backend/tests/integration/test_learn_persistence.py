"""Spec 006 task 27: learning sessions survive a restart and a lesson change.

FR-25, FR-28, NFR-6; AC-24, AC-31. A "restart" is what a deploy does: the startup step
(`asgi._migrate_and_seed`) runs again on the same database and a fresh app is built. A
"redeploy with a changed lesson" is the same with the lessons folder swapped:

- `lessons-v1/01-docker/01-ten-steps`: ten steps titled "Step 1".."Step 10";
  `02-pictures`: a lesson with an image.
- `lessons-v2/01-docker/01-ten-steps`: the same lesson with "Step 5" removed (nine steps);
  `02-pictures` is gone.

Positions on the wire are 0-based: the spec's "step 3" is position 2.
"""

import hashlib
import json
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import asgi
from app import db as app_db
from app.config import Settings
from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"
V1 = FIXTURES / "lessons-v1"
V2 = FIXTURES / "lessons-v2"
TEN = "01-docker/01-ten-steps"
PICTURES = "01-docker/02-pictures"
PNG = V1 / PICTURES / "layers.png"

# What passes each position of the ten-step lesson (v1), as the client sends it.
PASS = {
    0: {"type": "continue"},
    1: {"type": "submit_text", "text": "two"},
    2: {"type": "submit_choice", "selected": [2]},
    3: {"type": "submit_command", "command": "echo four"},
    4: {"type": "submit_text", "text": "five"},  # "Step 5", gone from v2
}


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    # The database is shared by the module; each test here starts with no lessons/sessions.
    await db.execute("truncate lesson, lesson_version, lesson_asset cascade")
    yield db


@contextmanager
def _deployed(database_url: str) -> Iterator[TestClient]:
    """A fresh app on the database, as after a (re)start."""
    with TestClient(create_app(_settings(database_url))) as client:
        yield client


async def _deploy(database_url: str, lessons_dir: Path) -> None:
    """The startup step a deploy runs before serving: migrate, seed, load lessons."""
    await asgi._migrate_and_seed(_settings(database_url), lessons_dir=lessons_dir)


def _start(client: TestClient, lesson_key: str) -> str:
    response = client.post("/api/learn/sessions", json={"lesson_key": lesson_key})
    assert response.status_code == 201, response.text
    return response.json()["invite_id"]


@contextmanager
def _joined(client: TestClient, invite: str, name: str) -> Iterator[tuple[object, dict]]:
    """Joins; yields the socket and the joiner's `welcome` (its own `presence` consumed)."""
    with client.websocket_connect(f"/api/learn/sessions/{invite}/ws?name={quote(name)}") as ws:
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome"
        assert ws.receive_json()["type"] == "presence"
        yield ws, welcome


def _act(ws, step: int, message: dict) -> dict:
    """Sends one action and returns the next `attempt` or `step_passed` event."""
    ws.send_text(json.dumps({**message, "step": step}))
    event = ws.receive_json()
    assert event["type"] in ("attempt", "step_passed"), event
    return event


def _pass(ws, step: int) -> None:
    """Passes `step` with its accepted answer; reads up to the `step_passed` broadcast."""
    event = _act(ws, step, PASS[step])
    if event["type"] == "attempt":
        assert event["attempt"]["correct"] is True, event
        event = ws.receive_json()
    assert event["type"] == "step_passed", event
    assert event["step"] == step


def _record(client: TestClient, invite: str) -> dict:
    response = client.get(f"/api/learn/sessions/{invite}/record")
    assert response.status_code == 200, response.text
    return response.json()


def _titles(record: dict) -> list[str]:
    return [s["title"] for s in record["lesson"]["steps"]]


async def _version_count(conn: asyncpg.Connection, key: str) -> int:
    return await conn.fetchval("select count(*) from lesson_version where lesson_key = $1", key)


# --- AC-24 (FR-25, NFR-6) ------------------------------------------------------------------


async def test_ac24_after_a_restart_the_session_is_on_step_4_with_steps_1_to_3_intact(
    database_url: str, migrated: asyncpg.Connection
) -> None:
    await _deploy(database_url, V1)
    with _deployed(database_url) as client:
        invite = _start(client, TEN)
        with _joined(client, invite, "Ada") as (ws, _):
            _pass(ws, 0)
            wrong = _act(ws, 1, {"type": "submit_text", "text": "three"})
            assert wrong["attempt"]["correct"] is False
            _pass(ws, 1)
            wrong = _act(ws, 2, {"type": "submit_choice", "selected": [0]})
            assert wrong["attempt"]["correct"] is False
            _pass(ws, 2)
        before = _record(client, invite)
    assert before["current_step"] == 3

    # Restart: the startup step runs again on the same database, then a fresh app.
    await _deploy(database_url, V1)
    assert await _version_count(migrated, TEN) == 1  # unchanged lesson, no new version

    with _deployed(database_url) as client:
        with _joined(client, invite, "Ada") as (ws, welcome):
            record = welcome["record"]
            assert record["current_step"] == 3
            assert record["completed"] is False
            assert len(record["lesson"]["steps"]) == 10
            steps = record["steps"]
            assert [s["position"] for s in steps] == [0, 1, 2, 3]
            assert all(s["passed"]["by"] == "Ada" for s in steps[:3])
            assert steps[3]["passed"] is None
            assert [(a["submitted"], a["correct"]) for a in steps[1]["attempts"]] == [
                ("three", False),
                ("two", True),
            ]
            assert [(a["submitted"], a["correct"]) for a in steps[2]["attempts"]] == [
                ([0], False),
                ([2], True),
            ]
            # Steps 1–3 and their attempts exactly as they were before the restart.
            assert steps[:3] == before["steps"][:3]

            # And the group carries on where it stopped.
            _pass(ws, 3)
        assert _record(client, invite)["current_step"] == 4


# --- AC-31 (FR-28) -------------------------------------------------------------------------


async def test_ac31_a_session_keeps_its_10_steps_after_step_5_is_removed_and_a_new_one_has_9(
    database_url: str, migrated: asyncpg.Connection
) -> None:
    await _deploy(database_url, V1)
    with _deployed(database_url) as client:
        old = _start(client, TEN)
        with _joined(client, old, "Ada") as (ws, _):
            _pass(ws, 0)
            _pass(ws, 1)
        before = _record(client, old)
    assert before["current_step"] == 2  # the spec's "step 3"
    assert len(before["lesson"]["steps"]) == 10

    # Redeploy with step 5 removed.
    await _deploy(database_url, V2)
    assert await _version_count(migrated, TEN) == 2

    ten = [f"Step {n}" for n in range(1, 11)]
    nine = [t for t in ten if t != "Step 5"]
    with _deployed(database_url) as client:
        # The old session: still ten steps, progress intact.
        with _joined(client, old, "Ada") as (ws, welcome):
            record = welcome["record"]
            assert _titles(record) == ten
            assert record["current_step"] == 2
            assert record["steps"][:2] == before["steps"][:2]

            # It is still judged against its own version through to the old "Step 5".
            _pass(ws, 2)
            _pass(ws, 3)
            _pass(ws, 4)
        after = _record(client, old)
        assert after["current_step"] == 5
        assert after["steps"][4]["title"] == "Step 5"
        assert _titles(after) == ten

        # A session started after the change has nine.
        new = _start(client, TEN)
        with _joined(client, new, "Linus") as (_, welcome):
            assert _titles(welcome["record"]) == nine
            assert welcome["record"]["current_step"] == 0

        listed = {
            lesson["key"]: lesson
            for topic in client.get("/api/learn/topics").json()
            for lesson in topic["lessons"]
        }
        assert listed[TEN]["step_count"] == 9


async def test_a_removed_lesson_is_not_listed_but_its_session_still_loads_with_its_images(
    database_url: str, migrated: asyncpg.Connection
) -> None:
    sha = hashlib.sha256(PNG.read_bytes()).hexdigest()
    await _deploy(database_url, V1)
    with _deployed(database_url) as client:
        listed = [
            lesson["key"] for t in client.get("/api/learn/topics").json() for lesson in t["lessons"]
        ]
        assert PICTURES in listed
        invite = _start(client, PICTURES)

    # Redeploy without the lesson.
    await _deploy(database_url, V2)
    assert (
        await migrated.fetchval("select current_version_id from lesson where key = $1", PICTURES)
        is None
    )

    with _deployed(database_url) as client:
        listed = [
            lesson["key"] for t in client.get("/api/learn/topics").json() for lesson in t["lessons"]
        ]
        assert PICTURES not in listed
        assert client.post("/api/learn/sessions", json={"lesson_key": PICTURES}).status_code == 404

        assert client.get(f"/api/learn/sessions/{invite}").json() == {"state": "active"}
        with _joined(client, invite, "Ada") as (ws, welcome):
            record = welcome["record"]
            assert record["lesson"]["key"] == PICTURES
            assert f"/api/learn/assets/{sha}" in record["steps"][0]["body_html"]
            _pass_pictures(ws)

        asset = client.get(f"/api/learn/assets/{sha}")
        assert asset.status_code == 200
        assert asset.headers["content-type"] == "image/png"
        assert asset.content == PNG.read_bytes()


def _pass_pictures(ws) -> None:
    """The removed lesson still runs: continue past the picture, then answer the quiz."""
    event = _act(ws, 0, {"type": "continue"})
    assert event["type"] == "step_passed"
    event = _act(ws, 1, {"type": "submit_text", "text": "layers"})
    assert event["attempt"]["correct"] is True
    assert ws.receive_json()["type"] in ("step_passed", "completed")
