"""Chat service (spec 002 plan, Chat): validate, persist, then broadcast.

FR10–FR18. A message is broadcast only after its insert commits, so anything a participant
sees is durable. The order is the message id; clients sort by it.
"""

import uuid
from datetime import UTC

import asyncpg

from app import clock
from app.chat import repo
from app.chat.repo import ChatMessage
from app.chat.rules import ChatError, validate_body
from app.sessions import hub as hub_module
from app.sessions.hub import SessionHub


def message_dict(message: ChatMessage) -> dict:
    """The wire shape: `{id, sender_name, text, sent_at}`, `sent_at` ISO-8601 UTC."""
    return {
        "id": message.id,
        "sender_name": message.sender_name,
        "text": message.text,
        "sent_at": message.sent_at.astimezone(UTC).isoformat(),
    }


async def send(
    conn: asyncpg.Connection,
    hub: SessionHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    sender_name: str,
    text: str,
    client_id: str,
) -> ChatError | None:
    """Stores and broadcasts the message to everyone in the session, the sender included.
    A refusal is returned for the caller to answer to the sender only."""
    if await repo.session_is_stale(conn, session_id):
        return ChatError.STALE
    refused = validate_body(text)
    if refused:
        return refused
    message = await repo.insert(conn, session_id, participant_id, sender_name, text, clock.now())
    await hub_module.broadcast(
        hub, {"type": "chat_message", "message": message_dict(message), "client_id": client_id}
    )
    return None


async def history(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[ChatMessage]:
    return await repo.history(conn, session_id)


async def remove(
    conn: asyncpg.Connection,
    hub: SessionHub | None,
    session_id: uuid.UUID,
    message_id: int,
    admin_sub: str,
) -> bool:
    """FR19: hides the message, then tells whoever is connected (`hub` is None when no one
    is). False when the message isn't in this session or is already removed."""
    if not await repo.mark_removed(conn, session_id, message_id, admin_sub):
        return False
    if hub is not None:
        await hub_module.broadcast(hub, {"type": "chat_removed", "id": message_id})
    return True
