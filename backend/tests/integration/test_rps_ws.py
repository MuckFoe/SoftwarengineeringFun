"""Spec 021 task 23: the Rock Paper Siege socket's join, cap, seats, setup frames and
per-recipient sends (`games/rps/ws.py`). AC-2, AC-7, AC-22, FR-24. Real Postgres and the real
app; nothing mocked.
"""

from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.games.rps import repo
from app.games.rps.rules import home_squares
from app.main import create_app
from tests.fixtures.rps_board import fixed_game, pieces

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",  # noqa: S106
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _invite(client: TestClient) -> str:
    return client.post("/api/games/rps/sessions").json()["invite_id"]


def _url(invite: str, name: str | None = None, rejoin: str | None = None) -> str:
    query = []
    if name is not None:
        query.append(f"name={quote(name)}")
    if rejoin is not None:
        query.append(f"rejoin={quote(rejoin)}")
    return f"/api/games/rps/sessions/{invite}/ws" + (f"?{'&'.join(query)}" if query else "")


class _Socket:
    """A joined socket that records every frame it receives."""

    def __init__(self, ws) -> None:
        self.ws = ws
        self.frames: list[dict] = []

    def send(self, **frame: object) -> None:
        self.ws.send_json(frame)

    def next(self, type_: str) -> dict:
        while True:
            frame = self.ws.receive_json()
            self.frames.append(frame)
            if frame["type"] == type_:
                return frame

    def state(self, until=lambda s: True) -> dict:
        while True:
            state = self.next("state")["state"]
            if until(state):
                return state


@contextmanager
def _joined(
    client: TestClient, invite: str, name: str | None = None, *, rejoin: str | None = None
) -> Iterator[tuple[_Socket, dict]]:
    with client.websocket_connect(_url(invite, name, rejoin)) as ws:
        socket = _Socket(ws)
        welcome = socket.next("welcome")
        yield socket, welcome


def _close_code(client: TestClient, url: str) -> int:
    with pytest.raises(WebSocketDisconnect) as info, client.websocket_connect(url) as ws:
        ws.receive_json()
    return info.value.code


def _side_pieces(state: dict, side: str) -> list[dict]:
    return [p for p in state["game"]["pieces"] if p["side"] == side]


def _kind_at(state: dict, square: int) -> str | None:
    return next(p["kind"] for p in state["game"]["pieces"] if p["square"] == square)


# --- AC-2: players, viewer, cap, seat switch ---------------------------------------------------


def test_ac2_three_joins_two_players_and_a_viewer_seat_switch(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        a, wa = stack.enter_context(_joined(client, invite, "Ann"))
        b, wb = stack.enter_context(_joined(client, invite, "Bob"))
        c, wc = stack.enter_context(_joined(client, invite, "Cy"))
        pa, pb, pc = (w["you"]["participant_id"] for w in (wa, wb, wc))
        assert wa["you"]["is_starter"] is True
        assert wa["state"]["you"] == "a"
        assert wb["state"]["you"] == "b"
        assert wc["state"]["you"] == "viewer"
        seats = wc["state"]["seats"]
        assert seats["a"]["participant_id"] == pa
        assert seats["b"]["participant_id"] == pb
        assert [v["participant_id"] for v in wc["state"]["viewers"]] == [pc]

        # Seats full: the viewer is refused, the sender only (Ann's next frame is a state).
        c.send(type="take_seat", side="b")
        assert c.next("error")["code"] == "seat_taken"

        b.send(type="leave_seat")
        for s in (a, b, c):
            s.state(lambda st: st["seats"]["b"] is None)
        assert not any(f["type"] == "error" for f in a.frames + b.frames)

        c.send(type="take_seat", side="b")
        seen = {
            name: s.state(lambda st: st["seats"]["b"] is not None)
            for name, s in (("a", a), ("b", b), ("c", c))
        }
        assert seen["c"]["seats"]["b"]["participant_id"] == pc
        assert seen["c"]["you"] == "b"
        assert seen["b"]["you"] == "viewer"
        assert seen["a"]["you"] == "a"


def test_ac2_sixth_join_is_refused_4403(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        for name in ("Ann", "Bob", "Cy", "Di", "Ed"):
            stack.enter_context(_joined(client, invite, name))
        assert _close_code(client, _url(invite, "Flo")) == 4403


def test_close_codes(client: TestClient) -> None:
    assert _close_code(client, _url("nope", "Ann")) == 4404
    invite = _invite(client)
    assert _close_code(client, _url(invite, "")) == 4422


async def test_deleted_session_closes_4411(client: TestClient, db: asyncpg.Connection) -> None:
    invite = _invite(client)
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.soft_delete(db, session.id, "starter", by_sub=None)
    assert _close_code(client, _url(invite, "Ann")) == 4411


async def test_stale_session_refuses_setup_frames(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite = _invite(client)
    with _joined(client, invite, "Ann") as (a, _):
        session = await repo.get_session_by_invite(db, invite)
        assert session is not None
        await db.execute("update rps_session set stale_at = now() where id = $1", session.id)
        a.send(type="redeal")
        assert a.next("error")["code"] == "session_stale"


# --- AC-7: nothing of B's setup reaches A ------------------------------------------------------


def test_ac7_frames_to_a_during_b_setup_hide_b(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        a, _ = stack.enter_context(_joined(client, invite, "Ann"))
        b, _ = stack.enter_context(_joined(client, invite, "Bob"))
        a.state(lambda st: st["seats"]["b"] is not None)
        a.send(type="start")
        a_start = a.state(lambda st: st["game"] is not None)
        b_state = b.state(lambda st: st["game"] is not None)
        assert a_start["game"]["status"] == "setup"
        # Per recipient: B sees its own kinds, A none of them.
        assert all(p["kind"] is not None for p in _side_pieces(b_state, "b"))
        assert all(p["kind"] is not None for p in _side_pieces(a_start, "a"))
        a.frames.clear()

        flag = next(p["square"] for p in _side_pieces(b_state, "b") if p["kind"] == "flag")
        targets = [sq for sq in home_squares("b") if _kind_at(b_state, sq) not in ("flag", "trap")]
        b.send(type="place", what="flag", square=targets[0])
        b_state = b.state(lambda st: _kind_at(st, targets[0]) == "flag")
        b.send(type="place", what="trap", square=flag)
        b_state = b.state(lambda st: _kind_at(st, flag) == "trap")
        for _ in range(3):
            b.send(type="redeal")
            b_state = b.state()
        b.send(type="ready")
        b.state(lambda st: st["game"]["ready"]["b"])

        # A received one state per B action, each the same view of side b.
        states = [a.state() for _ in range(6)]
        assert states[-1]["game"]["ready"]["b"] is True
        before = _side_pieces(a_start, "b")
        for frame in a.frames:
            assert frame["type"] == "state"
            assert "event" not in frame
            b_pieces = _side_pieces(frame["state"], "b")
            assert all(p["kind"] is None and p["revealed"] is False for p in b_pieces)
            assert b_pieces == before


def test_setup_frames_refused_to_the_sender(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        a, _ = stack.enter_context(_joined(client, invite, "Ann"))
        b, _ = stack.enter_context(_joined(client, invite, "Bob"))
        c, _ = stack.enter_context(_joined(client, invite, "Cy"))
        c.send(type="start")
        assert c.next("error")["code"] == "not_a_player"
        a.send(type="start")
        a.state(lambda st: st["game"] is not None)
        c.send(type="redeal")
        assert c.next("error")["code"] == "not_a_player"
        a.send(type="place", what="flag", square=home_squares("b")[0])
        assert a.next("error")["code"] == "not_home_square"
        a.send(type="ready")
        a.state(lambda st: st["game"]["ready"]["a"])
        a.send(type="ready")
        assert a.next("error")["code"] == "already_ready"
        a.send(type="redeal")
        assert a.next("error")["code"] == "already_ready"
        assert not any(f["type"] == "error" for f in b.frames)


# --- AC-22: a viewer seated for the next game gets the player view only ------------------------


async def test_ac22_viewer_of_game_1_seated_in_game_2_gets_player_view(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({0: "a rock", 1: "a flag", 41: "b paper", 40: "b flag"})
    fixed = await fixed_game(db, board)
    await repo.end_game(db, fixed.game.id, result="a", reason="flag")
    invite = fixed.session.invite_id
    with ExitStack() as stack:
        a, _ = stack.enter_context(_joined(client, invite, rejoin=fixed.token_a))
        b, _ = stack.enter_context(_joined(client, invite, rejoin=fixed.token_b))
        c, wc = stack.enter_context(_joined(client, invite, "Cy"))
        assert wc["state"]["you"] == "viewer"
        a.send(type="leave_seat")
        c.state(lambda st: st["seats"]["a"] is None)
        c.send(type="take_seat", side="a")
        c.state(lambda st: st["you"] == "a")
        c.frames.clear()
        c.send(type="start")
        game2 = c.state(lambda st: st["game"]["status"] == "setup")
        assert game2["you"] == "a"
        assert all(p["kind"] is not None for p in _side_pieces(game2, "a"))
        assert all(p["kind"] is None for p in _side_pieces(game2, "b"))
        for frame in c.frames:
            assert frame["state"]["you"] == "a"
        # The former player, now a viewer, sees every kind.
        seen_by_a = a.state(lambda st: st["game"]["status"] == "setup")
        assert seen_by_a["you"] == "viewer"
        assert all(p["kind"] is not None for p in seen_by_a["game"]["pieces"])


# --- FR-24: a reload restores setup as it was --------------------------------------------------


def test_fr24_rejoin_mid_setup_restores_pieces_and_ready(client: TestClient) -> None:
    invite = _invite(client)
    with _joined(client, invite, "Ann") as (a, _):
        with _joined(client, invite, "Bob") as (b, wb):
            token = wb["rejoin_token"]
            a.send(type="start")
            a.state(lambda st: st["game"] is not None)
            b.state(lambda st: st["game"] is not None)
            b.send(type="redeal")
            b.state()
            a.send(type="ready")
            last = b.state(lambda st: st["game"]["ready"]["a"])
        a.state(lambda st: st["seats"]["b"]["away"])
        with _joined(client, invite, "ignored", rejoin=token) as (_, back):
            restored = back["state"]
            assert back["you"]["participant_id"] == wb["you"]["participant_id"]
            assert restored["you"] == "b"
            assert restored["game"]["pieces"] == last["game"]["pieces"]
            assert restored["game"]["ready"] == {"a": True, "b": False}
