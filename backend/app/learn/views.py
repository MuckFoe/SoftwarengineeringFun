"""Wire shapes for learning sessions (spec 006 plan, Wire shapes).

Pure. `step_view` is the only place a step becomes wire data: a check's answer (correct
options, accepted texts, accepted commands and their output) and its known-mistake
responses are left out until the step is passed or its answer revealed (FR-14, FR-14a,
FR-15). The hint is left out until revealed. Attempt text is carried as-is, as data; only
`body_html` and `hint_html` are HTML, rendered here with raw HTML off (NFR-4).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.learn.lesson_file import Check, ChoiceCheck, Lesson, Step, TextCheck
from app.problems.markdown import render_description

SHOW_ANSWER_AFTER = 3  # wrong attempts on the step (FR-14a)
ASSET_PATH = "/api/learn/assets/"

Json = dict[str, Any]


@dataclass(frozen=True)
class StepProgress:
    """A `learning_step` row; the defaults are a step that has just become current."""

    hint_revealed_at: datetime | None = None
    answer_revealed_at: datetime | None = None
    passed_at: datetime | None = None
    passed_by_name: str | None = None


@dataclass(frozen=True)
class AttemptRow:
    """A `learning_attempt` row."""

    id: int
    actor_name: str
    kind: str  # choice | text | command
    submitted: list[int] | str
    correct: bool
    output: str | None
    created_at: datetime


def _at(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat()


def _html(source: str, assets: Mapping[str, str], base_path: str) -> str:
    """Markdown → HTML; images resolve only to this lesson version's assets (src → SHA-256)."""

    def image_src(src: str) -> str | None:
        sha = assets.get(src)
        return None if sha is None else ASSET_PATH + sha

    return render_description(source, base_path, image_src=image_src)


def lesson_outline(key: str, topic: str, lesson: Lesson) -> Json:
    return {
        "key": key,
        "title": lesson.title,
        "topic": topic,
        "steps": [
            {"position": n, "title": step.title, "kind": step.kind}
            for n, step in enumerate(lesson.steps)
        ],
    }


def _check(check: Check | None) -> Json | None:
    if check is None:
        return None
    if isinstance(check, ChoiceCheck):
        return {"type": "choice", "options": list(check.options), "multiple": check.multiple}
    if isinstance(check, TextCheck):
        return {"type": "text"}
    return {"type": "terminal", "prompt": check.prompt}


def answer(check: Check) -> Json:
    """The answer shown once a step is passed or revealed; a terminal's is its first command."""
    if isinstance(check, ChoiceCheck):
        # Lesson files number options from 1; the wire counts from 0, like step positions.
        return {"type": "choice", "correct": [c - 1 for c in check.correct]}
    if isinstance(check, TextCheck):
        return {"type": "text", "accept": list(check.accept)}
    first = check.accept[0]
    return {"type": "terminal", "command": first.command, "output": first.output}


def attempt(row: AttemptRow) -> Json:
    submitted = list(row.submitted) if isinstance(row.submitted, list) else row.submitted
    return {
        "id": row.id,
        "by": row.actor_name,
        "kind": row.kind,
        "submitted": submitted,
        "correct": row.correct,
        "output": row.output,
        "at": _at(row.created_at),
    }


def _passed(progress: StepProgress) -> Json | None:
    if progress.passed_at is None:
        return None
    return {
        "by": progress.passed_by_name,
        "at": _at(progress.passed_at),
        "after_reveal": progress.answer_revealed_at is not None,
    }


def step_view(
    position: int,
    step: Step,
    progress: StepProgress,
    attempts: Sequence[AttemptRow],
    assets: Mapping[str, str],
    base_path: str = "",
) -> Json:
    passed = progress.passed_at is not None
    revealed = progress.answer_revealed_at is not None
    wrong = sum(1 for a in attempts if not a.correct)
    shown = step.check is not None and (passed or revealed)
    hint_html = None
    if step.hint is not None and progress.hint_revealed_at is not None:
        hint_html = _html(step.hint, assets, base_path)
    return {
        "position": position,
        "title": step.title,
        "kind": step.kind,
        "body_html": _html(step.body, assets, base_path),
        "check": _check(step.check),
        "has_hint": step.hint is not None,
        "hint_html": hint_html,
        "show_answer_available": (
            step.check is not None and not passed and not revealed and wrong >= SHOW_ANSWER_AFTER
        ),
        "answer": answer(step.check) if shown and step.check is not None else None,
        "attempts": [attempt(a) for a in attempts],
        "passed": _passed(progress),
    }


def summary(
    lesson: Lesson,
    progress: Mapping[int, StepProgress],
    attempts: Mapping[int, Sequence[AttemptRow]],
) -> Json:
    steps = []
    for n, step in enumerate(lesson.steps):
        p = progress.get(n, StepProgress())
        steps.append(
            {
                "position": n,
                "title": step.title,
                "attempts": len(attempts.get(n, ())),
                "passed_by": p.passed_by_name,
                "after_reveal": p.answer_revealed_at is not None,
            }
        )
    return {"steps": steps}


def record(
    key: str,
    topic: str,
    lesson: Lesson,
    *,
    current_step: int,
    completed: bool,
    stale: bool,
    progress: Mapping[int, StepProgress],
    attempts: Mapping[int, Sequence[AttemptRow]],
    assets: Mapping[str, str],
    base_path: str = "",
) -> Json:
    """The whole session for a joiner or a stale read-only view: passed steps plus the current."""
    last = min(current_step, len(lesson.steps) - 1)
    steps = [
        step_view(
            n,
            lesson.steps[n],
            progress.get(n, StepProgress()),
            attempts.get(n, ()),
            assets,
            base_path,
        )
        for n in range(last + 1)
    ]
    return {
        "lesson": lesson_outline(key, topic, lesson),
        "current_step": current_step,
        "completed": completed,
        "stale": stale,
        "steps": steps,
        "summary": summary(lesson, progress, attempts) if completed else None,
    }
