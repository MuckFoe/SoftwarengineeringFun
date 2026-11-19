"""Sketch REST (spec 022 plan, Contracts — REST): GET /api/sessions/{invite}/sketch.
FR-16, FR-19, FR-21.

The session is always resolved from the invite, as chat history is (spec 002), so nothing
reaches another session's board (FR-21). Live drawing travels over the session WebSocket;
this read is what a stale session, which refuses the WebSocket, shows read-only (FR-16).
There is no write endpoint.
"""

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from app.sessions import repo as sessions_repo
from app.sessions.api import get_conn
from app.sketch import service

router = APIRouter(prefix="/api/sessions")


@router.get("/{invite}/sketch")
async def get_sketch(invite: str, conn: asyncpg.Connection = Depends(get_conn)) -> dict:
    session = await sessions_repo.get_by_invite(conn, invite)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"})
    snapshot = await service.snapshot(conn, session.id)
    return {"actions": snapshot["actions"], "read_only": session.stale_at is not None}
