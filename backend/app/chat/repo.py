"""Chat repository (spec 002 plan, Data model: `chat_message`).

FR11, FR12 (order is the bigserial id, the order the server received messages), FR17
(every query is scoped by session id), FR19 (removal hides a row, never erases it).
Spec 007: a message is text or a GIF reference (`kind`); GIF rows hold no body (FR-12).
Spec 012 (FR-3, FR-8, NFR-2): every message read carries its `participant_id` and
`signed_in`, read by joining the participant table (`account_sub is not null`).
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from app import clock
from app.gifs.models import GifRef


@dataclass(frozen=True)
class ChatMessage:
    id: int
    sender_name: str
    text: str | None  # None for a GIF message
    sent_at: datetime
    participant_id: uuid.UUID
    signed_in: bool  # the sender's participant belongs to an account; never client-supplied
    kind: str = "text"  # 'text' | 'gif'
    gif: GifRef | None = None  # set when kind == 'gif'


_COLUMNS = """m.id, m.sender_name, m.body, m.sent_at, m.participant_id, m.kind, m.gif_id,
              m.gif_title, m.gif_url, m.gif_still_url, m.gif_width, m.gif_height,
              p.account_sub is not null as signed_in"""

# An insert's returned row, joined to its participant for `signed_in`.
_INSERTED = f"""select {_COLUMNS}
                from inserted m join participant p on p.id = m.participant_id"""  # noqa: S608


def _message(row: asyncpg.Record) -> ChatMessage:
    gif = None
    if row["kind"] == "gif":
        gif = GifRef(
            id=row["gif_id"],
            title=row["gif_title"],
            url=row["gif_url"],
            still_url=row["gif_still_url"],
            width=row["gif_width"],
            height=row["gif_height"],
        )
    return ChatMessage(
        id=row["id"],
        sender_name=row["sender_name"],
        text=row["body"],
        sent_at=row["sent_at"],
        participant_id=row["participant_id"],
        signed_in=row["signed_in"],
        kind=row["kind"],
        gif=gif,
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
        f"""with inserted as (
               insert into chat_message (session_id, participant_id, sender_name, body, sent_at)
               values ($1, $2, $3, $4, $5)
               returning *)
           {_INSERTED}""",  # noqa: S608  (constant column list)
        session_id,
        participant_id,
        sender_name,
        body,
        sent_at,
    )
    return _message(row)


async def insert_gif(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    sender_name: str,
    gif: GifRef,
) -> ChatMessage:
    """Store a reference to the GIF, never its bytes (spec 007 FR-12); sent now by `clock`."""
    row = await conn.fetchrow(
        f"""with inserted as (
               insert into chat_message (session_id, participant_id, sender_name, sent_at, kind,
                                         gif_id, gif_title, gif_url, gif_still_url, gif_width,
                                         gif_height)
               values ($1, $2, $3, $4, 'gif', $5, $6, $7, $8, $9, $10)
               returning *)
           {_INSERTED}""",  # noqa: S608  (constant column list)
        session_id,
        participant_id,
        sender_name,
        clock.now(),
        gif.id,
        gif.title,
        gif.url,
        gif.still_url,
        gif.width,
        gif.height,
    )
    return _message(row)


async def history(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[ChatMessage]:
    """The session's messages that haven't been removed, in id order."""
    rows = await conn.fetch(
        f"""select {_COLUMNS}
            from chat_message m join participant p on p.id = m.participant_id
            where m.session_id = $1 and m.removed_at is null
            order by m.id""",  # noqa: S608  (constant column list)
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
