"""Spec 006 task 22: learning-session service (FR-6, FR-11, FR-12, FR-13, FR-14a, FR-16–FR-24,
FR-26, FR-28, NFR-4, NFR-6).

A real database; nothing mocked. The lesson is stored the way the loader stores it: the parsed
`Lesson` as `dataclasses.asdict` JSON with `images` replaced by `{file name: sha256}`.
"""

import asyncio
import dataclasses
import json
import os
import secrets
import subprocess
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db
from app.learn import repo, service
from app.learn.lesson_file import (
    ChoiceCheck,
    CommandOutput,
    Lesson,
    Step,
    TerminalCheck,
    TextCheck,
)

LESSON = Lesson(
    title="Basics",
    summary="Images and containers.",
    minutes=10,
    images=(),
    steps=(
        Step(kind="explanation", title="Intro", body="Read this.", hint=None, check=None),
        Step(
            kind="quiz",
            title="Which run?",
            body="Pick the running ones.",
            hint="Think *processes*.",
            check=ChoiceCheck(
                options=("An image", "A container", "A Dockerfile", "A -d container"),
                correct=(2, 4),
                multiple=True,
            ),
        ),
        Step(
            kind="quiz",
            title="Name it",
            body="A running image is a …",
            hint=None,
            check=TextCheck(accept=("container",)),
        ),
        Step(
            kind="terminal",
            title="List",
            body="List the running containers.",
            hint=None,
            check=TerminalCheck(
                prompt="$ ",
                accept=(CommandOutput(command="docker ps", output="CONTAINER ID   IMAGE"),),
                responses=(
                    CommandOutput(command="docker ls", output="docker: 'ls' is not a command"),
                ),
            ),
        ),
    ),
)
LAST = len(LESSON.steps) - 1


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _store(conn: asyncpg.Connection, key: str, lesson: Lesson) -> uuid.UUID:
    content = {**dataclasses.asdict(lesson), "images": {}}
    version_id = await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $2, $3::jsonb) returning id""",
        key,
        secrets.token_hex(16),
        json.dumps(content),
    )
    await conn.execute(
        """insert into lesson (key, topic_key, topic_title, current_version_id)
           values ($1, 'zz-docker', 'Docker', $2)
           on conflict (key) do update set current_version_id = excluded.current_version_id""",
        key,
        version_id,
    )
    return version_id


async def _lesson(conn: asyncpg.Connection, lesson: Lesson = LESSON) -> str:
    key = f"zz-docker/{secrets.token_hex(4)}"
    await _store(conn, key, lesson)
    return key


async def _started(conn: asyncpg.Connection, *names: str):
    session = await service.create_session(conn, await _lesson(conn))
    people = [await service.join(conn, session.id, name) for name in names or ("A",)]
    return session, people


async def _at_step(conn: asyncpg.Connection, step: int, *names: str):
    """A session advanced to `step` by passing each earlier step correctly as the first person."""
    session, people = await _started(conn, *names)
    a = people[0]
    correct = {
        0: lambda n: service.continue_(conn, session.id, a.id, a.display_name, n),
        1: lambda n: service.submit_choice(conn, session.id, a.id, a.display_name, n, [1, 3]),
        2: lambda n: service.submit_text(conn, session.id, a.id, a.display_name, n, "container"),
        3: lambda n: service.submit_command(conn, session.id, a.id, a.display_name, n, "docker ps"),
    }
    for n in range(step):
        await correct[n](n)
    return session, people


async def _error(coro) -> str:
    with pytest.raises(service.LearnError) as info:
        await coro
    return info.value.code


async def _current(conn: asyncpg.Connection, session_id: uuid.UUID) -> int:
    return await conn.fetchval(
        "select current_step from learning_session where id = $1", session_id
    )


async def _attempt_count(conn: asyncpg.Connection, session_id: uuid.UUID) -> int:
    return await conn.fetchval(
        "select count(*) from learning_attempt where session_id = $1", session_id
    )


# --- create and join -----------------------------------------------------------------------


async def test_ac6_a_created_session_is_at_step_0_of_the_current_version(
    migrated: asyncpg.Connection,
) -> None:
    """AC-6 (FR-6): step 0, the lesson's current version, a step-0 row, a long invite id."""
    key = await _lesson(migrated)
    current = await migrated.fetchval("select current_version_id from lesson where key = $1", key)

    session = await service.create_session(migrated, key)

    assert session.current_step == 0
    assert session.lesson_version_id == current
    assert len(session.invite_id) >= 22
    assert await repo.get_step(migrated, session.id, 0) is not None


async def test_creating_a_session_on_an_unknown_or_removed_lesson_raises(
    migrated: asyncpg.Connection,
) -> None:
    key = await _lesson(migrated)
    await migrated.execute("update lesson set current_version_id = null where key = $1", key)

    with pytest.raises(service.LessonNotFound):
        await service.create_session(migrated, key)
    with pytest.raises(service.LessonNotFound):
        await service.create_session(migrated, "zz-docker/no-such-lesson")


async def test_join_adds_a_participant_and_touches_activity(migrated: asyncpg.Connection) -> None:
    session = await service.create_session(migrated, await _lesson(migrated))
    await migrated.execute(
        "update learning_session set last_activity_at = now() - interval '1 day' where id = $1",
        session.id,
    )

    person = await service.join(migrated, session.id, "Ada")

    assert person.display_name == "Ada"
    assert [p.id for p in await repo.list_participants(migrated, session.id)] == [person.id]
    touched = await migrated.fetchval(
        "select last_activity_at > now() - interval '1 hour' from learning_session where id = $1",
        session.id,
    )
    assert touched


async def test_join_refuses_a_stale_session(migrated: asyncpg.Connection) -> None:
    session = await service.create_session(migrated, await _lesson(migrated))
    await migrated.execute("update learning_session set stale_at = now() where id = $1", session.id)

    assert await _error(service.join(migrated, session.id, "Ada")) == "session_stale"


# --- passing and advancing -----------------------------------------------------------------


async def test_continue_passes_an_explanation_without_a_check(migrated: asyncpg.Connection) -> None:
    session, (a,) = await _started(migrated, "A")

    events = await service.continue_(migrated, session.id, a.id, "A", 0)

    assert [e["type"] for e in events] == ["step_passed"]
    assert events[0]["step"] == 0
    assert events[0]["passed"]["by"] == "A"
    assert events[0]["answer"] is None
    assert events[0]["next"]["position"] == 1
    assert await _current(migrated, session.id) == 1
    assert await _attempt_count(migrated, session.id) == 0


async def test_continue_is_refused_on_a_step_with_a_check(migrated: asyncpg.Connection) -> None:
    session, (a,) = await _at_step(migrated, 1, "A")

    assert await _error(service.continue_(migrated, session.id, a.id, "A", 1)) == "no_check"
    assert await _current(migrated, session.id) == 1


async def test_a_submit_of_the_wrong_kind_for_the_step_is_no_check(
    migrated: asyncpg.Connection,
) -> None:
    session, (a,) = await _started(migrated, "A")

    assert await _error(service.submit_text(migrated, session.id, a.id, "A", 0, "x")) == "no_check"
    session, (a,) = await _at_step(migrated, 1, "A")
    assert (
        await _error(service.submit_command(migrated, session.id, a.id, "A", 1, "docker ps"))
        == "no_check"
    )
    assert await _attempt_count(migrated, session.id) == 0


async def test_ac10_when_a_passes_step_2_it_is_recorded_as_passed_by_a_and_current_is_3(
    migrated: asyncpg.Connection,
) -> None:
    """AC-10 (FR-11)."""
    session, (a, _b) = await _at_step(migrated, 2, "A", "B")

    events = await service.submit_text(migrated, session.id, a.id, "A", 2, "  Container ")

    assert [e["type"] for e in events] == ["attempt", "step_passed"]
    assert events[0]["step"] == 2
    assert events[0]["attempt"]["by"] == "A"
    assert events[0]["attempt"]["correct"] is True
    passed = events[1]
    assert passed["step"] == 2
    assert passed["passed"]["by"] == "A"
    assert passed["answer"] == {"type": "text", "accept": ["container"]}
    assert passed["next"]["position"] == 3
    assert passed["next"]["check"] == {"type": "terminal", "prompt": "$ "}
    assert "docker ps" not in json.dumps(passed["next"])
    assert await _current(migrated, session.id) == 3
    step = await repo.get_step(migrated, session.id, 2)
    assert step is not None
    assert step.passed_by_name == "A"
    assert step.passed_by == a.id
    assert await repo.get_step(migrated, session.id, 3) is not None


async def test_ac12_a_wrong_answer_keeps_the_step_and_allows_retry(
    migrated: asyncpg.Connection,
) -> None:
    """AC-12 (FR-13): wrong, still current, retry passes."""
    session, (a, b) = await _at_step(migrated, 1, "A", "B")

    events = await service.submit_choice(migrated, session.id, a.id, "A", 1, [1])

    assert [e["type"] for e in events] == ["attempt"]
    assert events[0]["attempt"]["correct"] is False
    assert events[0]["attempt"]["submitted"] == [1]
    assert events[0]["show_answer_available"] is False
    assert await _current(migrated, session.id) == 1

    events = await service.submit_choice(migrated, session.id, b.id, "B", 1, [3, 1])
    assert [e["type"] for e in events] == ["attempt", "step_passed"]
    assert events[1]["passed"]["by"] == "B"


async def test_ac15_a_choice_passes_on_the_0_based_indexes_of_the_correct_options(
    migrated: asyncpg.Connection,
) -> None:
    """AC-15 (FR-16): the wire is 0-based (correct options 2 and 4 in the lesson file are
    indexes 1 and 3); a subset, a superset, the 1-based numbers or an out-of-range index fail.
    The attempt carries the indexes as sent."""
    session, (a,) = await _at_step(migrated, 1, "A")

    for wrong in ([1], [1, 2, 3], [2, 4], [1, 3, 99], [-1]):
        events = await service.submit_choice(migrated, session.id, a.id, "A", 1, wrong)
        assert events[0]["attempt"]["correct"] is False, wrong
        assert events[0]["attempt"]["submitted"] == wrong
    assert await _current(migrated, session.id) == 1

    events = await service.submit_choice(migrated, session.id, a.id, "A", 1, [3, 1])

    assert events[0]["attempt"]["correct"] is True
    assert events[0]["attempt"]["submitted"] == [3, 1]
    assert events[1]["type"] == "step_passed"
    assert (await repo.list_attempts(migrated, session.id, 1))[-1].submitted == [3, 1]


async def test_ac12_reveal_hint_sets_it_once_and_no_hint_without_one(
    migrated: asyncpg.Connection,
) -> None:
    """AC-12 (FR-13)."""
    session, (a, b) = await _at_step(migrated, 1, "A", "B")

    events = await service.reveal_hint(migrated, session.id, b.id, 1)

    assert events == [{"type": "hint_revealed", "step": 1, "hint_html": events[0]["hint_html"]}]
    assert "<em>processes</em>" in events[0]["hint_html"]
    first = (await repo.get_step(migrated, session.id, 1)).hint_revealed_at
    assert first is not None
    await service.reveal_hint(migrated, session.id, a.id, 1)
    assert (await repo.get_step(migrated, session.id, 1)).hint_revealed_at == first

    await service.submit_choice(migrated, session.id, a.id, "A", 1, [1, 3])
    assert await _error(service.reveal_hint(migrated, session.id, a.id, 2)) == "no_hint"


async def test_ac13a_show_answer_is_refused_after_2_wrong_and_allowed_after_3(
    migrated: asyncpg.Connection,
) -> None:
    """AC-13a (FR-14a)."""
    session, (a, b) = await _at_step(migrated, 2, "A", "B")

    for _ in range(2):
        events = await service.submit_text(migrated, session.id, a.id, "A", 2, "nope")
        assert events[0]["show_answer_available"] is False
    assert (
        await _error(service.show_answer(migrated, session.id, b.id, 2))
        == "show_answer_unavailable"
    )

    events = await service.submit_text(migrated, session.id, a.id, "A", 2, "still nope")
    assert events[0]["show_answer_available"] is True

    events = await service.show_answer(migrated, session.id, b.id, 2)
    assert events == [
        {"type": "answer_revealed", "step": 2, "answer": {"type": "text", "accept": ["container"]}}
    ]
    assert await _current(migrated, session.id) == 2

    events = await service.submit_text(migrated, session.id, a.id, "A", 2, "container")
    assert events[0]["show_answer_available"] is False
    assert events[1]["type"] == "step_passed"
    assert events[1]["passed"]["after_reveal"] is True


async def test_show_answer_reveals_the_first_accepted_command_of_a_terminal(
    migrated: asyncpg.Connection,
) -> None:
    session, (a,) = await _at_step(migrated, 3, "A")
    for _ in range(3):
        await service.submit_command(migrated, session.id, a.id, "A", 3, "ls")

    events = await service.show_answer(migrated, session.id, a.id, 3)

    assert events[0]["answer"] == {
        "type": "terminal",
        "command": "docker ps",
        "output": "CONTAINER ID   IMAGE",
    }


async def test_show_answer_on_a_step_without_a_check_is_no_check(
    migrated: asyncpg.Connection,
) -> None:
    session, (a,) = await _started(migrated, "A")

    assert await _error(service.show_answer(migrated, session.id, a.id, 0)) == "no_check"


async def test_ac14_a_submit_for_a_step_that_is_not_current_stores_nothing(
    migrated: asyncpg.Connection,
) -> None:
    """AC-14 (FR-15): submit with step=2 while current is 3."""
    session, (a,) = await _at_step(migrated, 3, "A")
    before = await _attempt_count(migrated, session.id)

    code = await _error(service.submit_text(migrated, session.id, a.id, "A", 2, "container"))

    assert code == "not_current_step"
    assert await _attempt_count(migrated, session.id) == before
    assert await _current(migrated, session.id) == 3
    for action in (
        service.continue_(migrated, session.id, a.id, "A", 2),
        service.reveal_hint(migrated, session.id, a.id, 1),
        service.show_answer(migrated, session.id, a.id, 2),
    ):
        assert await _error(action) == "not_current_step"


# --- the terminal --------------------------------------------------------------------------


async def test_ac18_docker_ps_passes_with_the_lesson_output(migrated: asyncpg.Connection) -> None:
    """AC-18 (FR-19)."""
    session, (a,) = await _at_step(migrated, 3, "A")

    events = await service.submit_command(migrated, session.id, a.id, "A", 3, "  docker   ps ")

    assert events[0]["attempt"]["kind"] == "command"
    assert events[0]["attempt"]["submitted"] == "  docker   ps "
    assert events[0]["attempt"]["output"] == "CONTAINER ID   IMAGE"
    assert events[0]["attempt"]["correct"] is True
    assert events[1]["type"] == "step_passed"


async def test_ac19_a_known_mistake_shows_its_response_and_stays_unpassed(
    migrated: asyncpg.Connection,
) -> None:
    """AC-19 (FR-20)."""
    session, (a,) = await _at_step(migrated, 3, "A")

    events = await service.submit_command(migrated, session.id, a.id, "A", 3, "docker ls")

    assert [e["type"] for e in events] == ["attempt"]
    assert events[0]["attempt"]["output"] == "docker: 'ls' is not a command"
    assert events[0]["attempt"]["correct"] is False
    assert await _current(migrated, session.id) == 3


async def test_ac20_any_other_command_is_unavailable_and_stays_unpassed(
    migrated: asyncpg.Connection,
) -> None:
    """AC-20 (FR-21)."""
    session, (a,) = await _at_step(migrated, 3, "A")

    events = await service.submit_command(migrated, session.id, a.id, "A", 3, "rm -rf /")

    assert events[0]["attempt"]["output"] == "rm: not available in this exercise"
    assert events[0]["attempt"]["correct"] is False
    assert await _current(migrated, session.id) == 3


def _child_pids() -> set[int]:
    """PIDs whose parent is this test process (excluding the `ps` that lists them)."""
    me = os.getpid()
    proc = Path("/proc")
    if proc.is_dir():
        children = set()
        for entry in proc.iterdir():
            if entry.name.isdigit():
                try:
                    stat = (entry / "stat").read_text()
                except OSError:
                    continue
                if int(stat.rsplit(")", 1)[1].split()[1]) == me:
                    children.add(int(entry.name))
        return children
    out = subprocess.run(  # noqa: S603
        ["/bin/ps", "-A", "-o", "pid=,ppid=,comm="], capture_output=True, text=True, check=True
    ).stdout
    children = set()
    for line in out.splitlines():
        pid, ppid, comm = line.split(None, 2)
        if int(ppid) == me and not comm.strip().endswith("ps"):
            children.add(int(pid))
    return children


def _exists(path: Path) -> bool:
    return path.exists()


async def test_ac22_a_submitted_command_is_never_run(migrated: asyncpg.Connection) -> None:
    """AC-22 (FR-23, NFR-4): no file appears and no process is started."""
    session, (a,) = await _at_step(migrated, 3, "A")
    target = Path(f"/tmp/learn-ac22-{uuid.uuid4()}")  # noqa: S108
    before = _child_pids()

    events = await service.submit_command(migrated, session.id, a.id, "A", 3, f"touch {target}")

    assert events[0]["attempt"]["output"] == "touch: not available in this exercise"
    assert not _exists(target)
    assert _child_pids() == before


# --- completion ------------------------------------------------------------------------------


async def test_ac23_passing_the_last_step_completes_the_session_with_a_summary(
    migrated: asyncpg.Connection,
) -> None:
    """AC-23 (FR-24)."""
    session, (a, b) = await _at_step(migrated, LAST, "A", "B")
    await service.submit_command(migrated, session.id, a.id, "A", LAST, "ls")

    events = await service.submit_command(migrated, session.id, b.id, "B", LAST, "docker ps")

    assert [e["type"] for e in events] == ["attempt", "step_passed", "completed"]
    assert events[1]["next"] is None
    assert events[2]["summary"]["steps"] == [
        {"position": 0, "title": "Intro", "attempts": 0, "passed_by": "A", "after_reveal": False},
        {"position": 1, "title": "Which run?", "attempts": 1, "passed_by": "A",
         "after_reveal": False},
        {"position": 2, "title": "Name it", "attempts": 1, "passed_by": "A",
         "after_reveal": False},
        {"position": 3, "title": "List", "attempts": 2, "passed_by": "B", "after_reveal": False},
    ]  # fmt: skip
    row = await migrated.fetchrow(
        "select current_step, completed_at from learning_session where id = $1", session.id
    )
    assert row["current_step"] == len(LESSON.steps)
    assert row["completed_at"] is not None


async def test_ac25_any_submit_on_a_completed_session_is_session_completed(
    migrated: asyncpg.Connection,
) -> None:
    """AC-25 (FR-26)."""
    session, (a,) = await _at_step(migrated, len(LESSON.steps), "A")
    before = await _attempt_count(migrated, session.id)

    for action in (
        service.submit_command(migrated, session.id, a.id, "A", LAST, "docker ps"),
        service.submit_command(migrated, session.id, a.id, "A", LAST + 1, "docker ps"),
        service.submit_text(migrated, session.id, a.id, "A", 2, "container"),
        service.submit_choice(migrated, session.id, a.id, "A", 1, [1, 3]),
        service.continue_(migrated, session.id, a.id, "A", 0),
        service.reveal_hint(migrated, session.id, a.id, 1),
        service.show_answer(migrated, session.id, a.id, LAST),
    ):
        assert await _error(action) == "session_completed"
    assert await _attempt_count(migrated, session.id) == before


async def test_a_completed_session_can_still_be_joined(migrated: asyncpg.Connection) -> None:
    """Plan review 2026-10-29: completed sessions accept joins."""
    session, _ = await _at_step(migrated, len(LESSON.steps), "A")

    person = await service.join(migrated, session.id, "Late")

    assert person.display_name == "Late"


async def test_actions_on_a_stale_session_are_session_stale(migrated: asyncpg.Connection) -> None:
    session, (a,) = await _at_step(migrated, 1, "A")
    await migrated.execute("update learning_session set stale_at = now() where id = $1", session.id)

    code = await _error(service.submit_choice(migrated, session.id, a.id, "A", 1, [1, 3]))

    assert code == "session_stale"
    assert await _attempt_count(migrated, session.id) == 0


# --- guards ----------------------------------------------------------------------------------


async def test_two_concurrent_correct_submits_pass_once(
    migrated: asyncpg.Connection, database_url: str
) -> None:
    """Race (plan Service flow): one passes, the other gets not_current_step."""
    session, (a, b) = await _at_step(migrated, 2, "A", "B")
    other = await asyncpg.connect(database_url)
    try:
        results = await asyncio.gather(
            service.submit_text(migrated, session.id, a.id, "A", 2, "container"),
            service.submit_text(other, session.id, b.id, "B", 2, "container"),
            return_exceptions=True,
        )
    finally:
        await other.close()

    passed = [r for r in results if isinstance(r, list)]
    refused = [r for r in results if isinstance(r, service.LearnError)]
    assert len(passed) == 1
    assert [e.code for e in refused] == ["not_current_step"]
    assert await _current(migrated, session.id) == 3
    stored = await repo.list_attempts(migrated, session.id, 2)
    assert [(x.correct) for x in stored] == [True]


@pytest.mark.parametrize("kind", ["text", "command"])
async def test_a_1001_character_submission_is_too_long_and_stores_nothing(
    migrated: asyncpg.Connection, kind: str
) -> None:
    session, (a,) = await _at_step(migrated, 2 if kind == "text" else 3, "A")
    step = 2 if kind == "text" else 3
    submit = service.submit_text if kind == "text" else service.submit_command
    before = await _attempt_count(migrated, session.id)

    assert await _error(submit(migrated, session.id, a.id, "A", step, "x" * 1001)) == "too_long"
    assert await _attempt_count(migrated, session.id) == before

    events = await submit(migrated, session.id, a.id, "A", step, "x" * 1000)
    assert events[0]["type"] == "attempt"


async def test_ac28_submitted_markup_is_stored_and_returned_verbatim(
    migrated: asyncpg.Connection,
) -> None:
    """AC-28 (NFR-4): attempt text is data."""
    session, (a,) = await _at_step(migrated, 2, "A")

    events = await service.submit_text(migrated, session.id, a.id, "A", 2, "<b>hi</b>")

    assert events[0]["attempt"]["submitted"] == "<b>hi</b>"
    assert (await repo.list_attempts(migrated, session.id, 2))[0].submitted == "<b>hi</b>"


# --- versioning and the record -------------------------------------------------------------


async def test_fr28_judging_uses_the_sessions_own_lesson_version(
    migrated: asyncpg.Connection,
) -> None:
    """FR-28: after the lesson changes, an old session is judged against its old version."""
    key = await _lesson(migrated)
    old = await service.create_session(migrated, key)
    a = await service.join(migrated, old.id, "A")
    changed = dataclasses.replace(
        LESSON,
        steps=(
            Step(
                kind="quiz",
                title="New first",
                body="?",
                hint=None,
                check=TextCheck(accept=("new",)),
            ),
        ),
    )
    await _store(migrated, key, changed)
    new = await service.create_session(migrated, key)
    b = await service.join(migrated, new.id, "B")

    assert [e["type"] for e in await service.continue_(migrated, old.id, a.id, "A", 0)] == [
        "step_passed"
    ]
    events = await service.submit_text(migrated, new.id, b.id, "B", 0, "new")
    assert [e["type"] for e in events] == ["attempt", "step_passed", "completed"]


async def test_record_shows_passed_steps_and_the_current_one(
    migrated: asyncpg.Connection,
) -> None:
    session, (a,) = await _at_step(migrated, 2, "A")
    await service.submit_text(migrated, session.id, a.id, "A", 2, "wrong")
    fresh = await repo.get_session_by_invite(migrated, session.invite_id)

    record = await service.record(migrated, fresh)

    assert record["lesson"]["title"] == "Basics"
    assert record["lesson"]["topic"] == "Docker"
    assert record["current_step"] == 2
    assert record["completed"] is False
    assert record["stale"] is False
    assert [s["position"] for s in record["steps"]] == [0, 1, 2]
    assert record["steps"][2]["attempts"][0]["submitted"] == "wrong"
    assert record["steps"][2]["answer"] is None
    assert "container" not in json.dumps(record["steps"][2])
    assert record["summary"] is None
