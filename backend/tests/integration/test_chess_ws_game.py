"""Spec 014 task 22: starting a game over the chess socket. AC-9, AC-10, AC-30.
Real Postgres and the real app; nothing mocked.
"""

from contextlib import ExitStack

import asyncpg
from fastapi.testclient import TestClient

from tests.integration.test_chess_ws import _invite, _joined, client  # noqa: F401

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def _error(socket) -> str:
    return socket.next("error")["code"]


def test_ac9_start_needs_both_seats_and_a_player(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with ExitStack() as stack:
        a, _ = stack.enter_context(_joined(client, invite, "Ann"))
        a.send(type="start")
        assert _error(a) == "seats_incomplete"
        stack.enter_context(_joined(client, invite, "Bob"))
        c, _ = stack.enter_context(_joined(client, invite, "Cy"))
        c.send(type="start")
        assert _error(c) == "not_a_player"


def test_ac10_start_shows_the_starting_position_to_everyone(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with ExitStack() as stack:
        socks = [stack.enter_context(_joined(client, invite, n))[0] for n in ("Ann", "Bob", "Cy")]
        socks[1].send(type="start")
        for s in socks:
            game = s.state(lambda st: st["game"] is not None)["game"]
            assert game["fen"] == START_FEN
            assert game["turn"] == "white"
            assert game["ply"] == 0
            assert game["status"] == "in_progress"
            assert game["moves"] == []
        # Seats are now locked, and a second start is refused.
        socks[0].send(type="start")
        assert _error(socks[0]) == "game_in_progress"
        socks[0].send(type="leave_seat")
        assert _error(socks[0]) == "game_in_progress"


async def test_ac30_concurrent_starts_make_one_game(
    client: TestClient,  # noqa: F811
    db: asyncpg.Connection,
) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        socks = [stack.enter_context(_joined(client, invite, n))[0] for n in ("Ann", "Bob", "Cy")]
        socks[0].send(type="start")
        socks[1].send(type="start")
        # Each player then probes with leave_seat (always game_in_progress once a game runs);
        # the one whose start lost has one more error than the other.
        errors = []
        games = []
        for s in socks[:2]:
            s.send(type="leave_seat")
            count = 0
            seen_game = False
            while not (seen_game and count >= 1):
                frame = s.ws.receive_json()
                count += frame["type"] == "error"
                if frame["type"] == "state" and frame["state"]["game"] is not None:
                    seen_game = True
                    game = frame["state"]["game"]
            errors.append(count)
            games.append(game)
        assert sum(errors) >= 2
        final = socks[2].state(lambda st: st["game"] is not None)["game"]
        assert final == games[0] == games[1]
    count = await db.fetchval(
        "select count(*) from chess_game g join chess_session s on s.id = g.session_id"
        " where s.invite_id = $1",
        invite,
    )
    assert count == 1


# --- task 23: moves and automatic game end ----------------------------------------------------


def _mv(sock, frm: str, to: str, ply: int, promotion: str | None = None) -> None:
    extra = {"promotion": promotion} if promotion else {}
    sock.send(type="move", **{"from": frm, "to": to}, ply=ply, **extra)


def _play(white, black, moves: list[tuple[str, str]]) -> None:
    """Plays `moves` alternately (white first), waiting for each to be applied."""
    for i, (frm, to) in enumerate(moves):
        mover = white if i % 2 == 0 else black
        _mv(mover, frm, to, i)
        for s in (white, black):
            s.state(lambda st, n=i + 1: st["game"]["ply"] == n)


def _started(stack: ExitStack, client: TestClient, viewer: bool = True):  # noqa: F811
    invite = _invite(client)
    names = ("Ann", "Bob", "Cy") if viewer else ("Ann", "Bob")
    socks = [stack.enter_context(_joined(client, invite, n))[0] for n in names]
    socks[0].send(type="start")
    for s in socks:
        s.state(lambda st: st["game"] is not None)
    return socks


def test_ac12_only_the_player_to_move_can_move(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, viewer = _started(stack, client)
        _mv(black, "e7", "e5", 0)
        assert _error(black) == "not_your_turn"
        _mv(viewer, "e2", "e4", 0)
        assert _error(viewer) == "not_a_player"
        _mv(white, "e7", "e5", 0)  # a black piece
        assert _error(white) == "illegal_move"
        white.send(type="leave_seat")
        assert _error(white) == "game_in_progress"
        _mv(white, "e2", "e4", 0)
        assert white.state(lambda st: st["game"]["ply"] == 1)["game"]["ply"] == 1


def test_ac14_illegal_and_stale_moves_are_refused(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, _ = _started(stack, client)
        _mv(white, "e2", "e5", 0)
        assert _error(white) == "illegal_move"
        _mv(white, "e2", "e4", 3)
        assert _error(white) == "out_of_date"
        _mv(white, "e2", "e4", 0)
        black.state(lambda st: st["game"]["ply"] == 1)
        _mv(black, "e7", "e5", 0)
        assert _error(black) == "out_of_date"
        _mv(black, "e7", "e5", 1)
        assert white.state(lambda st: st["game"]["ply"] == 2)["game"]["ply"] == 2


def test_move_without_a_game_is_no_game(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with ExitStack() as stack:
        a, _ = stack.enter_context(_joined(client, invite, "Ann"))
        _mv(a, "e2", "e4", 0)
        assert _error(a) == "no_game"


def test_ac15_promotion_choice(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, _ = _started(stack, client)
        _play(
            white,
            black,
            [("h2", "h4"), ("g7", "g5"), ("h4", "g5"), ("h7", "h6"), ("g5", "h6"),
             ("f7", "f6"), ("h6", "h7"), ("e7", "e6")],
        )  # fmt: skip
        _mv(white, "h7", "g8", 8)
        assert _error(white) == "promotion_required"
        _mv(white, "h7", "g8", 8, "n")
        game = white.state(lambda st: st["game"]["ply"] == 9)["game"]
        assert game["fen"].split("/")[0] == "rnbqkbNr"
        assert game["moves"][-1]["san"] == "hxg8=N"


def test_ac16_ac19_move_is_shown_to_everyone_and_reload_keeps_it(
    client: TestClient,  # noqa: F811
) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        white, black, viewer = (
            stack.enter_context(_joined(client, invite, n))[0] for n in ("Ann", "Bob", "Cy")
        )
        white.send(type="start")
        _mv(white, "e2", "e4", 0)
        for s in (white, black, viewer):
            game = s.state(lambda st: st["game"] is not None and st["game"]["ply"] == 1)["game"]
            assert game["last_move"] == {"san": "e4", "from": "e2", "to": "e4"}
            assert game["moves"][0]["san"] == "e4"
            assert game["fen"].split(" ")[0].split("/")[4] == "4P3"
        script = [("e7", "e5"), ("g1", "f3"), ("b8", "c6"), ("f1", "c4"), ("g8", "f6"),
                  ("d2", "d3"), ("f8", "c5"), ("c1", "e3"), ("c5", "e3")]  # fmt: skip
        for i, (frm, to) in enumerate(script):
            _mv(black if i % 2 == 0 else white, frm, to, i + 1)
            for s in (white, black):
                s.state(lambda st, n=i + 2: st["game"]["ply"] == n)
        with _joined(client, invite, "Dee") as (_, welcome):
            game = welcome["state"]["game"]
            assert len(game["moves"]) == 10
            assert game["turn"] == "white"
            assert game["ply"] == 10


def test_ac20_checkmate_ends_the_game_and_ac11_start_again(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, viewer = _started(stack, client)
        _mv(white, "f2", "f3", 0)
        black.state(lambda st: st["game"]["ply"] == 1)
        _mv(black, "e7", "e5", 1)
        white.state(lambda st: st["game"]["ply"] == 2)
        _mv(white, "g2", "g4", 2)
        black.state(lambda st: st["game"]["ply"] == 3)
        _mv(black, "d8", "h4", 3)
        for s in (white, black, viewer):
            game = s.state(lambda st: st["game"]["status"] == "ended")["game"]
            assert game["result"] == "black"
            assert game["reason"] == "checkmate"
            assert game["legal"] == {}
        _mv(white, "a2", "a3", 4)
        assert _error(white) == "no_game"
        white.send(type="leave_seat")
        white.state(lambda st: st["seats"]["white"] is None)
        white.send(type="take_seat", color="white")
        white.state(lambda st: st["seats"]["white"] is not None)
        black.send(type="start")
        game = white.state(lambda st: st["game"]["status"] == "in_progress")["game"]
        assert game["ply"] == 0
        assert game["moves"] == []


def test_ac21_threefold_repetition_is_a_draw(client: TestClient) -> None:  # noqa: F811
    with ExitStack() as stack:
        white, black, _ = _started(stack, client)
        shuffle = [("g1", "f3"), ("g8", "f6"), ("f3", "g1"), ("f6", "g8")]
        _play(white, black, shuffle)  # the start position has now occurred twice
        _play_from(white, black, shuffle[:3], start=4)
        _mv(black, "f6", "g8", 7)  # ... and now a third time
        game = white.state(lambda st: st["game"]["status"] == "ended")["game"]
        assert game["result"] == "draw"
        assert game["reason"] == "threefold_repetition"


def _play_from(white, black, moves: list[tuple[str, str]], start: int) -> None:
    for i, (frm, to) in enumerate(moves, start):
        _mv(white if i % 2 == 0 else black, frm, to, i)
        for s in (white, black):
            s.state(lambda st, n=i + 1: st["game"]["ply"] == n)
