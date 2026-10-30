"""Spec 006 task 13: wire shapes, and what they hide before a step passes (AC-13, AC-13a, AC-14,
AC-28; FR-9, FR-14, FR-14a, FR-15, FR-24, NFR-4)."""

import json
from datetime import UTC, datetime, timedelta

from app.learn.lesson_file import (
    ChoiceCheck,
    CommandOutput,
    Lesson,
    Step,
    TerminalCheck,
    TextCheck,
)
from app.learn.views import (
    AttemptRow,
    StepProgress,
    answer,
    attempt,
    lesson_outline,
    record,
    step_view,
    summary,
)

SHA = "c" * 64
T0 = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)

CHOICE = Step(
    kind="quiz",
    title="Which runs?",
    body="Which of these are running processes?",
    hint=None,
    check=ChoiceCheck(
        options=("An image", "A container", "A Dockerfile", "A detached container"),
        correct=(2, 4),
        multiple=True,
    ),
)
TEXT = Step(
    kind="quiz",
    title="Name it",
    body="A running instance of an image is called a …",
    hint="Starts with *c*.",
    check=TextCheck(accept=("zqcontainerzq", "zqboxzq")),
)
TERMINAL = Step(
    kind="terminal",
    title="List containers",
    body="Show the running containers.",
    hint=None,
    check=TerminalCheck(
        prompt="$ ",
        accept=(
            CommandOutput(command="docker zqps", output="ZQ-PS-OUTPUT"),
            CommandOutput(command="docker zqcontainer zqls", output="ZQ-LS-OUTPUT"),
        ),
        responses=(CommandOutput(command="docker zqmistake", output="ZQ-MISTAKE-OUTPUT"),),
    ),
)
EXPLANATION = Step(
    kind="explanation",
    title="Images and containers",
    body="![diagram](layers.png) and ![x](/api/images/0b8f6a52-4c1e-4d0a-9a43-2f5d9b7e1c11)",
    hint="See ![d](layers.png).",
    check=None,
)
LESSON = Lesson(
    title="Basics",
    summary="Images vs containers.",
    minutes=25,
    steps=(EXPLANATION, CHOICE, TEXT, TERMINAL),
    images=("layers.png",),
)
ASSETS = {"layers.png": SHA}

FRESH = StepProgress()


def wrong(n: int, kind: str = "text") -> list[AttemptRow]:
    return [
        AttemptRow(
            id=i,
            actor_name="Ana",
            kind=kind,
            submitted=[1] if kind == "choice" else "nope",
            correct=False,
            output=None,
            created_at=T0 + timedelta(seconds=i),
        )
        for i in range(1, n + 1)
    ]


def view(step: Step, progress: StepProgress = FRESH, attempts=(), position: int = 1) -> dict:
    return step_view(position, step, progress, list(attempts), ASSETS)


def wire(value: object) -> str:
    return json.dumps(value)


# AC-13 (FR-14): nothing that gives the answer away before the step passes


def test_ac13_unpassed_choice_view_has_no_correct_option_set():
    v = view(CHOICE)
    text = wire(v)

    assert v["check"] == {
        "type": "choice",
        "options": ["An image", "A container", "A Dockerfile", "A detached container"],
        "multiple": True,
    }
    assert v["answer"] is None
    assert '"correct"' not in text
    assert "[2, 4]" not in text


def test_ac13_unpassed_text_view_has_no_accepted_text():
    v = view(TEXT)
    text = wire(v)

    assert v["check"] == {"type": "text"}
    assert v["answer"] is None
    assert "zqcontainerzq" not in text
    assert "zqboxzq" not in text
    assert "accept" not in text


def test_ac13_unpassed_terminal_view_has_no_command_output_or_response():
    v = view(TERMINAL, attempts=wrong(1, "command"))
    text = wire(v)

    assert v["check"] == {"type": "terminal", "prompt": "$ "}
    assert v["answer"] is None
    for secret in ("zqps", "ZQ-PS-OUTPUT", "zqls", "ZQ-LS-OUTPUT", "zqmistake", "ZQ-MISTAKE"):
        assert secret not in text, secret
    assert "accept" not in text
    assert "responses" not in text


def test_ac13_hint_is_hidden_until_revealed():
    hidden = view(TEXT)
    shown = view(TEXT, StepProgress(hint_revealed_at=T0))

    assert hidden["has_hint"] is True
    assert hidden["hint_html"] is None
    assert "Starts with" not in wire(hidden)
    assert shown["hint_html"] == "<p>Starts with <em>c</em>.</p>\n"


def test_a_step_without_a_hint_or_check():
    v = view(EXPLANATION)

    assert v["has_hint"] is True
    assert v["check"] is None
    assert v["answer"] is None
    assert v["show_answer_available"] is False
    assert view(CHOICE)["has_hint"] is False


# AC-13a (FR-14a): Show answer after 3 wrong attempts


def test_ac13a_show_answer_offered_after_three_wrong_attempts():
    assert view(TEXT, attempts=wrong(2))["show_answer_available"] is False
    assert view(TEXT, attempts=wrong(3))["show_answer_available"] is True


def test_ac13a_correct_attempts_do_not_count_towards_show_answer():
    attempts = [*wrong(2), AttemptRow(9, "Bo", "text", "x", True, None, T0)]

    assert view(TEXT, attempts=attempts)["show_answer_available"] is False


def test_ac13a_after_reveal_answer_is_present_and_offer_is_gone():
    v = view(TEXT, StepProgress(answer_revealed_at=T0), wrong(3))

    assert v["show_answer_available"] is False
    assert v["answer"] == {"type": "text", "accept": ["zqcontainerzq", "zqboxzq"]}
    assert v["passed"] is None


def test_ac13a_revealed_terminal_answer_is_the_first_accepted_command():
    v = view(TERMINAL, StepProgress(answer_revealed_at=T0), wrong(3, "command"))

    assert v["answer"] == {"type": "terminal", "command": "docker zqps", "output": "ZQ-PS-OUTPUT"}
    assert "zqls" not in wire(v)
    assert "zqmistake" not in wire(v)


def test_ac13a_passed_after_reveal():
    revealed = StepProgress(
        answer_revealed_at=T0, passed_at=T0 + timedelta(minutes=1), passed_by_name="Ana"
    )
    not_revealed = StepProgress(passed_at=T0, passed_by_name="Ana")

    assert view(TEXT, revealed)["passed"] == {
        "by": "Ana",
        "at": "2026-10-29T12:01:00+00:00",
        "after_reveal": True,
    }
    assert view(TEXT, not_revealed)["passed"]["after_reveal"] is False


# AC-14 (FR-15): a passed step shows its answer and every attempt


def test_ac14_passed_step_includes_answer_and_all_attempts():
    attempts = [
        *wrong(2, "choice"),
        AttemptRow(3, "Bo", "choice", [2, 4], True, None, T0 + timedelta(seconds=3)),
    ]
    v = view(CHOICE, StepProgress(passed_at=T0, passed_by_name="Bo"), attempts)

    assert v["answer"] == {"type": "choice", "correct": [1, 3]}
    assert [a["id"] for a in v["attempts"]] == [1, 2, 3]
    assert v["attempts"][2] == {
        "id": 3,
        "by": "Bo",
        "kind": "choice",
        "submitted": [2, 4],
        "correct": True,
        "output": None,
        "at": "2026-10-29T12:00:03+00:00",
    }
    assert v["show_answer_available"] is False


def test_passed_terminal_step_answer_is_the_first_accepted_command():
    v = view(TERMINAL, StepProgress(passed_at=T0, passed_by_name="Bo"))

    assert v["answer"] == {"type": "terminal", "command": "docker zqps", "output": "ZQ-PS-OUTPUT"}


def test_answer_builder_per_check_type():
    assert answer(CHOICE.check) == {"type": "choice", "correct": [1, 3]}
    assert answer(TEXT.check) == {"type": "text", "accept": ["zqcontainerzq", "zqboxzq"]}
    assert answer(TERMINAL.check) == {
        "type": "terminal",
        "command": "docker zqps",
        "output": "ZQ-PS-OUTPUT",
    }


# AC-28 (NFR-4): attempt text is data


def test_ac28_attempt_text_is_carried_verbatim():
    row = AttemptRow(1, "<i>Ana</i>", "command", "<b>hi</b>", False, "<b>hi</b>: nope", T0)

    a = attempt(row)

    assert a["submitted"] == "<b>hi</b>"
    assert a["by"] == "<i>Ana</i>"
    assert a["output"] == "<b>hi</b>: nope"


def test_body_html_is_rendered_with_only_this_versions_assets():
    v = step_view(1, EXPLANATION, FRESH, [], ASSETS, base_path="/hub")

    assert f'<img src="/hub/api/learn/assets/{SHA}" alt="diagram" />' in v["body_html"]
    assert "/api/images/" not in v["body_html"]
    assert "<img" not in step_view(1, EXPLANATION, FRESH, [], {})["body_html"]


def test_body_html_escapes_raw_html():
    step = Step(kind="explanation", title="t", body="<b>hi</b>", hint=None, check=None)

    assert "<b>" not in view(step)["body_html"]


# Outline, summary and record (FR-9, FR-24)


def test_lesson_outline():
    assert lesson_outline("01-docker/01-basics", "Docker", LESSON) == {
        "key": "01-docker/01-basics",
        "title": "Basics",
        "topic": "Docker",
        "steps": [
            {"position": 0, "title": "Images and containers", "kind": "explanation"},
            {"position": 1, "title": "Which runs?", "kind": "quiz"},
            {"position": 2, "title": "Name it", "kind": "quiz"},
            {"position": 3, "title": "List containers", "kind": "terminal"},
        ],
    }


def passed(name: str, revealed: bool = False) -> StepProgress:
    return StepProgress(
        answer_revealed_at=T0 if revealed else None, passed_at=T0, passed_by_name=name
    )


def test_summary_lists_attempts_and_passer_per_step():
    progress = {0: passed("Ana"), 1: passed("Bo"), 2: passed("Ana", True), 3: passed("Bo")}
    attempts = {1: wrong(2, "choice"), 2: wrong(3)}

    assert summary(LESSON, progress, attempts) == {
        "steps": [
            {
                "position": 0,
                "title": "Images and containers",
                "attempts": 0,
                "passed_by": "Ana",
                "after_reveal": False,
            },
            {
                "position": 1,
                "title": "Which runs?",
                "attempts": 2,
                "passed_by": "Bo",
                "after_reveal": False,
            },
            {
                "position": 2,
                "title": "Name it",
                "attempts": 3,
                "passed_by": "Ana",
                "after_reveal": True,
            },
            {
                "position": 3,
                "title": "List containers",
                "attempts": 0,
                "passed_by": "Bo",
                "after_reveal": False,
            },
        ]
    }


def test_ac9_record_has_passed_steps_plus_current_and_hides_current_answer():
    progress = {0: passed("Ana"), 1: passed("Bo"), 2: FRESH}
    r = record(
        "01-docker/01-basics",
        "Docker",
        LESSON,
        current_step=2,
        completed=False,
        stale=False,
        progress=progress,
        attempts={1: wrong(1, "choice")},
        assets=ASSETS,
    )

    assert r["lesson"]["key"] == "01-docker/01-basics"
    assert r["current_step"] == 2
    assert r["completed"] is False
    assert r["stale"] is False
    assert [s["position"] for s in r["steps"]] == [0, 1, 2]
    assert r["steps"][1]["answer"] == {"type": "choice", "correct": [1, 3]}
    assert r["steps"][1]["attempts"][0]["id"] == 1
    assert r["steps"][2]["answer"] is None
    assert "zqcontainerzq" not in wire(r)
    assert r["summary"] is None


def test_completed_record_has_every_step_and_a_summary():
    progress = {0: passed("Ana"), 1: passed("Bo"), 2: passed("Ana"), 3: passed("Bo")}
    r = record(
        "01-docker/01-basics",
        "Docker",
        LESSON,
        current_step=4,
        completed=True,
        stale=True,
        progress=progress,
        attempts={},
        assets=ASSETS,
    )

    assert [s["position"] for s in r["steps"]] == [0, 1, 2, 3]
    assert r["stale"] is True
    assert r["summary"] == summary(LESSON, progress, {})
    json.dumps(r)
