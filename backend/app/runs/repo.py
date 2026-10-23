"""Runs repository (plan.md "Data model": `run`, `run_result`, `session_problem.accepted`).

FR-23 (accepted), FR-26 (one run at a time), FR-27 (durable runs with their code and results).
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from app import clock
from app.runs.grading import TestResult


class RunInProgress(RuntimeError):
    """Another run is already `running` for this session (FR-26)."""


@dataclass(frozen=True)
class Run:
    id: uuid.UUID
    session_id: uuid.UUID
    problem_id: uuid.UUID
    code: str
    participant_id: uuid.UUID
    status: str
    started_at: datetime
    finished_at: datetime | None
    results: list[TestResult]


async def start_run(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    problem_id: uuid.UUID,
    code: str,
    participant_id: uuid.UUID,
) -> uuid.UUID:
    try:
        return await conn.fetchval(
            """insert into run (session_id, problem_id, code, participant_id, status, started_at)
               values ($1, $2, $3, $4, 'running', $5)
               returning id""",
            session_id,
            problem_id,
            code,
            participant_id,
            clock.now(),
        )
    except asyncpg.UniqueViolationError as exc:
        raise RunInProgress(f"a run is already in progress for session {session_id}") from exc


async def finish_run(
    conn: asyncpg.Connection, run_id: uuid.UUID, *, status: str, results: list[TestResult]
) -> None:
    async with conn.transaction():
        await conn.execute(
            "update run set status = $2, finished_at = $3 where id = $1",
            run_id,
            status,
            clock.now(),
        )
        await conn.executemany(
            """insert into run_result (run_id, test_position, outcome, error_message, traceback)
               values ($1, $2, $3, $4, $5)""",
            [(run_id, r.position, r.outcome, r.error_message, r.traceback) for r in results],
        )


async def mark_accepted(
    conn: asyncpg.Connection, session_id: uuid.UUID, problem_id: uuid.UUID
) -> None:
    await conn.execute(
        """insert into session_problem (session_id, problem_id, accepted, accepted_at)
           values ($1, $2, true, $3)
           on conflict (session_id, problem_id)
           do update set accepted = true, accepted_at = excluded.accepted_at""",
        session_id,
        problem_id,
        clock.now(),
    )


async def last_run(
    conn: asyncpg.Connection, session_id: uuid.UUID, problem_id: uuid.UUID
) -> Run | None:
    row = await conn.fetchrow(
        """select id, session_id, problem_id, code, participant_id, status,
                  started_at, finished_at
           from run
           where session_id = $1 and problem_id = $2
           order by started_at desc
           limit 1""",
        session_id,
        problem_id,
    )
    if row is None:
        return None
    result_rows = await conn.fetch(
        """select test_position, outcome, error_message, traceback
           from run_result where run_id = $1 order by test_position""",
        row["id"],
    )
    results = [
        TestResult(r["test_position"], r["outcome"], r["error_message"], r["traceback"])
        for r in result_rows
    ]
    return Run(
        id=row["id"],
        session_id=row["session_id"],
        problem_id=row["problem_id"],
        code=row["code"],
        participant_id=row["participant_id"],
        status=row["status"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        results=results,
    )
