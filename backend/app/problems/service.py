"""Problems service: validation and orchestration over the repo (plan.md "Problems").

FR-1, FR-2, FR-2a, FR-3, FR-4, FR-5, FR-7, FR-8, FR-9, NFR-5.
Spec 002: description rules on save (FR1, FR3, FR4).
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import asyncpg

from app.problems import images_repo, repo
from app.problems.categories import CATEGORY_IDS, DIFFICULTIES
from app.problems.images import MAX_IMAGES_PER_DESCRIPTION
from app.problems.markdown import disallowed_image_sources, image_ids
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


@dataclass(frozen=True)
class DescriptionError:
    """A description refused on save (spec 002 plan, REST: problems rows)."""

    code: str
    limit: int | None = None
    id: uuid.UUID | None = None


async def _check_description(conn: asyncpg.Connection, source: str) -> DescriptionError | None:
    if not source.strip():
        return DescriptionError("description_required")
    if disallowed_image_sources(source):
        return DescriptionError("image_source_not_allowed")
    ids = image_ids(source)
    if len(ids) > MAX_IMAGES_PER_DESCRIPTION:
        return DescriptionError("too_many_images", limit=MAX_IMAGES_PER_DESCRIPTION)
    existing = await images_repo.existing_ids(conn, ids)
    missing = [i for i in ids if i not in existing]
    if missing:
        return DescriptionError("image_not_found", id=missing[0])
    return None


def _check_labels(category: str | None, difficulty: str | None) -> list[FieldError]:
    errors = []
    if category is not None and category not in CATEGORY_IDS:
        errors.append(FieldError("category", f"category must be one of: {', '.join(CATEGORY_IDS)}"))
    if difficulty is not None and difficulty not in DIFFICULTIES:
        errors.append(
            FieldError("difficulty", f"difficulty must be one of: {', '.join(DIFFICULTIES)}")
        )
    return errors


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
    category: str | None = None,
    difficulty: str | None = None,
) -> uuid.UUID | list[FieldError] | DescriptionError:
    """Validates the signature and tests (FR-4), the category and difficulty (spec 018 FR-13)
    and the description (spec 002), then creates the problem (FR-3)."""
    if label_errors := _check_labels(category, difficulty):
        return label_errors
    try:
        sig = parse_signature(signature)
    except SignatureError as exc:
        return [FieldError("signature", exc.message)]
    errors = validate_tests(sig, tests)
    if errors:
        return errors
    refused = await _check_description(conn, description)
    if refused:
        return refused
    return await repo.create(
        conn,
        title=title,
        description=description,
        sig=sig,
        tests=tests,
        created_by_sub=created_by_sub,
        created_by_name=created_by_name,
        category=category,
        difficulty=difficulty,
    )


async def search(
    conn: asyncpg.Connection,
    query: str,
    *,
    category: str | None = None,
    difficulty: str | None = None,
) -> list[repo.ProblemSummary]:
    """FR-5: case-insensitive substring match, excluding deleted problems; spec 018 adds the
    category and difficulty filters and the canonical order."""
    return await repo.search(conn, query, category=category, difficulty=difficulty)


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
    category: str | None = None,
    difficulty: str | None = None,
) -> list[FieldError] | DescriptionError | None:
    """FR-7: validates, then replaces the problem's fields and tests. `None` on success.
    An omitted category or difficulty leaves the stored one unchanged (spec 018 FR-13)."""
    if label_errors := _check_labels(category, difficulty):
        return label_errors
    try:
        sig = parse_signature(signature)
    except SignatureError as exc:
        return [FieldError("signature", exc.message)]
    errors = validate_tests(sig, tests)
    if errors:
        return errors
    refused = await _check_description(conn, description)
    if refused:
        return refused
    await repo.update(
        conn,
        problem_id,
        title=title,
        description=description,
        sig=sig,
        tests=tests,
        category=category,
        difficulty=difficulty,
    )
    return None


async def delete(conn: asyncpg.Connection, problem_id: uuid.UUID) -> None:
    """FR-8: soft-deletes, then runs every registered deletion callback once."""
    await repo.soft_delete(conn, problem_id)
    for callback in _on_problem_deleted:
        await callback(problem_id)
