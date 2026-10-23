"""Task 19: sessions repository (FR-11, FR-27, FR-29, NFR-4)."""

import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db
from app.sessions import repo

MODULE_SOURCE = Path(repo.__file__).read_text()


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _problem(conn: asyncpg.Connection) -> uuid.UUID:
    return await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter)
           values ('Sum two', 'd', 'def add(a: int, b: int) -> int', 'add', '[]'::jsonb, 'int',
                   false)
           returning id"""
    )


def test_the_module_has_no_delete_statement() -> None:
    assert "delete from" not in MODULE_SOURCE.lower()


async def test_fr11_nfr4_two_sessions_get_distinct_128_bit_invite_ids(
    migrated: asyncpg.Connection,
) -> None:
    problem_id = await _problem(migrated)

    first = await repo.create(migrated, problem_id)
    second = await repo.create(migrated, problem_id)

    assert first.invite_id != second.invite_id
    assert len(first.invite_id) >= 22
    assert len(second.invite_id) >= 22


async def test_create_sets_the_current_problem(migrated: asyncpg.Connection) -> None:
    problem_id = await _problem(migrated)

    session = await repo.create(migrated, problem_id)

    assert session.current_problem_id == problem_id
    assert session.stale_at is None


async def test_get_by_invite_finds_the_created_session(migrated: asyncpg.Connection) -> None:
    problem_id = await _problem(migrated)
    created = await repo.create(migrated, problem_id)

    found = await repo.get_by_invite(migrated, created.invite_id)

    assert found == created


async def test_get_by_invite_is_none_for_an_unknown_invite(migrated: asyncpg.Connection) -> None:
    assert await repo.get_by_invite(migrated, "does-not-exist") is None


async def test_set_current_problem_changes_it(migrated: asyncpg.Connection) -> None:
    problem_a = await _problem(migrated)
    problem_b = await _problem(migrated)
    session = await repo.create(migrated, problem_a)

    await repo.set_current_problem(migrated, session.id, problem_b)

    found = await repo.get_by_invite(migrated, session.invite_id)
    assert found is not None
    assert found.current_problem_id == problem_b


async def test_set_and_clear_stale(migrated: asyncpg.Connection) -> None:
    problem_id = await _problem(migrated)
    session = await repo.create(migrated, problem_id)

    await repo.set_stale(migrated, session.id)
    staled = await repo.get_by_invite(migrated, session.invite_id)
    assert staled is not None
    assert staled.stale_at is not None

    await repo.clear_stale(migrated, session.id)
    cleared = await repo.get_by_invite(migrated, session.invite_id)
    assert cleared is not None
    assert cleared.stale_at is None


async def test_fr27_participants_ada_and_linus_are_reloadable(
    migrated: asyncpg.Connection,
) -> None:
    problem_id = await _problem(migrated)
    session = await repo.create(migrated, problem_id)

    await repo.add_participant(migrated, session.id, "Ada")
    await repo.add_participant(migrated, session.id, "Linus")

    names = [p.display_name for p in await repo.list_participants(migrated, session.id)]
    assert names == ["Ada", "Linus"]


async def test_leave_participant_sets_left_at(migrated: asyncpg.Connection) -> None:
    problem_id = await _problem(migrated)
    session = await repo.create(migrated, problem_id)
    ada = await repo.add_participant(migrated, session.id, "Ada")

    await repo.leave_participant(migrated, ada.id)

    [found] = await repo.list_participants(migrated, session.id)
    assert found.left_at is not None


async def test_fr27_appended_yjs_updates_are_reloadable_in_order(
    migrated: asyncpg.Connection,
) -> None:
    problem_id = await _problem(migrated)
    session = await repo.create(migrated, problem_id)

    await repo.append_update(migrated, session.id, b"first")
    await repo.append_update(migrated, session.id, b"second")

    assert await repo.load_updates(migrated, session.id) == [b"first", b"second"]


async def test_append_event_is_recorded(migrated: asyncpg.Connection) -> None:
    problem_id = await _problem(migrated)
    session = await repo.create(migrated, problem_id)

    await repo.append_event(migrated, session.id, "joined", "Ada", {"name": "Ada"})

    row = await migrated.fetchrow(
        "select kind, actor, payload from session_event where session_id = $1", session.id
    )
    assert row is not None
    assert row["kind"] == "joined"
    assert row["actor"] == "Ada"


async def test_touch_activity_updates_last_activity_at(
    migrated: asyncpg.Connection, frozen_clock
) -> None:
    problem_id = await _problem(migrated)
    session = await repo.create(migrated, problem_id)

    frozen_clock.advance(timedelta(hours=1))
    await repo.touch_activity(migrated, session.id)

    found = await repo.get_by_invite(migrated, session.invite_id)
    assert found is not None
    assert found.last_activity_at > session.last_activity_at
