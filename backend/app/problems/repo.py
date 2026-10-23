"""Problems repository (plan.md "Data model": `problem`, `problem_test`).

FR-3 (creator recorded), FR-5 (search), FR-8 (soft delete).
"""

import json
import uuid
from dataclasses import dataclass

import asyncpg

from app import clock
from app.problems.signature import Signature, TestInput


class NotFound(LookupError):
    pass


@dataclass(frozen=True)
class ProblemSummary:
    id: uuid.UUID
    title: str
    is_starter: bool


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
) -> uuid.UUID:
    async with conn.transaction():
        problem_id = await conn.fetchval(
            """insert into problem (title, description, signature, function_name, params,
                                     return_type, is_starter, created_by_sub, created_by_name,
                                     seed_key)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        )
        await _replace_tests(conn, problem_id, tests)
    return problem_id


async def _row(conn: asyncpg.Connection, problem_id: uuid.UUID) -> asyncpg.Record:
    row = await conn.fetchrow(
        """select id, title, description, signature, deleted_at
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
    )


async def search(conn: asyncpg.Connection, query: str) -> list[ProblemSummary]:
    """Case-insensitive substring match on title or description, excluding deleted (FR-5)."""
    rows = await conn.fetch(
        """select id, title, is_starter from problem
           where deleted_at is null
             and (title ilike '%' || $1 || '%' or description ilike '%' || $1 || '%')
           order by title""",
        query,
    )
    return [ProblemSummary(r["id"], r["title"], r["is_starter"]) for r in rows]


async def update(
    conn: asyncpg.Connection,
    problem_id: uuid.UUID,
    *,
    title: str,
    description: str,
    sig: Signature,
    tests: list[TestInput],
) -> None:
    """Replaces the problem's fields and its full set of tests."""
    async with conn.transaction():
        updated = await conn.fetchval(
            """update problem
               set title = $2, description = $3, signature = $4, function_name = $5,
                   params = $6, return_type = $7, updated_at = $8
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
