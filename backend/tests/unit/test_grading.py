import dataclasses
import json

from app.runs.grading import CaseOutcome, TestResult, grade, is_accepted


def _serialize(results: list[TestResult]) -> str:
    return json.dumps([dataclasses.asdict(r) for r in results])


def test_fr22_unequal_ok_outcomes_are_wrong_answer_and_leak_nothing():
    # tests (2, 3) -> 5 and (1, 1) -> 2; code `a * b` returned 6 and 1.
    expected = [5, 2]
    outcomes = [CaseOutcome(status="ok", value=6), CaseOutcome(status="ok", value=1)]

    results = grade(expected, outcomes)

    assert [r.outcome for r in results] == ["wrong_answer", "wrong_answer"]
    serialized = _serialize(results)
    for leaked in ("5", "6", "2, 3", "1, 1"):
        assert leaked not in serialized
    assert not is_accepted(results)


def test_fr22_results_are_identified_only_by_number():
    results = grade([5, 2], [CaseOutcome(status="ok", value=5), CaseOutcome(status="ok", value=1)])
    assert [r.position for r in results] == [1, 2]
    fields = {f.name for f in dataclasses.fields(TestResult)}
    assert fields == {"position", "outcome", "error_message", "traceback"}


def test_fr22_error_keeps_message_and_traceback():
    tb = 'File "solution.py", line 2, in f\nValueError: bad'
    results = grade(
        [5], [CaseOutcome(status="error", error_message="ValueError: bad", traceback=tb)]
    )
    assert results[0].outcome == "error"
    assert results[0].error_message == "ValueError: bad"
    assert results[0].traceback == tb


def test_fr22_timeout_and_memory_map_to_limit_outcomes():
    results = grade([1, 1], [CaseOutcome(status="timeout"), CaseOutcome(status="memory")])
    assert [r.outcome for r in results] == ["time_limit_exceeded", "memory_limit_exceeded"]
    assert all(r.error_message is None and r.traceback is None for r in results)


def test_fr22_equal_ok_outcome_is_passed():
    results = grade([[1, 2], 0.1 + 0.2], [CaseOutcome("ok", [1, 2]), CaseOutcome("ok", 0.3)])
    assert [r.outcome for r in results] == ["passed", "passed"]


def test_fr23_all_outcomes_equal_to_expected_is_accepted():
    expected = [5, 2, "x"]
    outcomes = [CaseOutcome("ok", 5), CaseOutcome("ok", 2), CaseOutcome("ok", "x")]

    results = grade(expected, outcomes)

    assert all(r.outcome == "passed" for r in results)
    assert is_accepted(results)


def test_fr23_one_failure_is_not_accepted():
    results = grade([5, 2], [CaseOutcome("ok", 5), CaseOutcome("timeout")])
    assert not is_accepted(results)


def test_fr23_no_results_is_not_accepted():
    assert not is_accepted([])
