"""Seed loader (plan.md "Seed"). FR-6.

Reads `seed/problems/*/problem.json` at startup and inserts every folder not loaded before,
so starter problems added to the seed later appear in an existing catalogue (FR-6). A
problem's folder name is its `seed_key`, its identity: a folder whose key is in the DB is
never loaded again, even if editors renamed or deleted that problem (FR-7, FR-8). So never
rename a seed folder; it would load as a new problem. Every folder is validated before
anything is inserted, and the inserts share one transaction. `topic` exists only for authoring
and tests; it is not stored. `category` and `difficulty` are (spec 018).
"""

import json
import uuid
from pathlib import Path

import asyncpg

from app.problems import repo
from app.problems.categories import CATEGORY_IDS, DIFFICULTIES
from app.problems.signature import SignatureError, TestInput, parse_signature, validate_tests


class SeedError(RuntimeError):
    """A seed problem folder failed validation."""


def _read_seed_problems(seed_dir: Path) -> list[tuple[str, dict]]:
    # Small files read once at startup; blocking I/O here is acceptable.
    problems = []
    for folder in sorted(p for p in seed_dir.iterdir() if p.is_dir()):
        problem_file = folder / "problem.json"
        if problem_file.is_file():
            problems.append((folder.name, json.loads(problem_file.read_text())))
    return problems


async def load_seed(conn: asyncpg.Connection, seed_dir: Path) -> int:
    """Inserts the seed folders not seeded before. Returns how many.

    The `seeded_problem` ledger records every seeded folder, so a starter an editor deleted is
    never re-added (FR-8). For a starter whose problem still exists, only a missing category or
    difficulty is filled in (FR-2); no other field of an existing problem is ever written.
    """
    problems = []
    for folder_name, data in _read_seed_problems(seed_dir):
        try:
            sig = parse_signature(data["signature"])
            tests = [TestInput(args=t["args"], expected=t["expected"]) for t in data["tests"]]
            errors = validate_tests(sig, tests)
        except SignatureError as exc:
            raise SeedError(f"{folder_name}: {exc.message}") from exc
        if errors:
            raise SeedError(f"{folder_name}: {errors[0].message}")
        category = data.get("category")
        if category is not None and category not in CATEGORY_IDS:
            raise SeedError(f"{folder_name}: category {category!r} is not in the category list")
        difficulty = data.get("difficulty")
        if difficulty is not None and difficulty not in DIFFICULTIES:
            raise SeedError(f"{folder_name}: difficulty {difficulty!r} is not easy, medium or hard")
        problems.append((folder_name, data, sig, tests))

    inserted = 0
    async with conn.transaction():
        ledger = {
            r["seed_key"]: r["problem_id"]
            for r in await conn.fetch("select seed_key, problem_id from seeded_problem")
        }
        for folder_name, data, sig, tests in problems:
            category, difficulty = data.get("category"), data.get("difficulty")
            if folder_name in ledger:
                if ledger[folder_name] is not None:
                    await _backfill(conn, ledger[folder_name], folder_name, category, difficulty)
                continue
            problem_id = await conn.fetchval(
                "select id from problem where seed_key = $1", folder_name
            )
            if problem_id is None:
                # A starter seeded before seed keys existed (migration 0002) is adopted by title.
                problem_id = await conn.fetchval(
                    """update problem set seed_key = $1
                       where id = (select id from problem
                                   where seed_key is null and is_starter and title = $2
                                   limit 1)
                       returning id""",
                    folder_name,
                    data["title"],
                )
            if problem_id is None:
                problem_id = await repo.create(
                    conn,
                    title=data["title"],
                    description=data["description"],
                    sig=sig,
                    tests=tests,
                    created_by_sub=None,
                    created_by_name=None,
                    is_starter=True,
                    seed_key=folder_name,
                    category=category,
                    difficulty=difficulty,
                )
                inserted += 1
            else:
                await _backfill(conn, problem_id, folder_name, category, difficulty)
            await conn.execute(
                "insert into seeded_problem (seed_key, problem_id) values ($1, $2)",
                folder_name,
                problem_id,
            )
    return inserted


async def _backfill(
    conn: asyncpg.Connection,
    problem_id: uuid.UUID,
    seed_key: str,
    category: str | None,
    difficulty: str | None,
) -> None:
    """Fills only what is missing: the seed key, category and difficulty, never overwriting."""
    await conn.execute(
        """update problem
           set seed_key = coalesce(seed_key, $2),
               category = coalesce(category, $3),
               difficulty = coalesce(difficulty, $4)
           where id = $1
             and (seed_key is null
                  or (category is null and $3::text is not null)
                  or (difficulty is null and $4::text is not null))""",
        problem_id,
        seed_key,
        category,
        difficulty,
    )
