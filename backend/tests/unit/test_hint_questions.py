"""Spec 020 FR-17 to FR-22 (questions, added 2026-11-13): the pure parts.

The question normalizer, the question and reveal prompts, and the answer checks that need no
runner. The executed check on answers is in tests/integration/test_hint_guard_runner.py.
"""

import uuid

import pytest

from app.hints.guard import (
    ANSWER_MAX_CHARS,
    REVEALED_MAX_CHARS,
    answer_candidates,
    check_answer,
    normalize_revealed,
)
from app.hints.prompt import (
    QUESTION_SYSTEM_MESSAGE,
    REVEAL_SYSTEM_MESSAGE,
    REVEALS_SOLUTION,
    HintContext,
    build_question_messages,
)
from app.hints.service import QUESTION_MAX_CHARS, normalize_question
from app.problems.repo import ProblemWithTests

ADD_SIG = "def add(a: int, b: int) -> int"
# No runner is reachable here: an answer that reaches the executed check would raise.
NO_RUNNER = "http://127.0.0.1:9"


def _ctx(**overrides: object) -> HintContext:
    base: dict[str, object] = {
        "title": "Add",
        "description": "Add two numbers. DESCQUAIL",
        "signature": ADD_SIG,
        "code": "def add(a, b):\n    pass",
        "latest_run": None,
        "earlier_hints": ["Look at the operator HINTONE."],
        "note": None,
        "earlier_questions": (("What is a QUESTIONONE?", "It is ANSWERONE."),),
    }
    base.update(overrides)
    return HintContext(**base)  # type: ignore[arg-type]


def _problem() -> ProblemWithTests:
    return ProblemWithTests(
        id=uuid.uuid4(), title="p", description="d", signature=ADD_SIG, deleted=False, tests=[]
    )


# --- FR-17: the question --------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  what does zip do?  ", "what does zip do?"),
        ("two\nlines", "two lines"),
        ("   ", None),
        ("", None),
        (None, None),
        (42, None),
    ],
)
def test_fr17_question_is_one_trimmed_line_or_none(raw: object, expected: str | None) -> None:
    assert normalize_question(raw) == expected


def test_fr17_question_is_cut_to_500_characters() -> None:
    assert normalize_question("x" * 600) == "x" * QUESTION_MAX_CHARS


# --- FR-19, FR-20, FR-22: the prompts ------------------------------------------------


def test_fr22_question_prompt_carries_context_earlier_questions_and_the_question() -> None:
    system, user = build_question_messages(_ctx(), "Why does QUESTIONTWO fail?")
    assert system == {"role": "system", "content": QUESTION_SYSTEM_MESSAGE}
    content = user["content"]
    for marker in ("DESCQUAIL", "HINTONE", "QUESTIONONE", "ANSWERONE", "QUESTIONTWO"):
        assert marker in content, marker
    assert content.rstrip().endswith("Why does QUESTIONTWO fail?")
    assert "## Hint level" not in content


def test_fr20_the_model_is_told_to_say_reveals_solution_instead_of_the_solution() -> None:
    assert REVEALS_SOLUTION in QUESTION_SYSTEM_MESSAGE
    assert REVEALS_SOLUTION not in REVEAL_SYSTEM_MESSAGE


def test_fr20_reveal_mode_uses_the_reveal_system_message() -> None:
    system, _ = build_question_messages(_ctx(), "q", reveal=True)
    assert system["content"] == REVEAL_SYSTEM_MESSAGE


# --- FR-19, FR-20: the answer checks ---------------------------------------------------


async def test_fr20_the_marker_asks_the_asker_first() -> None:
    assert await check_answer(NO_RUNNER, _problem(), "REVEALS_SOLUTION") == ("reveal", None)
    marked = "<think>hm</think>\nThat is the solution. REVEALS_SOLUTION"
    assert await check_answer(NO_RUNNER, _problem(), marked) == ("reveal", None)


async def test_fr20_a_whole_function_in_an_answer_asks_the_asker_first() -> None:
    raw = "Like this:\n```python\ndef add(a, b):\n    return a + b\n```"
    assert await check_answer(NO_RUNNER, _problem(), raw) == ("reveal", None)


async def test_fr19_a_plain_prose_answer_is_shown() -> None:
    raw = "Answer: `+` adds numbers. It works on ints and floats alike."
    verdict, body = await check_answer(NO_RUNNER, _problem(), raw)
    assert verdict == "ok"
    assert body == "`+` adds numbers. It works on ints and floats alike."


@pytest.mark.parametrize(
    "raw",
    [
        "x" * (ANSWER_MAX_CHARS + 1),
        " ".join(f"Sentence {i}." for i in range(8)),
        "1. one\n2. two\n3. three\n4. four",
    ],
    ids=["too-long", "too-many-sentences", "a-plan"],
)
async def test_fr19_an_answer_breaking_the_length_rules_is_withheld(raw: str) -> None:
    assert await check_answer(NO_RUNNER, _problem(), raw) == ("withheld", None)


def test_fr20_an_answers_code_lines_are_also_tried_together_as_the_body() -> None:
    text = "Do `total = a + b` and then `return total`."
    codes = answer_candidates(ADD_SIG, text)
    assert "def add(a: int, b: int) -> int:\n    total = a + b\n    return total" in codes


def test_fr20_a_revealed_answer_is_cleaned_and_capped() -> None:
    raw = "<think>x</think>REVEALS_SOLUTION\n```python\ndef add(a, b):\n    return a + b\n```"
    assert normalize_revealed(raw) == "```python\ndef add(a, b):\n    return a + b\n```"
    assert normalize_revealed("y" * (REVEALED_MAX_CHARS + 1)) is None


async def test_fr20_an_unfenced_multi_line_function_asks_the_asker_first() -> None:
    raw = "def add(a: int, b: int):\n    result = a\n    return result"
    assert await check_answer(NO_RUNNER, _problem(), raw) == ("reveal", None)
