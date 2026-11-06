"""Spec 014 task 1: migration 0008, the chess tables.

FR-27, NFR-3, NFR-4.
"""

import uuid
from collections.abc import AsyncIterator
from typing import Any

import asyncpg
import pytest

from app import db as app_db

CHESS_TABLES = {
    "chess_session",
    "chess_participant",
    "chess_game",
    "chess_move",
    "chess_chat_message",
}


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> uuid.UUID:
    return await conn.fetchval(
        "insert into chess_session (invite_id) values ($1) returning id", uuid.uuid4().hex
    )


async def _participant(
    conn: asyncpg.Connection, session_id: uuid.UUID, account_sub: str | None = None, **kw: Any
) -> uuid.UUID:
    return await conn.fetchval(
        """insert into chess_participant (session_id, display_name, rejoin_token_hash,
                                          account_sub, hidden_at)
           values ($1, 'Ana', $2, $3, $4) returning id""",
        session_id,
        uuid.uuid4().hex,
        account_sub,
        kw.get("hidden_at"),
    )


async def _game(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    white: uuid.UUID,
    black: uuid.UUID,
    ended: tuple[str, str] | None = None,
    draw_offer_by: str | None = None,
) -> uuid.UUID:
    return await conn.fetchval(
        """insert into chess_game (session_id, white_participant_id, black_participant_id,
                                   started_at, draw_offer_by, ended_at, result, reason)
           values ($1, $2, $3, now(), $4, case when $5::text is null then null else now() end,
                   $5, $6) returning id""",
        session_id,
        white,
        black,
        draw_offer_by,
        ended[0] if ended else None,
        ended[1] if ended else None,
    )


async def _pair(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    session_id = await _session(conn)
    return session_id, await _participant(conn, session_id), await _participant(conn, session_id)


async def _move(conn: asyncpg.Connection, game: uuid.UUID, by: uuid.UUID, ply: int, uci: str):
    await conn.execute(
        """insert into chess_move (game_id, ply, uci, san, participant_id, made_at)
           values ($1, $2, $3, 'e4', $4, now())""",
        game,
        ply,
        uci,
        by,
    )


async def test_0008_creates_every_chess_table(migrated: asyncpg.Connection) -> None:
    rows = await migrated.fetch(
        "select table_name from information_schema.tables where table_schema = 'public'"
    )
    assert CHESS_TABLES <= {r["table_name"] for r in rows}
    names = [r["name"] for r in await migrated.fetch("select name from schema_migration")]
    assert "0008_chess.sql" in names


async def test_second_move_for_the_same_ply_is_refused(migrated: asyncpg.Connection) -> None:
    session_id, white, black = await _pair(migrated)
    game = await _game(migrated, session_id, white, black)
    await _move(migrated, game, white, 1, "e2e4")
    await _move(migrated, game, black, 2, "e7e5")

    with pytest.raises(asyncpg.UniqueViolationError):
        await _move(migrated, game, black, 1, "d2d4")


async def test_move_uci_and_ply_checks(migrated: asyncpg.Connection) -> None:
    session_id, white, black = await _pair(migrated)
    game = await _game(migrated, session_id, white, black)
    await _move(migrated, game, white, 1, "e7e8q")
    for ply, uci in ((2, "e2e9"), (3, "E2E4"), (4, "e2e4x"), (5, "e2")):
        with pytest.raises(asyncpg.CheckViolationError):
            await _move(migrated, game, white, ply, uci)
    with pytest.raises(asyncpg.CheckViolationError):
        await _move(migrated, game, white, 0, "e2e4")


async def test_session_deleted_at_requires_reason(migrated: asyncpg.Connection) -> None:
    session_id = await _session(migrated)
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "update chess_session set deleted_at = now() where id = $1", session_id
        )
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "update chess_session set deleted_reason = 'admin' where id = $1", session_id
        )
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "update chess_session set deleted_at = now(), deleted_reason = 'bogus' where id = $1",
            session_id,
        )
    await migrated.execute(
        "update chess_session set deleted_at = now(), deleted_reason = 'admin' where id = $1",
        session_id,
    )


async def test_white_and_black_seat_must_differ(migrated: asyncpg.Connection) -> None:
    session_id, white, black = await _pair(migrated)
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            "update chess_session set white_participant_id = $1, black_participant_id = $1"
            " where id = $2",
            white,
            session_id,
        )
    await migrated.execute(
        "update chess_session set white_participant_id = $1, black_participant_id = $2"
        " where id = $3",
        white,
        black,
        session_id,
    )


async def test_game_end_fields_go_together_and_draw_offer_needs_a_live_game(
    migrated: asyncpg.Connection,
) -> None:
    session_id, white, black = await _pair(migrated)
    await _game(migrated, session_id, white, black, ended=("white", "checkmate"))
    await _game(migrated, session_id, white, black, draw_offer_by="black")

    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            """insert into chess_game (session_id, white_participant_id, black_participant_id,
                                       started_at, ended_at)
               values ($1, $2, $3, now(), now())""",
            session_id,
            white,
            black,
        )
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            """insert into chess_game (session_id, white_participant_id, black_participant_id,
                                       started_at, result, reason)
               values ($1, $2, $3, now(), 'draw', 'agreement')""",
            session_id,
            white,
            black,
        )
    with pytest.raises(asyncpg.CheckViolationError):
        await _game(
            migrated, session_id, white, black, ended=("draw", "agreement"), draw_offer_by="white"
        )
    with pytest.raises(asyncpg.CheckViolationError):
        await _game(migrated, session_id, white, black, ended=("white", "bogus"))


async def test_participant_hidden_needs_an_account_and_account_is_unique_per_session(
    migrated: asyncpg.Connection,
) -> None:
    session_id = await _session(migrated)
    other = await _session(migrated)
    await _participant(migrated, session_id, "sub-1")
    await _participant(migrated, other, "sub-1")
    await _participant(migrated, session_id)
    await _participant(migrated, session_id)

    with pytest.raises(asyncpg.UniqueViolationError):
        await _participant(migrated, session_id, "sub-1")
    with pytest.raises(asyncpg.CheckViolationError):
        await _participant(migrated, session_id, hidden_at=await migrated.fetchval("select now()"))
    await _participant(
        migrated, session_id, "sub-2", hidden_at=await migrated.fetchval("select now()")
    )


async def test_chat_message_shape_matches_presentation_chat(migrated: asyncpg.Connection) -> None:
    session_id, white, _ = await _pair(migrated)
    await migrated.execute(
        """insert into chess_chat_message (session_id, participant_id, sender_name, body, sent_at)
           values ($1, $2, 'Ana', 'hi', now())""",
        session_id,
        white,
    )
    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            """insert into chess_chat_message (session_id, participant_id, sender_name, body,
                                               sent_at)
               values ($1, $2, 'Ana', '', now())""",
            session_id,
            white,
        )
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await migrated.execute(
            """insert into chess_chat_message (session_id, participant_id, sender_name, body,
                                               sent_at)
               values ($1, $2, 'Ana', 'hi', now())""",
            uuid.uuid4(),
            white,
        )
