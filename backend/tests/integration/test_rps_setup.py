"""Spec 021 task 15: rps service lifecycle (FR-2, FR-4, FR-5, FR-6, FR-8, FR-18, NFR-1).

AC-4 a started game holds 4/4/4 + flag + trap per side on home rows. AC-6 setup locks on Ready;
the second Ready starts play with `first_side` to move. AC-8 consecutive games alternate the
first mover. FR-2 joining, seats and Start as chess: Start only for players, refused during a
running game, allowed again after it ended. FR-18 a side with no legal move at the start of
play loses at once.
"""

import uuid
from collections import Counter
from collections.abc import AsyncIterator, Awaitable

import asyncpg
import pytest

from app import db as app_db
from app.games.chess.hub import ChessHub
from app.games.rps import repo, rules, service
from app.games.rps.service import Refused
from tests.fixtures.rps_board import fixed_game, pieces


class _Socket:
    async def send_json(self, data: object) -> None:  # pragma: no cover - never sent to
        pass


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


def _hub() -> ChessHub:
    return ChessHub(abandon_seconds=120)


async def _join(
    conn: asyncpg.Connection, session: repo.RpsSession, hub: ChessHub, name: str
) -> repo.Participant:
    current = await repo.get_session(conn, session.id)
    assert current is not None
    participant, _ = await service.join(
        conn, current, name=name, account=None, rejoin=None, hub=hub
    )
    hub.add(participant.id, _Socket(), name)
    return participant


async def _three(
    conn: asyncpg.Connection, hub: ChessHub
) -> tuple[repo.RpsSession, repo.Participant, repo.Participant, repo.Participant]:
    session = await service.create_session(conn)
    ana = await _join(conn, session, hub, "Ana")
    bo = await _join(conn, session, hub, "Bo")
    cy = await _join(conn, session, hub, "Cy")
    return session, ana, bo, cy


async def _game_id(conn: asyncpg.Connection, session_id: uuid.UUID) -> uuid.UUID:
    row = await repo.get_session(conn, session_id)
    assert row is not None and row.current_game_id is not None
    return row.current_game_id


def _side_pieces(board: rules.Board, side: rules.Side) -> dict[int, rules.Piece]:
    return {sq: p for sq, p in board.items() if p.side == side}


async def _refused(call: Awaitable[object], code: str) -> None:
    with pytest.raises(Refused) as err:
        await call
    assert err.value.code == code


# --- FR-2: joining and seats, as chess --------------------------------------------------------


async def test_first_two_are_players_third_is_a_viewer(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session, ana, bo, cy = await _three(migrated, hub)
    row = await repo.get_session(migrated, session.id)
    assert row is not None
    assert row.starter_participant_id == ana.id
    assert (row.a_participant_id, row.b_participant_id) == (ana.id, bo.id)
    assert hub.seated == {ana.id, bo.id}
    full = await service.snapshot(migrated, session.id, hub)
    assert full.seat_a is not None and full.seat_a.name == "Ana"
    assert full.seat_b is not None and full.seat_b.name == "Bo"
    assert [v.name for v in full.viewers] == ["Cy"]
    assert full.game is None and full.stale is False


async def test_viewer_takes_a_seat_only_when_free(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session, _ana, bo, cy = await _three(migrated, hub)
    await _refused(service.take_seat(migrated, session.id, cy.id, "b", hub=hub), "seat_taken")
    full = await service.leave_seat(migrated, session.id, bo.id, hub=hub)
    assert full.seat_b is None
    full = await service.take_seat(migrated, session.id, cy.id, "b", hub=hub)
    assert full.seat_b is not None and full.seat_b.name == "Cy"
    assert [v.name for v in full.viewers] == ["Bo"]


async def test_seat_changes_refused_during_a_game(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session, ana, bo, cy = await _three(migrated, hub)
    await service.start(migrated, session.id, ana.id, hub=hub)
    await _refused(service.take_seat(migrated, session.id, cy.id, "a", hub=hub), "game_in_progress")
    await _refused(service.leave_seat(migrated, session.id, bo.id, hub=hub), "game_in_progress")


# --- AC-4 (FR-4): the deal ---------------------------------------------------------------------


async def test_started_game_deals_four_of_each_plus_flag_and_trap(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    session, ana, _bo, _cy = await _three(migrated, hub)
    full = await service.start(migrated, session.id, ana.id, hub=hub)
    assert full.game is not None and full.game.status == "setup"
    assert full.game.turn is None and full.game.duel is None
    assert hub.game_in_progress is True
    for side in ("a", "b"):
        mine = _side_pieces(full.game.board, side)
        assert sorted(mine) == rules.home_squares(side)
        assert Counter(p.kind for p in mine.values()) == {
            "rock": 4,
            "paper": 4,
            "scissors": 4,
            "flag": 1,
            "trap": 1,
        }
        assert not any(p.revealed for p in mine.values())
    assert full.game.board == await repo.list_pieces(migrated, await _game_id(migrated, session.id))


async def test_place_moves_flag_and_trap_anywhere_home_and_redeal_keeps_them(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    session, ana, bo, _cy = await _three(migrated, hub)
    await service.start(migrated, session.id, ana.id, hub=hub)
    full = await service.place(migrated, session.id, bo.id, "flag", 41, hub=hub)
    full = await service.place(migrated, session.id, bo.id, "trap", 28, hub=hub)
    assert full.game.board[41].kind == "flag" and full.game.board[28].kind == "trap"
    await _refused(
        service.place(migrated, session.id, bo.id, "flag", 3, hub=hub), "not_home_square"
    )
    before = _side_pieces(full.game.board, "a")
    full = await service.redeal(migrated, session.id, bo.id, hub=hub)
    assert full.game.board[41].kind == "flag" and full.game.board[28].kind == "trap"
    assert Counter(p.kind for p in _side_pieces(full.game.board, "b").values())["rock"] == 4
    assert _side_pieces(full.game.board, "a") == before


async def test_setup_refused_for_a_viewer(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session, ana, _bo, cy = await _three(migrated, hub)
    await service.start(migrated, session.id, ana.id, hub=hub)
    await _refused(service.place(migrated, session.id, cy.id, "flag", 0, hub=hub), "not_a_player")
    await _refused(service.redeal(migrated, session.id, cy.id, hub=hub), "not_a_player")
    await _refused(service.ready(migrated, session.id, cy.id, hub=hub), "not_a_player")


# --- AC-6 (FR-6): Ready locks the setup; the second Ready starts play -------------------------


async def test_ready_locks_setup_and_second_ready_starts_play(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    session, ana, bo, _cy = await _three(migrated, hub)
    started = await service.start(migrated, session.id, ana.id, hub=hub)
    assert started.game is not None
    full = await service.ready(migrated, session.id, ana.id, hub=hub)
    assert full.game is not None and full.game.a_ready and not full.game.b_ready
    assert full.game.status == "setup" and full.game.turn is None
    locked = _side_pieces(full.game.board, "a")
    await _refused(
        service.place(migrated, session.id, ana.id, "flag", 13, hub=hub), "already_ready"
    )
    await _refused(service.redeal(migrated, session.id, ana.id, hub=hub), "already_ready")
    await _refused(service.ready(migrated, session.id, ana.id, hub=hub), "already_ready")
    after = await service.snapshot(migrated, session.id, hub)
    assert _side_pieces(after.game.board, "a") == locked
    # The other player can still change theirs.
    await service.redeal(migrated, session.id, bo.id, hub=hub)

    full = await service.ready(migrated, session.id, bo.id, hub=hub)
    assert full.game is not None and full.game.status == "play"
    assert full.game.turn == started.game.first
    await _refused(service.redeal(migrated, session.id, bo.id, hub=hub), "already_ready")


# --- FR-18 at the start of play -----------------------------------------------------------------


async def test_first_mover_without_a_legal_move_loses_on_second_ready(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    board = pieces({0: "a flag", 1: "a trap", 40: "b flag", 41: "b trap", 35: "b rock"})
    fixed = await fixed_game(migrated, board, first_side="a", ready=False)
    await service.ready(migrated, fixed.session.id, fixed.b.id, hub=hub)
    full = await service.ready(migrated, fixed.session.id, fixed.a.id, hub=hub)
    assert full.game is not None and full.game.status == "ended"
    assert (full.game.result, full.game.reason) == ("b", "no_moves")
    assert full.game.turn is None
    assert hub.game_in_progress is False


# --- AC-8 (FR-8) and FR-2: Start ---------------------------------------------------------------


async def test_consecutive_games_alternate_the_first_mover(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session, ana, bo, _cy = await _three(migrated, hub)
    sides = []
    for _ in range(3):
        full = await service.start(migrated, session.id, bo.id, hub=hub)
        assert full.game is not None
        sides.append(full.game.first)
        game_id = await _game_id(migrated, session.id)
        await repo.end_game(migrated, game_id, result="draw", reason="agreement")
    assert sides[1] != sides[0] and sides[2] == sides[0]
    assert ana.id != bo.id


async def test_start_only_for_players_and_not_during_a_running_game(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    session, ana, bo, cy = await _three(migrated, hub)
    await _refused(service.start(migrated, session.id, cy.id, hub=hub), "not_a_player")
    first = await service.start(migrated, session.id, ana.id, hub=hub)
    assert first.game is not None
    await _refused(service.start(migrated, session.id, bo.id, hub=hub), "game_in_progress")
    first_id = await _game_id(migrated, session.id)
    await repo.end_game(migrated, first_id, result="a", reason="flag")
    again = await service.start(migrated, session.id, bo.id, hub=hub)
    assert again.game is not None and await _game_id(migrated, session.id) != first_id
    assert again.game.status == "setup"


async def test_start_needs_both_seats(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    ana = await _join(migrated, session, hub, "Ana")
    await _refused(service.start(migrated, session.id, ana.id, hub=hub), "seats_incomplete")


async def test_stale_session_refuses_setup(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session, ana, _bo, _cy = await _three(migrated, hub)
    await migrated.execute("update rps_session set stale_at = now() where id = $1", session.id)
    await _refused(service.start(migrated, session.id, ana.id, hub=hub), "session_stale")
    assert (await service.snapshot(migrated, session.id, hub)).stale is True
