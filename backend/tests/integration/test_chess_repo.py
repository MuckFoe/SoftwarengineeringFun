"""Spec 014 task 9: chess repository (FR-27, FR-34, NFR-4).

FR-27/NFR-4 the session, participants, seats, position (move list) and result round-trip
through a real DB, moves in `ply` order. FR-34 after `soft_delete` the invite lookup returns
nothing and the deleted lookup reports it.
"""

import hashlib
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app import clock
from app import db as app_db
from app.games.chess import repo
from tests.conftest import FrozenClock

T0 = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


def _hash() -> str:
    return hashlib.sha256(secrets.token_bytes(32)).hexdigest()


async def _with_two(
    conn: asyncpg.Connection,
) -> tuple[repo.ChessSession, repo.Participant, repo.Participant]:
    session = await repo.create_session(conn)
    ana = await repo.add_participant(conn, session.id, "Ana", _hash())
    bo = await repo.add_participant(conn, session.id, "Bo", _hash())
    return session, ana, bo


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
    await repo.set_seats(migrated, session.id, white=ana.id, black=bo.id)
    game = await repo.insert_game(migrated, session.id, ana.id, bo.id)
    await repo.set_current_game(migrated, session.id, game.id)

    read = await repo.get_session_by_invite(migrated, session.invite_id)
    assert read is not None
    assert read.id == session.id
    assert read.starter_participant_id == ana.id
    assert (read.white_participant_id, read.black_participant_id) == (ana.id, bo.id)
    assert read.current_game_id == game.id
    assert (await repo.get_session(migrated, session.id)) == read

    got = await repo.get_game(migrated, game.id)
    assert got is not None
    assert got.started_at == T0
    assert (got.white_participant_id, got.black_participant_id) == (ana.id, bo.id)
    assert got.ended_at is None and got.result is None and got.draw_offer_by is None

    await repo.set_seats(migrated, session.id, white=None, black=None)
    cleared = await repo.get_session(migrated, session.id)
    assert cleared is not None
    assert cleared.white_participant_id is None and cleared.black_participant_id is None


async def test_participants_by_token_account_and_leave(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    frozen_clock.set(T0)
    session = await repo.create_session(migrated)
    other = await repo.create_session(migrated)
    token = _hash()
    guest = await repo.add_participant(migrated, session.id, "Guest", token)
    assert guest.signed_in is False and guest.left_at is None and guest.joined_at == T0
    found = await repo.get_participant_by_token_hash(migrated, session.id, token)
    assert found == guest
    assert await repo.get_participant_by_token_hash(migrated, other.id, token) is None
    assert await repo.get_participant_by_token_hash(migrated, session.id, _hash()) is None

    frozen_clock.advance(timedelta(seconds=1))
    first, reused = await repo.join_as_account(migrated, session.id, "sub-1", "Ann", _hash())
    assert reused is False and first.account_sub == "sub-1" and first.signed_in
    by_account = await repo.get_participant_by_account(migrated, session.id, "sub-1")
    assert by_account == first
    assert await repo.get_participant_by_account(migrated, other.id, "sub-1") is None

    await repo.leave_participant(migrated, first.id)
    new_token = _hash()
    again, reused = await repo.join_as_account(migrated, session.id, "sub-1", "Ann", new_token)
    assert reused is True and again.id == first.id and again.left_at is None
    assert await repo.get_participant_by_token_hash(migrated, session.id, new_token) == again

    assert [p.id for p in await repo.list_participants(migrated, session.id)] == [
        guest.id,
        first.id,
    ]


async def test_moves_come_back_in_ply_order(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    frozen_clock.set(T0)
    session, ana, bo = await _with_two(migrated)
    game = await repo.insert_game(migrated, session.id, ana.id, bo.id)
    await repo.insert_move(migrated, game.id, 2, "e7e5", "e5", bo.id)
    await repo.insert_move(migrated, game.id, 1, "e2e4", "e4", ana.id)
    await repo.insert_move(migrated, game.id, 3, "g1f3", "Nf3", ana.id)
    moves = await repo.list_moves(migrated, game.id)
    assert [(m.ply, m.uci, m.san, m.participant_id) for m in moves] == [
        (1, "e2e4", "e4", ana.id),
        (2, "e7e5", "e5", bo.id),
        (3, "g1f3", "Nf3", ana.id),
    ]
    assert all(m.made_at == T0 for m in moves)
    with pytest.raises(asyncpg.UniqueViolationError):
        await repo.insert_move(migrated, game.id, 1, "d2d4", "d4", ana.id)


async def test_draw_offer_and_end_game_keep_the_result(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    frozen_clock.set(T0)
    session, ana, bo = await _with_two(migrated)
    game = await repo.insert_game(migrated, session.id, ana.id, bo.id)
    await repo.set_draw_offer(migrated, game.id, "white")
    offered = await repo.get_game(migrated, game.id)
    assert offered is not None and offered.draw_offer_by == "white"
    await repo.set_draw_offer(migrated, game.id, None)
    cleared = await repo.get_game(migrated, game.id)
    assert cleared is not None and cleared.draw_offer_by is None

    await repo.set_draw_offer(migrated, game.id, "black")
    frozen_clock.set(T0 + timedelta(minutes=5))
    await repo.end_game(migrated, game.id, result="black", reason="resignation")
    ended = await repo.get_game(migrated, game.id)
    assert ended is not None
    assert (ended.result, ended.reason) == ("black", "resignation")
    assert ended.ended_at == T0 + timedelta(minutes=5)
    assert ended.draw_offer_by is None


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
    session, ana, _ = await _with_two(migrated)
    live = await repo.create_session(migrated)
    assert await repo.get_session_by_invite(migrated, session.invite_id) is not None
    assert await repo.is_deleted_invite(migrated, session.invite_id) is False

    assert await repo.soft_delete(migrated, session.id, "starter") is True
    assert await repo.get_session_by_invite(migrated, session.invite_id) is None
    assert await repo.is_deleted_invite(migrated, session.invite_id) is True
    assert await repo.is_deleted_invite(migrated, "unknown-invite") is False
    # Nothing is dropped: the row and its participants still exist.
    gone = await repo.get_session(migrated, session.id)
    assert gone is not None and gone.deleted_at == T0 and gone.deleted_reason == "starter"
    assert len(await repo.list_participants(migrated, session.id)) == 2
    # Idempotent, and other sessions are untouched.
    assert await repo.soft_delete(migrated, session.id, "admin", by_sub="a") is False
    assert await repo.get_session_by_invite(migrated, live.invite_id) is not None

    other = await repo.create_session(migrated)
    assert await repo.soft_delete(migrated, other.id, "admin", by_sub="adm-1") is True
    deleted = await repo.get_session(migrated, other.id)
    assert deleted is not None and deleted.deleted_by_sub == "adm-1"
    assert ana.id  # participants of a deleted session stay readable
