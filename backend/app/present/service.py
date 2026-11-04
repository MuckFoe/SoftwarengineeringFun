"""Presentation service (spec 013 plan.md "Contracts", "Session lifetime"): library
operations, starting, joining and rejoining a session, and the host's place. FR-1, FR-4,
FR-5, FR-8, FR-9, FR-10, FR-11, FR-12, FR-14, FR-30.

Refusals are `PresentError`s whose `code` is what REST and the WebSocket report. Place
changes hold the session's `asyncio.Lock` (the hosting rules use the same lock). Nothing here
broadcasts; callers send the returned results to the hub.
"""

import asyncio
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from app.present import html_check, repo
from app.present.repo import Anchor, LibraryEntry, Participant, PresentSession

MAX_TITLE = 100  # FR-1
MAX_TOPIC = 60  # FR-1
MAX_NAME = 30  # FR-9: the coding-session name rule (spec 001)


class PresentError(Exception):
    """A refused operation; `code` is the error code sent to whoever asked."""

    code = "error"

    def __init__(self, code: str | None = None) -> None:
        if code is not None:
            self.code = code
        super().__init__(self.code)


class PresentationNotFound(PresentError):
    """No such presentation, or it was removed."""

    code = "not_found"


class SessionNotFound(PresentError):
    code = "not_found"


class NotHost(PresentError):
    code = "not_host"


class BadSlide(PresentError):
    code = "bad_slide"


class SessionStale(PresentError):
    code = "session_stale"


class Unavailable(PresentError):
    """The session's presentation was removed (FR-5)."""

    code = "presentation_unavailable"


@dataclass(frozen=True)
class Joined:
    participant: Participant
    token: str  # the rejoin token; only its SHA-256 is stored
    reused: bool


@dataclass(frozen=True)
class PlaceChange:
    slide: int | None
    anchor: Anchor | None
    slide_changed: bool


@dataclass(frozen=True)
class SessionState:
    """What a (re)opened session shows (FR-12, FR-30)."""

    session_id: uuid.UUID
    invite_id: str
    title: str
    topic: str
    kind: str
    slide_count: int
    available: bool
    stale: bool
    host_id: uuid.UUID | None
    host_name: str | None
    host_away_since: datetime | None
    slide: int | None
    anchor: Anchor | None


# --- library ----------------------------------------------------------------------------------


def _text(value: str, limit: int, code: str) -> str:
    stripped = value.strip()
    if not 1 <= len(stripped) <= limit:
        raise PresentError(code)
    return stripped


async def add_presentation(
    conn: asyncpg.Connection, *, title: str, topic: str, data: bytes, by_sub: str
) -> LibraryEntry:
    """FR-1. Raises `PresentError` (invalid_title/invalid_topic) or `html_check.Rejected`."""
    title = _text(title, MAX_TITLE, "invalid_title")
    topic = _text(topic, MAX_TOPIC, "invalid_topic")
    analysis = html_check.analyze(data)
    created = await repo.create_presentation(
        conn,
        title=title,
        topic=topic,
        html=analysis.html,
        kind=analysis.kind,
        slide_count=analysis.slide_count,
        created_by_sub=by_sub,
    )
    return LibraryEntry(created.id, title, topic, analysis.kind, analysis.slide_count)


async def replace_html(
    conn: asyncpg.Connection, presentation_id: uuid.UUID, *, data: bytes, by_sub: str
) -> LibraryEntry:
    """FR-4: a new current version; running sessions keep theirs."""
    analysis = html_check.analyze(data)
    version = await repo.add_version(
        conn,
        presentation_id,
        html=analysis.html,
        kind=analysis.kind,
        slide_count=analysis.slide_count,
        created_by_sub=by_sub,
    )
    presentation = await repo.get_presentation(conn, presentation_id)
    if version is None or presentation is None:
        raise PresentationNotFound()
    return LibraryEntry(
        presentation.id, presentation.title, presentation.topic, version.kind, version.slide_count
    )


async def remove_presentation(
    conn: asyncpg.Connection, presentation_id: uuid.UUID, *, by_sub: str
) -> list[PresentSession]:
    """FR-5: hidden from the library. Returns its sessions, whose live hubs the caller tells."""
    if not await repo.mark_removed(conn, presentation_id, by_sub):
        raise PresentationNotFound()
    return await repo.sessions_of_presentation(conn, presentation_id)


# --- sessions ---------------------------------------------------------------------------------


async def start_session(conn: asyncpg.Connection, presentation_id: uuid.UUID) -> PresentSession:
    """FR-8: on the current version, at slide 0 (slides) or the top (page, slide null)."""
    presentation = await repo.get_presentation(conn, presentation_id)
    if (
        presentation is None
        or presentation.removed_at is not None
        or presentation.current_version_id is None
    ):
        raise PresentationNotFound()
    version = await repo.get_version(conn, presentation.current_version_id)
    if version is None:
        raise PresentationNotFound()
    return await repo.create_session(
        conn, version.id, slide=0 if version.kind == "slides" else None
    )


async def _session(conn: asyncpg.Connection, session_id: uuid.UUID) -> PresentSession:
    invite_id = await conn.fetchval(
        "select invite_id from presentation_session where id = $1", session_id
    )
    session = None if invite_id is None else await repo.get_session_by_invite(conn, invite_id)
    if session is None:
        raise SessionNotFound()
    return session


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def valid_name(raw: str) -> str | None:
    name = raw.strip()
    return name if 1 <= len(name) <= MAX_NAME else None


async def join(
    conn: asyncpg.Connection, session_id: uuid.UUID, name: str, rejoin_token: str | None
) -> Joined:
    """FR-9. A token issued in this session reuses its participant (and its name, whatever
    `name` is); otherwise a new participant under a valid name, with a fresh token."""
    session = await _session(conn, session_id)
    if session.stale_at is not None:
        raise SessionStale()
    if rejoin_token:
        found = await repo.get_participant_by_token_hash(conn, session_id, _hash(rejoin_token))
        if found is not None:
            return Joined(found, rejoin_token, reused=True)
    clean = valid_name(name)
    if clean is None:
        raise PresentError("bad_name")
    token = secrets.token_urlsafe(32)
    participant = await repo.add_participant(conn, session_id, clean, _hash(token))
    return Joined(participant, token, reused=False)


_locks: dict[uuid.UUID, asyncio.Lock] = {}


def lock(session_id: uuid.UUID) -> asyncio.Lock:
    """The per-session lock for place and hosting changes."""
    found = _locks.get(session_id)
    if found is None:
        found = _locks[session_id] = asyncio.Lock()
    return found


async def _available(conn: asyncpg.Connection, version_id: uuid.UUID) -> bool:
    return bool(
        await conn.fetchval(
            """select p.removed_at is null from presentation_version v
               join presentation p on p.id = v.presentation_id where v.id = $1""",
            version_id,
        )
    )


async def set_place(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    slide: int | None,
    anchor: Anchor | None,
) -> PlaceChange:
    """FR-10, FR-11, FR-14, FR-30: the host's place, persisted (touches activity).
    Slides need 0 ≤ slide < slide_count; a page needs slide null."""
    async with lock(session_id):
        session = await _session(conn, session_id)
        if session.stale_at is not None:
            raise SessionStale()
        if not await _available(conn, session.version_id):
            raise Unavailable()
        if session.host_participant_id != participant_id:
            raise NotHost()
        version = await repo.get_version(conn, session.version_id)
        if version is None:
            raise Unavailable()
        if version.kind == "slides":
            in_range = (
                isinstance(slide, int)
                and not isinstance(slide, bool)
                and 0 <= slide < version.slide_count
            )
        else:
            in_range = slide is None
        if not in_range:
            raise BadSlide()
        await repo.set_place(conn, session_id, slide, anchor)
    return PlaceChange(slide, anchor, slide_changed=slide != session.slide)


async def session_state(conn: asyncpg.Connection, invite_id: str) -> SessionState:
    """FR-12, FR-30: the stored place, host and availability of the session behind `invite_id`.
    Shape and counts come from the session's own version (FR-4)."""
    session = await repo.get_session_by_invite(conn, invite_id)
    if session is None:
        raise SessionNotFound()
    row = await conn.fetchrow(
        """select p.title, p.topic, p.removed_at is null as available, v.kind, v.slide_count
           from presentation_version v join presentation p on p.id = v.presentation_id
           where v.id = $1""",
        session.version_id,
    )
    host_name = (
        None
        if session.host_participant_id is None
        else await conn.fetchval(
            "select display_name from presentation_participant where id = $1",
            session.host_participant_id,
        )
    )
    return SessionState(
        session_id=session.id,
        invite_id=session.invite_id,
        title=row["title"],
        topic=row["topic"],
        kind=row["kind"],
        slide_count=row["slide_count"],
        available=row["available"],
        stale=session.stale_at is not None,
        host_id=session.host_participant_id,
        host_name=host_name,
        host_away_since=session.host_away_since,
        slide=session.slide,
        anchor=session.anchor,
    )
