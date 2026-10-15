"""Pure grading: map runner outcomes to per-test results (FR-22, FR-23).

No I/O, no framework imports. Results carry only the test's number, its outcome and,
for errors, the message and traceback; never args, expected or actual values.
"""

from dataclasses import dataclass
from typing import Any, Literal

from app.problems.signature import values_equal

Status = Literal["ok", "error", "timeout", "memory"]
Outcome = Literal["passed", "wrong_answer", "error", "time_limit_exceeded", "memory_limit_exceeded"]

_LIMIT_OUTCOMES: dict[str, Outcome] = {
    "timeout": "time_limit_exceeded",
    "memory": "memory_limit_exceeded",
}


@dataclass(frozen=True)
class CaseOutcome:
    status: Status
    value: Any = None
    error_message: str | None = None
    traceback: str | None = None


@dataclass(frozen=True)
class TestResult:
    __test__ = False  # not a pytest test class

    position: int
    outcome: Outcome
    error_message: str | None = None
    traceback: str | None = None


def _grade_one(position: int, expected: Any, case: CaseOutcome) -> TestResult:
    if case.status == "ok":
        outcome: Outcome = "passed" if values_equal(case.value, expected) else "wrong_answer"
        return TestResult(position, outcome)
    if case.status == "error":
        return TestResult(position, "error", case.error_message, case.traceback)
    return TestResult(position, _LIMIT_OUTCOMES[case.status])


def grade(expected: list[Any], outcomes: list[CaseOutcome]) -> list[TestResult]:
    pairs = zip(expected, outcomes, strict=True)
    return [_grade_one(i, exp, case) for i, (exp, case) in enumerate(pairs, start=1)]


def is_accepted(results: list[TestResult]) -> bool:
    return bool(results) and all(r.outcome == "passed" for r in results)
