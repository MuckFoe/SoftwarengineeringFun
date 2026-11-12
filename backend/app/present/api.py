"""Presentation REST (spec 013 plan.md "Contracts — REST"). FR-1–FR-7.

Library: list (anyone), analyze/add/replace/remove (editors). Uploads are the raw request
body — a file's bytes or pasted markup sent as a UTF-8 string — read in chunks and cut off
one byte past the limit, as in the images API. Errors are `{error: code, ...}`.

Sessions (FR-4, FR-5, FR-8, FR-17, FR-30–FR-32): start (anyone), state, the frame document
with `FRAME_HEADERS`, the chat history a stale session shows read-only, and the admin-only
chat removal and reactivation. Live place, drawing and chat travel over the WebSocket;
removing a presentation tells its live sessions through it.
"""

import uuid
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.auth.deps import User, current_user, require_role
from app.present import chat, hosting, html_check, repo, service, stale
from app.present.frame import FRAME_HEADERS, build_frame
from app.present.hub import peek_hub
from app.present.repo import LibraryEntry, PresentSession, list_presentations
from app.present.ws import broadcast
from app.sessions.api import get_conn, missing_invite

router = APIRouter(prefix="/api/present")

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]
Editor = Annotated[User, Depends(require_role("editor"))]
Admin = Annotated[User, Depends(require_role("admin"))]


class AnalysisOut(BaseModel):
    kind: str
    slide_count: int


class PresentationOut(BaseModel):
    id: uuid.UUID
    title: str
    topic: str
    kind: str
    slide_count: int


def _out(entry: LibraryEntry) -> PresentationOut:
    return PresentationOut(
        id=entry.id,
        title=entry.title,
        topic=entry.topic,
        kind=entry.kind,
        slide_count=entry.slide_count,
    )


def _refuse(code: int, error: str, **extra: object) -> HTTPException:
    return HTTPException(status_code=code, detail={"error": error, **extra})


def _not_found() -> HTTPException:
    return _refuse(status.HTTP_404_NOT_FOUND, "not_found")


def _rejected(exc: html_check.Rejected) -> HTTPException:
    if exc.code == "too_large":
        return _refuse(
            status.HTTP_413_CONTENT_TOO_LARGE, "too_large", limit_bytes=html_check.MAX_BYTES
        )
    return _refuse(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.code)


async def _read_body(request: Request) -> bytes:
    """The body, or 413 once it exceeds the size limit (the rest is never read). FR-3, NFR-4."""
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > html_check.MAX_BYTES:
            raise _rejected(html_check.Rejected("too_large"))
    return bytes(data)


@router.get("/presentations", response_model=list[PresentationOut])
async def list_library(conn: Conn) -> list[PresentationOut]:
    """FR-6: not removed, by title, with topic and shape."""
    return [_out(entry) for entry in await list_presentations(conn)]


@router.post("/analyze", response_model=AnalysisOut)
async def analyze(request: Request, _: Editor) -> AnalysisOut:
    """FR-2: slides (and how many) or a single page, before saving. Saves nothing."""
    data = await _read_body(request)
    try:
        analysis = html_check.analyze(data)
    except html_check.Rejected as exc:
        raise _rejected(exc) from None
    return AnalysisOut(kind=analysis.kind, slide_count=analysis.slide_count)


@router.post("/presentations", status_code=status.HTTP_201_CREATED, response_model=PresentationOut)
async def add(
    request: Request, user: Editor, conn: Conn, title: str = "", topic: str = ""
) -> PresentationOut:
    """FR-1, FR-3: a missing title or topic is refused like an empty one."""
    data = await _read_body(request)
    try:
        entry = await service.add_presentation(
            conn, title=title, topic=topic, data=data, by_sub=user.sub
        )
    except html_check.Rejected as exc:
        raise _rejected(exc) from None
    except service.PresentError as exc:
        raise _refuse(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.code) from None
    return _out(entry)


@router.put("/presentations/{presentation_id}/html", response_model=PresentationOut)
async def replace(
    presentation_id: uuid.UUID, request: Request, user: Editor, conn: Conn
) -> PresentationOut:
    """FR-4: a new current version; running sessions keep theirs."""
    data = await _read_body(request)
    try:
        entry = await service.replace_html(conn, presentation_id, data=data, by_sub=user.sub)
    except html_check.Rejected as exc:
        raise _rejected(exc) from None
    except service.PresentationNotFound:
        raise _not_found() from None
    return _out(entry)


@router.delete("/presentations/{presentation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(presentation_id: uuid.UUID, user: Editor, conn: Conn) -> Response:
    """FR-5: hidden from the library; its live sessions get `presentation_removed`."""
    try:
        sessions = await service.remove_presentation(conn, presentation_id, by_sub=user.sub)
    except service.PresentationNotFound:
        raise _not_found() from None
    for session in sessions:
        hub = peek_hub(session.id)
        if hub is not None:
            await broadcast(hub, {"type": "presentation_removed"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- sessions ---------------------------------------------------------------------------------


class StartIn(BaseModel):
    presentation_id: uuid.UUID


class StartedOut(BaseModel):
    invite_id: str


async def _session(conn: asyncpg.Connection, invite: str) -> PresentSession:
    session = await repo.get_session_by_invite(conn, invite)
    if session is None:
        raise _not_found()
    return session


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=StartedOut)
async def start_session(body: StartIn, conn: Conn) -> StartedOut:
    """FR-8: anyone, as `POST /api/sessions`; on the current version, at its start."""
    try:
        session = await service.start_session(conn, body.presentation_id)
    except service.PresentationNotFound:
        raise _not_found() from None
    return StartedOut(invite_id=session.invite_id)


@router.get("/sessions/{invite}")
async def get_session(invite: str, request: Request, conn: Conn) -> dict[str, Any]:
    """FR-4, FR-5, FR-12, FR-30, FR-31: shape from the session's own version, availability,
    stale (and whether this caller, an admin, may reactivate it), host (and whether the host is
    signed in, spec 012 FR-8) and stored place. Spec 019 FR-8: a deleted session's invite is
    410 session_deleted."""
    try:
        state = await service.session_state(conn, invite)
    except service.SessionNotFound:
        raise await missing_invite(conn, "presentation", invite) from None
    user = current_user(request)
    return {
        "title": state.title,
        "topic": state.topic,
        "kind": state.kind,
        "slide_count": state.slide_count,
        "available": state.available,
        "stale": state.stale,
        "can_reactivate": state.stale and user is not None and "admin" in user.roles,
        "host_name": state.host_name,
        "host_signed_in": state.host_id is not None
        and await hosting.host_signed_in(conn, state.host_id),
        "place": {"slide": state.slide, "anchor": state.anchor},
    }


@router.get("/sessions/{invite}/frame")
async def get_frame(invite: str, conn: Conn) -> Response:
    """FR-4, FR-17, NFR-2: the session's version, bridge injected, served sandboxed
    (`FRAME_HEADERS`). 410 once the presentation is removed (FR-5)."""
    session = await _session(conn, invite)
    version = await repo.get_version(conn, session.version_id)
    presentation = (
        None if version is None else await repo.get_presentation(conn, version.presentation_id)
    )
    if version is None or presentation is None:
        raise _not_found()
    if presentation.removed_at is not None:
        raise _refuse(status.HTTP_410_GONE, "presentation_removed")
    return HTMLResponse(
        build_frame(version.html, version.kind, session.slide), headers=FRAME_HEADERS
    )


@router.get("/sessions/{invite}/chat")
async def get_chat(invite: str, conn: Conn) -> dict[str, Any]:
    """FR-32: spec 002's `{messages, read_only}`; read-only once the session is stale."""
    session = await _session(conn, invite)
    return {
        "messages": [chat.message_dict(m) for m in await chat.history(conn, session.id)],
        "read_only": session.stale_at is not None,
    }


@router.delete("/sessions/{invite}/chat/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_chat_message(invite: str, message_id: int, conn: Conn, user: Admin) -> Response:
    """FR-32: admin only; hides the message and sends `chat_removed` to everyone connected."""
    session = await _session(conn, invite)
    if not await chat.remove(conn, peek_hub(session.id), session.id, message_id, user.sub):
        raise _not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/{invite}/reactivate")
async def reactivate_session(invite: str, conn: Conn, _: Admin) -> dict[str, Any]:
    """FR-31: admin only; `409 not_stale`, `404`."""
    try:
        await stale.reactivate(conn, invite)
    except stale.SessionNotFound:
        raise _not_found() from None
    except stale.SessionNotStale:
        raise _refuse(status.HTTP_409_CONFLICT, "not_stale") from None
    return {}
