"""Spec 021 task 27: the Rock Paper Siege socket's game frames (`move`, `duel_pick`,
`offer_draw`, `answer_draw`, `resign`, `claim_win`), each connection getting its own state and
event after every commit. AC-11, AC-12, AC-13, AC-15, AC-16, AC-19, AC-20, AC-21. Real Postgres
and the real app; nothing mocked. Boards come from `fixed_game`; squares are `row * 7 + col`,
side a's home rows at the bottom (0, 1), side b's at the top (4, 5).
"""

import json
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app
from tests.fixtures.rps_board import FixedGame, fixed_game, pieces

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


def _settings(database_url: str, **extra: object) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",  # noqa: S106
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
        **extra,  # type: ignore[arg-type]
    )


async def _migrated(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


@pytest.fixture
async def quick_client(database_url: str) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
    settings = _settings(database_url, chess_abandon_seconds=0.3)
    with TestClient(create_app(settings)) as test_client:
        yield test_client


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

    def event(self, kind: str) -> tuple[dict, dict]:
        """The next state frame carrying an event of `kind`: (event, state)."""
        while True:
            frame = self.next("state")
            event = frame.get("event")
            if event is not None and event["kind"] == kind:
                return event, frame["state"]


@contextmanager
def _joined(
    client: TestClient, invite: str, name: str | None = None, *, rejoin: str | None = None
) -> Iterator[_Socket]:
    with client.websocket_connect(_url(invite, name, rejoin)) as ws:
        socket = _Socket(ws)
        socket.next("welcome")
        yield socket


def _three(stack: ExitStack, client: TestClient, fixed: FixedGame) -> tuple[_Socket, ...]:
    """A and B by rejoin token, then a viewer; each has seen everyone arrive."""
    invite = fixed.session.invite_id
    a = stack.enter_context(_joined(client, invite, rejoin=fixed.token_a))
    b = stack.enter_context(_joined(client, invite, rejoin=fixed.token_b))
    v = stack.enter_context(_joined(client, invite, "Cy"))
    for s in (a, b):
        s.state(lambda st: len(st["viewers"]) == 1)
    for s in (a, b, v):
        s.frames.clear()
    return a, b, v


def _piece(state: dict, square: int) -> dict | None:
    return next((p for p in state["game"]["pieces"] if p["square"] == square), None)


def _move(socket: _Socket, frm: int, to: int) -> None:
    socket.send(type="move", **{"from": frm, "to": to})


def _every_kind_shown(state: dict) -> bool:
    return all(p["kind"] is not None for p in state["game"]["pieces"])


# --- AC-11: a hidden step ----------------------------------------------------------------------


async def test_ac11_hidden_step_passes_the_turn_and_stays_hidden(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({7: "a rock", 0: "a flag", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        a, b, v = _three(stack, client, fixed)
        _move(a, 7, 14)
        seen = {name: s.event("moved") for name, s in (("a", a), ("b", b), ("v", v))}
        for event, state in seen.values():
            assert event == {"kind": "moved", "from": 7, "to": 14}
            assert state["game"]["turn"] == "b"
            assert _piece(state, 7) is None
        assert _piece(seen["b"][1], 14) == {
            "square": 14,
            "side": "a",
            "kind": None,
            "revealed": False,
        }
        assert _piece(seen["a"][1], 14)["kind"] == "rock"
        assert _piece(seen["v"][1], 14)["kind"] == "rock"
        assert seen["b"][1]["game"]["legal"] and not seen["a"][1]["game"]["legal"]


async def test_refusals_go_to_the_sender_only(client: TestClient, db: asyncpg.Connection) -> None:
    board = pieces({7: "a rock", 0: "a flag", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        a, b, v = _three(stack, client, fixed)
        _move(b, 35, 28)
        assert b.next("error")["code"] == "not_your_turn"
        _move(a, 7, 21)  # not adjacent
        assert a.next("error")["code"] == "illegal_move"
        v.send(type="duel_pick", weapon="rock")
        assert v.next("error")["code"] == "not_a_player"
        a.send(type="duel_pick", weapon="rock")
        assert a.next("error")["code"] == "no_duel"
        _move(a, 7, 14)
        for s in (a, b, v):
            s.event("moved")
        # Each error went to its sender only.
        assert [f["code"] for f in b.frames if f["type"] == "error"] == ["not_your_turn"]
        assert [f["code"] for f in v.frames if f["type"] == "error"] == ["not_a_player"]
        assert [f["code"] for f in a.frames if f["type"] == "error"] == ["illegal_move", "no_duel"]


def _errors_of(socket: _Socket) -> list[dict]:
    return [f for f in socket.frames if f["type"] == "error"]


async def test_malformed_game_frames_are_ignored(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({7: "a rock", 0: "a flag", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        a, _b, _v = _three(stack, client, fixed)
        a.send(type="move", **{"from": "7", "to": 14})
        a.send(type="move", **{"from": True, "to": 14})
        a.send(type="duel_pick", weapon=3)
        a.send(type="answer_draw", accept="yes")
        _move(a, 7, 14)
        a.event("moved")
        assert _errors_of(a) == []


# --- AC-12: a fight ----------------------------------------------------------------------------


async def test_ac12_fight_shows_both_weapons_and_reveals_the_winner(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({14: "a rock", 0: "a flag", 21: "b scissors", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        a, b, v = _three(stack, client, fixed)
        _move(a, 14, 21)
        for s in (a, b, v):
            event, state = s.event("fight")
            assert event == {
                "kind": "fight",
                "from": 14,
                "to": 21,
                "attacker": "rock",
                "defender": "scissors",
                "winner": "attacker",
            }
            assert _piece(state, 21) == {
                "square": 21,
                "side": "a",
                "kind": "rock",
                "revealed": True,
            }
            assert _piece(state, 14) is None
            assert state["game"]["turn"] == "b"


# --- AC-13, AC-21: duel picks stay secret until both are in ------------------------------------


def _duel_frames(socket: _Socket) -> list[dict]:
    return [
        f["state"]["game"]["duel"]
        for f in socket.frames
        if f["type"] == "state" and f["state"]["game"]["duel"] is not None
    ]


async def test_ac13_ac21_duel_picks_reach_nobody_before_both_are_in(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({14: "a rock", 0: "a flag", 21: "b rock", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        a, b, v = _three(stack, client, fixed)
        _move(a, 14, 21)
        for s in (a, b, v):
            event, state = s.event("duel")
            assert event == {"kind": "duel", "from": 14, "to": 21, "weapon": "rock"}
            assert state["game"]["turn"] is None
            s.frames.clear()

        # Round 1, B first: until A picks, A's and the viewer's frames say only that B picked.
        b.send(type="duel_pick", weapon="paper")
        for s in (a, v):
            s.state(lambda st: st["game"]["duel"]["picked"]["b"])
        mine = b.state(lambda st: st["game"]["duel"]["picked"]["b"])
        assert mine["game"]["duel"]["your_pick"] == "paper"
        for s in (a, v):
            for duel in _duel_frames(s):
                assert duel["your_pick"] is None
                assert duel["last_round"] is None
            assert "paper" not in json.dumps([f.get("event") for f in s.frames])
        a.send(type="duel_pick", weapon="paper")
        for s in (a, b, v):
            event, state = s.event("duel_round")
            assert event == {
                "kind": "duel_round",
                "picks": {"a": "paper", "b": "paper"},
                "outcome": "again",
            }
            duel = state["game"]["duel"]
            assert duel["round"] == 2
            assert duel["last_round"] == {"a": "paper", "b": "paper"}
            assert duel["picked"] == {"a": False, "b": False}
            s.frames.clear()

        # Round 2, A first: nothing of A's pick reaches B or the viewer until B picks.
        a.send(type="duel_pick", weapon="rock")
        for s in (b, v):
            s.state(lambda st: st["game"]["duel"]["picked"]["a"])
            for duel in _duel_frames(s):
                assert duel["your_pick"] is None
            assert all(f.get("event") is None for f in s.frames)
        b.send(type="duel_pick", weapon="scissors")
        for s in (a, b, v):
            event, state = s.event("duel_round")
            assert event["picks"] == {"a": "rock", "b": "scissors"}
            assert event["outcome"] == "attacker"
            assert state["game"]["duel"] is None
            assert _piece(state, 21) == {
                "square": 21,
                "side": "a",
                "kind": "rock",
                "revealed": True,
            }
            assert state["game"]["turn"] == "b"
        a.send(type="duel_pick", weapon="rock")
        assert a.next("error")["code"] == "no_duel"


async def test_duel_refuses_a_second_pick_and_a_move(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({14: "a rock", 0: "a flag", 21: "b rock", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        a, b, _v = _three(stack, client, fixed)
        _move(a, 14, 21)
        b.event("duel")
        b.send(type="duel_pick", weapon="rock")
        b.state(lambda st: st["game"]["duel"]["picked"]["b"])
        b.send(type="duel_pick", weapon="paper")
        assert b.next("error")["code"] == "already_picked"
        _move(b, 35, 28)
        assert b.next("error")["code"] == "duel_pending"


# --- AC-15: the trap -----------------------------------------------------------------------------


async def test_ac15_trap_catches_attackers_and_stays_hidden(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces(
        {
            14: "a rock",
            22: "a scissors",
            0: "a flag",
            21: "b trap",
            35: "b paper",
            41: "b flag",
        }
    )
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        a, b, v = _three(stack, client, fixed)
        _move(a, 14, 21)
        seen = {name: s.event("trapped") for name, s in (("a", a), ("b", b), ("v", v))}
        assert seen["a"][0] == {"kind": "trapped", "from": 14, "to": 21, "attacker": "rock"}
        assert seen["b"][0] == {"kind": "trapped", "from": 14, "to": 21, "attacker": None}
        assert seen["v"][0]["attacker"] == "rock"
        for _event, state in seen.values():
            assert _piece(state, 14) is None
            assert state["game"]["turn"] == "b"
        assert _piece(seen["a"][1], 21) == {
            "square": 21,
            "side": "b",
            "kind": None,
            "revealed": False,
        }
        assert _piece(seen["v"][1], 21)["kind"] == "trap"

        _move(b, 35, 28)
        a.event("moved")
        _move(a, 22, 21)
        event, state = a.event("trapped")
        assert event["attacker"] == "scissors"
        assert _piece(state, 22) is None
        assert _piece(state, 21)["side"] == "b"
        b_event, _ = b.event("trapped")
        assert b_event["attacker"] is None


# --- AC-16, AC-20: every ending, seen by everyone, with every kind -------------------------------


def _assert_ended(sockets: tuple[_Socket, ...], result: str, reason: str) -> None:
    for s in sockets:
        state = s.state(lambda st: st["game"]["status"] == "ended")
        assert state["game"]["result"] == result
        assert state["game"]["reason"] == reason
        assert _every_kind_shown(state)
        assert state["game"]["legal"] == {}


async def test_ac16_ac20_flag_capture_ends_the_game_for_everyone(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces(
        {34: "a rock", 0: "a flag", 1: "a trap", 41: "b flag", 40: "b trap", 35: "b paper"}
    )
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        sockets = _three(stack, client, fixed)
        _move(sockets[0], 34, 41)
        for s in sockets:
            event, state = s.event("flag")
            assert event == {"kind": "flag", "from": 34, "to": 41}
            assert state["game"]["status"] == "ended"
            assert state["game"]["result"] == "a"
            assert state["game"]["reason"] == "flag"
            assert _every_kind_shown(state)
            assert state["game"]["legal"] == {}


async def test_ac20_no_moves_ends_the_game_for_everyone(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({14: "a rock", 0: "a flag", 21: "b scissors", 41: "b flag", 40: "b trap"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        sockets = _three(stack, client, fixed)
        _move(sockets[0], 14, 21)
        _assert_ended(sockets, "a", "no_moves")


async def test_ac19_ac20_draw_offer_declined_then_accepted(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({7: "a rock", 0: "a flag", 1: "a trap", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        sockets = _three(stack, client, fixed)
        a, b, v = sockets
        a.send(type="offer_draw")
        for s in sockets:
            s.state(lambda st: st["game"]["draw_offer_by"] == "a")
        a.send(type="offer_draw")
        assert a.next("error")["code"] == "own_draw_offer"
        a.send(type="answer_draw", accept=True)
        assert a.next("error")["code"] == "own_draw_offer"
        b.send(type="answer_draw", accept=False)
        for s in sockets:
            state = s.state(lambda st: st["game"]["draw_offer_by"] is None)
            assert state["game"]["status"] == "play"
        b.send(type="answer_draw", accept=True)
        assert b.next("error")["code"] == "no_draw_offer"
        v.send(type="offer_draw")
        assert v.next("error")["code"] == "not_a_player"

        b.send(type="offer_draw")
        for s in sockets:
            s.state(lambda st: st["game"]["draw_offer_by"] == "b")
        a.send(type="answer_draw", accept=True)
        _assert_ended(sockets, "draw", "agreement")


async def test_ac20_resignation_shows_the_ending_then_closes(
    client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({7: "a rock", 0: "a flag", 1: "a trap", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        sockets = _three(stack, client, fixed)
        sockets[0].send(type="resign")
        _assert_ended(sockets, "b", "resignation")
        for s in sockets:
            closed = s.next("session_closed")
            assert closed == {"type": "session_closed", "result": "b", "reason": "resignation"}


async def test_resign_by_a_viewer_is_refused(client: TestClient, db: asyncpg.Connection) -> None:
    board = pieces({7: "a rock", 0: "a flag", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    with ExitStack() as stack:
        _a, _b, v = _three(stack, client, fixed)
        v.send(type="resign")
        assert v.next("error")["code"] == "not_a_player"
        v.send(type="claim_win")
        assert v.next("error")["code"] == "claim_not_available"


async def test_ac20_abandonment_claim_shows_the_ending_then_closes(
    quick_client: TestClient, db: asyncpg.Connection
) -> None:
    board = pieces({7: "a rock", 0: "a flag", 1: "a trap", 35: "b paper", 41: "b flag"})
    fixed = await fixed_game(db, board)
    invite = fixed.session.invite_id
    with ExitStack() as stack:
        a = stack.enter_context(_joined(quick_client, invite, rejoin=fixed.token_a))
        v = stack.enter_context(_joined(quick_client, invite, "Cy"))
        a.state(lambda st: st["game"]["claim_available_to"] == "a")
        a.frames.clear()
        a.send(type="claim_win")
        _assert_ended((a, v), "a", "abandonment")
        for s in (a, v):
            closed = s.next("session_closed")
            assert closed["result"] == "a"
            assert closed["reason"] == "abandonment"
