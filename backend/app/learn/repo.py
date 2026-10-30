"""Learn repository (spec 006 plan.md "Data model"): lessons, versions, assets, learning
sessions, participants, steps and attempts. FR-6, FR-11, FR-12, FR-13, FR-14a, FR-24, FR-25.

Chat SQL lives in `learn.chat`, stale-marking SQL in `learn.stale`. Writing lessons, versions
and assets is the loader's job. Nothing here ever deletes a row: there is no `DELETE`.
"""

import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

from app import clock


@dataclass(frozen=True)
class CatalogueLesson:
    key: str
    topic_key: str
    topic_title: str
    version_id: uuid.UUID
    content: dict[str, Any]


@dataclass(frozen=True)
class LessonVersion:
    id: uuid.UUID
    lesson_key: str
    content_hash: str
    content: dict[str, Any]
    created_at: datetime


@dataclass(frozen=True)
class Asset:
    sha256: str
    media_type: str
    data: bytes


@dataclass(frozen=True)
class LearningSession:
    id: uuid.UUID
    invite_id: str
    lesson_version_id: uuid.UUID
    current_step: int
    completed_at: datetime | None
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


@dataclass(frozen=True)
class Step:
    session_id: uuid.UUID
    position: int
    hint_revealed_at: datetime | None
    answer_revealed_at: datetime | None
    passed_at: datetime | None
    passed_by_name: str | None
    passed_by: uuid.UUID | None


@dataclass(frozen=True)
class Attempt:
    id: int
    session_id: uuid.UUID
    position: int
    participant_id: uuid.UUID
    actor_name: str
    kind: str
    submitted: Any  # list of option numbers, or the exact text typed
    correct: bool
    output: str | None
    created_at: datetime


def _session(row: asyncpg.Record) -> LearningSession:
    return LearningSession(**dict(row))


def _participant(row: asyncpg.Record) -> Participant:
    return Participant(**dict(row))


def _step(row: asyncpg.Record) -> Step:
    return Step(**dict(row))


def _attempt(row: asyncpg.Record) -> Attempt:
    values = dict(row)
    values["submitted"] = json.loads(values["submitted"])
    return Attempt(**values)


# --- catalogue, versions, assets ------------------------------------------------------


async def list_current_lessons(conn: asyncpg.Connection) -> list[CatalogueLesson]:
    """FR-2: lessons that have a current version, with their topic, in key order."""
    rows = await conn.fetch(
        """select l.key, l.topic_key, l.topic_title, v.id as version_id, v.content
           from lesson l join lesson_version v on v.id = l.current_version_id
           order by l.topic_key, l.key"""
    )
    return [
        CatalogueLesson(
            key=r["key"],
            topic_key=r["topic_key"],
            topic_title=r["topic_title"],
            version_id=r["version_id"],
            content=json.loads(r["content"]),
        )
        for r in rows
    ]


async def get_version(conn: asyncpg.Connection, version_id: uuid.UUID) -> LessonVersion | None:
    row = await conn.fetchrow(
        """select id, lesson_key, content_hash, content, created_at
           from lesson_version where id = $1""",
        version_id,
    )
    if row is None:
        return None
    values = dict(row)
    values["content"] = json.loads(values["content"])
    return LessonVersion(**values)


async def get_asset(conn: asyncpg.Connection, sha256: str) -> Asset | None:
    row = await conn.fetchrow(
        "select sha256, media_type, data from lesson_asset where sha256 = $1", sha256
    )
    return Asset(**dict(row)) if row else None


# --- sessions ---------------------------------------------------------------------------


async def create_session(conn: asyncpg.Connection, lesson_version_id: uuid.UUID) -> LearningSession:
    """FR-6: at the first step; a 128-bit invite id (`secrets.token_urlsafe(16)`)."""
    now = clock.now()
    row = await conn.fetchrow(
        """insert into learning_session
                (invite_id, lesson_version_id, created_at, last_activity_at)
            values ($1, $2, $3, $3)
            returning id, invite_id, lesson_version_id, current_step, completed_at, created_at,
                      last_activity_at, stale_at""",
        secrets.token_urlsafe(16),
        lesson_version_id,
        now,
    )
    return _session(row)


async def get_session_by_invite(conn: asyncpg.Connection, invite_id: str) -> LearningSession | None:
    row = await conn.fetchrow(
        """select id, invite_id, lesson_version_id, current_step, completed_at, created_at,
                  last_activity_at, stale_at
           from learning_session where invite_id = $1""",
        invite_id,
    )
    return _session(row) if row else None


async def touch_activity(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    await conn.execute(
        "update learning_session set last_activity_at = $2 where id = $1",
        session_id,
        clock.now(),
    )


async def pass_and_advance(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    step: int,
    participant_id: uuid.UUID,
    participant_name: str,
) -> bool:
    """FR-11: advance `current_step` past `step` only if it is still `step`, and record who
    passed it. Returns whether it advanced; when it didn't, nothing is changed (race rule in
    plan.md "Service flow"). Call inside the caller's transaction."""
    advanced = await conn.fetchval(
        """update learning_session set current_step = $2 + 1
           where id = $1 and current_step = $2 and completed_at is null
           returning true""",
        session_id,
        step,
    )
    if not advanced:
        return False
    await conn.execute(
        """insert into learning_step (session_id, position, passed_at, passed_by_name, passed_by)
           values ($1, $2, $3, $4, $5)
           on conflict (session_id, position) do update
           set passed_at = excluded.passed_at,
               passed_by_name = excluded.passed_by_name,
               passed_by = excluded.passed_by""",
        session_id,
        step,
        clock.now(),
        participant_name,
        participant_id,
    )
    return True


async def set_completed(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    """FR-24: records the first completion only."""
    await conn.execute(
        "update learning_session set completed_at = $2 where id = $1 and completed_at is null",
        session_id,
        clock.now(),
    )


# --- participants -------------------------------------------------------------------------


async def add_participant(
    conn: asyncpg.Connection, session_id: uuid.UUID, display_name: str
) -> Participant:
    row = await conn.fetchrow(
        """insert into learning_participant (session_id, display_name, joined_at)
            values ($1, $2, $3)
            returning id, session_id, display_name, joined_at, left_at""",
        session_id,
        display_name,
        clock.now(),
    )
    return _participant(row)


async def leave_participant(conn: asyncpg.Connection, participant_id: uuid.UUID) -> None:
    await conn.execute(
        "update learning_participant set left_at = $2 where id = $1",
        participant_id,
        clock.now(),
    )


async def list_participants(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[Participant]:
    rows = await conn.fetch(
        """select id, session_id, display_name, joined_at, left_at from learning_participant
            where session_id = $1 order by joined_at, id""",
        session_id,
    )
    return [_participant(r) for r in rows]


# --- steps -----------------------------------------------------------------------------------


async def ensure_step(conn: asyncpg.Connection, session_id: uuid.UUID, position: int) -> Step:
    """The step's row, created if it has none yet."""
    await conn.execute(
        """insert into learning_step (session_id, position) values ($1, $2)
           on conflict (session_id, position) do nothing""",
        session_id,
        position,
    )
    row = await conn.fetchrow(
        """select session_id, position, hint_revealed_at, answer_revealed_at, passed_at,
                  passed_by_name, passed_by
           from learning_step where session_id = $1 and position = $2""",
        session_id,
        position,
    )
    return _step(row)


async def get_step(conn: asyncpg.Connection, session_id: uuid.UUID, position: int) -> Step | None:
    row = await conn.fetchrow(
        """select session_id, position, hint_revealed_at, answer_revealed_at, passed_at,
                  passed_by_name, passed_by
           from learning_step where session_id = $1 and position = $2""",
        session_id,
        position,
    )
    return _step(row) if row else None


async def list_steps(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[Step]:
    rows = await conn.fetch(
        """select session_id, position, hint_revealed_at, answer_revealed_at, passed_at,
                  passed_by_name, passed_by
           from learning_step where session_id = $1 order by position""",
        session_id,
    )
    return [_step(r) for r in rows]


async def reveal_hint(conn: asyncpg.Connection, session_id: uuid.UUID, position: int) -> None:
    """FR-13: records the first reveal only."""
    await conn.execute(
        """update learning_step set hint_revealed_at = $3
           where session_id = $1 and position = $2 and hint_revealed_at is null""",
        session_id,
        position,
        clock.now(),
    )


async def reveal_answer(conn: asyncpg.Connection, session_id: uuid.UUID, position: int) -> None:
    """FR-14a: records the first reveal only."""
    await conn.execute(
        """update learning_step set answer_revealed_at = $3
           where session_id = $1 and position = $2 and answer_revealed_at is null""",
        session_id,
        position,
        clock.now(),
    )


# --- attempts ------------------------------------------------------------------------------


async def add_attempt(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    position: int,
    participant_id: uuid.UUID,
    actor_name: str,
    kind: str,
    submitted: Any,
    *,
    correct: bool,
    output: str | None = None,
) -> Attempt:
    """FR-12: `submitted` is a list of option numbers or the exact text typed."""
    row = await conn.fetchrow(
        """insert into learning_attempt
                (session_id, position, participant_id, actor_name, kind, submitted, correct,
                 output, created_at)
            values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
            returning id, session_id, position, participant_id, actor_name, kind, submitted,
                      correct, output, created_at""",
        session_id,
        position,
        participant_id,
        actor_name,
        kind,
        json.dumps(submitted),
        correct,
        output,
        clock.now(),
    )
    return _attempt(row)


async def list_attempts(
    conn: asyncpg.Connection, session_id: uuid.UUID, position: int | None = None
) -> list[Attempt]:
    """A step's attempts in order, or the whole session's (by step, then order) for FR-24."""
    rows = await conn.fetch(
        """select id, session_id, position, participant_id, actor_name, kind, submitted,
                  correct, output, created_at
           from learning_attempt
            where session_id = $1 and ($2::int is null or position = $2)
            order by position, id""",
        session_id,
        position,
    )
    return [_attempt(r) for r in rows]


async def count_wrong_attempts(
    conn: asyncpg.Connection, session_id: uuid.UUID, position: int
) -> int:
    """FR-14a: incorrect attempts on this step only."""
    return await conn.fetchval(
        """select count(*) from learning_attempt
           where session_id = $1 and position = $2 and not correct""",
        session_id,
        position,
    )
