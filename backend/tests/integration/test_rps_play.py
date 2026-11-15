"""Spec 021 task 20: rps play service (FR-2, FR-11..FR-19, NFR-4) on fixed boards.

AC-6 no move before both Ready. AC-9 out of turn refused. AC-13 a duel asks both, repeats on a
tie with the last picks kept, a decisive round removes the loser. AC-14 the duel winner keeps
its weapon. AC-16 the flag ends the game (`flag`). AC-17 the turn passes after a fight, a trap
and a duel. AC-18 a side with no legal move at its turn loses (`no_moves`). AC-19 draw by
agreement; decline and a move clear the offer. FR-2 resignation and the away claim as chess.

Board: `square = row * 7 + col`; side a owns rows 0-1 (0-13), side b rows 4-5 (28-41).
"""

import hashlib
import secrets
import uuid
from collections.abc import AsyncIterator, Awaitable
from datetime import timedelta

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.games.chess.hub import ChessHub
from app.games.rps import repo, service
from app.games.rps.rules import Piece
from app.games.rps.service import Refused
from app.games.rps.views import (
    DuelEvent,
    DuelRoundEvent,
    FightEvent,
    FlagEvent,
    MovedEvent,
    TrappedEvent,
)
from tests.fixtures.rps_board import FixedGame, fixed_game, pieces


class _Socket:
    async def send_json(self, data: object) -> None:  # pragma: no cover - never sent to
        pass


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


def _hub() -> ChessHub:
    return ChessHub(abandon_seconds=120)


async def _refused(call: Awaitable[object], code: str) -> None:
    with pytest.raises(Refused) as err:
        await call
    assert err.value.code == code


async def _game(conn: asyncpg.Connection, fixed: FixedGame) -> repo.Game:
    game = await repo.get_game(conn, fixed.game.id)
    assert game is not None
    return game


async def _viewer(conn: asyncpg.Connection, session_id: uuid.UUID) -> repo.Participant:
    token_hash = hashlib.sha256(secrets.token_bytes(16)).hexdigest()
    return await repo.add_participant(conn, session_id, "Cy", token_hash)


# Both sides keep a spare fighter far away so FR-18 does not end the game by accident.
_SPARES = {0: "a flag", 1: "a rock", 41: "b flag", 40: "b rock"}


def _board(spec: dict[int, str]) -> dict[int, Piece]:
    return pieces({**_SPARES, **spec})


# --- AC-6, AC-9: who may move ------------------------------------------------------------------


async def test_ac6_no_move_before_both_ready(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a rock"}), ready=False)
    sid, a = fixed.session.id, fixed.a.id
    await _refused(service.move(migrated, sid, a, 15, 22, hub=hub), "not_your_turn")
    await repo.set_ready(migrated, fixed.game.id, "a")
    await _refused(service.move(migrated, sid, a, 15, 22, hub=hub), "not_your_turn")


async def test_ac9_move_out_of_turn_is_refused(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a rock", 29: "b paper"}), turn="b")
    await _refused(
        service.move(migrated, fixed.session.id, fixed.a.id, 15, 22, hub=hub), "not_your_turn"
    )
    game = await _game(migrated, fixed)
    assert game.turn == "b" and game.ply == 0


async def test_illegal_targets_and_viewers_are_refused(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a rock", 16: "a paper"}))
    sid, a = fixed.session.id, fixed.a.id
    await _refused(service.move(migrated, sid, a, 15, 16, hub=hub), "illegal_move")  # own piece
    await _refused(service.move(migrated, sid, a, 15, 29, hub=hub), "illegal_move")  # too far
    await _refused(service.move(migrated, sid, a, 0, 7, hub=hub), "illegal_move")  # the flag
    viewer = await _viewer(migrated, sid)
    await _refused(service.move(migrated, sid, viewer.id, 15, 22, hub=hub), "not_a_player")


# --- AC-17: plain moves, fights and traps pass the turn ----------------------------------------


async def test_a_step_passes_the_turn(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a rock"}))
    full, event = await service.move(migrated, fixed.session.id, fixed.a.id, 15, 22, hub=hub)
    assert event == MovedEvent(15, 22)
    assert full.game is not None
    assert full.game.turn == "b" and full.game.ply == 1
    assert full.game.board[22] == Piece("a", "rock") and 15 not in full.game.board


async def test_ac17_a_won_fight_reveals_the_winner_and_passes_the_turn(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a rock", 22: "b scissors"}))
    full, event = await service.move(migrated, fixed.session.id, fixed.a.id, 15, 22, hub=hub)
    assert event == FightEvent(15, 22, "rock", "scissors", "attacker")
    assert full.game is not None
    assert full.game.board[22] == Piece("a", "rock", True) and 15 not in full.game.board
    assert full.game.turn == "b" and full.game.ply == 1


async def test_a_lost_fight_removes_the_attacker(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a scissors", 22: "b rock"}))
    full, event = await service.move(migrated, fixed.session.id, fixed.a.id, 15, 22, hub=hub)
    assert event == FightEvent(15, 22, "scissors", "rock", "defender")
    assert full.game is not None
    assert full.game.board[22] == Piece("b", "rock", True) and 15 not in full.game.board
    assert full.game.turn == "b"


async def test_ac17_a_trap_removes_the_attacker_and_passes_the_turn(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a rock", 22: "b trap"}))
    full, event = await service.move(migrated, fixed.session.id, fixed.a.id, 15, 22, hub=hub)
    assert event == TrappedEvent(15, 22, "rock", side="a")
    assert full.game is not None
    assert 15 not in full.game.board and full.game.board[22] == Piece("b", "trap")
    assert full.game.turn == "b" and full.game.ply == 1


# --- AC-13, AC-14, AC-17: duels -----------------------------------------------------------------


async def test_ac13_ac14_ac17_duel_repeats_on_a_tie_and_the_winner_keeps_its_weapon(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a paper", 22: "b paper"}))
    sid, a, b = fixed.session.id, fixed.a.id, fixed.b.id

    full, event = await service.move(migrated, sid, a, 15, 22, hub=hub)
    assert event == DuelEvent(15, 22, "paper")
    assert full.game is not None and full.game.duel is not None
    assert full.game.turn is None and full.game.ply == 0
    assert full.game.duel.attacker == "a" and full.game.duel.round == 1
    assert full.game.board[15].revealed and full.game.board[22].revealed

    await _refused(service.move(migrated, sid, a, 1, 2, hub=hub), "duel_pending")
    await _refused(service.move(migrated, sid, b, 40, 33, hub=hub), "duel_pending")

    full, event = await service.duel_pick(migrated, sid, a, "scissors", hub=hub)
    assert event is None
    assert full.game is not None and full.game.duel is not None
    assert full.game.duel.a_pick == "scissors" and full.game.duel.b_pick is None
    await _refused(service.duel_pick(migrated, sid, a, "rock", hub=hub), "already_picked")

    full, event = await service.duel_pick(migrated, sid, b, "scissors", hub=hub)
    assert event == DuelRoundEvent("scissors", "scissors", "again")
    assert full.game is not None and full.game.duel is not None
    duel = full.game.duel
    assert duel.round == 2 and duel.a_pick is None and duel.b_pick is None
    assert (duel.last_a_pick, duel.last_b_pick) == ("scissors", "scissors")
    assert full.game.turn is None

    await service.duel_pick(migrated, sid, a, "rock", hub=hub)
    full, event = await service.duel_pick(migrated, sid, b, "scissors", hub=hub)
    assert event == DuelRoundEvent("rock", "scissors", "attacker")
    assert full.game is not None
    assert full.game.duel is None
    assert full.game.board[22] == Piece("a", "paper", True)  # AC-14: still paper
    assert 15 not in full.game.board
    assert full.game.turn == "b" and full.game.ply == 1  # AC-17
    assert await repo.get_duel(migrated, fixed.game.id) is None


async def test_duel_picks_are_refused_without_a_duel_or_for_a_viewer(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({15: "a paper", 22: "b paper"}))
    sid = fixed.session.id
    await _refused(service.duel_pick(migrated, sid, fixed.a.id, "rock", hub=hub), "no_duel")
    await service.move(migrated, sid, fixed.a.id, 15, 22, hub=hub)
    viewer = await _viewer(migrated, sid)
    await _refused(service.duel_pick(migrated, sid, viewer.id, "rock", hub=hub), "not_a_player")
    await _refused(service.duel_pick(migrated, sid, fixed.a.id, "lizard", hub=hub), "illegal_move")


# --- AC-16: the flag ----------------------------------------------------------------------------


async def test_ac16_attacking_the_flag_ends_the_game(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    hub.set_game_in_progress(True)
    fixed = await fixed_game(migrated, pieces({15: "a rock", 22: "b flag", 40: "b rock"}))
    full, event = await service.move(migrated, fixed.session.id, fixed.a.id, 15, 22, hub=hub)
    assert event == FlagEvent(15, 22)
    assert full.game is not None
    assert (full.game.status, full.game.result, full.game.reason) == ("ended", "a", "flag")
    assert full.game.turn is None
    assert hub.game_in_progress is False


# --- AC-18: no legal move at the start of a turn ------------------------------------------------


async def test_ac18_boxed_in_side_loses_when_its_turn_begins(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    board = pieces({0: "a flag", 15: "a rock", 41: "b scissors", 34: "b flag", 40: "b trap"})
    fixed = await fixed_game(migrated, board)
    full, _ = await service.move(migrated, fixed.session.id, fixed.a.id, 15, 16, hub=hub)
    assert full.game is not None
    assert (full.game.status, full.game.result, full.game.reason) == ("ended", "a", "no_moves")


async def test_ac18_side_without_fighters_loses_when_its_turn_begins(
    migrated: asyncpg.Connection,
) -> None:
    hub = _hub()
    board = pieces({0: "a flag", 15: "a rock", 22: "b scissors", 41: "b flag"})
    fixed = await fixed_game(migrated, board)
    full, _ = await service.move(migrated, fixed.session.id, fixed.a.id, 15, 22, hub=hub)
    assert full.game is not None
    assert (full.game.status, full.game.result, full.game.reason) == ("ended", "a", "no_moves")


# --- AC-19: draws -------------------------------------------------------------------------------


async def test_ac19_accepted_draw_ends_the_game(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({}))
    sid, a, b = fixed.session.id, fixed.a.id, fixed.b.id
    await _refused(service.answer_draw(migrated, sid, b, True, hub=hub), "no_draw_offer")
    full = await service.offer_draw(migrated, sid, a, hub=hub)
    assert full.game is not None and full.game.draw_offer_by == "a"
    await _refused(service.offer_draw(migrated, sid, a, hub=hub), "own_draw_offer")
    await _refused(service.answer_draw(migrated, sid, a, True, hub=hub), "own_draw_offer")
    full = await service.answer_draw(migrated, sid, b, True, hub=hub)
    assert full.game is not None
    assert (full.game.status, full.game.result, full.game.reason) == ("ended", "draw", "agreement")


async def test_ac19_declined_draw_clears_the_offer(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({}))
    sid = fixed.session.id
    await service.offer_draw(migrated, sid, fixed.a.id, hub=hub)
    full = await service.answer_draw(migrated, sid, fixed.b.id, False, hub=hub)
    assert full.game is not None
    assert full.game.draw_offer_by is None and full.game.status == "play"


async def test_ac19_a_move_instead_clears_the_offer(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({}), turn="b")
    sid = fixed.session.id
    await service.offer_draw(migrated, sid, fixed.a.id, hub=hub)
    full, _ = await service.move(migrated, sid, fixed.b.id, 40, 33, hub=hub)
    assert full.game is not None
    assert full.game.draw_offer_by is None and full.game.status == "play"


# --- FR-2: resignation and the away claim -------------------------------------------------------


async def test_resignation_ends_the_game_and_closes_the_session(
    migrated: asyncpg.Connection,
) -> None:
    fixed = await fixed_game(migrated, _board({}))
    closed = await service.resign(migrated, fixed.session.id, fixed.a.id)
    assert (closed.result, closed.reason) == ("b", "resignation")
    game = await _game(migrated, fixed)
    assert (game.result, game.reason) == ("b", "resignation")
    session = await repo.get_session(migrated, fixed.session.id)
    assert session is not None and session.deleted_at is not None


async def test_away_claim_ends_the_game_by_abandonment(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    fixed = await fixed_game(migrated, _board({}))
    sid, a, b = fixed.session.id, fixed.a.id, fixed.b.id
    hub.add(a, _Socket(), "Ana")
    await _refused(service.claim_win(migrated, sid, a, hub), "claim_not_available")
    hub.away_since[b] = clock.now() - timedelta(seconds=121)
    await _refused(service.claim_win(migrated, sid, b, hub), "claim_not_available")
    closed = await service.claim_win(migrated, sid, a, hub)
    assert (closed.result, closed.reason) == ("a", "abandonment")
    game = await _game(migrated, fixed)
    assert (game.result, game.reason) == ("a", "abandonment")
    session = await repo.get_session(migrated, sid)
    assert session is not None and session.deleted_at is not None
