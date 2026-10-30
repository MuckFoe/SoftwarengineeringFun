"""Learning-session service (spec 006 plan, Service flow). FR-6, FR-11, FR-12, FR-13, FR-14a,
FR-16–FR-24, FR-26, FR-28, NFR-4, NFR-6.

Every step action (submit, continue, hint, show answer) holds the session's `asyncio.Lock`,
checks the session is neither stale nor completed and that `step` is the current step, then
writes in one transaction and returns the events to broadcast, built from committed state
only. It never broadcasts itself; the caller sends the events to every participant and a
`LearnError` only to the one who acted. Judging always uses the session's own lesson version
(FR-28). A submitted command is only compared with the lesson's text, never run (FR-23).
"""

import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import asyncpg

from app.learn import checks, repo, views
from app.learn.lesson_file import (
    Check,
    ChoiceCheck,
    CommandOutput,
    Lesson,
    Step,
    TerminalCheck,
    TextCheck,
)
from app.learn.repo import LearningSession, Participant

MAX_INPUT = 1000  # characters in a quiz text or a command (plan review, 2026-10-29)

Json = dict[str, Any]


class LearnError(Exception):
    """A refused action; `code` is the WebSocket `error` code sent to the actor."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class LessonNotFound(LookupError):
    """No such lesson, or it has no current version (removed)."""


class SessionNotFound(LookupError):
    pass


@dataclass(frozen=True)
class LoadedLesson:
    """One lesson version, rebuilt from its stored snapshot."""

    key: str
    topic: str  # topic title
    lesson: Lesson
    assets: dict[str, str]  # image src (file name) -> sha256


# --- lesson versions -------------------------------------------------------------------------


def _commands(raw: list[dict[str, str]]) -> tuple[CommandOutput, ...]:
    return tuple(CommandOutput(command=c["command"], output=c["output"]) for c in raw)


def _check(raw: dict[str, Any] | None) -> Check | None:
    if raw is None:
        return None
    if raw["type"] == "choice":
        return ChoiceCheck(
            options=tuple(raw["options"]), correct=tuple(raw["correct"]), multiple=raw["multiple"]
        )
    if raw["type"] == "text":
        return TextCheck(accept=tuple(raw["accept"]))
    return TerminalCheck(
        prompt=raw["prompt"], accept=_commands(raw["accept"]), responses=_commands(raw["responses"])
    )


def lesson_from_content(content: dict[str, Any]) -> Lesson:
    """The inverse of the loader's snapshot (`asdict(Lesson)` with `images` as a mapping)."""
    return Lesson(
        title=content["title"],
        summary=content["summary"],
        minutes=content["minutes"],
        steps=tuple(
            Step(
                kind=s["kind"],
                title=s["title"],
                body=s["body"],
                hint=s["hint"],
                check=_check(s["check"]),
            )
            for s in content["steps"]
        ),
        images=tuple(sorted(content["images"])),
    )


async def load_lesson(conn: asyncpg.Connection, version_id: uuid.UUID) -> LoadedLesson:
    version = await repo.get_version(conn, version_id)
    if version is None:
        raise LessonNotFound(str(version_id))
    topic = await conn.fetchval("select topic_title from lesson where key = $1", version.lesson_key)
    return LoadedLesson(
        key=version.lesson_key,
        topic=topic or version.lesson_key.split("/", 1)[0],
        lesson=lesson_from_content(version.content),
        assets=dict(version.content["images"]),
    )


# --- sessions ----------------------------------------------------------------------------------


async def create_session(conn: asyncpg.Connection, lesson_key: str) -> LearningSession:
    """FR-6: at step 0 of the lesson's current version."""
    version_id = await conn.fetchval(
        "select current_version_id from lesson where key = $1", lesson_key
    )
    if version_id is None:
        raise LessonNotFound(lesson_key)
    async with conn.transaction():
        session = await repo.create_session(conn, version_id)
        await repo.ensure_step(conn, session.id, 0)
    return session


async def _session(conn: asyncpg.Connection, session_id: uuid.UUID) -> LearningSession:
    row = await conn.fetchrow(
        """select id, invite_id, lesson_version_id, current_step, completed_at, created_at,
                  last_activity_at, stale_at
           from learning_session where id = $1""",
        session_id,
    )
    if row is None:
        raise SessionNotFound(str(session_id))
    return LearningSession(**dict(row))


async def join(conn: asyncpg.Connection, session_id: uuid.UUID, name: str) -> Participant:
    """A participant row; touches activity. Completed sessions may be joined, stale ones not.
    The name is assumed already validated (strip, 1–30 characters) by the caller."""
    session = await _session(conn, session_id)
    if session.stale_at is not None:
        raise LearnError("session_stale")
    async with conn.transaction():
        participant = await repo.add_participant(conn, session_id, name)
        await repo.touch_activity(conn, session_id)
    return participant


async def record(conn: asyncpg.Connection, session: LearningSession, base_path: str = "") -> Json:
    """The `Record` wire shape: passed steps plus the current one (welcome, read-only view)."""
    loaded = await load_lesson(conn, session.lesson_version_id)
    progress, attempts = await _history(conn, session.id)
    return views.record(
        loaded.key,
        loaded.topic,
        loaded.lesson,
        current_step=session.current_step,
        completed=session.completed_at is not None,
        stale=session.stale_at is not None,
        progress=progress,
        attempts=attempts,
        assets=loaded.assets,
        base_path=base_path,
    )


# --- step actions ------------------------------------------------------------------------------

_locks: dict[uuid.UUID, asyncio.Lock] = {}


def _lock(session_id: uuid.UUID) -> asyncio.Lock:
    lock = _locks.get(session_id)
    if lock is None:
        lock = _locks[session_id] = asyncio.Lock()
    return lock


async def _current(
    conn: asyncpg.Connection, session_id: uuid.UUID, step: int
) -> tuple[LearningSession, LoadedLesson, Step]:
    """Call with the session's lock held."""
    session = await _session(conn, session_id)
    if session.stale_at is not None:
        raise LearnError("session_stale")
    if session.completed_at is not None:
        raise LearnError("session_completed")
    if step != session.current_step:
        raise LearnError("not_current_step")
    loaded = await load_lesson(conn, session.lesson_version_id)
    return session, loaded, loaded.lesson.steps[step]


def _progress(row: repo.Step) -> views.StepProgress:
    return views.StepProgress(
        hint_revealed_at=row.hint_revealed_at,
        answer_revealed_at=row.answer_revealed_at,
        passed_at=row.passed_at,
        passed_by_name=row.passed_by_name,
    )


def _attempt_row(row: repo.Attempt) -> views.AttemptRow:
    return views.AttemptRow(
        id=row.id,
        actor_name=row.actor_name,
        kind=row.kind,
        submitted=row.submitted,
        correct=row.correct,
        output=row.output,
        created_at=row.created_at,
    )


async def _history(
    conn: asyncpg.Connection, session_id: uuid.UUID
) -> tuple[dict[int, views.StepProgress], dict[int, list[views.AttemptRow]]]:
    progress = {s.position: _progress(s) for s in await repo.list_steps(conn, session_id)}
    attempts: dict[int, list[views.AttemptRow]] = {}
    for a in await repo.list_attempts(conn, session_id):
        attempts.setdefault(a.position, []).append(_attempt_row(a))
    return progress, attempts


async def _step_view(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    loaded: LoadedLesson,
    position: int,
    base_path: str,
) -> Json:
    row = await repo.get_step(conn, session_id, position)
    attempts = await repo.list_attempts(conn, session_id, position)
    return views.step_view(
        position,
        loaded.lesson.steps[position],
        _progress(row) if row else views.StepProgress(),
        [_attempt_row(a) for a in attempts],
        loaded.assets,
        base_path,
    )


async def _advance(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    step: int,
    participant_id: uuid.UUID,
    name: str,
    step_count: int,
) -> None:
    """FR-11 / FR-24, inside the caller's transaction. A lost race rolls the transaction back."""
    if not await repo.pass_and_advance(conn, session_id, step, participant_id, name):
        raise LearnError("not_current_step")
    if step + 1 == step_count:
        await repo.set_completed(conn, session_id)
    else:
        await repo.ensure_step(conn, session_id, step + 1)


async def _passed_events(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    loaded: LoadedLesson,
    step: int,
    base_path: str,
) -> list[Json]:
    passed = await _step_view(conn, session_id, loaded, step, base_path)
    last = step + 1 == len(loaded.lesson.steps)
    nxt = None if last else await _step_view(conn, session_id, loaded, step + 1, base_path)
    events = [
        {
            "type": "step_passed",
            "step": step,
            "passed": passed["passed"],
            "answer": passed["answer"],
            "next": nxt,
        }
    ]
    if last:
        progress, attempts = await _history(conn, session_id)
        events.append(
            {"type": "completed", "summary": views.summary(loaded.lesson, progress, attempts)}
        )
    return events


Judge = Callable[[Check | None], tuple[bool, str | None]]


async def _submit(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    name: str,
    step: int,
    kind: str,
    submitted: Any,
    judge: Judge,
    base_path: str,
) -> list[Json]:
    async with _lock(session_id):
        _, loaded, lesson_step = await _current(conn, session_id, step)
        correct, output = judge(lesson_step.check)
        async with conn.transaction():
            attempt = await repo.add_attempt(
                conn,
                session_id,
                step,
                participant_id,
                name,
                kind,
                submitted,
                correct=correct,
                output=output,
            )
            if correct:
                await _advance(
                    conn, session_id, step, participant_id, name, len(loaded.lesson.steps)
                )
            await repo.touch_activity(conn, session_id)
        view = await _step_view(conn, session_id, loaded, step, base_path)
        events: list[Json] = [
            {
                "type": "attempt",
                "step": step,
                "attempt": views.attempt(_attempt_row(attempt)),
                "show_answer_available": view["show_answer_available"],
            }
        ]
        if correct:
            events += await _passed_events(conn, session_id, loaded, step, base_path)
        return events


def _guard_length(text: str) -> None:
    if len(text) > MAX_INPUT:
        raise LearnError("too_long")


async def submit_choice(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    name: str,
    step: int,
    selected: list[int],
    *,
    base_path: str = "",
) -> list[Json]:
    """FR-16: passes iff the selected options are exactly the correct set. The wire is
    0-based (like step positions) while lesson files are 1-based, so `selected` is shifted
    before judging; an out-of-range index never matches, so it is a wrong attempt. The attempt
    stores and carries the 0-based list as sent."""

    def judge(check: Check | None) -> tuple[bool, str | None]:
        if not isinstance(check, ChoiceCheck):
            raise LearnError("no_check")
        return checks.judge_choice(check.correct, [i + 1 for i in selected]), None

    return await _submit(
        conn, session_id, participant_id, name, step, "choice", list(selected), judge, base_path
    )


async def submit_text(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    name: str,
    step: int,
    text: str,
    *,
    base_path: str = "",
) -> list[Json]:
    """FR-17: any accepted answer, ignoring case and surrounding spaces. Stored as typed."""
    _guard_length(text)

    def judge(check: Check | None) -> tuple[bool, str | None]:
        if not isinstance(check, TextCheck):
            raise LearnError("no_check")
        return checks.judge_text(check.accept, text), None

    return await _submit(
        conn, session_id, participant_id, name, step, "text", text, judge, base_path
    )


async def submit_command(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    name: str,
    step: int,
    command: str,
    *,
    base_path: str = "",
) -> list[Json]:
    """FR-19–FR-23: the lesson's output, a known mistake's response, or "not available".
    Nothing is executed."""
    _guard_length(command)

    def judge(check: Check | None) -> tuple[bool, str | None]:
        if not isinstance(check, TerminalCheck):
            raise LearnError("no_check")
        result = checks.judge_command(check, command)
        if isinstance(result, checks.Accepted):
            return True, result.output
        if isinstance(result, checks.KnownMistake):
            return False, result.output
        return False, result.text

    return await _submit(
        conn, session_id, participant_id, name, step, "command", command, judge, base_path
    )


async def continue_(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    name: str,
    step: int,
    *,
    base_path: str = "",
) -> list[Json]:
    """Passes a step that has no check; no attempt is recorded. A step with a check → `no_check`
    (it passes only by a correct submit)."""
    async with _lock(session_id):
        _, loaded, lesson_step = await _current(conn, session_id, step)
        if lesson_step.check is not None:
            raise LearnError("no_check")
        async with conn.transaction():
            await _advance(conn, session_id, step, participant_id, name, len(loaded.lesson.steps))
            await repo.touch_activity(conn, session_id)
        return await _passed_events(conn, session_id, loaded, step, base_path)


async def reveal_hint(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    step: int,
    *,
    base_path: str = "",
) -> list[Json]:
    """FR-13: records the first reveal only; repeating it returns the same event."""
    async with _lock(session_id):
        _, loaded, lesson_step = await _current(conn, session_id, step)
        if lesson_step.hint is None:
            raise LearnError("no_hint")
        async with conn.transaction():
            await repo.reveal_hint(conn, session_id, step)
            await repo.touch_activity(conn, session_id)
        view = await _step_view(conn, session_id, loaded, step, base_path)
        return [{"type": "hint_revealed", "step": step, "hint_html": view["hint_html"]}]


async def show_answer(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    step: int,
) -> list[Json]:
    """FR-14a: only after `views.SHOW_ANSWER_AFTER` wrong attempts on the step. Doesn't pass it;
    a later correct submit records the pass as after the reveal. Repeating returns the same
    event."""
    async with _lock(session_id):
        _, _, lesson_step = await _current(conn, session_id, step)
        if lesson_step.check is None:
            raise LearnError("no_check")
        if await repo.count_wrong_attempts(conn, session_id, step) < views.SHOW_ANSWER_AFTER:
            raise LearnError("show_answer_unavailable")
        async with conn.transaction():
            await repo.reveal_answer(conn, session_id, step)
            await repo.touch_activity(conn, session_id)
        return [
            {"type": "answer_revealed", "step": step, "answer": views.answer(lesson_step.check)}
        ]
