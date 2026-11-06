"""Chess REST (spec 014 plan.md "Contracts — REST"): start a session and the pre-join check.
FR-3, FR-32, FR-34. Live play travels over the WebSocket.
"""

from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.auth.deps import User, require_role
from app.games.chess import chat, repo, service, stale, ws
from app.games.chess.hub import ChessHub
from app.sessions.api import get_conn
from app.sessions.hub import MAX_PARTICIPANTS

router = APIRouter(prefix="/api/games/chess")

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]
Admin = Annotated[User, Depends(require_role("admin"))]
Reactivator = Annotated[User, Depends(require_role("admin"))]


class StartedOut(BaseModel):
    invite_id: str


class CheckOut(BaseModel):
    invite_id: str
    stale: bool
    full: bool


def _full(request: Request, session: repo.ChessSession) -> bool:
    """FR-32: whether a newcomer would be refused. Reads the session's live hub, if one is
    loaded (`app.state.chess_hubs`, filled by the socket); no hub means nobody is in it."""
    hubs: dict[object, ChessHub] = getattr(request.app.state, "chess_hubs", {})
    hub = hubs.get(session.id)
    if hub is None:
        return False
    non_seated = sum(1 for p in hub.connections if p not in hub.seated)
    return non_seated + len(hub.seated) + len(hub.reserved) >= MAX_PARTICIPANTS


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=StartedOut)
async def start_session(conn: Conn) -> StartedOut:
    """FR-3: anyone, signed in or not."""
    session = await service.create_session(conn)
    return StartedOut(invite_id=session.invite_id)


@router.get("/sessions/{invite}", response_model=CheckOut)
async def check_session(invite: str, request: Request, conn: Conn) -> CheckOut:
    session = await repo.get_session_by_invite(conn, invite)
    if session is None:
        if await repo.is_deleted_invite(conn, invite):
            raise HTTPException(status.HTTP_410_GONE, {"error": "session_deleted"})
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"error": "not_found"})
    return CheckOut(
        invite_id=session.invite_id,
        stale=session.stale_at is not None,
        full=_full(request, session),
    )


@router.post("/sessions/{invite}/reactivate")
async def reactivate_session(invite: str, conn: Conn, _: Reactivator) -> dict[str, object]:
    """FR-29: admin only; `404` unknown or deleted, `409 not_stale`."""
    try:
        await stale.reactivate(conn, invite)
    except stale.SessionNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"error": "not_found"}) from None
    except stale.SessionNotStale:
        raise HTTPException(status.HTTP_409_CONFLICT, {"error": "not_stale"}) from None
    return {"invite_id": invite, "stale": False}


async def _live_session(conn: asyncpg.Connection, invite: str) -> repo.ChessSession:
    session = await repo.get_session_by_invite(conn, invite)
    if session is None:
        if await repo.is_deleted_invite(conn, invite):
            raise HTTPException(status.HTTP_410_GONE, {"error": "session_deleted"})
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"error": "not_found"})
    return session


@router.get("/sessions/{invite}/chat")
async def get_chat(invite: str, conn: Conn) -> dict:
    """FR-30, FR-34: the history, also while stale; 404 unknown, 410 deleted."""
    session = await _live_session(conn, invite)
    return {"messages": [chat.message_dict(m) for m in await chat.history(conn, session.id)]}


@router.delete("/sessions/{invite}/chat/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_chat_message(
    invite: str, message_id: int, request: Request, conn: Conn, user: Admin
) -> Response:
    """FR-30: admin only; hides the message and sends `chat_removed` to everyone connected."""
    session = await _live_session(conn, invite)
    hubs: dict[object, ChessHub] = getattr(request.app.state, "chess_hubs", {})
    if not await chat.remove(conn, hubs.get(session.id), session.id, message_id, user.sub):
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"error": "not_found"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/sessions/{invite}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(invite: str, request: Request, conn: Conn, user: Admin) -> Response:
    """FR-35: an admin deletes any session; everyone connected is told and disconnected."""
    session = await repo.get_session_by_invite(conn, invite)
    if session is None:
        if await repo.is_deleted_invite(conn, invite):
            raise HTTPException(status.HTTP_410_GONE, {"error": "session_deleted"})
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"error": "not_found"})
    try:
        closed = await service.delete_session(
            conn, session.id, reason="admin", by_participant=None, by_sub=user.sub
        )
    except service.Refused:
        raise HTTPException(status.HTTP_410_GONE, {"error": "session_deleted"}) from None
    await ws.close_session(request.app, session.id, closed)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
