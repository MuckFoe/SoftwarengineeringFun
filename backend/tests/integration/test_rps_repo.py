"""Spec 021 task 7: the repository on the `rps_*` tables (FR-2, FR-24, NFR-3).

FR-24/NFR-3 a setup, the pieces after a fight and a duel with `a_pick` set reload exactly as
written. FR-2 participants (account uniqueness, rejoin token) and seats mirror `test_chess_repo`.
"""

import hashlib
import random
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.games.rps import repo, rules
from app.games.rps.rules import Piece
from tests.conftest import FrozenClock
from tests.fixtures.rps_board import fixed_game, pieces

T0 = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


def _hash() -> str:
    return hashlib.sha256(secrets.token_bytes(32)).hexdigest()


async def _with_two(
    conn: asyncpg.Connection,
) -> tuple[repo.RpsSession, repo.Participant, repo.Participant]:
    session = await repo.create_session(conn)
    ana = await repo.add_participant(conn, session.id, "Ana", _hash())
    bo = await repo.add_participant(conn, session.id, "Bo", _hash())
    return session, ana, bo


def _setup(rng: random.Random) -> dict[int, Piece]:
    return {
        **rules.deal("a", 3, 10, rng),
        **rules.deal("b", 38, 29, rng),
    }


# --- FR-2: sessions, participants, seats ------------------------------------------------------


async def test_session_round_trip_with_starter_seats_and_game(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    frozen_clock.set(T0)
    session = await repo.create_session(migrated)
    assert session.starter_participant_id is None
    assert session.created_at == T0 and session.last_activity_at == T0
    assert session.stale_at is None and session.deleted_at is None
    assert len(session.invite_id) >= 20

    ana = await repo.add_participant(migrated, session.id, "Ana", _hash())
    bo = await repo.add_participant(migrated, session.id, "Bo", _hash())
    await repo.set_starter(migrated, session.id, ana.id)
    await repo.set_seats(migrated, session.id, a=ana.id, b=bo.id)
    game = await repo.insert_game(migrated, session.id, ana.id, bo.id, "b")
    await repo.set_current_game(migrated, session.id, game.id)

    read = await repo.get_session_by_invite(migrated, session.invite_id)
    assert read is not None
    assert read.id == session.id
    assert read.starter_participant_id == ana.id
    assert (read.a_participant_id, read.b_participant_id) == (ana.id, bo.id)
    assert read.current_game_id == game.id
    assert (await repo.get_session(migrated, session.id)) == read

    got = await repo.get_game(migrated, game.id)
    assert got == game
    assert got.started_at == T0 and got.first_side == "b"
    assert (got.a_participant_id, got.b_participant_id) == (ana.id, bo.id)
    assert (got.a_ready, got.b_ready, got.turn, got.ply) == (False, False, None, 0)
    assert got.ended_at is None and got.result is None and got.draw_offer_by is None
    assert got.phase == "setup"

    await repo.set_seats(migrated, session.id, a=None, b=None)
    cleared = await repo.get_session(migrated, session.id)
    assert cleared is not None
    assert cleared.a_participant_id is None and cleared.b_participant_id is None
    with pytest.raises(asyncpg.CheckViolationError):
        await repo.set_seats(migrated, session.id, a=ana.id, b=ana.id)


async def test_participants_by_token_account_and_leave(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    frozen_clock.set(T0)
    session = await repo.create_session(migrated)
    other = await repo.create_session(migrated)
    token = _hash()
    guest = await repo.add_participant(migrated, session.id, "Guest", token)
    assert guest.signed_in is False and guest.left_at is None and guest.joined_at == T0
    assert await repo.get_participant_by_token_hash(migrated, session.id, token) == guest
    assert await repo.get_participant_by_token_hash(migrated, other.id, token) is None
    assert await repo.get_participant_by_token_hash(migrated, session.id, _hash()) is None

    frozen_clock.advance(timedelta(seconds=1))
    first, reused = await repo.join_as_account(migrated, session.id, "sub-1", "Ann", _hash())
    assert reused is False and first.account_sub == "sub-1" and first.signed_in
    assert await repo.get_participant_by_account(migrated, session.id, "sub-1") == first
    assert await repo.get_participant_by_account(migrated, other.id, "sub-1") is None

    await repo.leave_participant(migrated, first.id)
    new_token = _hash()
    again, reused = await repo.join_as_account(migrated, session.id, "sub-1", "Ann", new_token)
    assert reused is True and again.id == first.id and again.left_at is None
    assert await repo.get_participant_by_token_hash(migrated, session.id, new_token) == again
    # The same account in another session is a different participant.
    elsewhere, reused = await repo.join_as_account(migrated, other.id, "sub-1", "Ann", _hash())
    assert reused is False and elsewhere.id != first.id

    assert [p.id for p in await repo.list_participants(migrated, session.id)] == [
        guest.id,
        first.id,
    ]


async def test_lock_session_and_activity_and_stale(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    frozen_clock.set(T0)
    session = await repo.create_session(migrated)
    async with migrated.transaction():
        locked = await repo.lock_session(migrated, session.id)
    assert locked is not None and locked.id == session.id
    assert await repo.lock_session(migrated, uuid.uuid4()) is None

    frozen_clock.set(T0 + timedelta(days=31))
    await repo.touch_activity(migrated, session.id)
    touched = await repo.get_session(migrated, session.id)
    assert touched is not None and touched.last_activity_at == clock.now()

    await repo.set_stale(migrated, session.id, clock.now())
    stale = await repo.get_session(migrated, session.id)
    assert stale is not None and stale.stale_at == clock.now()
    await repo.set_stale(migrated, session.id, None)
    fresh = await repo.get_session(migrated, session.id)
    assert fresh is not None and fresh.stale_at is None


async def test_soft_delete_hides_the_invite_but_reports_deleted(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    frozen_clock.set(T0)
    session, _, _ = await _with_two(migrated)
    live = await repo.create_session(migrated)
    assert await repo.is_deleted_invite(migrated, session.invite_id) is False

    assert await repo.soft_delete(migrated, session.id, "starter") is True
    assert await repo.get_session_by_invite(migrated, session.invite_id) is None
    assert await repo.is_deleted_invite(migrated, session.invite_id) is True
    assert await repo.is_deleted_invite(migrated, "unknown-invite") is False
    gone = await repo.get_session(migrated, session.id)
    assert gone is not None and gone.deleted_at == T0 and gone.deleted_reason == "starter"
    assert len(await repo.list_participants(migrated, session.id)) == 2
    assert await repo.soft_delete(migrated, session.id, "admin", by_sub="a") is False
    assert await repo.get_session_by_invite(migrated, live.invite_id) is not None

    # A purged session's tombstone (spec 019 FR-8) also counts as deleted.
    await migrated.execute(
        "insert into deleted_session (kind, invite_id, deleted_by) values ('rps', 'gone-1', 'host')"
    )
    assert await repo.is_deleted_invite(migrated, "gone-1") is True


# --- FR-24/NFR-3: setup, pieces after a fight, duel ---------------------------------------------


async def test_setup_round_trips_and_rewriting_one_side_keeps_the_other(
    migrated: asyncpg.Connection,
) -> None:
    rng = random.Random(21)  # noqa: S311 - a seeded test deal, not a secret
    board = _setup(rng)
    fixed = await fixed_game(migrated, board, ready=False)
    assert await repo.list_pieces(migrated, fixed.game.id) == board
    assert len(board) == 28

    placed = rules.place(board, "a", "flag", 0)
    redealt = rules.redeal(placed, "a", rng)
    await repo.write_side(migrated, fixed.game.id, "a", redealt)
    assert await repo.list_pieces(migrated, fixed.game.id) == redealt
    assert {sq: p for sq, p in redealt.items() if p.side == "b"} == {
        sq: p for sq, p in board.items() if p.side == "b"
    }

    await repo.set_ready(migrated, fixed.game.id, "a")
    game = await repo.get_game(migrated, fixed.game.id)
    assert game is not None and (game.a_ready, game.b_ready, game.phase) == (True, False, "setup")
    await repo.set_ready(migrated, fixed.game.id, "b")
    await repo.set_turn(migrated, fixed.game.id, "a")
    game = await repo.get_game(migrated, fixed.game.id)
    assert game is not None and (game.b_ready, game.turn, game.phase) == (True, "a", "play")


async def test_pieces_after_a_fight_and_a_trap_reload_identically(
    migrated: asyncpg.Connection,
) -> None:
    board = pieces({8: "a rock", 15: "b scissors", 9: "a paper", 16: "b trap", 38: "b flag"})
    fixed = await fixed_game(migrated, board)
    gid = fixed.game.id

    # A's rock beats B's scissors: the defender goes, the attacker moves on, revealed.
    await repo.delete_piece(migrated, gid, 15)
    await repo.move_piece(migrated, gid, 8, 15)
    await repo.set_revealed(migrated, gid, 15)
    # A's paper walks into the trap: the attacker goes, the trap stays hidden.
    await repo.delete_piece(migrated, gid, 9)

    expected = pieces({15: "a rock*", 16: "b trap", 38: "b flag"})
    assert await repo.list_pieces(migrated, gid) == expected

    with pytest.raises(asyncpg.UniqueViolationError):
        await repo.move_piece(migrated, gid, 15, 16)  # never onto an occupied square


async def test_turn_ply_draw_offer_and_end_game(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    frozen_clock.set(T0)
    fixed = await fixed_game(migrated, pieces({8: "a rock", 38: "b flag"}))
    gid = fixed.game.id
    await repo.set_draw_offer(migrated, gid, "a")
    offered = await repo.get_game(migrated, gid)
    assert offered is not None and offered.draw_offer_by == "a"

    await repo.end_turn(migrated, gid, "b")
    passed = await repo.get_game(migrated, gid)
    assert passed is not None
    assert (passed.turn, passed.ply, passed.draw_offer_by) == ("b", 1, None)

    await repo.set_turn(migrated, gid, None)  # a duel is pending
    duel_wait = await repo.get_game(migrated, gid)
    assert duel_wait is not None and duel_wait.turn is None and duel_wait.phase == "play"

    await repo.set_draw_offer(migrated, gid, "b")
    frozen_clock.set(T0 + timedelta(minutes=5))
    await repo.end_game(migrated, gid, result="a", reason="flag")
    ended = await repo.get_game(migrated, gid)
    assert ended is not None
    assert (ended.result, ended.reason, ended.turn, ended.draw_offer_by) == (
        "a",
        "flag",
        None,
        None,
    )
    assert ended.ended_at == T0 + timedelta(minutes=5) and ended.phase == "ended"


async def test_duel_with_one_pick_round_trips_and_advances(
    migrated: asyncpg.Connection,
) -> None:
    board = pieces({8: "a paper*", 15: "b paper*", 38: "b flag"})
    fixed = await fixed_game(migrated, board, turn=None)
    gid = fixed.game.id
    assert await repo.get_duel(migrated, gid) is None

    await repo.insert_duel(migrated, gid, from_square=8, to_square=15, attacker="a")
    await repo.set_pick(migrated, gid, "a", "rock")
    duel = await repo.get_duel(migrated, gid)
    assert duel == repo.Duel(
        game_id=gid,
        from_square=8,
        to_square=15,
        attacker="a",
        round=1,
        a_pick="rock",
        b_pick=None,
        last_a_pick=None,
        last_b_pick=None,
    )
    assert await repo.get_duel(migrated, gid) == duel  # a reload gives the same row

    await repo.set_pick(migrated, gid, "b", "rock")
    await repo.next_round(migrated, gid)
    tied = await repo.get_duel(migrated, gid)
    assert tied is not None
    assert (tied.round, tied.a_pick, tied.b_pick) == (2, None, None)
    assert (tied.last_a_pick, tied.last_b_pick) == ("rock", "rock")

    await repo.delete_duel(migrated, gid)
    assert await repo.get_duel(migrated, gid) is None
    assert await repo.list_pieces(migrated, gid) == board
