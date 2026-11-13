"""Task 8: the guard's executed solution check against the real runner (plan: Solution guard 5-6).

AC-8 (FR-10): an answer whose code line, placed alone into the editor, passes every test is
withheld. AC-9 (FR-11): these executions never reach `run` or `run_result`.

Runner-backed, so kept to a few tests whose executions all go out concurrently.
"""

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db
from app.hints.guard import candidates, check, check_answer, passes_all_tests
from app.problems.repo import ProblemWithTests
from app.problems.signature import TestInput
from app.runs.runner_client import RunnerUnavailable

RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")
SWEEP_CONCURRENCY = 2  # problems at a time; each sends up to 3 candidates
SEED_DIR = Path(__file__).resolve().parents[3] / "seed" / "problems"

# One sample per category, every difficulty: the four easy ones have single-line reference bodies.
STARTER_SAMPLE = (
    "01-sum-two",  # easy, math-bits
    "02-reverse-words",  # easy, strings
    "13-kth-smallest",  # easy, sorting-searching
    "18-common-elements",  # easy, hash-maps-sets
    "09-average-or-none",  # medium, math-bits
    "088-judge-disagreement-count",  # hard, sorting-searching
)


def _problem(signature: str, tests: list[tuple[list, object]]) -> ProblemWithTests:
    return ProblemWithTests(
        id=uuid.uuid4(),
        title="p",
        description="d",
        signature=signature,
        deleted=False,
        tests=[TestInput(args=args, expected=expected) for args, expected in tests],
    )


ADD = _problem(
    "def add(a: int, b: int) -> int",
    [([1, 2], 3), ([0, 0], 0), ([-4, 9], 5), ([10, -10], 0)],
)


def _starter(folder: str) -> tuple[ProblemWithTests, str]:
    path = SEED_DIR / folder
    data = json.loads((path / "problem.json").read_text())
    tests = [(t["args"], t["expected"]) for t in data["tests"]]
    return _problem(data["signature"], tests), (path / "reference.py").read_text()


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _counts(conn: asyncpg.Connection) -> tuple[int, int]:
    runs = await conn.fetchval("select count(*) from run")
    results = await conn.fetchval("select count(*) from run_result")
    return runs, results


async def test_ac8_solutions_for_add_are_withheld_and_a_partial_line_is_shown(
    migrated: asyncpg.Connection,
) -> None:
    before = await _counts(migrated)
    full_def = "```python\ndef add(a, b):\n    return a + b\n```"
    answers = {
        "Try `return a + b` here.": None,
        "Try `a + b` here.": None,
        full_def: None,
        "Start with `if not a:` and think about what follows.": (
            "Start with `if not a:` and think about what follows."
        ),
        "Think about what adding means.": "Think about what adding means.",
        "Try `return a - b` here.": "Try `return a - b` here.",
        # Names don't count as the one code line, but each fragment is still run: a solving
        # fragment after a name is caught, and names alone are shown.
        "Look at `a`, then try `a + b`.": None,
        "Add `a` and `b` with the addition operator.": (
            "Add `a` and `b` with the addition operator."
        ),
    }
    shown = await asyncio.gather(*(check(RUNNER_URL, ADD, raw) for raw in answers))
    assert dict(zip(answers, shown, strict=True)) == answers
    # AC-9: the guard's executions are never stored as runs or run results.
    assert await _counts(migrated) == before


async def test_ac8_starter_single_line_bodies_and_full_references_pass_all_tests() -> None:
    # The runner's stdlib server drops connections past a handful at once; a real hint sends
    # at most 3 candidates, so the sweep goes out in small concurrent batches.
    limit = asyncio.Semaphore(SWEEP_CONCURRENCY)

    async def bounded(problem: ProblemWithTests, codes: list[str]) -> bool:
        async with limit:
            return await passes_all_tests(RUNNER_URL, problem, codes)

    jobs = []
    labels = []
    for folder in STARTER_SAMPLE:
        problem, reference = _starter(folder)
        jobs.append(bounded(problem, [reference]))
        labels.append(f"{folder}: full reference")
        header, *body = [line for line in reference.splitlines() if line.strip()]
        if len(body) == 1:
            line = body[0].strip()
            jobs.append(bounded(problem, candidates(header, line)))
            labels.append(f"{folder}: {line}")
            expression = line.removeprefix("return ").strip()
            jobs.append(bounded(problem, candidates(header, expression)))
            labels.append(f"{folder}: {expression}")
    outcomes = await asyncio.gather(*jobs)
    assert len(labels) == 6 + 2 * 4
    assert [label for label, ok in zip(labels, outcomes, strict=True) if not ok] == []


async def test_executed_check_raises_runner_unavailable_when_the_runner_is_unreachable() -> None:
    with pytest.raises(RunnerUnavailable):
        await check("http://127.0.0.1:9", ADD, "Try `a + b` here.")
    # No code line: nothing is executed, so an unreachable runner does not matter.
    assert await check("http://127.0.0.1:9", ADD, "Think about it.") == "Think about it."


async def test_fr20_an_answer_splitting_the_solution_over_its_code_lines_asks_first() -> None:
    """Spec 020 FR-20 (2026-11-13): an answer's code lines are also run together as the body."""
    problem = _problem("def add(a: int, b: int) -> int", [([2, 3], 5), ([-1, 1], 0)])
    split = "First `total = a + b`, then `return total`."
    safe = "Use `a + 1` to see how `+` behaves."
    verdicts = await asyncio.gather(
        check_answer(RUNNER_URL, problem, split), check_answer(RUNNER_URL, problem, safe)
    )
    assert verdicts == [("reveal", None), ("ok", safe)]
