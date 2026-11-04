"""Spec 013 task 23: drawing over the presentation WebSocket (plan.md "Drawing",
"Contracts — WebSocket", "Session lifetime").

FR-19–FR-24, NFR-3; AC-19–AC-23, AC-15g (drawing part). A real database and the real app,
nothing mocked. "Reaches nobody" is shown with a sentinel: the next frame the socket gets
is a later, known one.
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from datetime import timedelta
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import clock
from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.present import hub as present_hub
from app.present import repo

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
ANCHOR = {"path": [1, 0], "dx": 0.25, "dy": 0.5}


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )


async def _reset(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
        await conn.execute(
            """truncate presentation_chat_message, presentation_participant,
                        presentation_session, presentation_version, presentation cascade"""
        )
    finally:
        await conn.close()


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    await _reset(database_url)
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


@pytest.fixture
async def conn(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    connection = await asyncpg.connect(database_url)
    try:
        yield connection
    finally:
        await connection.close()


async def _invite(client: TestClient, conn: asyncpg.Connection) -> str:
    html = "".join(f"<section><h1>Slide {i}</h1></section>" for i in range(4))
    created = await repo.create_presentation(
        conn,
        title="Intro to DNS",
        topic="Networking",
        html=html,
        kind="slides",
        slide_count=4,
        created_by_sub="editor-sub",
    )
    response = client.post("/api/present/sessions", json={"presentation_id": str(created.id)})
    assert response.status_code == 201, response.text
    return response.json()["invite_id"]


class _Socket:
    def __init__(self, ws) -> None:
        self.ws = ws

    def send(self, message: dict) -> None:
        self.ws.send_json(message)

    def until(self, msg_type: str) -> dict:
        """The next frame of `msg_type`, skipping presence and host only."""
        while True:
            frame = self.ws.receive_json()
            if frame["type"] == msg_type:
                return frame
            assert frame["type"] in {"presence", "host"}, frame

    def presence_of(self, count: int) -> None:
        while len(self.until("presence")["participants"]) != count:
            pass


@contextmanager
def _joined(client: TestClient, invite: str, name: str) -> Iterator[tuple[_Socket, dict]]:
    with client.websocket_connect(f"/api/present/sessions/{invite}/ws?name={quote(name)}") as ws:
        socket = _Socket(ws)
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome", welcome
        yield socket, welcome


def _start(stroke_id: str, points: list[list[float]] | None = None, anchor=ANCHOR) -> dict:
    return {
        "type": "stroke_start",
        "id": stroke_id,
        "anchor": anchor,
        "points": [[0.1, 0.2]] if points is None else points,
    }


def _sentinel(host: _Socket, *others: _Socket, slide: int) -> None:
    """A place change everyone receives; anything before it in a stream arrived first."""
    host.send({"type": "place", "slide": slide, "anchor": None})
    for socket in (host, *others):
        assert socket.until("place")["slide"] == slide


# --- AC-19: strokes relayed live, distinct colours --------------------------------------------


async def test_strokes_relayed_with_distinct_colours(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, _ = stack.enter_context(_joined(client, invite, "Ana"))
        ben, ben_w = stack.enter_context(_joined(client, invite, "Ben"))
        cleo, cleo_w = stack.enter_context(_joined(client, invite, "Cleo"))
        ben_id = ben_w["you"]["participant_id"]
        cleo_id = cleo_w["you"]["participant_id"]
        ana.presence_of(3)

        # The server sets participant_id and colour, whatever the client claims.
        ben.send({**_start("b1"), "participant_id": cleo_id, "color": 4})
        cleo.send(_start("c1", [[0.5, 0.5]], anchor=None))

        # Two connections: either may be relayed first.
        got = {s["id"]: s for s in (ana.until("stroke_start")["stroke"] for _ in range(2))}
        ben_stroke, cleo_stroke = got["b1"], got["c1"]
        assert ben_stroke == {
            "id": "b1",
            "participant_id": ben_id,
            "color": 1,
            "anchor": ANCHOR,
            "points": [[0.1, 0.2]],
        }
        assert cleo_stroke["participant_id"] == cleo_id
        assert cleo_stroke["anchor"] is None
        assert cleo_stroke["color"] != ben_stroke["color"]
        assert cleo.until("stroke_start")["stroke"]["id"] == "b1"
        assert ben.until("stroke_start")["stroke"]["id"] == "c1"

        ben.send({"type": "stroke_points", "id": "b1", "points": [[0.3, 0.4], [0.5, 0.6]]})
        expected = {"type": "stroke_points", "id": "b1", "points": [[0.3, 0.4], [0.5, 0.6]]}
        assert ana.until("stroke_points") == expected
        assert cleo.until("stroke_points") == expected

        # Cleo can't extend Ben's stroke; nobody echoes the drawer's own frames.
        cleo.send({"type": "stroke_points", "id": "b1", "points": [[0.9, 0.9]]})
        _sentinel(ana, ben, cleo, slide=1)


async def test_malformed_drawing_frames_ignored(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        ben.send({"type": "stroke_start", "id": "", "anchor": None, "points": []})
        ben.send({"type": "stroke_start", "id": "x", "anchor": "nope", "points": []})
        ben.send({"type": "stroke_start", "id": "x", "anchor": None, "points": [[1]]})
        ben.send({"type": "stroke_start", "id": "x", "anchor": None, "points": [["a", 1]]})
        ben.send({"type": "stroke_start", "id": 7, "anchor": None, "points": []})
        ben.send({"type": "stroke_points", "id": "nope", "points": [[0.1, 0.1]]})
        ben.send(_start("b1"))
        ben.send(_start("b1"))  # a duplicate id doesn't replace the stroke
        ben.send({"type": "stroke_points", "id": "b1", "points": "bad"})
        assert ana.until("stroke_start")["stroke"]["id"] == "b1"
        _sentinel(ana, ben, slide=1)


# --- AC-20: a slide change clears ------------------------------------------------------------


async def test_slide_change_clears(client: TestClient, conn: asyncpg.Connection) -> None:
    invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        ben.send(_start("b1"))
        assert ana.until("stroke_start")["stroke"]["id"] == "b1"

        ana.send({"type": "place", "slide": 2, "anchor": None})
        assert ben.until("place")["slide"] == 2
        assert ben.until("drawings_cleared") == {"type": "drawings_cleared"}

        with _joined(client, invite, "Cleo") as (_, welcome):
            assert welcome["strokes"] == []

        ana.send({"type": "place", "slide": 1, "anchor": None})
        with _joined(client, invite, "Dana") as (_, welcome):
            assert welcome["strokes"] == []


# --- AC-21: anyone clears for everyone -------------------------------------------------------


async def test_clear_drawings_reaches_everyone(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)

    with ExitStack() as stack:
        ana, _ = stack.enter_context(_joined(client, invite, "Ana"))
        ben, _ = stack.enter_context(_joined(client, invite, "Ben"))
        cleo, _ = stack.enter_context(_joined(client, invite, "Cleo"))
        ana.presence_of(3)
        ben.send(_start("b1"))
        cleo.until("stroke_start")
        cleo.send(_start("c1"))
        ana.until("stroke_start")
        ana.until("stroke_start")
        ben.until("stroke_start")

        cleo.send({"type": "clear_drawings"})
        for socket in (ana, ben, cleo):
            assert socket.until("drawings_cleared") == {"type": "drawings_cleared"}

        with _joined(client, invite, "Dana") as (_, welcome):
            assert welcome["strokes"] == []


# --- AC-22: joiners get current strokes ------------------------------------------------------


async def test_joiner_gets_strokes(client: TestClient, conn: asyncpg.Connection) -> None:
    invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, bw):
        ana.presence_of(2)
        ben.send(_start("b1"))
        ben.send({"type": "stroke_points", "id": "b1", "points": [[0.3, 0.4]]})
        ana.until("stroke_start")
        ana.until("stroke_points")
        ana.send(_start("a1", [[0.7, 0.7]], anchor=None))
        ben.until("stroke_start")

        with _joined(client, invite, "Dana") as (_, welcome):
            strokes = welcome["strokes"]
        assert [s["id"] for s in strokes] == ["b1", "a1"]
        assert strokes[0] == {
            "id": "b1",
            "participant_id": bw["you"]["participant_id"],
            "color": 1,
            "anchor": ANCHOR,
            "points": [[0.1, 0.2], [0.3, 0.4]],
        }
        assert strokes[1]["points"] == [[0.7, 0.7]]


# --- AC-23: gone after everyone leaves, never stored -----------------------------------------


async def test_strokes_gone_after_everyone_leaves(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)
    stroke_id = f"stroke-{uuid.uuid4()}"

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        ben.send(_start(stroke_id))
        ben.send({"type": "stroke_points", "id": stroke_id, "points": [[0.3, 0.4]]})
        ana.until("stroke_start")
        ana.until("stroke_points")

    with _joined(client, invite, "Ana") as (_, welcome):
        assert welcome["strokes"] == []

    tables = await conn.fetch(
        "select table_name from information_schema.tables "
        "where table_schema = 'public' and table_name like 'presentation%'"
    )
    assert tables
    for row in tables:
        name = row["table_name"]
        hits = await conn.fetchval(
            f"select count(*) from {name} t where t::text like $1",  # noqa: S608  (catalogue name)
            f"%{stroke_id}%",
        )
        assert hits == 0, name


# --- NFR-3: caps --------------------------------------------------------------------------------


async def test_caps_refuse_with_drawing_full(
    client: TestClient, conn: asyncpg.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(present_hub, "MAX_STROKES", 2)
    monkeypatch.setattr(present_hub, "MAX_POINTS_PER_STROKE", 3)
    invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        ben.send(_start("long", [[0.1, 0.1]] * 4))
        assert ben.until("error") == {"type": "error", "code": "drawing_full"}

        ben.send(_start("b1", [[0.1, 0.1]] * 2))
        assert ana.until("stroke_start")["stroke"]["id"] == "b1"
        ben.send({"type": "stroke_points", "id": "b1", "points": [[0.2, 0.2]] * 2})
        assert ben.until("error") == {"type": "error", "code": "drawing_full"}

        ben.send(_start("b2"))
        assert ana.until("stroke_start")["stroke"]["id"] == "b2"
        ben.send(_start("b3"))
        assert ben.until("error") == {"type": "error", "code": "drawing_full"}
        _sentinel(ana, ben, slide=1)


# --- AC-15g: stale refuses drawing ------------------------------------------------------------


async def test_stale_refuses_drawing(client: TestClient, conn: asyncpg.Connection) -> None:
    invite = await _invite(client, conn)

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        ben.send(_start("b1"))
        assert ana.until("stroke_start")["stroke"]["id"] == "b1"
        await conn.execute(
            "update presentation_session set stale_at = now() where invite_id = $1", invite
        )

        ben.send(_start("b2"))
        assert ben.until("error") == {"type": "error", "code": "session_stale"}
        ben.send({"type": "stroke_points", "id": "b1", "points": [[0.3, 0.3]]})
        assert ben.until("error") == {"type": "error", "code": "session_stale"}
        ben.send({"type": "clear_drawings"})
        assert ben.until("error") == {"type": "error", "code": "session_stale"}
        # Ana got none of it: her next frame is the refusal of her own clear.
        ana.send({"type": "clear_drawings"})
        assert ana.until("error") == {"type": "error", "code": "session_stale"}


# --- activity, throttled ----------------------------------------------------------------------


async def test_stroke_touches_activity_at_most_once_a_minute(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = await _invite(client, conn)
    old = clock.now() - timedelta(days=10)

    async def last_activity():
        return await conn.fetchval(
            "select last_activity_at from presentation_session where invite_id = $1", invite
        )

    with _joined(client, invite, "Ana") as (ana, _), _joined(client, invite, "Ben") as (ben, _):
        ana.presence_of(2)
        await conn.execute(
            "update presentation_session set last_activity_at = $2 where invite_id = $1",
            invite,
            old,
        )
        ben.send(_start("b1"))
        ana.until("stroke_start")
        assert await last_activity() > old

        await conn.execute(
            "update presentation_session set last_activity_at = $2 where invite_id = $1",
            invite,
            old,
        )
        ben.send(_start("b2"))
        ana.until("stroke_start")
        assert await last_activity() == old
