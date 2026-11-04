"""Account REST (spec 012 plan.md "Contracts"): `/api/me/*`. FR-2, FR-4, FR-12, FR-13,
FR-15, FR-16, NFR-1.

Every route is `401` when signed out and reads only the caller's own rows: the account is
the cookie's `sub`, never a parameter.
"""

from dataclasses import asdict
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, StrictBool, model_validator

from app.accounts import repo
from app.auth.deps import User, current_user
from app.sessions.api import get_conn

router = APIRouter(prefix="/api/me")

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]


def signed_in(request: Request) -> User:
    """A dependency: the signed-in user, or `401`."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


Account = Annotated[User, Depends(signed_in)]


@router.get("/sessions")
async def my_sessions(user: Account, conn: Conn) -> list[dict[str, Any]]:
    """FR-2, FR-4, FR-12: the account's non-hidden sessions, most recently active first."""
    return [
        {**asdict(s), "last_activity_at": s.last_activity_at.isoformat()}
        for s in await repo.recent_sessions(conn, user.sub)
    ]


@router.post("/sessions/{kind}/{invite}/hide", status_code=status.HTTP_204_NO_CONTENT)
async def hide_session(kind: str, invite: str, user: Account, conn: Conn) -> Response:
    """FR-13: hide a session from the caller's own list only. Unknown kind, unknown session
    and a session the caller isn't in are the same `404` (NFR-1). Idempotent."""
    if not await repo.hide(conn, user.sub, kind, invite):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class PreferencesIn(BaseModel):
    appearance: repo.Appearance | None = None
    chat_visible: StrictBool | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "PreferencesIn":
        if self.appearance is None and self.chat_visible is None:
            raise ValueError("give appearance, chat_visible or both")
        return self


@router.put("/preferences")
async def put_preferences(body: PreferencesIn, user: Account, conn: Conn) -> dict[str, Any]:
    """FR-15, FR-16, FR-18: store the caller's preferences; returns the stored pair."""
    stored = await repo.put_preferences(conn, user.sub, body.appearance, body.chat_visible)
    return asdict(stored)
