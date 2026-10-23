"""Seed loader (plan.md "Seed"). FR-6.

Reads `seed/problems/*/problem.json` at startup and inserts every folder not loaded before,
so starter problems added to the seed later appear in an existing catalogue (FR-6). A
problem's folder name is its `seed_key`, its identity: a folder whose key is in the DB is
never loaded again, even if editors renamed or deleted that problem (FR-7, FR-8). So never
rename a seed folder; it would load as a new problem. Every folder is validated before
anything is inserted, and the inserts share one transaction. `topic` and `difficulty` exist
only for authoring and tests; they are not stored.
"""

import json
from pathlib import Path

import asyncpg

from app.problems import repo
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
    """Inserts the seed folders not loaded before. Returns how many."""
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
        problems.append((folder_name, data, sig, tests))

    inserted = 0
    async with conn.transaction():
        for folder_name, data, sig, tests in problems:
            if await conn.fetchval("select 1 from problem where seed_key = $1", folder_name):
                continue
            # A starter seeded before seed keys existed (migration 0002) is adopted by title.
            adopted = await conn.fetchval(
                """update problem set seed_key = $1
                   where id = (select id from problem
                               where seed_key is null and is_starter and title = $2
                               limit 1)
                   returning id""",
                folder_name,
                data["title"],
            )
            if adopted:
                continue
            await repo.create(
                conn,
                title=data["title"],
                description=data["description"],
                sig=sig,
                tests=tests,
                created_by_sub=None,
                created_by_name=None,
                is_starter=True,
                seed_key=folder_name,
            )
            inserted += 1
    return inserted
