"""Task 24: runs service (execute, grade, persist). FR-21, FR-22, FR-23, FR-24, FR-26."""

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db
from app.runs import repo as runs_repo
from app.runs import service

RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
def runner_url() -> str:
    return RUNNER_URL


async def _problem(
    conn: asyncpg.Connection, signature: str, tests: list[tuple[list, object]]
) -> uuid.UUID:
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter)
           values ('p', 'd', $1, 'f', '[]'::jsonb, 'int', false)
           returning id""",
        signature,
    )
    await conn.executemany(
        "insert into problem_test (problem_id, position, args, expected) values ($1, $2, $3, $4)",
        [
            (problem_id, i, json.dumps(args), json.dumps(expected))
            for i, (args, expected) in enumerate(tests)
        ],
    )
    return problem_id


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


async def _setup(
    conn: asyncpg.Connection, signature: str, tests: list[tuple[list, object]]
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    problem_id = await _problem(conn, signature, tests)
    session_id = await _session(conn, problem_id)
    participant_id = await _participant(conn, session_id)
    return session_id, problem_id, participant_id


async def test_fr22_wrong_answers_are_reported_with_no_values(
    migrated: asyncpg.Connection, runner_url: str
) -> None:
    session_id, problem_id, participant_id = await _setup(
        migrated,
        "def mul(a: int, b: int) -> int",
        [([2, 3], 5), ([1, 1], 2)],
    )

    result = await service.run(
        migrated,
        runner_url,
        session_id,
        problem_id,
        "def mul(a, b):\n    return a * b\n",
        participant_id,
    )

    assert [r.outcome for r in result.results] == ["wrong_answer", "wrong_answer"]
    assert result.accepted is False


async def test_fr23_all_passed_marks_the_problem_accepted(
    migrated: asyncpg.Connection, runner_url: str
) -> None:
    session_id, problem_id, participant_id = await _setup(
        migrated, "def add(a: int, b: int) -> int", [([2, 3], 5)]
    )

    result = await service.run(
        migrated,
        runner_url,
        session_id,
        problem_id,
        "def add(a, b):\n    return a + b\n",
        participant_id,
    )

    assert [r.outcome for r in result.results] == ["passed"]
    assert result.accepted is True
    row = await migrated.fetchrow(
        "select accepted from session_problem where session_id = $1 and problem_id = $2",
        session_id,
        problem_id,
    )
    assert row is not None
    assert row["accepted"] is True


async def test_fr24_an_infinite_loop_gives_time_limit_exceeded(
    migrated: asyncpg.Connection, runner_url: str
) -> None:
    session_id, problem_id, participant_id = await _setup(migrated, "def f() -> int", [([], 0)])

    result = await service.run(
        migrated,
        runner_url,
        session_id,
        problem_id,
        "def f():\n    while True:\n        pass\n",
        participant_id,
    )

    assert [r.outcome for r in result.results] == ["time_limit_exceeded"]


async def test_the_runner_request_body_contains_no_expected(
    migrated: asyncpg.Connection, runner_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    session_id, problem_id, participant_id = await _setup(
        migrated, "def add(a: int, b: int) -> int", [([2, 3], 99999)]
    )
    real_execute = service.execute
    captured: dict = {}

    async def spy(url: str, code: str, function_name: str, cases: list) -> list:
        captured["cases"] = cases
        return await real_execute(url, code, function_name, cases)

    monkeypatch.setattr(service, "execute", spy)

    await service.run(
        migrated,
        runner_url,
        session_id,
        problem_id,
        "def add(a, b):\n    return a + b\n",
        participant_id,
    )

    assert captured["cases"] == [[2, 3]]


async def test_fr26_a_concurrent_second_call_raises_run_in_progress(
    database_url: str, runner_url: str
) -> None:
    conn_a = await asyncpg.connect(database_url)
    conn_b = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn_a)
        session_id, problem_id, participant_id = await _setup(conn_a, "def f() -> int", [([], 0)])
        slow_code = "def f():\n    while True:\n        pass\n"

        results = await asyncio.gather(
            service.run(conn_a, runner_url, session_id, problem_id, slow_code, participant_id),
            service.run(conn_b, runner_url, session_id, problem_id, slow_code, participant_id),
            return_exceptions=True,
        )

        oks = [r for r in results if isinstance(r, service.RunResult)]
        errors = [r for r in results if isinstance(r, Exception)]
        assert len(oks) == 1
        assert len(errors) == 1
        assert isinstance(errors[0], runs_repo.RunInProgress)
    finally:
        await conn_a.close()
        await conn_b.close()
