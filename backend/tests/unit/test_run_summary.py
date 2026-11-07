"""Task 9 (spec 016, FR-17): time, memory and examples passed/total on a run result.

Pure functions: no database, runner or network.
"""

import uuid

from app.runs.grading import TestResult
from app.runs.runner_client import CaseOutcome
from app.runs.service import RunResult, summarise
from app.sessions.ws import _run_finished_dict, _run_result_dict


def _passed(position: int) -> TestResult:
    return TestResult(position=position, outcome="passed")


def test_fr17_case_outcome_carries_optional_figures() -> None:
    assert CaseOutcome(status="ok", value=1).memory_kb is None
    assert CaseOutcome(status="ok", value=1, memory_kb=5, duration_ms=2).duration_ms == 2


def test_fr17_finished_run_sums_time_takes_max_memory_counts_examples() -> None:
    outcomes = [
        CaseOutcome(status="ok", value=1, memory_kb=100, duration_ms=10),
        CaseOutcome(status="ok", value=2, memory_kb=300, duration_ms=5),
        CaseOutcome(status="ok", value=3, memory_kb=200, duration_ms=7),
    ]
    results = [_passed(1), _passed(2), TestResult(position=3, outcome="wrong_answer")]
    assert summarise(results, outcomes) == dict(
        duration_ms=22, memory_kb=300, examples_passed=2, examples_total=3
    )


def test_fr17_one_failing_example_gives_total_minus_one() -> None:
    outcomes = [CaseOutcome(status="ok", memory_kb=1, duration_ms=1)] * 2
    results = [_passed(1), TestResult(position=2, outcome="error")]
    s = summarise(results, outcomes)
    assert (s["examples_passed"], s["examples_total"]) == (1, 2)


def test_fr17_timeout_gives_null_time_and_memory() -> None:
    outcomes = [
        CaseOutcome(status="ok", memory_kb=100, duration_ms=10),
        CaseOutcome(status="timeout"),
    ]
    results = [_passed(1), TestResult(position=2, outcome="time_limit_exceeded")]
    s = summarise(results, outcomes)
    assert s["duration_ms"] is None and s["memory_kb"] is None


def test_fr17_memory_limit_gives_null_time_and_memory() -> None:
    outcomes = [CaseOutcome(status="memory")]
    s = summarise([TestResult(position=1, outcome="memory_limit_exceeded")], outcomes)
    assert s["duration_ms"] is None and s["memory_kb"] is None


def test_fr17_no_tests_gives_null_examples_and_not_zero() -> None:
    assert summarise([], []) == dict(
        duration_ms=None, memory_kb=None, examples_passed=None, examples_total=None
    )


def test_fr17_missing_per_case_figures_are_omitted_not_zero() -> None:
    outcomes = [CaseOutcome(status="ok")]
    s = summarise([_passed(1)], outcomes)
    assert s["duration_ms"] is None and s["memory_kb"] is None
    assert (s["examples_passed"], s["examples_total"]) == (1, 1)


def test_fr17_run_result_defaults_to_null_figures() -> None:
    r = RunResult(run_id=uuid.uuid4(), status="infra_error", results=[], accepted=False)
    assert (r.duration_ms, r.memory_kb, r.examples_passed, r.examples_total) == (None,) * 4


def test_fr17_run_finished_message_has_the_four_fields() -> None:
    r = RunResult(
        run_id=uuid.uuid4(),
        status="done",
        results=[_passed(1)],
        accepted=True,
        duration_ms=12,
        memory_kb=3400,
        examples_passed=1,
        examples_total=1,
    )
    d = _run_finished_dict(uuid.uuid4(), r)
    assert (d["duration_ms"], d["memory_kb"], d["examples_passed"], d["examples_total"]) == (
        12,
        3400,
        1,
        1,
    )
    assert {"run_id", "problem_id", "accepted", "results"} <= d.keys()


def test_fr17_last_run_has_only_examples() -> None:
    class Res:
        position, outcome, error_message, traceback = 1, "passed", None, None

    class LastRun:
        id = uuid.uuid4()
        problem_id = uuid.uuid4()
        results = [Res(), Res()]

    d = _run_result_dict(LastRun(), True)  # type: ignore[arg-type]
    assert d is not None
    assert (d["examples_passed"], d["examples_total"]) == (2, 2)
    assert "duration_ms" not in d and "memory_kb" not in d


def test_fr17_last_run_with_no_results_has_null_examples() -> None:
    class LastRun:
        id = uuid.uuid4()
        problem_id = uuid.uuid4()
        results: list = []

    d = _run_result_dict(LastRun(), False)  # type: ignore[arg-type]
    assert d is not None
    assert d["examples_passed"] is None and d["examples_total"] is None
