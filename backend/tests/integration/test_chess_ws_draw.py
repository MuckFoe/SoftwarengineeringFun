"""Spec 014 task 24: draw offers over the chess socket. AC-23.
Real Postgres and the real app; nothing mocked.
"""

from contextlib import ExitStack

from fastapi.testclient import TestClient

from tests.integration.test_chess_ws import _invite, _joined, client  # noqa: F401


def _error(socket) -> str:
    return socket.next("error")["code"]


def _game(sock, until=lambda g: True) -> dict:
    return sock.state(lambda st: st["game"] is not None and until(st["game"]))["game"]


def _started(client: TestClient, stack: ExitStack, names=("Ann", "Bob", "Cy")):  # noqa: F811
    invite = _invite(client)
    socks = [stack.enter_context(_joined(client, invite, n))[0] for n in names]
    socks[0].send(type="start")
    for s in socks:
        _game(s)
    return socks


def test_ac23_offer_then_accept_is_a_draw_by_agreement(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, viewer = _started(client, stack)
        white.send(type="offer_draw")
        for s in (white, black, viewer):
            assert _game(s, lambda g: g["draw_offer_by"] == "white")["status"] == "in_progress"
        black.send(type="answer_draw", accept=True)
        for s in (white, black, viewer):
            game = _game(s, lambda g: g["status"] == "ended")
            assert (game["result"], game["reason"]) == ("draw", "agreement")
            assert game["draw_offer_by"] is None


def test_ac23_offer_then_decline_continues_without_the_offer(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, _ = _started(client, stack)
        white.send(type="offer_draw")
        _game(black, lambda g: g["draw_offer_by"] == "white")
        black.send(type="answer_draw", accept=False)
        game = _game(white, lambda g: g["draw_offer_by"] is None)
        assert game["status"] == "in_progress"
        assert game["result"] is None


def test_ac23_a_move_clears_the_offer(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, _ = _started(client, stack)
        white.send(type="offer_draw")
        _game(black, lambda g: g["draw_offer_by"] == "white")
        white.send(type="move", **{"from": "e2", "to": "e4", "ply": 0})
        game = _game(black, lambda g: g["ply"] == 1)
        assert game["draw_offer_by"] is None
        # Black offers, and White's reply move clears Black's offer too.
        black.send(type="offer_draw")
        _game(white, lambda g: g["draw_offer_by"] == "black")
        black.send(type="move", **{"from": "e7", "to": "e5", "ply": 1})
        assert _game(white, lambda g: g["ply"] == 2)["draw_offer_by"] is None


def test_ac23_refusals(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, viewer = _started(client, stack)
        white.send(type="answer_draw", accept=True)
        assert _error(white) == "no_draw_offer"
        viewer.send(type="offer_draw")
        assert _error(viewer) == "not_a_player"
        white.send(type="offer_draw")
        _game(black, lambda g: g["draw_offer_by"] == "white")
        white.send(type="answer_draw", accept=True)
        assert _error(white) == "own_draw_offer"
        white.send(type="offer_draw")
        assert _error(white) == "own_draw_offer"
        viewer.send(type="answer_draw", accept=True)
        assert _error(viewer) == "not_a_player"
        # Nothing changed: the offer still stands.
        assert _game(viewer)["draw_offer_by"] == "white"


def test_offer_without_a_game_is_refused(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with _joined(client, invite, "Ann") as (a, _):
        a.send(type="offer_draw")
        assert _error(a) == "no_game"
