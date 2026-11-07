"""Problems repository (plan.md "Data model": `problem`, `problem_test`).

FR-3 (creator recorded), FR-5 (search), FR-8 (soft delete).
"""

import json
import uuid
from dataclasses import dataclass

import asyncpg

from app import clock
from app.problems.categories import CATEGORY_IDS, DIFFICULTIES
from app.problems.signature import Signature, TestInput


class NotFound(LookupError):
    pass


@dataclass(frozen=True)
class ProblemSummary:
    id: uuid.UUID
    title: str
    is_starter: bool
    category: str | None = None
    difficulty: str | None = None


@dataclass(frozen=True)
class ProblemPublic:
    id: uuid.UUID
    title: str
    description: str
    signature: str
    deleted: bool


@dataclass(frozen=True)
class ProblemWithTests:
    id: uuid.UUID
    title: str
    description: str
    signature: str
    deleted: bool
    tests: list[TestInput]
    category: str | None = None
    difficulty: str | None = None


def _params_json(sig: Signature) -> str:
    return json.dumps([{"name": p.name, "type": p.type} for p in sig.params])


async def _replace_tests(
    conn: asyncpg.Connection, problem_id: uuid.UUID, tests: list[TestInput]
) -> None:
    await conn.execute("delete from problem_test where problem_id = $1", problem_id)
    await conn.executemany(
        """insert into problem_test (problem_id, position, args, expected)
           values ($1, $2, $3, $4)""",
        [(problem_id, i, json.dumps(t.args), json.dumps(t.expected)) for i, t in enumerate(tests)],
    )


async def create(
    conn: asyncpg.Connection,
    *,
    title: str,
    description: str,
    sig: Signature,
    tests: list[TestInput],
    created_by_sub: str | None,
    created_by_name: str | None,
    is_starter: bool = False,
    seed_key: str | None = None,
    category: str | None = None,
    difficulty: str | None = None,
) -> uuid.UUID:
    async with conn.transaction():
        problem_id = await conn.fetchval(
            """insert into problem (title, description, signature, function_name, params,
                                     return_type, is_starter, created_by_sub, created_by_name,
                                     seed_key, category, difficulty)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               returning id""",
            title,
            description,
            sig.line,
            sig.name,
            _params_json(sig),
            sig.return_type,
            is_starter,
            created_by_sub,
            created_by_name,
            seed_key,
            category,
            difficulty,
        )
        await _replace_tests(conn, problem_id, tests)
    return problem_id


async def _row(conn: asyncpg.Connection, problem_id: uuid.UUID) -> asyncpg.Record:
    row = await conn.fetchrow(
        """select id, title, description, signature, deleted_at, category, difficulty
           from problem where id = $1""",
        problem_id,
    )
    if row is None:
        raise NotFound(f"no problem {problem_id}")
    return row


async def get_public(conn: asyncpg.Connection, problem_id: uuid.UUID) -> ProblemPublic:
    row = await _row(conn, problem_id)
    return ProblemPublic(
        id=row["id"],
        title=row["title"],
        description=row["description"],
        signature=row["signature"],
        deleted=row["deleted_at"] is not None,
    )


async def get_with_tests(conn: asyncpg.Connection, problem_id: uuid.UUID) -> ProblemWithTests:
    row = await _row(conn, problem_id)
    tests = await list_tests_for_grading(conn, problem_id)
    return ProblemWithTests(
        id=row["id"],
        title=row["title"],
        description=row["description"],
        signature=row["signature"],
        deleted=row["deleted_at"] is not None,
        tests=tests,
        category=row["category"],
        difficulty=row["difficulty"],
    )


async def search(
    conn: asyncpg.Connection,
    query: str,
    *,
    category: str | None = None,
    difficulty: str | None = None,
) -> list[ProblemSummary]:
    """Case-insensitive substring match on title or description, excluding deleted (FR-5),
    narrowed by the optional category and difficulty (spec 018 FR-10). Canonical order
    (FR-11): category list order, then easy < medium < hard, then title; unset values last.
    """
    rows = await conn.fetch(
        """select id, title, is_starter, category, difficulty from problem
           where deleted_at is null
             and (title ilike '%' || $1 || '%' or description ilike '%' || $1 || '%')
             and ($2::text is null or category = $2)
             and ($3::text is null or difficulty = $3)
           order by array_position($4::text[], category) nulls last,
                    array_position($5::text[], difficulty) nulls last,
                    title, id""",
        query,
        category,
        difficulty,
        CATEGORY_IDS,
        DIFFICULTIES,
    )
    return [
        ProblemSummary(r["id"], r["title"], r["is_starter"], r["category"], r["difficulty"])
        for r in rows
    ]


async def update(
    conn: asyncpg.Connection,
    problem_id: uuid.UUID,
    *,
    title: str,
    description: str,
    sig: Signature,
    tests: list[TestInput],
    category: str | None = None,
    difficulty: str | None = None,
) -> None:
    """Replaces the problem's fields and its full set of tests. A `None` category or
    difficulty keeps the stored value."""
    async with conn.transaction():
        updated = await conn.fetchval(
            """update problem
               set title = $2, description = $3, signature = $4, function_name = $5,
                   params = $6, return_type = $7, updated_at = $8,
                   category = coalesce($9, category), difficulty = coalesce($10, difficulty)
               where id = $1
               returning id""",
            problem_id,
            title,
            description,
            sig.line,
            sig.name,
            _params_json(sig),
            sig.return_type,
            clock.now(),
            category,
            difficulty,
        )
        if updated is None:
            raise NotFound(f"no problem {problem_id}")
        await _replace_tests(conn, problem_id, tests)


async def soft_delete(conn: asyncpg.Connection, problem_id: uuid.UUID) -> None:
    deleted = await conn.fetchval(
        "update problem set deleted_at = $2 where id = $1 returning id",
        problem_id,
        clock.now(),
    )
    if deleted is None:
        raise NotFound(f"no problem {problem_id}")


async def list_tests_for_grading(
    conn: asyncpg.Connection, problem_id: uuid.UUID
) -> list[TestInput]:
    rows = await conn.fetch(
        """select args, expected from problem_test
           where problem_id = $1 order by position""",
        problem_id,
    )
    return [TestInput(args=json.loads(r["args"]), expected=json.loads(r["expected"])) for r in rows]


__all__ = [
    "NotFound",
    "ProblemPublic",
    "ProblemSummary",
    "ProblemWithTests",
    "create",
    "get_public",
    "get_with_tests",
    "list_tests_for_grading",
    "search",
    "soft_delete",
    "update",
]
