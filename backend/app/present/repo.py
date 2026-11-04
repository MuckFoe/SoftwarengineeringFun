"""Presentation repository (spec 013 plan.md "Data model"): presentations, their versions,
sessions and participants. FR-1, FR-4, FR-5, FR-6, FR-8, FR-9, FR-30.

Chat SQL lives in `present.chat`, stale-marking SQL in `present.stale`. Removing a
presentation sets `removed_at`; nothing here ever drops a row.
"""

import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

from app import clock

Anchor = dict[str, Any]  # {path: [int], fx: float, fy: float}, see plan "Content-relative place"


@dataclass(frozen=True)
class Presentation:
    id: uuid.UUID
    title: str
    topic: str
    current_version_id: uuid.UUID | None
    created_by_sub: str
    created_at: datetime
    removed_at: datetime | None
    removed_by_sub: str | None


@dataclass(frozen=True)
class LibraryEntry:
    """One library row (FR-6): the presentation with its current version's shape."""

    id: uuid.UUID
    title: str
    topic: str
    kind: str
    slide_count: int


@dataclass(frozen=True)
class Version:
    id: uuid.UUID
    presentation_id: uuid.UUID
    html: str
    kind: str
    slide_count: int
    created_by_sub: str
    created_at: datetime


@dataclass(frozen=True)
class PresentSession:
    id: uuid.UUID
    invite_id: str
    version_id: uuid.UUID
    slide: int | None
    anchor: Anchor | None
    host_participant_id: uuid.UUID | None
    host_away_since: datetime | None
    created_at: datetime
    last_activity_at: datetime
    stale_at: datetime | None


@dataclass(frozen=True)
class Participant:
    id: uuid.UUID
    session_id: uuid.UUID
    display_name: str
    joined_at: datetime
    left_at: datetime | None
    account_sub: str | None = None  # spec 012: set when the participant is an account's

    @property
    def signed_in(self) -> bool:
        return self.account_sub is not None


def _session(row: asyncpg.Record) -> PresentSession:
    values = dict(row)
    if values["anchor"] is not None:
        values["anchor"] = json.loads(values["anchor"])
    return PresentSession(**values)


# --- presentations and versions ------------------------------------------------------------


async def _insert_version(
    conn: asyncpg.Connection,
    presentation_id: uuid.UUID,
    html: str,
    kind: str,
    slide_count: int,
    created_by_sub: str,
) -> Version:
    row = await conn.fetchrow(
        """insert into presentation_version
                (presentation_id, html, kind, slide_count, created_by_sub, created_at)
            values ($1, $2, $3, $4, $5, $6)
            returning id, presentation_id, html, kind, slide_count, created_by_sub, created_at""",
        presentation_id,
        html,
        kind,
        slide_count,
        created_by_sub,
        clock.now(),
    )
    return Version(**dict(row))


async def create_presentation(
    conn: asyncpg.Connection,
    *,
    title: str,
    topic: str,
    html: str,
    kind: str,
    slide_count: int,
    created_by_sub: str,
) -> Presentation:
    """FR-1: the presentation and its first version, in one transaction."""
    async with conn.transaction():
        presentation_id = await conn.fetchval(
            """insert into presentation (title, topic, created_by_sub, created_at)
               values ($1, $2, $3, $4) returning id""",
            title,
            topic,
            created_by_sub,
            clock.now(),
        )
        version = await _insert_version(
            conn, presentation_id, html, kind, slide_count, created_by_sub
        )
        row = await conn.fetchrow(
            """update presentation set current_version_id = $2 where id = $1
                returning id, title, topic, current_version_id, created_by_sub, created_at,
                      removed_at, removed_by_sub""",
            presentation_id,
            version.id,
        )
    return Presentation(**dict(row))


async def add_version(
    conn: asyncpg.Connection,
    presentation_id: uuid.UUID,
    *,
    html: str,
    kind: str,
    slide_count: int,
    created_by_sub: str,
) -> Version | None:
    """FR-4: a new version that the presentation now points to. Sessions keep theirs.
    None when the presentation does not exist or was removed."""
    async with conn.transaction():
        found = await conn.fetchval(
            "select true from presentation where id = $1 and removed_at is null for update",
            presentation_id,
        )
        if not found:
            return None
        version = await _insert_version(
            conn, presentation_id, html, kind, slide_count, created_by_sub
        )
        await conn.execute(
            "update presentation set current_version_id = $2 where id = $1",
            presentation_id,
            version.id,
        )
    return version


async def mark_removed(conn: asyncpg.Connection, presentation_id: uuid.UUID, by_sub: str) -> bool:
    """FR-5: whether it was removed now (false when absent or already removed)."""
    removed = await conn.fetchval(
        """update presentation set removed_at = $2, removed_by_sub = $3
           where id = $1 and removed_at is null returning true""",
        presentation_id,
        clock.now(),
        by_sub,
    )
    return bool(removed)


async def list_presentations(conn: asyncpg.Connection) -> list[LibraryEntry]:
    """FR-6: presentations not removed, by title, each with its topic and current shape."""
    rows = await conn.fetch(
        """select p.id, p.title, p.topic, v.kind, v.slide_count
           from presentation p join presentation_version v on v.id = p.current_version_id
           where p.removed_at is null
           order by p.title, p.id"""
    )
    return [LibraryEntry(**dict(r)) for r in rows]


async def get_presentation(
    conn: asyncpg.Connection, presentation_id: uuid.UUID
) -> Presentation | None:
    """Removed presentations too (FR-5: their sessions still need them)."""
    row = await conn.fetchrow(
        """select id, title, topic, current_version_id, created_by_sub, created_at,
                  removed_at, removed_by_sub
           from presentation where id = $1""",
        presentation_id,
    )
    return Presentation(**dict(row)) if row else None


async def get_version(conn: asyncpg.Connection, version_id: uuid.UUID) -> Version | None:
    row = await conn.fetchrow(
        """select id, presentation_id, html, kind, slide_count, created_by_sub, created_at
           from presentation_version where id = $1""",
        version_id,
    )
    return Version(**dict(row)) if row else None


# --- sessions ---------------------------------------------------------------------------------


async def create_session(
    conn: asyncpg.Connection, version_id: uuid.UUID, *, slide: int | None
) -> PresentSession:
    """FR-8: no host yet (the starter becomes host on connect); a 128-bit invite id."""
    now = clock.now()
    row = await conn.fetchrow(
        """insert into presentation_session as s
                (invite_id, version_id, slide, created_at, last_activity_at)
            values ($1, $2, $3, $4, $4)
            returning s.id, s.invite_id, s.version_id, s.slide, s.anchor, s.host_participant_id,
                   s.host_away_since, s.created_at, s.last_activity_at, s.stale_at""",
        secrets.token_urlsafe(16),
        version_id,
        slide,
        now,
    )
    return _session(row)


async def get_session_by_invite(conn: asyncpg.Connection, invite_id: str) -> PresentSession | None:
    row = await conn.fetchrow(
        """select s.id, s.invite_id, s.version_id, s.slide, s.anchor, s.host_participant_id,
                  s.host_away_since, s.created_at, s.last_activity_at, s.stale_at
           from presentation_session s where s.invite_id = $1""",
        invite_id,
    )
    return _session(row) if row else None


async def sessions_of_presentation(
    conn: asyncpg.Connection, presentation_id: uuid.UUID
) -> list[PresentSession]:
    """Every session of any of the presentation's versions (FR-5 notifies their hubs)."""
    rows = await conn.fetch(
        """select s.id, s.invite_id, s.version_id, s.slide, s.anchor, s.host_participant_id,
                   s.host_away_since, s.created_at, s.last_activity_at, s.stale_at
            from presentation_session s join presentation_version v on v.id = s.version_id
            where v.presentation_id = $1
            order by s.created_at, s.id""",
        presentation_id,
    )
    return [_session(r) for r in rows]


async def set_place(
    conn: asyncpg.Connection, session_id: uuid.UUID, slide: int | None, anchor: Anchor | None
) -> None:
    """FR-30: the last place shown. A place change is activity, so it is touched too."""
    await conn.execute(
        """update presentation_session set slide = $2, anchor = $3::jsonb, last_activity_at = $4
           where id = $1""",
        session_id,
        slide,
        None if anchor is None else json.dumps(anchor),
        clock.now(),
    )


async def set_host(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID | None
) -> None:
    """A new (or returning) host is present, so `host_away_since` is cleared."""
    await conn.execute(
        """update presentation_session set host_participant_id = $2, host_away_since = null
           where id = $1""",
        session_id,
        participant_id,
    )


async def set_host_away(
    conn: asyncpg.Connection, session_id: uuid.UUID, since: datetime | None
) -> None:
    await conn.execute(
        "update presentation_session set host_away_since = $2 where id = $1",
        session_id,
        since,
    )


async def touch_activity(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    await conn.execute(
        "update presentation_session set last_activity_at = $2 where id = $1",
        session_id,
        clock.now(),
    )


# --- participants -------------------------------------------------------------------------------


async def add_participant(
    conn: asyncpg.Connection, session_id: uuid.UUID, display_name: str, token_hash: str
) -> Participant:
    """FR-9. `token_hash` is the SHA-256 hex of the rejoin token; the token is never stored."""
    row = await conn.fetchrow(
        """insert into presentation_participant
                (session_id, display_name, rejoin_token_hash, joined_at)
            values ($1, $2, $3, $4)
            returning id, session_id, display_name, joined_at, left_at, account_sub""",
        session_id,
        display_name,
        token_hash,
        clock.now(),
    )
    return Participant(**dict(row))


async def join_as_account(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    account_sub: str,
    name: str,
    token_hash: str,
) -> tuple[Participant, bool]:
    """Spec 012 FR-1, FR-5, FR-7, FR-14: the account's one participant in the session,
    and whether it already existed. Reuse clears `left_at` and `hidden_at` and rotates the
    rejoin token to `token_hash`, so the previous token no longer rejoins."""
    row = await conn.fetchrow(
        """insert into presentation_participant as p
                (session_id, display_name, rejoin_token_hash, joined_at, account_sub)
            values ($1, $2, $3, $4, $5)
            on conflict (account_sub, session_id) where account_sub is not null
            do update set left_at = null, hidden_at = null,
                          rejoin_token_hash = excluded.rejoin_token_hash
            returning p.id, p.session_id, p.display_name, p.joined_at, p.left_at,
                      p.account_sub, p.xmax <> 0 as reused""",
        session_id,
        name,
        token_hash,
        clock.now(),
        account_sub,
    )
    values = dict(row)
    reused = values.pop("reused")
    return Participant(**values), reused


async def get_participant_by_token_hash(
    conn: asyncpg.Connection, session_id: uuid.UUID, token_hash: str
) -> Participant | None:
    """Only within `session_id`: a token from another session does not rejoin this one."""
    row = await conn.fetchrow(
        """select id, session_id, display_name, joined_at, left_at, account_sub
            from presentation_participant where session_id = $1 and rejoin_token_hash = $2""",
        session_id,
        token_hash,
    )
    return Participant(**dict(row)) if row else None


async def leave_participant(conn: asyncpg.Connection, participant_id: uuid.UUID) -> None:
    await conn.execute(
        "update presentation_participant set left_at = $2 where id = $1",
        participant_id,
        clock.now(),
    )
