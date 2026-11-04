"""Learning-session chat (spec 006 plan.md: `chat.py`, `learning_chat_message`). FR-29, FR-27.

The rules and wire shapes are the coding-session chat's (spec 002): plain text, 1–2000
characters (`app.chat.rules`), `{id, sender_name, text, sent_at}`, order by id, removal hides a
row and never erases it. Every query is scoped by the learning session's id. A message is
broadcast only after its insert commits; a stale session refuses chat (`session_stale`).
Sending touches the session's activity. Completed sessions keep chat open (FR-26).
Spec 012 (FR-3, FR-8, NFR-2): every message read carries its `participant_id` and
`signed_in`, read by joining `learning_participant` (`account_sub is not null`).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import asyncpg

from app import clock
from app.chat.rules import ChatError, validate_body
from app.learn import repo
from app.sessions import hub as hub_module
from app.sessions.hub import SessionHub


@dataclass(frozen=True)
class ChatMessage:
    id: int
    sender_name: str
    text: str
    sent_at: datetime
    participant_id: uuid.UUID
    signed_in: bool  # the sender's participant belongs to an account; never client-supplied


_COLUMNS = """m.id, m.sender_name, m.body, m.sent_at, m.participant_id,
              p.account_sub is not null as signed_in"""


def _message(row: asyncpg.Record) -> ChatMessage:
    return ChatMessage(
        id=row["id"],
        sender_name=row["sender_name"],
        text=row["body"],
        sent_at=row["sent_at"],
        participant_id=row["participant_id"],
        signed_in=row["signed_in"],
    )


def message_dict(message: ChatMessage) -> dict:
    """The spec 002 wire shape: `{id, sender_name, text, sent_at}`, `sent_at` ISO-8601 UTC;
    spec 012 adds the sender's `participant_id` and `signed_in` (read server-side)."""
    return {
        "id": message.id,
        "sender_name": message.sender_name,
        "text": message.text,
        "sent_at": message.sent_at.astimezone(UTC).isoformat(),
        "participant_id": str(message.participant_id),
        "signed_in": message.signed_in,
    }


# --- repository ----------------------------------------------------------------------------


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
               insert into learning_chat_message
                   (session_id, participant_id, sender_name, body, sent_at)
               values ($1, $2, $3, $4, $5)
               returning *)
           select {_COLUMNS}
           from inserted m join learning_participant p on p.id = m.participant_id""",  # noqa: S608
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
        f"""select {_COLUMNS}
            from learning_chat_message m join learning_participant p on p.id = m.participant_id
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
        """update learning_chat_message set removed_at = $3, removed_by_sub = $4
           where id = $2 and session_id = $1 and removed_at is null""",
        session_id,
        message_id,
        clock.now(),
        admin_sub,
    )
    return status == "UPDATE 1"


async def _is_stale(conn: asyncpg.Connection, session_id: uuid.UUID) -> bool:
    """Re-read before each send: a session gone stale mid-connection refuses chat (FR-29)."""
    return bool(
        await conn.fetchval(
            "select stale_at is not null from learning_session where id = $1", session_id
        )
    )


# --- service -------------------------------------------------------------------------------


async def send(
    conn: asyncpg.Connection,
    hub: SessionHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    sender_name: str,
    text: str,
    client_id: str,
) -> ChatError | None:
    """Stores the message, touches activity, then broadcasts `chat_message` to everyone, the
    sender included. A refusal is returned for the caller to answer to the sender only."""
    if await _is_stale(conn, session_id):
        return ChatError.STALE
    refused = validate_body(text)
    if refused:
        return refused
    async with conn.transaction():
        message = await insert(conn, session_id, participant_id, sender_name, text, clock.now())
        await repo.touch_activity(conn, session_id)
    await hub_module.broadcast(
        hub, {"type": "chat_message", "message": message_dict(message), "client_id": client_id}
    )
    return None


async def remove(
    conn: asyncpg.Connection,
    hub: SessionHub | None,
    session_id: uuid.UUID,
    message_id: int,
    admin_sub: str,
) -> bool:
    """Hides the message, then sends `chat_removed` to whoever is connected (`hub` is None when
    no one is). False when the message isn't in this session or is already removed."""
    if not await mark_removed(conn, session_id, message_id, admin_sub):
        return False
    if hub is not None:
        await hub_module.broadcast(hub, {"type": "chat_removed", "id": message_id})
    return True
