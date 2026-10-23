"""Problems API (plan.md "Contracts"): GET /api/problems, GET /api/problems/{id},
POST /api/problems, GET /api/problems/{id}/edit, PUT /api/problems/{id},
DELETE /api/problems/{id}. FR-1, FR-2, FR-2a, FR-3, FR-4, FR-5, FR-7, FR-8, FR-9, NFR-5.
"""

import uuid
from collections.abc import AsyncIterator
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.auth.deps import User, require_role
from app.problems import repo, service
from app.problems.signature import FieldError, TestInput

router = APIRouter(prefix="/api/problems")


async def get_conn(request: Request) -> AsyncIterator[asyncpg.Connection]:
    async with request.app.state.pool.acquire() as conn:
        yield conn


class ProblemTestIn(BaseModel):
    args: list[Any]
    expected: Any = None


class ProblemIn(BaseModel):
    title: str
    description: str
    signature: str
    tests: list[ProblemTestIn]


class ProblemSummaryOut(BaseModel):
    id: uuid.UUID
    title: str
    is_starter: bool


class ProblemOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    signature: str
    deleted: bool


class CreatedOut(BaseModel):
    id: uuid.UUID


class EditableProblemOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    signature: str
    tests: list[ProblemTestIn]


def _field_error_body(errors: list[FieldError]) -> dict:
    def to_dict(e: FieldError) -> dict:
        body: dict = {"field": e.field, "message": e.message}
        if e.test_index is not None:
            body["test_index"] = e.test_index
        return body

    return {"errors": [to_dict(e) for e in errors]}


@router.get("", response_model=list[ProblemSummaryOut])
async def list_problems(
    q: str = "", conn: asyncpg.Connection = Depends(get_conn)
) -> list[ProblemSummaryOut]:
    found = await service.search(conn, q)
    return [ProblemSummaryOut(id=p.id, title=p.title, is_starter=p.is_starter) for p in found]


@router.get("/{problem_id}", response_model=ProblemOut)
async def get_problem(
    problem_id: uuid.UUID, conn: asyncpg.Connection = Depends(get_conn)
) -> ProblemOut:
    try:
        problem = await service.get_public(conn, problem_id)
    except repo.NotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"}
        ) from exc
    return ProblemOut(
        id=problem.id,
        title=problem.title,
        description=problem.description,
        signature=problem.signature,
        deleted=problem.deleted,
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CreatedOut)
async def create_problem(
    body: ProblemIn,
    user: User = Depends(require_role("editor")),
    conn: asyncpg.Connection = Depends(get_conn),
) -> CreatedOut:
    tests = [TestInput(args=t.args, expected=t.expected) for t in body.tests]
    result = await service.create(
        conn,
        title=body.title,
        description=body.description,
        signature=body.signature,
        tests=tests,
        created_by_sub=user.sub,
        created_by_name=user.name,
    )
    if isinstance(result, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_field_error_body(result)
        )
    return CreatedOut(id=result)


@router.get("/{problem_id}/edit", response_model=EditableProblemOut)
async def get_problem_for_edit(
    problem_id: uuid.UUID,
    user: User = Depends(require_role("editor")),
    conn: asyncpg.Connection = Depends(get_conn),
) -> EditableProblemOut:
    try:
        problem = await service.get_for_edit(conn, problem_id)
    except repo.NotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"}
        ) from exc
    return EditableProblemOut(
        id=problem.id,
        title=problem.title,
        description=problem.description,
        signature=problem.signature,
        tests=[ProblemTestIn(args=t.args, expected=t.expected) for t in problem.tests],
    )


@router.put("/{problem_id}")
async def update_problem(
    problem_id: uuid.UUID,
    body: ProblemIn,
    user: User = Depends(require_role("editor")),
    conn: asyncpg.Connection = Depends(get_conn),
) -> dict:
    tests = [TestInput(args=t.args, expected=t.expected) for t in body.tests]
    try:
        errors = await service.update(
            conn,
            problem_id,
            title=body.title,
            description=body.description,
            signature=body.signature,
            tests=tests,
        )
    except repo.NotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"}
        ) from exc
    if errors is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_field_error_body(errors)
        )
    return {}


@router.delete("/{problem_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_problem(
    problem_id: uuid.UUID,
    user: User = Depends(require_role("editor")),
    conn: asyncpg.Connection = Depends(get_conn),
) -> None:
    try:
        await service.delete(conn, problem_id)
    except repo.NotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"}
        ) from exc
