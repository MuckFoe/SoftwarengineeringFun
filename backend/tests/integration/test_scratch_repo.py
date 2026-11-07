"""Spec 011 task 5: migration 0009 and `scratch.repo` (`session_scratch_run`).

FR-8, FR-9, FR-10. Real PostgreSQL.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db
from app.scratch import repo


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> uuid.UUID:
    problem = await conn.fetchval("select id from problem limit 1")
    if problem is None:
        problem = await conn.fetchval(
            "insert into problem (title, description, signature, function_name, params, "
            "return_type) values ('t', 'd', 's', 'f', '[]', 'int') returning id"
        )
    return await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        problem,
    )


async def test_two_simultaneous_claims_one_wins(migrated: asyncpg.Connection, database_url: str):
    sid = await _session(migrated)
    a = await asyncpg.connect(database_url)
    b = await asyncpg.connect(database_url)
    try:
        results = await asyncio.gather(repo.claim(a, sid, "A", "1"), repo.claim(b, sid, "B", "2"))
    finally:
        await a.close()
        await b.close()
    assert sorted(results) == [False, True]


async def test_claim_refused_while_running_then_ok_after_finish(migrated: asyncpg.Connection):
    sid = await _session(migrated)
    assert await repo.claim(migrated, sid, "A", "1") is True
    before = await repo.get(migrated, sid)
    assert await repo.claim(migrated, sid, "B", "2") is False
    assert await repo.get(migrated, sid) == before
    await repo.finish(migrated, sid, "finished", 0, [])
    assert await repo.claim(migrated, sid, "B", "2") is True


async def test_new_claim_replaces_finished_run(migrated: asyncpg.Connection):
    sid = await _session(migrated)
    await repo.claim(migrated, sid, "A", "old-in")
    await repo.finish(migrated, sid, "finished", 0, [{"s": "out", "t": "old"}])
    assert await repo.claim(migrated, sid, "B", "new-in") is True
    run = await repo.get(migrated, sid)
    assert run is not None
    assert (run.status, run.started_by, run.input, run.output, run.seq, run.exit_code) == (
        "running",
        "B",
        "new-in",
        [],
        0,
        None,
    )
    assert run.ended_at is None


async def test_get_finished_run_with_seq(migrated: asyncpg.Connection):
    sid = await _session(migrated)
    await repo.claim(migrated, sid, "A", "3")
    await repo.save_progress(migrated, sid, [{"s": "out", "t": "9"}])
    mid = await repo.get(migrated, sid)
    assert mid is not None and mid.status == "running" and mid.seq == 1
    segs = [{"s": "out", "t": "9é"}, {"s": "err", "t": "x"}]
    await repo.finish(migrated, sid, "finished", 0, segs)
    run = await repo.get(migrated, sid)
    assert run is not None
    assert run.input == "3" and run.output == segs and run.status == "finished"
    assert run.started_by == "A" and run.exit_code == 0 and run.ended_at is not None
    assert run.seq == len("9é".encode()) + 1
    assert await repo.get(migrated, await _session(migrated)) is None


async def test_interrupt_running(migrated: asyncpg.Connection):
    await migrated.execute("delete from session_scratch_run")
    s1, s2 = await _session(migrated), await _session(migrated)
    await repo.claim(migrated, s1, "A", "")
    await repo.claim(migrated, s2, "A", "")
    await repo.finish(migrated, s2, "finished", 0, [])
    assert await repo.interrupt_running(migrated) == 1
    r1 = await repo.get(migrated, s1)
    assert r1 is not None and r1.status == "interrupted" and r1.ended_at is not None
    assert (await repo.get(migrated, s2)).status == "finished"  # type: ignore[union-attr]


async def test_session_with_a_run_is_not_deleted_automatically(migrated: asyncpg.Connection):
    """NFR-9: no foreign key cascades, so a session that has a run cannot be removed under it."""
    sid = await _session(migrated)
    await repo.claim(migrated, sid, "A", "1")
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await migrated.execute("delete from session where id = $1", sid)
    assert await repo.get(migrated, sid) is not None
