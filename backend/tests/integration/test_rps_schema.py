"""Spec 021 task 1: migration 0016, the rps tables.

FR-2, NFR-3.
"""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db

RPS_TABLES = {
    "rps_session",
    "rps_participant",
    "rps_chat_message",
    "rps_game",
    "rps_piece",
    "rps_duel",
}


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> uuid.UUID:
    return await conn.fetchval(
        "insert into rps_session (invite_id) values ($1) returning id", uuid.uuid4().hex
    )


async def _participant(
    conn: asyncpg.Connection, session_id: uuid.UUID, account_sub: str | None = None
) -> uuid.UUID:
    return await conn.fetchval(
        """insert into rps_participant (session_id, display_name, rejoin_token_hash, account_sub)
           values ($1, 'Ana', $2, $3) returning id""",
        session_id,
        uuid.uuid4().hex,
        account_sub,
    )


async def _game(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    session_id = await _session(conn)
    a = await _participant(conn, session_id)
    b = await _participant(conn, session_id)
    game = await conn.fetchval(
        """insert into rps_game (session_id, a_participant_id, b_participant_id, first_side,
                                 started_at)
           values ($1, $2, $3, 'b', now()) returning id""",
        session_id,
        a,
        b,
    )
    return session_id, a, b, game


async def test_0016_creates_every_rps_table(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        "select table_name from information_schema.tables where table_schema = 'public'"
    )
    assert RPS_TABLES <= {r["table_name"] for r in rows}
    names = [r["name"] for r in await migrated.fetch("select name from schema_migration")]
    assert "0016_rps.sql" in names


async def test_participant_indexes(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        "select indexname, indexdef from pg_indexes where tablename = 'rps_participant'"
    )
    defs = {r["indexname"]: r["indexdef"] for r in rows}
    assert "UNIQUE" in defs["rps_participant_account"]
    assert "(account_sub, session_id)" in defs["rps_participant_account"]
    assert "(session_id, joined_at, id)" in defs["rps_participant_first_signed_in"]
    assert "account_sub IS NOT NULL" in defs["rps_participant_first_signed_in"]

    session_id = await _session(migrated)
    await _participant(migrated, session_id, "sub-1")
    with pytest.raises(asyncpg.UniqueViolationError):
        await _participant(migrated, session_id, "sub-1")


async def test_deleted_session_accepts_rps(migrated: asyncpg.Connection) -> None:
    invite = uuid.uuid4().hex
    for kind in ("rps", "chess"):
        await migrated.execute(
            "insert into deleted_session (kind, invite_id, deleted_by) values ($1, $2, 'host')",
            kind,
            invite,
        )
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "insert into deleted_session (kind, invite_id, deleted_by) values ($1, $2, 'host')",
            "bogus",
            invite,
        )


async def test_session_checks_match_chess(migrated: asyncpg.Connection) -> None:
    session_id = await _session(migrated)
    a = await _participant(migrated, session_id)
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "update rps_session set deleted_at = now() where id = $1", session_id
        )
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "update rps_session set a_participant_id = $1, b_participant_id = $1 where id = $2",
            a,
            session_id,
        )
    await migrated.execute(
        "update rps_session set deleted_at = now(), deleted_reason = 'starter' where id = $1",
        session_id,
    )


async def test_setup_pieces_and_pending_duel_read_back(migrated: asyncpg.Connection) -> None:
    session_id, _, _, game = await _game(migrated)
    await migrated.execute(
        "update rps_session set current_game_id = $1 where id = $2", game, session_id
    )
    kinds = ["flag", "trap"] + ["rock", "paper", "scissors"] * 4
    pieces = [(game, sq, "a", kinds[sq], False) for sq in range(14)]
    pieces += [(game, 28 + i, "b", kinds[i], i == 5) for i in range(14)]
    await migrated.executemany(
        "insert into rps_piece (game_id, square, side, kind, revealed) values ($1, $2, $3, $4, $5)",
        pieces,
    )
    await migrated.execute(
        """insert into rps_duel (game_id, from_square, to_square, attacker, a_pick)
           values ($1, 13, 20, 'a', 'rock')""",
        game,
    )

    row = await migrated.fetchrow(
        "select a_ready, b_ready, turn, ply, ended_at, first_side from rps_game where id = $1",
        game,
    )
    assert dict(row) == {
        "a_ready": False,
        "b_ready": False,
        "turn": None,
        "ply": 0,
        "ended_at": None,
        "first_side": "b",
    }
    back = await migrated.fetch(
        "select game_id, square, side, kind, revealed from rps_piece where game_id = $1"
        " order by square",
        game,
    )
    assert [tuple(r) for r in back] == pieces
    duel = await migrated.fetchrow("select * from rps_duel where game_id = $1", game)
    assert dict(duel) == {
        "game_id": game,
        "from_square": 13,
        "to_square": 20,
        "attacker": "a",
        "round": 1,
        "a_pick": "rock",
        "b_pick": None,
        "last_a_pick": None,
        "last_b_pick": None,
    }


async def test_game_end_fields_go_together(migrated: asyncpg.Connection) -> None:
    _, _, _, game = await _game(migrated)
    half_ended = (
        (True, None, None),
        (False, "a", "flag"),
        (True, "a", None),
        (True, None, "flag"),
    )
    for ended, result, reason in half_ended:
        with pytest.raises(asyncpg.CheckViolationError):
            await migrated.execute(
                """update rps_game set ended_at = case when $2 then now() end,
                                       result = $3, reason = $4
                   where id = $1""",
                game,
                ended,
                result,
                reason,
            )
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "update rps_game set ended_at = now(), result = 'a', reason = 'checkmate'"
            " where id = $1",
            game,
        )
    await migrated.execute(
        "update rps_game set ended_at = now(), result = 'b', reason = 'flag' where id = $1", game
    )


async def test_piece_checks(migrated: asyncpg.Connection) -> None:
    _, _, _, game = await _game(migrated)
    insert = "insert into rps_piece (game_id, square, side, kind) values ($1, $2, $3, $4)"
    await migrated.execute(insert, game, 41, "b", "rock")
    await migrated.execute(insert, game, 0, "a", "trap")
    for square, side, kind in (
        (42, "a", "rock"),
        (-1, "a", "rock"),
        (5, "c", "rock"),
        (6, "a", "lizard"),
    ):
        with pytest.raises(asyncpg.CheckViolationError):
            await migrated.execute(insert, game, square, side, kind)
    with pytest.raises(asyncpg.UniqueViolationError):
        await migrated.execute(insert, game, 41, "a", "paper")
