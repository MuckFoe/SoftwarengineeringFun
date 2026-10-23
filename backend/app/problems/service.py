"""Problems service: validation and orchestration over the repo (plan.md "Problems").

FR-1, FR-2, FR-2a, FR-3, FR-4, FR-5, FR-7, FR-8, FR-9, NFR-5.
"""

import uuid
from collections.abc import Awaitable, Callable

import asyncpg

from app.problems import repo
from app.problems.signature import (
    FieldError,
    SignatureError,
    TestInput,
    parse_signature,
    validate_tests,
)

OnProblemDeleted = Callable[[uuid.UUID], Awaitable[None]]

# `sessions` (task 38) registers here to react to a deletion, so `problems` never has to
# import `sessions` (plan.md dependency direction: sessions -> problems, never the reverse).
_on_problem_deleted: list[OnProblemDeleted] = []


def register_on_problem_deleted(callback: OnProblemDeleted) -> None:
    _on_problem_deleted.append(callback)


def unregister_on_problem_deleted(callback: OnProblemDeleted) -> None:
    """The counterpart to `register_on_problem_deleted`, so a caller that registers a
    closure over a resource (e.g. a DB pool) can remove it once that resource is gone.
    """
    if callback in _on_problem_deleted:
        _on_problem_deleted.remove(callback)


async def create(
    conn: asyncpg.Connection,
    *,
    title: str,
    description: str,
    signature: str,
    tests: list[TestInput],
    created_by_sub: str,
    created_by_name: str,
) -> uuid.UUID | list[FieldError]:
    """Validates the signature and tests (FR-4), then creates the problem (FR-3)."""
    try:
        sig = parse_signature(signature)
    except SignatureError as exc:
        return [FieldError("signature", exc.message)]
    errors = validate_tests(sig, tests)
    if errors:
        return errors
    return await repo.create(
        conn,
        title=title,
        description=description,
        sig=sig,
        tests=tests,
        created_by_sub=created_by_sub,
        created_by_name=created_by_name,
    )


async def search(conn: asyncpg.Connection, query: str) -> list[repo.ProblemSummary]:
    """FR-5: case-insensitive substring match, excluding deleted problems."""
    return await repo.search(conn, query)


async def get_public(conn: asyncpg.Connection, problem_id: uuid.UUID) -> repo.ProblemPublic:
    """FR-9 / NFR-5: the public shape, which has no tests."""
    return await repo.get_public(conn, problem_id)


async def get_for_edit(conn: asyncpg.Connection, problem_id: uuid.UUID) -> repo.ProblemWithTests:
    """FR-7: the editor shape, with tests."""
    return await repo.get_with_tests(conn, problem_id)


async def update(
    conn: asyncpg.Connection,
    problem_id: uuid.UUID,
    *,
    title: str,
    description: str,
    signature: str,
    tests: list[TestInput],
) -> list[FieldError] | None:
    """FR-7: validates, then replaces the problem's fields and tests. `None` on success."""
    try:
        sig = parse_signature(signature)
    except SignatureError as exc:
        return [FieldError("signature", exc.message)]
    errors = validate_tests(sig, tests)
    if errors:
        return errors
    await repo.update(conn, problem_id, title=title, description=description, sig=sig, tests=tests)
    return None


async def delete(conn: asyncpg.Connection, problem_id: uuid.UUID) -> None:
    """FR-8: soft-deletes, then runs every registered deletion callback once."""
    await repo.soft_delete(conn, problem_id)
    for callback in _on_problem_deleted:
        await callback(problem_id)
