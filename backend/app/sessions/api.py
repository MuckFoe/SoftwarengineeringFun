"""Sessions API (plan.md "Contracts"): POST /api/sessions, GET /api/sessions/{invite},
POST /api/sessions/{invite}/reactivate. FR-8, FR-11, FR-14, FR-30, FR-31, FR-32.
"""

import uuid
from collections.abc import AsyncIterator

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.auth.deps import User, current_user, require_role
from app.sessions import service

router = APIRouter(prefix="/api/sessions")


async def get_conn(request: Request) -> AsyncIterator[asyncpg.Connection]:
    async with request.app.state.pool.acquire() as conn:
        yield conn


class CreateSessionIn(BaseModel):
    problem_id: uuid.UUID


class CreatedSessionOut(BaseModel):
    invite_id: str


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CreatedSessionOut)
async def create_session(
    body: CreateSessionIn, conn: asyncpg.Connection = Depends(get_conn)
) -> CreatedSessionOut:
    try:
        session = await service.create_session(conn, body.problem_id)
    except service.ProblemNotAvailable as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"}
        ) from exc
    return CreatedSessionOut(invite_id=session.invite_id)


@router.get("/{invite}")
async def get_session(
    invite: str, request: Request, conn: asyncpg.Connection = Depends(get_conn)
) -> dict:
    user = current_user(request)
    is_admin = user is not None and "admin" in user.roles
    try:
        session, can_reactivate = await service.get_status(conn, invite, is_admin=is_admin)
    except service.SessionNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"}
        ) from exc
    if session.stale_at is not None:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={"error": "stale", "can_reactivate": can_reactivate},
        )
    return {"state": "active"}


@router.post("/{invite}/reactivate")
async def reactivate_session(
    invite: str,
    user: User = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_conn),
) -> dict:
    try:
        await service.reactivate(conn, invite)
    except service.SessionNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"}
        ) from exc
    except service.SessionNotStale as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"error": "not_stale"}
        ) from exc
    return {}
