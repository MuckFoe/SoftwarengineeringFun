"""Spec 021 task 29: a Rock Paper Siege setup not yet confirmed and a duel waiting for a pick
survive an app restart. AC-23 (FR-24, NFR-3).

A "restart" is a fresh app on the same database, as in the chess restart test: the hubs and
every in-memory cache are gone, so everything checked below must come back from the tables.
Real Postgres and the real app; nothing mocked. Marked `slow`.
"""

from collections.abc import Iterator
from contextlib import ExitStack, contextmanager

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.games.rps.rules import home_squares
from app.main import create_app
from tests.fixtures.rps_board import fixed_game, pieces
from tests.integration.test_rps_ws import _invite, _joined, _kind_at, _side_pieces
from tests.integration.test_rps_ws_game import _migrated, _move, _settings, _Socket, _url

pytestmark = pytest.mark.slow


@contextmanager
def _app(database_url: str) -> Iterator[TestClient]:
    with TestClient(create_app(_settings(database_url))) as client:
        yield client


@contextmanager
def _player(client: TestClient, invite: str, token: str) -> Iterator[tuple[_Socket, dict]]:
    """A rejoin by token on a socket that can also wait for events."""
    with client.websocket_connect(_url(invite, rejoin=token)) as ws:
        socket = _Socket(ws)
        welcome = socket.next("welcome")
        yield socket, welcome


def _without_away(state: dict) -> dict:
    seats = {
        side: seat and {k: v for k, v in seat.items() if k != "away"}
        for side, seat in state["seats"].items()
    }
    return {**state, "seats": seats}


async def test_ac23_unconfirmed_setup_and_pending_duel_pick_survive_a_restart(
    database_url: str, db: asyncpg.Connection
) -> None:
    await _migrated(database_url)
    # Session 2: B is mid-game; A has attacked a same-kind piece and already picked.
    duel_board = pieces({14: "a rock", 0: "a flag", 21: "b rock", 35: "b paper", 41: "b flag"})
    duel_game = await fixed_game(db, duel_board, names=("Dee", "Bo"))
    duel_invite = duel_game.session.invite_id

    with _app(database_url) as client:
        # Session 1: A moves the flag during setup and does not press Ready.
        setup_invite = _invite(client)
        with ExitStack() as stack:
            a, a_welcome = stack.enter_context(_joined(client, setup_invite, "Ann"))
            other, _ = stack.enter_context(_joined(client, setup_invite, "Cal"))
            a.state(lambda st: st["seats"]["b"] is not None)
            a.send(type="start")
            dealt = a.state(lambda st: st["game"] is not None)
            other.state(lambda st: st["game"] is not None)
            target = next(
                sq for sq in home_squares("a") if _kind_at(dealt, sq) not in ("flag", "trap")
            )
            a.send(type="place", what="flag", square=target)
            placed = a.state(lambda st: _kind_at(st, target) == "flag")
            assert placed["game"]["ready"]["a"] is False

        with ExitStack() as stack:
            da, _ = stack.enter_context(_player(client, duel_invite, duel_game.token_a))
            b, _ = stack.enter_context(_player(client, duel_invite, duel_game.token_b))
            _move(da, 14, 21)
            for s in (da, b):
                s.event("duel")
            da.send(type="duel_pick", weapon="rock")
            asked = b.state(lambda st: st["game"]["duel"]["picked"]["a"])
            da.state(lambda st: st["game"]["duel"]["picked"]["a"])
    duel_before = asked["game"]["duel"]
    assert duel_before["picked"] == {"a": True, "b": False}
    assert duel_before["your_pick"] is None

    with _app(database_url) as client:  # restarted
        # A reloads: the flag stays where it was put, the dealt fighters are unchanged, and
        # the setup is still unconfirmed.
        with _joined(client, setup_invite, rejoin=a_welcome["rejoin_token"]) as (_, back):
            restored = back["state"]
            assert back["you"]["participant_id"] == a_welcome["you"]["participant_id"]
            assert restored["you"] == "a"
            assert restored["game"]["status"] == "setup"
            assert _kind_at(restored, target) == "flag"
            assert _side_pieces(restored, "a") == _side_pieces(placed, "a")
            assert restored["game"]["pieces"] == placed["game"]["pieces"]
            assert restored["game"]["ready"] == {"a": False, "b": False}

        # B reloads: still asked for the same duel pick, A's pick still hidden from B.
        with ExitStack() as stack:
            b, b_back = stack.enter_context(_player(client, duel_invite, duel_game.token_b))
            assert _without_away(b_back["state"])["game"] == _without_away(asked)["game"]
            assert b_back["state"]["game"]["duel"] == duel_before
            assert b_back["state"]["game"]["turn"] is None

            da, a_back = stack.enter_context(_player(client, duel_invite, duel_game.token_a))
            assert a_back["state"]["game"]["duel"]["your_pick"] == "rock"
            assert a_back["state"]["game"]["duel"]["round"] == duel_before["round"]

            # The duel goes on: B's pick settles it.
            b.send(type="duel_pick", weapon="scissors")
            for s in (da, b):
                event, state = s.event("duel_round")
                assert event["picks"] == {"a": "rock", "b": "scissors"}
                assert event["outcome"] == "attacker"
                assert state["game"]["duel"] is None
                assert state["game"]["turn"] == "b"
