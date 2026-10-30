"""Spec 006 task 12: learn repository (FR-6, FR-11, FR-12, FR-13, FR-14a, FR-24, FR-25)."""

import json
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db
from app.learn import repo
from tests.conftest import FrozenClock

MODULE_SOURCE = Path(repo.__file__).read_text()


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _version(
    conn: asyncpg.Connection, lesson_key: str | None = None, content: dict | None = None
) -> uuid.UUID:
    return await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $2, $3::jsonb) returning id""",
        lesson_key or f"t/{secrets.token_hex(4)}",
        secrets.token_hex(16),
        json.dumps(content or {"title": "L", "steps": [{"kind": "explanation"}]}),
    )


async def _session(conn: asyncpg.Connection) -> repo.LearningSession:
    return await repo.create_session(conn, await _version(conn))


def test_the_module_has_no_delete_statement() -> None:
    assert "delete from" not in MODULE_SOURCE.lower()


# --- catalogue, versions, assets ----------------------------------------------------


async def test_list_current_lessons_returns_each_lesson_with_its_topic_and_current_version(
    migrated: asyncpg.Connection,
) -> None:
    old = await _version(migrated, "zz-docker/01-basics", {"title": "Old"})
    new = await _version(migrated, "zz-docker/01-basics", {"title": "Basics"})
    await migrated.execute(
        """insert into lesson (key, topic_key, topic_title, current_version_id) values
           ('zz-docker/01-basics', 'zz-docker', 'Docker', $1),
           ('zz-docker/02-hidden', 'zz-docker', 'Docker', null)""",
        new,
    )

    lessons = [
        lesson
        for lesson in await repo.list_current_lessons(migrated)
        if lesson.key.startswith("zz-")
    ]

    assert [(lesson.key, lesson.topic_key, lesson.topic_title) for lesson in lessons] == [
        ("zz-docker/01-basics", "zz-docker", "Docker")
    ]
    assert lessons[0].version_id == new != old
    assert lessons[0].content == {"title": "Basics"}


async def test_get_version_round_trips_the_snapshot(migrated: asyncpg.Connection) -> None:
    content = {"title": "T", "steps": [{"kind": "quiz", "answer": [2]}]}
    version_id = await _version(migrated, "k/one", content)

    version = await repo.get_version(migrated, version_id)

    assert version is not None
    assert version.id == version_id
    assert version.lesson_key == "k/one"
    assert version.content == content


async def test_get_version_is_none_when_unknown(migrated: asyncpg.Connection) -> None:
    assert await repo.get_version(migrated, uuid.uuid4()) is None


async def test_get_asset_round_trips_and_is_none_when_unknown(
    migrated: asyncpg.Connection,
) -> None:
    sha = secrets.token_hex(32)
    await migrated.execute(
        "insert into lesson_asset (sha256, media_type, data) values ($1, 'image/png', $2)",
        sha,
        b"\x89PNG",
    )

    asset = await repo.get_asset(migrated, sha)

    assert asset == repo.Asset(sha256=sha, media_type="image/png", data=b"\x89PNG")
    assert await repo.get_asset(migrated, "0" * 64) is None


# --- sessions and participants ------------------------------------------------------


async def test_fr6_create_session_starts_at_the_first_step_with_a_128_bit_invite(
    migrated: asyncpg.Connection,
) -> None:
    version_id = await _version(migrated)

    first = await repo.create_session(migrated, version_id)
    second = await repo.create_session(migrated, version_id)

    assert first.lesson_version_id == version_id
    assert first.current_step == 0
    assert first.completed_at is None
    assert first.stale_at is None
    assert first.invite_id != second.invite_id
    assert len(first.invite_id) >= 22


async def test_fr25_get_session_by_invite_round_trips(migrated: asyncpg.Connection) -> None:
    created = await _session(migrated)

    assert await repo.get_session_by_invite(migrated, created.invite_id) == created
    assert await repo.get_session_by_invite(migrated, "nope") is None


async def test_participants_are_inserted_listed_and_marked_left(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    ada = await repo.add_participant(migrated, session.id, "Ada")
    frozen_clock.advance(timedelta(minutes=1))
    bob = await repo.add_participant(migrated, session.id, "Bob")

    frozen_clock.advance(timedelta(minutes=1))
    await repo.leave_participant(migrated, ada.id)

    listed = await repo.list_participants(migrated, session.id)
    assert [p.display_name for p in listed] == ["Ada", "Bob"]
    assert listed[0].left_at is not None
    assert listed[1] == bob
    assert bob.left_at is None


async def test_touch_activity_sets_last_activity_at(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    frozen_clock.advance(timedelta(hours=2))

    await repo.touch_activity(migrated, session.id)

    found = await repo.get_session_by_invite(migrated, session.invite_id)
    assert found is not None
    assert found.last_activity_at == session.last_activity_at + timedelta(hours=2)


# --- steps ---------------------------------------------------------------------------


async def test_ensure_step_creates_once_and_returns_the_existing_row(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)

    first = await repo.ensure_step(migrated, session.id, 0)
    await repo.reveal_hint(migrated, session.id, 0)
    again = await repo.ensure_step(migrated, session.id, 0)

    assert first.position == 0
    assert first.hint_revealed_at is None
    assert first.passed_at is None
    assert again.hint_revealed_at is not None
    assert await repo.get_step(migrated, session.id, 0) == again
    assert await repo.get_step(migrated, session.id, 5) is None


async def test_list_steps_is_in_position_order(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    await repo.ensure_step(migrated, session.id, 1)
    await repo.ensure_step(migrated, session.id, 0)

    assert [s.position for s in await repo.list_steps(migrated, session.id)] == [0, 1]


async def test_fr13_fr14a_reveal_hint_and_answer_record_the_first_reveal_only(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    await repo.ensure_step(migrated, session.id, 0)

    await repo.reveal_hint(migrated, session.id, 0)
    await repo.reveal_answer(migrated, session.id, 0)
    first = await repo.get_step(migrated, session.id, 0)
    frozen_clock.advance(timedelta(minutes=5))
    await repo.reveal_hint(migrated, session.id, 0)
    await repo.reveal_answer(migrated, session.id, 0)

    assert first is not None
    assert first.hint_revealed_at is not None
    assert first.answer_revealed_at is not None
    assert await repo.get_step(migrated, session.id, 0) == first


# --- attempts --------------------------------------------------------------------------


async def test_fr12_attempts_round_trip_per_step_in_order(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    ada = await repo.add_participant(migrated, session.id, "Ada")

    first = await repo.add_attempt(
        migrated, session.id, 0, ada.id, "Ada", "choice", [1, 3], correct=False
    )
    second = await repo.add_attempt(
        migrated,
        session.id,
        0,
        ada.id,
        "Ada",
        "command",
        "docker ps",
        correct=True,
        output="CONTAINER ID",
    )
    await repo.add_attempt(migrated, session.id, 1, ada.id, "Ada", "text", "x", correct=False)

    on_step_0 = await repo.list_attempts(migrated, session.id, 0)
    assert on_step_0 == [first, second]
    assert first.submitted == [1, 3]
    assert first.correct is False
    assert first.output is None
    assert second.submitted == "docker ps"
    assert second.output == "CONTAINER ID"
    assert second.actor_name == "Ada"
    assert second.participant_id == ada.id
    assert [a.position for a in await repo.list_attempts(migrated, session.id)] == [0, 0, 1]


async def test_fr14a_wrong_attempt_count_counts_only_incorrect_attempts_on_that_step(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    other = await _session(migrated)
    ada = await repo.add_participant(migrated, session.id, "Ada")
    bob = await repo.add_participant(migrated, other.id, "Bob")
    for _ in range(2):
        await repo.add_attempt(migrated, session.id, 0, ada.id, "Ada", "text", "a", correct=False)
    await repo.add_attempt(migrated, session.id, 0, ada.id, "Ada", "text", "b", correct=True)
    await repo.add_attempt(migrated, session.id, 1, ada.id, "Ada", "text", "c", correct=False)
    await repo.add_attempt(migrated, other.id, 0, bob.id, "Bob", "text", "d", correct=False)

    assert await repo.count_wrong_attempts(migrated, session.id, 0) == 2
    assert await repo.count_wrong_attempts(migrated, session.id, 1) == 1
    assert await repo.count_wrong_attempts(migrated, session.id, 2) == 0


# --- passing, advancing, completing -----------------------------------------------------


async def test_fr11_pass_and_advance_marks_the_step_passed_and_moves_on(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    ada = await repo.add_participant(migrated, session.id, "Ada")
    await repo.ensure_step(migrated, session.id, 0)

    advanced = await repo.pass_and_advance(migrated, session.id, 0, ada.id, "Ada")

    assert advanced is True
    found = await repo.get_session_by_invite(migrated, session.invite_id)
    assert found is not None
    assert found.current_step == 1
    step = await repo.get_step(migrated, session.id, 0)
    assert step is not None
    assert step.passed_at is not None
    assert step.passed_by == ada.id
    assert step.passed_by_name == "Ada"


async def test_guarded_advance_updates_once_and_a_second_call_changes_nothing(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    ada = await repo.add_participant(migrated, session.id, "Ada")
    bob = await repo.add_participant(migrated, session.id, "Bob")
    await repo.ensure_step(migrated, session.id, 0)
    assert await repo.pass_and_advance(migrated, session.id, 0, ada.id, "Ada") is True
    step_after_first = await repo.get_step(migrated, session.id, 0)
    session_after_first = await repo.get_session_by_invite(migrated, session.invite_id)

    again = await repo.pass_and_advance(migrated, session.id, 0, bob.id, "Bob")

    assert again is False
    assert await repo.get_step(migrated, session.id, 0) == step_after_first
    assert await repo.get_session_by_invite(migrated, session.invite_id) == session_after_first
    assert await repo.get_step(migrated, session.id, 1) is None


async def test_fr24_set_completed_records_completion_once(
    migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)

    await repo.set_completed(migrated, session.id)
    first = await repo.get_session_by_invite(migrated, session.invite_id)
    frozen_clock.advance(timedelta(minutes=1))
    await repo.set_completed(migrated, session.id)

    assert first is not None
    assert first.completed_at is not None
    assert await repo.get_session_by_invite(migrated, session.invite_id) == first
