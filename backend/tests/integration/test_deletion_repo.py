"""Spec 019 task 6: `deletion/repo.py`, the host rule, the per-kind purge and the tombstone.
AC-5 (data part, FR-6), FR-8 and FR-0 (plan.md "Data model", "Contracts").

Rows are seeded with plain SQL against the real Postgres; two sessions per kind, so a purge is
seen to leave the other session (and the shared catalogue rows) alone.
"""

import json
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app import db as app_db
from app.deletion import repo

T0 = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)


@pytest.fixture
async def conn(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


def _invite() -> str:
    return secrets.token_urlsafe(8)


def _at(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


# --- seeding ---------------------------------------------------------------------------------


async def _problem(conn: asyncpg.Connection) -> uuid.UUID:
    return await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params, return_type)
           values ('Two sum', 'd', 'def f(): ...', 'f', '[]'::jsonb, 'int') returning id"""
    )


async def _coding(
    conn: asyncpg.Connection,
    started_by: str | None = None,
    subs: tuple[str | None, ...] = (None,),
    problem_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """A coding session with one row in every table of its purge list; `subs` are the
    participants' account subs, in join order."""
    problem_id = problem_id or await _problem(conn)
    sid = await conn.fetchval(
        """insert into session (invite_id, current_problem_id, started_by_sub)
           values ($1, $2, $3) returning id""",
        _invite(),
        problem_id,
        started_by,
    )
    pids = [
        await conn.fetchval(
            """insert into participant (session_id, display_name, account_sub, joined_at)
               values ($1, 'P', $2, $3) returning id""",
            sid,
            sub,
            _at(i),
        )
        for i, sub in enumerate(subs)
    ]
    await conn.execute(
        "insert into session_problem (session_id, problem_id) values ($1, $2)", sid, problem_id
    )
    run_id = await conn.fetchval(
        """insert into run (session_id, problem_id, code, participant_id, status)
           values ($1, $2, 'print(1)', $3, 'done') returning id""",
        sid,
        problem_id,
        pids[0],
    )
    await conn.execute(
        "insert into run_result (run_id, test_position, outcome) values ($1, 0, 'pass')", run_id
    )
    await conn.execute(
        """insert into chat_message (session_id, participant_id, sender_name, body, sent_at)
           values ($1, $2, 'P', 'hi', now())""",
        sid,
        pids[0],
    )
    await conn.execute("insert into yjs_update (session_id, update) values ($1, 'x')", sid)
    await conn.execute(
        "insert into session_event (session_id, kind, actor) values ($1, 'joined', 'P')", sid
    )
    await conn.execute(
        """insert into session_scratch_run (session_id, status, started_by, input)
           values ($1, 'finished', 'P', '')""",
        sid,
    )
    return sid


async def _lesson_version(conn: asyncpg.Connection) -> uuid.UUID:
    return await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ('git-basics', $1, '{}'::jsonb) returning id""",
        secrets.token_hex(8),
    )


async def _learning(
    conn: asyncpg.Connection,
    started_by: str | None = None,
    subs: tuple[str | None, ...] = (None,),
    version_id: uuid.UUID | None = None,
) -> uuid.UUID:
    version_id = version_id or await _lesson_version(conn)
    sid = await conn.fetchval(
        """insert into learning_session (invite_id, lesson_version_id, started_by_sub)
           values ($1, $2, $3) returning id""",
        _invite(),
        version_id,
        started_by,
    )
    pids = [
        await conn.fetchval(
            """insert into learning_participant (session_id, display_name, account_sub, joined_at)
               values ($1, 'P', $2, $3) returning id""",
            sid,
            sub,
            _at(i),
        )
        for i, sub in enumerate(subs)
    ]
    await conn.execute(
        """insert into learning_step (session_id, position, passed_at, passed_by_name, passed_by)
           values ($1, 0, now(), 'P', $2)""",
        sid,
        pids[0],
    )
    await conn.execute(
        """insert into learning_attempt
               (session_id, position, participant_id, actor_name, kind, submitted, correct)
           values ($1, 0, $2, 'P', 'text', $3::jsonb, true)""",
        sid,
        pids[0],
        json.dumps("ls"),
    )
    await conn.execute(
        """insert into learning_chat_message
               (session_id, participant_id, sender_name, body, sent_at)
           values ($1, $2, 'P', 'hi', now())""",
        sid,
        pids[0],
    )
    return sid


async def _presentation_version(conn: asyncpg.Connection) -> uuid.UUID:
    pres = await conn.fetchval(
        """insert into presentation (title, topic, created_by_sub)
           values ('Deck', 'Talks', 'author') returning id"""
    )
    version = await conn.fetchval(
        """insert into presentation_version
               (presentation_id, html, kind, slide_count, created_by_sub)
           values ($1, '<p>x</p>', 'slides', 1, 'author') returning id""",
        pres,
    )
    await conn.execute(
        "update presentation set current_version_id = $1 where id = $2", version, pres
    )
    return version


async def _presentation(
    conn: asyncpg.Connection,
    host_sub: str | None = None,
    has_host: bool = True,
    version_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """A presentation session whose first participant is its host (unless `has_host` is false),
    plus a second, signed-in participant."""
    version_id = version_id or await _presentation_version(conn)
    sid = await conn.fetchval(
        "insert into presentation_session (invite_id, version_id) values ($1, $2) returning id",
        _invite(),
        version_id,
    )
    host = None
    for i, sub in enumerate((host_sub, "viewer-sub")):
        pid = await conn.fetchval(
            """insert into presentation_participant
                   (session_id, display_name, rejoin_token_hash, account_sub, joined_at)
               values ($1, 'P', $2, $3, $4) returning id""",
            sid,
            secrets.token_hex(16),
            sub,
            _at(i),
        )
        host = host or pid
    if has_host:
        await conn.execute(
            "update presentation_session set host_participant_id = $1 where id = $2", host, sid
        )
    await conn.execute(
        """insert into presentation_chat_message
               (session_id, participant_id, sender_name, body, sent_at)
           values ($1, $2, 'P', 'hi', now())""",
        sid,
        host,
    )
    return sid


async def _chess(
    conn: asyncpg.Connection,
    started_by: str | None = None,
    subs: tuple[str | None, ...] = (None, None),
    starter_index: int | None = 0,
) -> uuid.UUID:
    """A chess session with a game, a move and chat; `subs` are the participants' account subs
    in join order (at least two: they play white and black)."""
    sid = await conn.fetchval(
        "insert into chess_session (invite_id, started_by_sub) values ($1, $2) returning id",
        _invite(),
        started_by,
    )
    pids = [
        await conn.fetchval(
            """insert into chess_participant
                   (session_id, display_name, rejoin_token_hash, account_sub, joined_at)
               values ($1, 'P', $2, $3, $4) returning id""",
            sid,
            secrets.token_hex(16),
            sub,
            _at(i),
        )
        for i, sub in enumerate(subs)
    ]
    game = await conn.fetchval(
        """insert into chess_game
               (session_id, white_participant_id, black_participant_id, started_at)
           values ($1, $2, $3, now()) returning id""",
        sid,
        pids[0],
        pids[1],
    )
    await conn.execute(
        """insert into chess_move (game_id, ply, uci, san, participant_id, made_at)
           values ($1, 1, 'e2e4', 'e4', $2, now())""",
        game,
        pids[0],
    )
    await conn.execute(
        """update chess_session set starter_participant_id = $2, white_participant_id = $3,
               black_participant_id = $4, current_game_id = $5 where id = $1""",
        sid,
        None if starter_index is None else pids[starter_index],
        pids[0],
        pids[1],
        game,
    )
    await conn.execute(
        """insert into chess_chat_message (session_id, participant_id, sender_name, body, sent_at)
           values ($1, $2, 'P', 'hi', now())""",
        sid,
        pids[0],
    )
    return sid


# --- counting: the purge list per kind (plan.md "Data model"), written out independently ------

_COUNTS: dict[str, dict[str, str]] = {
    "coding": {
        "run_result": "select count(*) from run_result r join run on run.id = r.run_id"
        " where run.session_id = $1",
        "run": "select count(*) from run where session_id = $1",
        "chat_message": "select count(*) from chat_message where session_id = $1",
        "yjs_update": "select count(*) from yjs_update where session_id = $1",
        "session_event": "select count(*) from session_event where session_id = $1",
        "session_scratch_run": "select count(*) from session_scratch_run where session_id = $1",
        "session_problem": "select count(*) from session_problem where session_id = $1",
        "participant": "select count(*) from participant where session_id = $1",
        "session": "select count(*) from session where id = $1",
    },
    "learning": {
        "learning_attempt": "select count(*) from learning_attempt where session_id = $1",
        "learning_chat_message": "select count(*) from learning_chat_message where session_id = $1",
        "learning_step": "select count(*) from learning_step where session_id = $1",
        "learning_participant": "select count(*) from learning_participant where session_id = $1",
        "learning_session": "select count(*) from learning_session where id = $1",
    },
    "presentation": {
        "presentation_chat_message": "select count(*) from presentation_chat_message"
        " where session_id = $1",
        "presentation_participant": "select count(*) from presentation_participant"
        " where session_id = $1",
        "presentation_session": "select count(*) from presentation_session where id = $1",
    },
    "chess": {
        "chess_move": "select count(*) from chess_move m join chess_game g on g.id = m.game_id"
        " where g.session_id = $1",
        "chess_game": "select count(*) from chess_game where session_id = $1",
        "chess_chat_message": "select count(*) from chess_chat_message where session_id = $1",
        "chess_participant": "select count(*) from chess_participant where session_id = $1",
        "chess_session": "select count(*) from chess_session where id = $1",
    },
}

_SHARED = (
    "problem",
    "problem_test",
    "lesson",
    "lesson_version",
    "presentation",
    "presentation_version",
)


async def _counts(conn: asyncpg.Connection, kind: str, sid: uuid.UUID) -> dict[str, int]:
    return {table: await conn.fetchval(sql, sid) for table, sql in _COUNTS[kind].items()}


async def _shared(conn: asyncpg.Connection) -> dict[str, int]:
    return {t: await conn.fetchval(f"select count(*) from {t}") for t in _SHARED}  # noqa: S608


async def _two(conn: asyncpg.Connection, kind: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Two sessions of `kind` sharing their catalogue row (problem, lesson or presentation)."""
    if kind == "coding":
        problem = await _problem(conn)
        return await _coding(conn, problem_id=problem), await _coding(conn, problem_id=problem)
    if kind == "learning":
        version = await _lesson_version(conn)
        return await _learning(conn, version_id=version), await _learning(conn, version_id=version)
    if kind == "presentation":
        version = await _presentation_version(conn)
        return await _presentation(conn, "h", version_id=version), await _presentation(
            conn, "h", version_id=version
        )
    return await _chess(conn), await _chess(conn)


# --- AC-5 (data part): purge -----------------------------------------------------------------


@pytest.mark.parametrize("kind", ["coding", "learning", "presentation", "chess"])
async def test_ac5_purge_removes_every_row_of_the_session_and_nothing_else(
    conn: asyncpg.Connection, kind: str
) -> None:
    doomed, other = await _two(conn, kind)
    before_other = await _counts(conn, kind, other)
    before_shared = await _shared(conn)
    assert all(n > 0 for n in (await _counts(conn, kind, doomed)).values())
    assert all(n > 0 for n in before_other.values())

    async with conn.transaction():
        await repo.purge(conn, kind, doomed)

    assert await _counts(conn, kind, doomed) == dict.fromkeys(_COUNTS[kind], 0)
    assert await _counts(conn, kind, other) == before_other
    assert await _shared(conn) == before_shared


async def test_purge_and_host_sub_refuse_an_unknown_kind(conn: asyncpg.Connection) -> None:
    sid = await _coding(conn)
    for bad in ("session; drop table session", "Coding", ""):
        with pytest.raises(ValueError):
            await repo.purge(conn, bad, sid)
        with pytest.raises(ValueError):
            await repo.host_sub(conn, bad, sid)
    assert await conn.fetchval("select count(*) from session where id = $1", sid) == 1


# --- FR-8: tombstone -------------------------------------------------------------------------


async def test_fr8_tombstone_marks_only_that_kind_and_invite(conn: asyncpg.Connection) -> None:
    invite = _invite()
    assert not await repo.is_tombstoned(conn, "coding", invite)
    await repo.tombstone(conn, "coding", invite, "host")
    assert await repo.is_tombstoned(conn, "coding", invite)
    assert not await repo.is_tombstoned(conn, "learning", invite)
    assert not await repo.is_tombstoned(conn, "coding", _invite())
    row = await conn.fetchrow(
        "select deleted_by from deleted_session where kind = 'coding' and invite_id = $1", invite
    )
    assert row["deleted_by"] == "host"


async def test_fr8_tombstone_records_an_admin_deletion(conn: asyncpg.Connection) -> None:
    invite = _invite()
    await repo.tombstone(conn, "chess", invite, "admin")
    assert await repo.is_tombstoned(conn, "chess", invite)
    assert (
        await conn.fetchval(
            "select deleted_by from deleted_session where kind = 'chess' and invite_id = $1",
            invite,
        )
        == "admin"
    )


# --- FR-0: host rule -------------------------------------------------------------------------


@pytest.mark.parametrize(("kind", "seed"), [("coding", _coding), ("learning", _learning)])
async def test_fr0_starter_is_the_host_even_if_someone_signed_in_joined_first(
    conn: asyncpg.Connection, kind: str, seed
) -> None:
    sid = await seed(conn, started_by="starter", subs=("early", "starter"))
    assert await repo.host_sub(conn, kind, sid) == "starter"


@pytest.mark.parametrize(("kind", "seed"), [("coding", _coding), ("learning", _learning)])
async def test_fr0_without_a_starter_the_first_signed_in_participant_hosts(
    conn: asyncpg.Connection, kind: str, seed
) -> None:
    sid = await seed(conn, started_by=None, subs=(None, "first", "second"))
    assert await repo.host_sub(conn, kind, sid) == "first"


@pytest.mark.parametrize(("kind", "seed"), [("coding", _coding), ("learning", _learning)])
async def test_fr0_a_guest_only_session_has_no_host(
    conn: asyncpg.Connection, kind: str, seed
) -> None:
    sid = await seed(conn, started_by=None, subs=(None, None))
    assert await repo.host_sub(conn, kind, sid) is None


async def test_fr0_chess_starter_sub_wins(conn: asyncpg.Connection) -> None:
    sid = await _chess(conn, started_by="starter", subs=("a", "b"), starter_index=0)
    assert await repo.host_sub(conn, "chess", sid) == "starter"


async def test_fr0_chess_falls_back_to_the_starter_participants_account(
    conn: asyncpg.Connection,
) -> None:
    sid = await _chess(conn, started_by=None, subs=("early", "starter"), starter_index=1)
    assert await repo.host_sub(conn, "chess", sid) == "starter"


async def test_fr0_chess_then_falls_back_to_the_first_signed_in_participant(
    conn: asyncpg.Connection,
) -> None:
    guest_starter = await _chess(conn, subs=(None, "first", "second"), starter_index=0)
    assert await repo.host_sub(conn, "chess", guest_starter) == "first"
    no_starter = await _chess(conn, subs=(None, "first"), starter_index=None)
    assert await repo.host_sub(conn, "chess", no_starter) == "first"
    guests = await _chess(conn, subs=(None, None))
    assert await repo.host_sub(conn, "chess", guests) is None


async def test_fr0_presentation_host_is_the_presenters_account(conn: asyncpg.Connection) -> None:
    assert await repo.host_sub(conn, "presentation", await _presentation(conn, "pres")) == "pres"
    guest_host = await _presentation(conn, None)
    assert await repo.host_sub(conn, "presentation", guest_host) is None
    no_host = await _presentation(conn, "pres", has_host=False)
    assert await repo.host_sub(conn, "presentation", no_host) is None


@pytest.mark.parametrize("kind", ["coding", "learning", "presentation", "chess"])
async def test_fr0_an_unknown_session_has_no_host(conn: asyncpg.Connection, kind: str) -> None:
    assert await repo.host_sub(conn, kind, uuid.uuid4()) is None
