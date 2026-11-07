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


# --- Spec 018 task 5: ledger, category and difficulty backfill ------------------------------


def _seed_dir(root: Path, n: int, *, category: str | None = "arrays", difficulty: str = "easy"):
    """Writes starter folder `n` under root and returns its folder name."""
    name = f"{n:03d}-problem-{n}"
    folder = root / name
    folder.mkdir()
    data = {
        "title": f"Problem {n}",
        "description": f"Task {n}.",
        "signature": "def add(a: int, b: int) -> int",
        "topic": "math",
        "difficulty": difficulty,
        "tests": [{"args": [1, 2], "expected": 3}],
    }
    if category is not None:
        data["category"] = category
    (folder / "problem.json").write_text(json.dumps(data))
    return name


async def _snapshot(conn: asyncpg.Connection) -> list[tuple]:
    rows = await conn.fetch(
        """select id, title, description, category, difficulty, seed_key, updated_at,
                  deleted_at from problem order by title"""
    )
    ledger = await conn.fetch("select seed_key, problem_id from seeded_problem order by seed_key")
    return [tuple(r.values()) for r in rows] + [tuple(r.values()) for r in ledger]


async def test_fr1_n_seed_folders_in_an_empty_database_give_n_problems_and_ledger_rows(
    migrated: asyncpg.Connection, tmp_path: Path
) -> None:
    for n in range(1, 8):
        _seed_dir(tmp_path, n, difficulty=("easy", "medium", "hard")[n % 3])

    assert await load_seed(migrated, tmp_path) == 7

    assert await migrated.fetchval("select count(*) from problem") == 7
    assert await migrated.fetchval("select count(*) from seeded_problem") == 7
    row = await migrated.fetchrow(
        "select category, difficulty from problem where title = 'Problem 2'"
    )
    assert (row["category"], row["difficulty"]) == ("arrays", "hard")


async def test_fr4_a_seed_folder_with_a_category_outside_the_list_is_a_seed_error(
    migrated: asyncpg.Connection, tmp_path: Path
) -> None:
    _seed_dir(tmp_path, 1, category="nonsense")

    with pytest.raises(SeedError, match="001-problem-1.*category"):
        await load_seed(migrated, tmp_path)
    assert await migrated.fetchval("select count(*) from problem") == 0


async def test_fr2_seeding_a_legacy_database_fills_category_and_keeps_id_session_and_topic(
    migrated: asyncpg.Connection, tmp_path: Path
) -> None:
    name = _seed_dir(tmp_path, 1, category="strings", difficulty="medium")
    # A legacy row: seeded before categories existed, so no category or difficulty, and a
    # ledger row as written by the migration.
    pid = await migrated.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter, seed_key)
           values ('Problem 1', 'Edited text', 'def add(a: int, b: int) -> int', 'add', '[]',
                   'int', true, $1) returning id""",
        name,
    )
    await migrated.execute(
        "insert into seeded_problem (seed_key, problem_id) values ($1, $2)", name, pid
    )
    session_id = await migrated.fetchval(
        "insert into session (invite_id, current_problem_id) values ('inv', $1) returning id", pid
    )

    assert await load_seed(migrated, tmp_path) == 0

    row = await migrated.fetchrow("select * from problem")
    assert row["id"] == pid
    assert row["description"] == "Edited text"
    assert (row["category"], row["difficulty"]) == ("strings", "medium")
    assert "topic" not in row
    assert (
        await migrated.fetchval("select current_problem_id from session where id = $1", session_id)
        == pid
    )


async def test_fr8_edit_kept_deleted_stays_deleted_no_duplicates_second_run_changes_nothing(
    migrated: asyncpg.Connection, tmp_path: Path
) -> None:
    names = [_seed_dir(tmp_path, n) for n in range(1, 6)]
    await load_seed(migrated, tmp_path)
    # Legacy state: category and difficulty not yet set on the rows.
    await migrated.execute("update problem set category = null, difficulty = null")
    await migrated.execute(
        "update problem set title = 'Edited title' where seed_key = $1", names[0]
    )
    await migrated.execute(
        "delete from problem_test where problem_id = (select id from problem where seed_key = $1)",
        names[1],
    )
    await migrated.execute(
        "update seeded_problem set problem_id = null where seed_key = $1", names[1]
    )
    await migrated.execute("delete from problem where seed_key = $1", names[1])  # hard delete
    new_name = _seed_dir(tmp_path, 6)

    first = await load_seed(migrated, tmp_path)
    after_first = await _snapshot(migrated)
    second = await load_seed(migrated, tmp_path)

    assert first == 1  # only the genuinely new starter
    assert second == 0
    assert await _snapshot(migrated) == after_first
    titles = [r["title"] for r in await migrated.fetch("select title from problem")]
    assert "Edited title" in titles
    assert "Problem 2" not in titles  # deleted stays deleted
    assert len(titles) == len(set(titles)) == 5
    assert (
        await migrated.fetchval("select count(*) from problem where seed_key = $1", new_name) == 1
    )
    assert await migrated.fetchval("select count(*) from problem where category is null") == 0


async def test_a_seeded_problem_with_a_category_keeps_it_when_the_seed_says_otherwise(
    migrated: asyncpg.Connection, tmp_path: Path
) -> None:
    name = _seed_dir(tmp_path, 1, category="arrays", difficulty="easy")
    await load_seed(migrated, tmp_path)
    await migrated.execute("update problem set category = 'strings', difficulty = 'hard'")

    await load_seed(migrated, tmp_path)

    row = await migrated.fetchrow(
        "select category, difficulty from problem where seed_key = $1", name
    )
    assert (row["category"], row["difficulty"]) == ("strings", "hard")
