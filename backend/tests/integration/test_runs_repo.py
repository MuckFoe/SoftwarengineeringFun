"""Task 18: runs repository (FR-23, FR-26, FR-27)."""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db
from app.runs import repo
from app.runs.grading import TestResult


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _problem(conn: asyncpg.Connection, title: str) -> uuid.UUID:
    return await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter)
           values ($1, 'd', 'def add(a: int, b: int) -> int', 'add', '[]'::jsonb, 'int', false)
           returning id""",
        title,
    )


async def _session(conn: asyncpg.Connection, problem_id: uuid.UUID) -> uuid.UUID:
    return await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        problem_id,
    )


async def _participant(conn: asyncpg.Connection, session_id: uuid.UUID) -> uuid.UUID:
    return await conn.fetchval(
        "insert into participant (session_id, display_name) values ($1, 'Ada') returning id",
        session_id,
    )


async def test_fr26_a_second_start_run_raises_run_in_progress(
    migrated: asyncpg.Connection,
) -> None:
    problem_id = await _problem(migrated, "Sum two")
    session_id = await _session(migrated, problem_id)
    participant_id = await _participant(migrated, session_id)
    await repo.start_run(migrated, session_id, problem_id, "return a + b", participant_id)

    with pytest.raises(repo.RunInProgress):
        await repo.start_run(migrated, session_id, problem_id, "return a - b", participant_id)

    rows = await migrated.fetch("select count(*) as n from run where session_id = $1", session_id)
    assert rows[0]["n"] == 1


async def test_fr26_a_new_run_can_start_once_the_first_is_finished(
    migrated: asyncpg.Connection,
) -> None:
    problem_id = await _problem(migrated, "Sum two")
    session_id = await _session(migrated, problem_id)
    participant_id = await _participant(migrated, session_id)
    first = await repo.start_run(migrated, session_id, problem_id, "return a + b", participant_id)
    await repo.finish_run(migrated, first, status="done", results=[])

    second = await repo.start_run(migrated, session_id, problem_id, "return a - b", participant_id)

    assert second != first


async def test_fr27_two_finished_runs_are_retrievable_with_their_code_and_results(
    migrated: asyncpg.Connection,
) -> None:
    problem_a = await _problem(migrated, "Sum two")
    problem_b = await _problem(migrated, "Reverse list")
    session_id = await _session(migrated, problem_a)
    participant_id = await _participant(migrated, session_id)

    run_a = await repo.start_run(migrated, session_id, problem_a, "return a + b", participant_id)
    await repo.finish_run(migrated, run_a, status="done", results=[TestResult(1, "passed")])
    run_b = await repo.start_run(
        migrated, session_id, problem_b, "return list(reversed(xs))", participant_id
    )
    await repo.finish_run(
        migrated,
        run_b,
        status="done",
        results=[TestResult(1, "wrong_answer"), TestResult(2, "error", "boom", "Traceback...")],
    )

    loaded_a = await repo.last_run(migrated, session_id, problem_a)
    loaded_b = await repo.last_run(migrated, session_id, problem_b)

    assert loaded_a is not None
    assert loaded_a.code == "return a + b"
    assert loaded_a.results == [TestResult(1, "passed")]
    assert loaded_b is not None
    assert loaded_b.code == "return list(reversed(xs))"
    assert loaded_b.results == [
        TestResult(1, "wrong_answer"),
        TestResult(2, "error", "boom", "Traceback..."),
    ]


async def test_last_run_is_none_when_there_is_no_run_yet(migrated: asyncpg.Connection) -> None:
    problem_id = await _problem(migrated, "Sum two")
    session_id = await _session(migrated, problem_id)

    assert await repo.last_run(migrated, session_id, problem_id) is None


async def test_fr23_mark_accepted_sets_accepted_and_accepted_at(
    migrated: asyncpg.Connection,
) -> None:
    problem_id = await _problem(migrated, "Sum two")
    session_id = await _session(migrated, problem_id)

    await repo.mark_accepted(migrated, session_id, problem_id)

    row = await migrated.fetchrow(
        """select accepted, accepted_at from session_problem
           where session_id = $1 and problem_id = $2""",
        session_id,
        problem_id,
    )
    assert row is not None
    assert row["accepted"] is True
    assert row["accepted_at"] is not None
