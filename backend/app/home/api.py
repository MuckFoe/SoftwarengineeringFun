"""Spec 017 `GET /api/home` (plan.md "Contracts"). Neither account nor guest is `401`; the
account is the cookie's `sub`, never a parameter."""

import uuid
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from app.auth.deps import User, current_user
from app.home import service
from app.home.preview import may_open, preview
from app.present import hub as present_hub
from app.sessions import hub as session_hub
from app.sessions.api import get_conn

router = APIRouter(prefix="/api/home")

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]


def connected_now() -> dict[Any, list[service.Connected]]:
    """Session id -> its connected participants, across the coding/learning and the
    presentation hub registries (ids are unique across them)."""
    live: dict[Any, list[service.Connected]] = {}
    for registry in (session_hub._hubs, present_hub._hubs):  # noqa: SLF001
        for session_id, hub in registry.items():
            if hub.connections:
                live[session_id] = [
                    service.Connected(c.participant_id, c.name) for c in hub.connections.values()
                ]
    return live


async def viewer(request: Request, conn: Conn) -> tuple[User | None, service.Guest | None]:
    """The signed-in account, else the guest the `X-Rejoin-Token` header names; 401 for
    neither."""
    user = current_user(request)
    if user is not None:
        return user, None
    token = request.headers.get("x-rejoin-token")
    guest = await service.resolve_guest(conn, token) if token else None
    if guest is None:
        raise HTTPException(status_code=401)
    return None, guest


Viewer = Annotated[tuple[User | None, service.Guest | None], Depends(viewer)]


@router.get("")
async def home(who: Viewer, conn: Conn) -> dict[str, Any]:
    """FR-1, FR-3, FR-8, FR-10: the home snapshot; FR-11: reduced for a guest or invitee."""
    user, guest = who
    if user is None:
        assert guest is not None  # noqa: S101
        return await service.build_guest_home(conn, guest, connected_now())
    return await service.build_home(conn, user, connected_now())


@router.get("/preview/{session_id}")
async def session_preview(session_id: uuid.UUID, who: Viewer, conn: Conn) -> Response:
    """FR-4: the first lines of a visible session's code. 404 for a missing session and for
    one the account may not open alike; 204 when there is no code to show."""
    user, guest = who
    if not await may_open(conn, user, session_id, guest):
        raise HTTPException(status_code=404, detail="Not found")
    body = await preview(conn, user, session_id)
    if body is None:
        return Response(status_code=204)
    return JSONResponse(body)
