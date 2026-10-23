"""Task 25: the seed loader (`problems/seed.py`). FR-6."""

import json
import shutil
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db
from app.problems.seed import SeedError, load_seed

FIXTURES = Path(__file__).parent / "fixtures"
TWO_PROBLEMS = FIXTURES / "seed_problems"
INVALID = FIXTURES / "seed_invalid"


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    # The database is shared by the module; each test here starts from an empty catalogue.
    await db.execute("truncate problem, problem_test cascade")
    yield db


async def test_fr6_loading_the_fixture_twice_gives_exactly_2_starter_problems(
    migrated: asyncpg.Connection,
) -> None:
    first = await load_seed(migrated, TWO_PROBLEMS)
    second = await load_seed(migrated, TWO_PROBLEMS)

    assert first == 2
    assert second == 0
    rows = await migrated.fetch("select title, is_starter from problem")
    assert len(rows) == 2
    assert all(r["is_starter"] for r in rows)


async def test_fr6_each_starter_problem_has_at_least_one_test(
    migrated: asyncpg.Connection,
) -> None:
    await load_seed(migrated, TWO_PROBLEMS)

    counts = await migrated.fetch(
        """select p.title, count(t.id) as n from problem p
           join problem_test t on t.problem_id = p.id
           group by p.title"""
    )
    assert len(counts) == 2
    assert all(r["n"] >= 1 for r in counts)


async def test_an_invalid_fixture_problem_raises_an_error_naming_its_folder(
    migrated: asyncpg.Connection,
) -> None:
    with pytest.raises(SeedError, match="01-broken"):
        await load_seed(migrated, INVALID)


async def test_fr7_a_renamed_starter_problem_is_not_re_seeded(
    migrated: asyncpg.Connection,
) -> None:
    await load_seed(migrated, TWO_PROBLEMS)
    await migrated.execute(
        "update problem set title = 'Renamed by an editor' where id = "
        "(select id from problem order by title limit 1)"
    )

    again = await load_seed(migrated, TWO_PROBLEMS)

    assert again == 0
    titles = [r["title"] for r in await migrated.fetch("select title from problem")]
    assert len(titles) == 2
    assert "Renamed by an editor" in titles


async def test_fr8_a_deleted_starter_problem_is_not_re_seeded(
    migrated: asyncpg.Connection,
) -> None:
    await load_seed(migrated, TWO_PROBLEMS)
    await migrated.execute("update problem set deleted_at = now()")

    assert await load_seed(migrated, TWO_PROBLEMS) == 0
    assert await migrated.fetchval("select count(*) from problem") == 2


async def test_fr6_a_starter_problem_added_later_is_loaded_alongside_edited_ones(
    migrated: asyncpg.Connection, tmp_path: Path
) -> None:
    shutil.copytree(TWO_PROBLEMS / "01-sum-two", tmp_path / "01-sum-two")
    assert await load_seed(migrated, tmp_path) == 1
    await migrated.execute("update problem set title = 'Renamed by an editor'")

    shutil.copytree(TWO_PROBLEMS / "02-reverse-list", tmp_path / "02-reverse-list")
    assert await load_seed(migrated, tmp_path) == 1

    rows = await migrated.fetch("select title, is_starter from problem order by title")
    reverse_title = json.loads((TWO_PROBLEMS / "02-reverse-list" / "problem.json").read_text())
    assert [r["title"] for r in rows] == sorted(["Renamed by an editor", reverse_title["title"]])
    assert all(r["is_starter"] for r in rows)


async def test_a_starter_seeded_before_seed_keys_is_adopted_by_title_not_duplicated(
    migrated: asyncpg.Connection,
) -> None:
    await load_seed(migrated, TWO_PROBLEMS)
    await migrated.execute("update problem set seed_key = null")  # as rows seeded before 0002

    assert await load_seed(migrated, TWO_PROBLEMS) == 0
    keys = [r["seed_key"] for r in await migrated.fetch("select seed_key from problem")]
    assert sorted(keys) == ["01-sum-two", "02-reverse-list"]


async def test_a_seed_with_an_invalid_problem_inserts_nothing(
    migrated: asyncpg.Connection, tmp_path: Path
) -> None:
    shutil.copytree(TWO_PROBLEMS / "01-sum-two", tmp_path / "01-sum-two")
    shutil.copytree(INVALID / "01-broken", tmp_path / "02-broken")

    with pytest.raises(SeedError, match="02-broken"):
        await load_seed(migrated, tmp_path)

    assert await migrated.fetchval("select count(*) from problem") == 0
