"""Task 16: problems repository (FR-3, FR-5, FR-8)."""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db
from app.problems import repo
from app.problems.signature import TestInput, parse_signature

ADD = parse_signature("def add(a: int, b: int) -> int")


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _create(
    conn: asyncpg.Connection,
    title: str,
    description: str = "",
    *,
    tests: list[TestInput] | None = None,
    created_by_sub: str | None = "editor1-sub",
) -> uuid.UUID:
    return await repo.create(
        conn,
        title=title,
        description=description,
        sig=ADD,
        tests=tests if tests is not None else [TestInput(args=[2, 3], expected=5)],
        created_by_sub=created_by_sub,
        created_by_name="editor1",
    )


async def test_fr3_create_records_the_creator_sub(migrated: asyncpg.Connection) -> None:
    problem_id = await _create(migrated, "Sum two", created_by_sub="editor1-sub")

    sub = await migrated.fetchval("select created_by_sub from problem where id = $1", problem_id)
    assert sub == "editor1-sub"


async def test_fr5_search_matches_title_or_description_case_insensitively(
    migrated: asyncpg.Connection,
) -> None:
    await _create(migrated, "Two targets", "find a pair summing to the target")
    reverse_id = await _create(migrated, "Reverse list", "reverse a linked list")

    results = await repo.search(migrated, "REVERSE")

    assert [r.id for r in results] == [reverse_id]
    assert results[0].title == "Reverse list"


async def test_fr5_search_matches_on_description_too(migrated: asyncpg.Connection) -> None:
    await _create(migrated, "Mystery", "all about reversing things")

    results = await repo.search(migrated, "reversing")

    assert [r.title for r in results] == ["Mystery"]


async def test_fr8_soft_delete_excludes_from_search_but_keeps_the_row(
    migrated: asyncpg.Connection,
) -> None:
    # A title unique to this test: the shared test database is scoped per module (conftest.py).
    title = f"Zorblaxxian puzzle {uuid.uuid4().hex[:8]}"
    problem_id = await _create(migrated, title)

    await repo.soft_delete(migrated, problem_id)

    assert await repo.search(migrated, title) == []
    row = await migrated.fetchrow("select id, deleted_at from problem where id = $1", problem_id)
    assert row is not None
    assert row["deleted_at"] is not None


async def test_get_public_has_no_tests_field(migrated: asyncpg.Connection) -> None:
    problem_id = await _create(migrated, "Sum two", "add a and b")

    public = await repo.get_public(migrated, problem_id)

    assert public.title == "Sum two"
    assert public.signature == ADD.line
    assert public.deleted is False
    assert not hasattr(public, "tests")


async def test_get_public_raises_not_found_for_a_missing_id(migrated: asyncpg.Connection) -> None:
    with pytest.raises(repo.NotFound):
        await repo.get_public(migrated, uuid.uuid4())


async def test_get_with_tests_returns_the_stored_tests(migrated: asyncpg.Connection) -> None:
    tests = [TestInput(args=[2, 3], expected=5), TestInput(args=[0, 0], expected=0)]
    problem_id = await _create(migrated, "Sum two", tests=tests)

    full = await repo.get_with_tests(migrated, problem_id)

    assert full.tests == tests


async def test_update_replaces_fields_and_tests(migrated: asyncpg.Connection) -> None:
    problem_id = await _create(migrated, "Sum two", "old description")

    await repo.update(
        migrated,
        problem_id,
        title="Sum two (updated)",
        description="new description",
        sig=ADD,
        tests=[TestInput(args=[1, 1], expected=2)],
    )

    full = await repo.get_with_tests(migrated, problem_id)
    assert full.title == "Sum two (updated)"
    assert full.description == "new description"
    assert full.tests == [TestInput(args=[1, 1], expected=2)]


async def test_update_raises_not_found_for_a_missing_id(migrated: asyncpg.Connection) -> None:
    with pytest.raises(repo.NotFound):
        await repo.update(
            migrated,
            uuid.uuid4(),
            title="x",
            description="y",
            sig=ADD,
            tests=[TestInput(args=[1, 1], expected=2)],
        )


async def test_soft_delete_raises_not_found_for_a_missing_id(
    migrated: asyncpg.Connection,
) -> None:
    with pytest.raises(repo.NotFound):
        await repo.soft_delete(migrated, uuid.uuid4())


async def test_list_tests_for_grading_is_ordered_by_position(
    migrated: asyncpg.Connection,
) -> None:
    tests = [
        TestInput(args=[1, 1], expected=2),
        TestInput(args=[2, 3], expected=5),
        TestInput(args=[0, 0], expected=0),
    ]
    problem_id = await _create(migrated, "Sum two", tests=tests)

    loaded = await repo.list_tests_for_grading(migrated, problem_id)

    assert loaded == tests
