"""Spec 022 task 11: sketch messages on the session WebSocket (`sessions/ws.py`).

FR-1, FR-9, FR-10, FR-11, FR-13, FR-16, FR-21, NFR-1, NFR-4, NFR-5; AC-1, AC-9, AC-10, AC-11,
AC-13, AC-16, AC-20, AC-22. Several TestClient WebSocket clients, real Postgres, nothing mocked.
"""

import json
import uuid
from collections.abc import AsyncIterator
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.sessions import repo as sessions_repo

ADD = parse_signature("def add(a: int, b: int) -> int")
PEN = {"kind": "pen", "color": "blue", "points": [10, 10, 20, 20, 30, 25]}
ELLIPSE = {"kind": "ellipse", "color": "red", "points": [100, 100, 260, 200]}


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",  # noqa: S106
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
async def client(database_url: str, migrated: asyncpg.Connection) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


async def _session(conn: asyncpg.Connection) -> sessions_repo.Session:
    problem_id = await problems_repo.create(
        conn,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    return await sessions_repo.create(conn, problem_id)


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _next(ws) -> dict:
    """The next message that isn't a presence update (joiners see each other's presence)."""
    while True:
        message = ws.receive_json()
        if message["type"] != "presence":
            return message


def _welcome(ws) -> dict:
    message = _next(ws)
    assert message["type"] == "welcome"
    return message


def _add(ws, action: dict, client_id: str | None = None) -> str:
    client_id = client_id or uuid.uuid4().hex
    ws.send_text(json.dumps({"type": "sketch_add", "client_id": client_id, "action": action}))
    return client_id


def _no_author(frame: dict) -> None:
    assert "author_id" not in json.dumps(frame)


async def test_ac1_a_new_board_is_empty_and_a_later_joiner_gets_the_same_board(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        welcome = _welcome(ana)
        assert welcome["sketch"] == {"actions": [], "full": False}
        client_id = _add(ana, PEN)
        added = _next(ana)
        assert added["type"] == "sketch_added"
        assert added["action"]["client_id"] == client_id

        with client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben:
            later = _welcome(ben)
    assert later["sketch"]["actions"] == [added["action"]]
    assert later["sketch"]["full"] is False
    _no_author(later)


async def test_ac9_ben_receives_anas_circle(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _welcome(ana)
        _welcome(ben)
        client_id = _add(ana, ELLIPSE)
        to_ben = _next(ben)
        to_ana = _next(ana)
    for frame in (to_ben, to_ana):
        assert frame["type"] == "sketch_added"
        action = frame["action"]
        assert action["client_id"] == client_id
        assert action["kind"] == "ellipse"
        assert action["color"] == "red"
        assert action["points"] == ELLIPSE["points"]
        assert isinstance(action["seq"], int)
        _no_author(frame)


async def test_ac10_three_concurrent_drawers_see_the_same_order(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
        client.websocket_connect(_ws_url(session.invite_id, "Cy")) as cy,
    ):
        sockets = (ana, ben, cy)
        for ws in sockets:
            _welcome(ws)
        for ws in sockets:
            _add(ws, PEN)
        orders = [[_next(ws)["action"]["seq"] for _ in range(3)] for ws in sockets]
    assert orders[0] == orders[1] == orders[2]
    assert orders[0] == sorted(orders[0])
    assert len(set(orders[0])) == 3


async def test_ac13_undo_of_anothers_action_is_refused_and_own_undo_is_removed(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _welcome(ana)
        _welcome(ben)
        _add(ben, PEN)
        bens_seq = _next(ben)["action"]["seq"]
        assert _next(ana)["action"]["seq"] == bens_seq

        ana.send_text(json.dumps({"type": "sketch_undo", "seq": bens_seq}))
        assert _next(ana) == {"type": "sketch_refused", "seq": bens_seq, "reason": "not_yours"}

        # Ben's undo is the next thing both see: Ana's refused undo broadcast nothing.
        ben.send_text(json.dumps({"type": "sketch_undo", "seq": bens_seq}))
        removed = {"type": "sketch_removed", "seq": bens_seq}
        assert _next(ben) == removed
        assert _next(ana) == removed


async def test_ac13_bens_action_stays_after_anas_refused_undo(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _welcome(ana)
        _welcome(ben)
        _add(ben, PEN)
        bens_seq = _next(ben)["action"]["seq"]
        _next(ana)
        ana.send_text(json.dumps({"type": "sketch_undo", "seq": bens_seq}))
        assert _next(ana)["reason"] == "not_yours"
    count = await migrated.fetchval("select count(*) from sketch_action where seq = $1", bens_seq)
    assert count == 1


async def test_clear_is_broadcast_to_everyone(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _welcome(ana)
        _welcome(ben)
        ana.send_text(json.dumps({"type": "sketch_clear", "client_id": "c1"}))
        for ws in (ana, ben):
            frame = _next(ws)
            assert frame["type"] == "sketch_added"
            assert frame["action"]["kind"] == "clear"
            assert frame["action"]["client_id"] == "c1"


async def test_ac16_a_stale_sessions_socket_is_refused(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await sessions_repo.set_stale(migrated, session.id)
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ws:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
    assert exc_info.value.code == 4410


async def test_ac16_a_session_going_stale_mid_connection_refuses_drawing(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
        _welcome(ana)
        await sessions_repo.set_stale(migrated, session.id)
        client_id = _add(ana, PEN)
        assert _next(ana) == {"type": "sketch_refused", "client_id": client_id, "reason": "stale"}


async def test_ac20_another_sessions_socket_never_receives_this_board(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    s = await _session(migrated)
    t = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(s.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(t.invite_id, "Tom")) as tom,
    ):
        _welcome(ana)
        tom_welcome = _welcome(tom)
        assert tom_welcome["sketch"]["actions"] == []
        _add(ana, PEN)
        _next(ana)
        # Tom's own drawing is the next thing Tom receives: nothing of S came first.
        toms_id = _add(tom, ELLIPSE)
        frame = _next(tom)
    assert frame["type"] == "sketch_added"
    assert frame["action"]["client_id"] == toms_id
    _no_author(frame)


@pytest.mark.parametrize(
    "frame",
    [
        {"type": "sketch_add", "client_id": "c1", "action": {"kind": "star", "points": [1, 1]}},
        {
            "type": "sketch_add",
            "client_id": "c1",
            "action": {"kind": "pen", "color": "<script>alert(1)</script>", "points": [1, 1]},
        },
        {"type": "sketch_add", "client_id": "c1", "action": "<b>pen</b>"},
        {"type": "sketch_undo", "seq": "<script>alert(1)</script>"},
        {"type": "sketch_undo", "seq": 1.5},
        {"type": "sketch_undo", "seq": True},
        {"type": "sketch_undo"},
        {"type": "sketch_add", "action": PEN},
        {"type": "sketch_add", "client_id": 7, "action": PEN},
        {"type": "sketch_add", "client_id": "<img src=x onerror=alert(1)>" * 10, "action": PEN},
        {"type": "sketch_clear", "client_id": ["c1"]},
        {"type": "sketch_clear"},
    ],
)
async def test_ac22_malformed_frames_are_refused_to_the_sender_only(
    client: TestClient, migrated: asyncpg.Connection, frame: dict
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _welcome(ana)
        _welcome(ben)
        ana.send_text(json.dumps(frame))
        refused = _next(ana)
        assert refused["type"] == "sketch_refused"
        assert refused["reason"] == "invalid"
        if isinstance(frame.get("client_id"), str):
            assert refused["client_id"] == frame["client_id"]
        else:
            assert "client_id" not in refused
        # Ben's next frame is Ana's following valid drawing: the malformed one reached no one.
        client_id = _add(ana, PEN)
        to_ben = _next(ben)
    assert to_ben["type"] == "sketch_added"
    assert to_ben["action"]["client_id"] == client_id
    rows = await migrated.fetchval(
        "select count(*) from sketch_action where session_id = $1", session.id
    )
    assert rows == 1


@pytest.mark.slow
async def test_ac11_the_board_is_the_same_after_a_restart(
    database_url: str, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with TestClient(create_app(_settings(database_url))) as first:
        with first.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
            _welcome(ana)
            _add(ana, PEN)
            _next(ana)
            _add(ana, ELLIPSE)
            _next(ana)
            ana.send_text(json.dumps({"type": "sketch_clear", "client_id": "c-clear"}))
            _next(ana)
        with first.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
            before = _welcome(ana)["sketch"]
    with TestClient(create_app(_settings(database_url))) as restarted:  # noqa: SIM117
        with restarted.websocket_connect(_ws_url(session.invite_id, "Ana")) as ana:
            after = _welcome(ana)["sketch"]
    assert len(before["actions"]) == 3
    assert after == before
