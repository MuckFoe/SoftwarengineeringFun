"""Chat repository (spec 002 plan, Data model: `chat_message`).

FR11, FR12 (order is the bigserial id, the order the server received messages), FR17
(every query is scoped by session id), FR19 (removal hides a row, never erases it).
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from app import clock


@dataclass(frozen=True)
class ChatMessage:
    id: int
    sender_name: str
    text: str
    sent_at: datetime


def _message(row: asyncpg.Record) -> ChatMessage:
    return ChatMessage(
        id=row["id"], sender_name=row["sender_name"], text=row["body"], sent_at=row["sent_at"]
    )


async def insert(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    sender_name: str,
    body: str,
    sent_at: datetime,
) -> ChatMessage:
    row = await conn.fetchrow(
        """insert into chat_message (session_id, participant_id, sender_name, body, sent_at)
           values ($1, $2, $3, $4, $5)
           returning id, sender_name, body, sent_at""",
        session_id,
        participant_id,
        sender_name,
        body,
        sent_at,
    )
    return _message(row)


async def history(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[ChatMessage]:
    """The session's messages that haven't been removed, in id order."""
    rows = await conn.fetch(
        """select id, sender_name, body, sent_at from chat_message
           where session_id = $1 and removed_at is null
           order by id""",
        session_id,
    )
    return [_message(r) for r in rows]


async def mark_removed(
    conn: asyncpg.Connection, session_id: uuid.UUID, message_id: int, admin_sub: str
) -> bool:
    """False when the message isn't in this session or is already removed."""
    status = await conn.execute(
        """update chat_message set removed_at = $3, removed_by_sub = $4
           where id = $2 and session_id = $1 and removed_at is null""",
        session_id,
        message_id,
        clock.now(),
        admin_sub,
    )
    return status == "UPDATE 1"


async def session_is_stale(conn: asyncpg.Connection, session_id: uuid.UUID) -> bool:
    """Re-read before each send, so a session gone stale mid-connection refuses chat (FR16)."""
    return await conn.fetchval("select stale_at is not null from session where id = $1", session_id)
