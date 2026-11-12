"""Hints REST (spec 020 plan, Contracts → REST): GET /api/sessions/{invite}/hints.

FR-3 / FR-15: a session's hints, active or stale, read-only. The session is resolved from
the invite only (no auth beyond it, as `GET …/chat`); live hints travel over the session
WebSocket, and this is what the stale window shows.
"""

import asyncpg
from fastapi import APIRouter, Depends

from app.hints import repo
from app.sessions import repo as sessions_repo
from app.sessions.api import get_conn, missing_invite

router = APIRouter(prefix="/api/sessions")


@router.get("/{invite}/hints")
async def get_hints(invite: str, conn: asyncpg.Connection = Depends(get_conn)) -> dict:
    session = await sessions_repo.get_by_invite(conn, invite)
    if session is None:
        raise await missing_invite(conn, "coding", invite)
    return {"hints": [repo.hint_dict(r) for r in await repo.list_for_session(conn, session.id)]}
