"""Chat REST (spec 002 plan, Contracts): GET /api/sessions/{invite}/chat and
DELETE /api/sessions/{invite}/chat/{message_id}. FR16, FR17, FR19.

The session is always resolved from the invite, so neither endpoint reaches another
session's chat (FR17). Live chat travels over the session WebSocket; this history is what a
stale session, which refuses the WebSocket, shows read-only (FR16).
"""

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.auth.deps import User, require_role
from app.chat import service
from app.sessions import hub as hub_module
from app.sessions import repo as sessions_repo
from app.sessions.api import get_conn
from app.sessions.repo import Session

router = APIRouter(prefix="/api/sessions")


async def _session(conn: asyncpg.Connection, invite: str) -> Session:
    session = await sessions_repo.get_by_invite(conn, invite)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"})
    return session


@router.get("/{invite}/chat")
async def get_chat(invite: str, conn: asyncpg.Connection = Depends(get_conn)) -> dict:
    session = await _session(conn, invite)
    return {
        "messages": [service.message_dict(m) for m in await service.history(conn, session.id)],
        "read_only": session.stale_at is not None,
    }


@router.delete("/{invite}/chat/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_chat_message(
    invite: str,
    message_id: int,
    user: User = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    session = await _session(conn, invite)
    hub = hub_module.peek_hub(session.id)
    if not await service.remove(conn, hub, session.id, message_id, user.sub):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
