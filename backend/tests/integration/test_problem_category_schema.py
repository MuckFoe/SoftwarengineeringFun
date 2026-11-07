"""Spec 018 task 1: category column, difficulty column, seeded_problem ledger and its
migration backfill. FR-2, FR-4, FR-8."""

import shutil
import tempfile
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db
from app.problems.categories import CATEGORY_IDS

MIGRATION = "0010_problem_category.sql"
LEGACY = [
    ("01-sum-two", "Sum Two Numbers"),
    ("02-reverse-words", "Reverse Word Order"),
    ("03-count-vowels", "Count Vowels"),
    ("04-max-of-three", "Largest Of Three"),
    ("05-is-palindrome", "Palindrome Check"),
    ("06-unique-elements", "First Occurrences Only"),
    ("07-word-frequency", "Word Frequency Count"),
    ("08-flatten-pairs", "Flatten Pairs"),
    ("09-average-or-none", "Average Or Nothing"),
    ("10-shift-letters", "Shift Letters"),
    ("11-pair-sum-indices", "Pair Sums To Target"),
    ("12-valid-brackets", "Valid Brackets"),
    ("13-kth-smallest", "Kth Smallest"),
    ("14-climb-steps", "Count Ways To Climb"),
    ("15-insert-position", "Find Insert Position"),
    ("16-digital-root", "Digital Root"),
    ("17-max-profit", "Best Single Trade"),
    ("18-common-elements", "Common Elements"),
    ("19-merge-ranges", "Merge Overlapping Ranges"),
    ("20-count-set-bits", "Count Set Bits"),
]
LEGACY_KEYS = [k for k, _ in LEGACY]
SIG = ("def f(a: int) -> int", "f", "[]", "int")


@pytest.fixture
async def before(db: asyncpg.Connection) -> asyncpg.Connection:
    """The schema as of migration 0009, with an empty catalogue, for each test."""
    await db.execute("drop schema public cascade; create schema public")
    with tempfile.TemporaryDirectory() as tmp:
        for f in sorted(app_db.MIGRATIONS_DIR.glob("[0-9]*.sql")):
            if f.name < MIGRATION:
                shutil.copy(f, Path(tmp) / f.name)
        await app_db.migrate(db, Path(tmp))
    return db


async def _legacy(db: asyncpg.Connection, n: int, *, seed_key: bool = True) -> str:
    # Legacy starters carry the real seed's folder name and title (the migration knows both).
    return await db.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter, seed_key)
           values ($1, 'd', $2, $3, $4, $5, true, $6) returning id::text""",
        LEGACY[n - 1][1],
        *SIG[:2],
        SIG[2],
        SIG[3],
        LEGACY_KEYS[n - 1] if seed_key else None,
    )


async def test_fr8_migration_ledgers_legacy_starters_null_id_for_the_deleted_one(
    before: asyncpg.Connection,
) -> None:
    ids = {n: await _legacy(before, n) for n in range(1, 21) if n != 7}  # 7 hard-deleted

    await app_db.migrate(before)

    rows = {
        r["seed_key"]: r["problem_id"]
        for r in await before.fetch("select seed_key, problem_id from seeded_problem")
    }
    assert len(rows) == 20
    assert rows[LEGACY_KEYS[6]] is None
    for n, pid in ids.items():
        assert str(rows[LEGACY_KEYS[n - 1]]) == pid


async def test_fr8_a_legacy_starter_without_a_seed_key_is_matched_by_title(
    before: asyncpg.Connection,
) -> None:
    pid = await _legacy(before, 3, seed_key=False)

    await app_db.migrate(before)

    row = await before.fetchrow(
        "select problem_id from seeded_problem where seed_key = $1", LEGACY_KEYS[2]
    )
    assert str(row["problem_id"]) == pid


async def test_migration_on_a_fresh_database_leaves_the_ledger_empty(
    before: asyncpg.Connection,
) -> None:
    await app_db.migrate(before)

    assert await before.fetchval("select count(*) from seeded_problem") == 0


async def test_fr4_the_database_rejects_a_category_outside_the_list(
    before: asyncpg.Connection,
) -> None:
    await app_db.migrate(before)

    for bad in ("nonsense", "Arrays"):
        with pytest.raises(asyncpg.CheckViolationError):
            await before.execute(
                """insert into problem (title, description, signature, function_name, params,
                                        return_type, category)
                   values ('t', 'd', 's', 'f', '[]', 'int', $1)""",
                bad,
            )
    for ok in [None, *CATEGORY_IDS]:
        await before.execute(
            """insert into problem (title, description, signature, function_name, params,
                                    return_type, category)
               values ('t', 'd', 's', 'f', '[]', 'int', $1)""",
            ok,
        )


async def test_the_database_rejects_a_difficulty_outside_easy_medium_hard(
    before: asyncpg.Connection,
) -> None:
    await app_db.migrate(before)

    with pytest.raises(asyncpg.CheckViolationError):
        await before.execute(
            """insert into problem (title, description, signature, function_name, params,
                                    return_type, difficulty)
               values ('t', 'd', 's', 'f', '[]', 'int', 'brutal')"""
        )
