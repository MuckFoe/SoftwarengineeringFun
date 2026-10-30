"""Learn REST (spec 006 plan.md "Contracts — REST"): topics, starting a session, a session's
state and record, lesson assets. FR-2, FR-4, FR-6, FR-26, FR-27.

Every route here only reads lessons (FR-4): lessons, versions and assets are written by the
startup loader alone. The stale list, reactivation and chat removal are admin-only. The chat
history (task 29, FR-29) is what a stale session, which refuses the WebSocket, shows read-only;
live chat travels over the WebSocket.
"""

from datetime import datetime
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.auth.deps import User, current_user, require_role
from app.learn import chat, repo, service, stale
from app.sessions import hub as hub_module
from app.sessions.api import get_conn

router = APIRouter(prefix="/api/learn")

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]

ASSET_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
    "Content-Disposition": "inline",
    "Cache-Control": "public, max-age=31536000, immutable",
}


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"})


@router.get("/topics")
async def list_topics(conn: Conn) -> list[dict[str, Any]]:
    """FR-2: current lessons grouped by topic, in folder order."""
    topics: dict[str, dict[str, Any]] = {}
    for lesson in await repo.list_current_lessons(conn):
        topic = topics.setdefault(
            lesson.topic_key,
            {"key": lesson.topic_key, "title": lesson.topic_title, "lessons": []},
        )
        topic["lessons"].append(
            {
                "key": lesson.key,
                "title": lesson.content["title"],
                "summary": lesson.content["summary"],
                "step_count": len(lesson.content["steps"]),
                "minutes": lesson.content["minutes"],
            }
        )
    return list(topics.values())


class StartIn(BaseModel):
    lesson_key: str


class StartedOut(BaseModel):
    invite_id: str


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=StartedOut)
async def start_session(body: StartIn, conn: Conn) -> StartedOut:
    """FR-6: anyone, the same rule as `POST /api/sessions`."""
    try:
        session = await service.create_session(conn, body.lesson_key)
    except service.LessonNotFound as exc:
        raise _not_found() from exc
    return StartedOut(invite_id=session.invite_id)


class StaleSessionOut(BaseModel):
    invite_id: str
    lesson_title: str
    stale_at: datetime
    last_activity_at: datetime


# Declared before GET /sessions/{invite} so "stale" is never taken for an invite id.
@router.get("/sessions/stale", response_model=list[StaleSessionOut])
async def list_stale_sessions(
    conn: Conn, user: User = Depends(require_role("admin"))
) -> list[StaleSessionOut]:
    """FR-27: the admin list of stale learning sessions, separate from coding sessions'."""
    return [StaleSessionOut(**vars(r)) for r in await stale.list_stale(conn)]


@router.post("/sessions/{invite}/reactivate")
async def reactivate_session(
    invite: str, conn: Conn, user: User = Depends(require_role("admin"))
) -> dict[str, Any]:
    """FR-27: admin only; `409 not_stale`, `404`."""
    try:
        await stale.reactivate(conn, invite)
    except stale.SessionNotFound as exc:
        raise _not_found() from exc
    except stale.SessionNotStale as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"error": "not_stale"}
        ) from exc
    return {}


async def _session(conn: asyncpg.Connection, invite: str) -> repo.LearningSession:
    session = await repo.get_session_by_invite(conn, invite)
    if session is None:
        raise _not_found()
    return session


@router.get("/sessions/{invite}")
async def get_session(invite: str, request: Request, conn: Conn) -> dict[str, str]:
    """FR-27: a stale session is 423 with whether this caller (an admin) may reactivate it."""
    session = await _session(conn, invite)
    if session.stale_at is not None:
        user = current_user(request)
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={"error": "stale", "can_reactivate": user is not None and "admin" in user.roles},
        )
    return {"state": "completed" if session.completed_at is not None else "active"}


@router.get("/sessions/{invite}/record")
async def get_record(invite: str, request: Request, conn: Conn) -> dict[str, Any]:
    """FR-26, FR-27: the read-only view, stale or not. No hidden answers (AC-13)."""
    session = await _session(conn, invite)
    return await service.record(conn, session, request.app.state.settings.base_path)


@router.get("/sessions/{invite}/chat")
async def get_chat(invite: str, conn: Conn) -> dict[str, Any]:
    """FR-29: spec 002's `{messages, read_only}`; read-only once the session is stale."""
    session = await _session(conn, invite)
    return {
        "messages": [chat.message_dict(m) for m in await chat.history(conn, session.id)],
        "read_only": session.stale_at is not None,
    }


@router.delete("/sessions/{invite}/chat/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_chat_message(
    invite: str, message_id: int, conn: Conn, user: User = Depends(require_role("admin"))
) -> Response:
    """FR-29: admin only; hides the message and sends `chat_removed` to everyone connected."""
    session = await _session(conn, invite)
    hub = hub_module.peek_hub(session.id)
    if not await chat.remove(conn, hub, session.id, message_id, user.sub):
        raise _not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/assets/{sha256}")
async def get_asset(sha256: str, conn: Conn) -> Response:
    asset = await repo.get_asset(conn, sha256)
    if asset is None:
        raise _not_found()
    return Response(content=asset.data, media_type=asset.media_type, headers=ASSET_HEADERS)
