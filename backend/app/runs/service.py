"""Runs service: execute, grade, persist (plan.md run pipeline, steps 1, 2 and 5).

FR-21 (execute), FR-22/FR-23 (grade), FR-24 (limits surface as outcomes), FR-26 (one at a time).
The caller supplies the code, so this module never depends on sessions.
"""

import uuid
from dataclasses import dataclass

import asyncpg

from app.problems import repo as problems_repo
from app.problems.signature import parse_signature
from app.runs import repo as runs_repo
from app.runs.grading import TestResult, grade, is_accepted
from app.runs.runner_client import CaseOutcome, RunnerUnavailable, execute

Status = str  # "done" | "infra_error"


@dataclass(frozen=True)
class RunResult:
    run_id: uuid.UUID
    status: Status
    results: list[TestResult]
    accepted: bool
    # FR-17: all None when the run did not finish; examples None when there are no results.
    duration_ms: int | None = None
    memory_kb: int | None = None
    examples_passed: int | None = None
    examples_total: int | None = None


def examples_counts(results: list[TestResult]) -> tuple[int | None, int | None]:
    """FR-17: (passed, total) over `results`; both None when there are none."""
    if not results:
        return None, None
    return sum(1 for r in results if r.outcome == "passed"), len(results)


def summarise(results: list[TestResult], outcomes: list[CaseOutcome]) -> dict[str, int | None]:
    """FR-17: total time, peak memory and examples passed/total. Missing, never zero."""
    passed, total = examples_counts(results)
    finished = (
        bool(outcomes)
        and all(o.status in ("ok", "error") for o in outcomes)
        and all(o.duration_ms is not None and o.memory_kb is not None for o in outcomes)
    )
    return {
        "duration_ms": sum(o.duration_ms for o in outcomes if o.duration_ms is not None)
        if finished
        else None,
        "memory_kb": max(o.memory_kb for o in outcomes if o.memory_kb is not None)
        if finished
        else None,
        "examples_passed": passed,
        "examples_total": total,
    }


async def start(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    problem_id: uuid.UUID,
    code: str,
    participant_id: uuid.UUID,
) -> uuid.UUID:
    """Reserves the run slot. Raises `RunInProgress` (FR-26) if one is already running."""
    return await runs_repo.start_run(conn, session_id, problem_id, code, participant_id)


async def finish(
    conn: asyncpg.Connection,
    runner_url: str,
    run_id: uuid.UUID,
    session_id: uuid.UUID,
    problem_id: uuid.UUID,
    code: str,
) -> RunResult:
    """Executes, grades and persists a run already reserved by `start`."""
    problem = await problems_repo.get_with_tests(conn, problem_id)
    function_name = parse_signature(problem.signature).name
    cases = [test.args for test in problem.tests]

    try:
        outcomes = await execute(runner_url, code, function_name, cases)
    except RunnerUnavailable:
        await runs_repo.finish_run(conn, run_id, status="infra_error", results=[])
        return RunResult(run_id=run_id, status="infra_error", results=[], accepted=False)

    expected = [test.expected for test in problem.tests]
    results = grade(expected, outcomes)
    accepted = is_accepted(results)
    await runs_repo.finish_run(conn, run_id, status="done", results=results)
    if accepted:
        await runs_repo.mark_accepted(conn, session_id, problem_id)
    return RunResult(
        run_id=run_id,
        status="done",
        results=results,
        accepted=accepted,
        **summarise(results, outcomes),
    )


async def run(
    conn: asyncpg.Connection,
    runner_url: str,
    session_id: uuid.UUID,
    problem_id: uuid.UUID,
    code: str,
    participant_id: uuid.UUID,
) -> RunResult:
    """Raises `RunInProgress` (FR-26) if a run is already in progress for this session."""
    run_id = await start(conn, session_id, problem_id, code, participant_id)
    return await finish(conn, runner_url, run_id, session_id, problem_id, code)
