"""Chat service (spec 002 plan, Chat): validate, persist, then broadcast.

FR10–FR18. A message is broadcast only after its insert commits, so anything a participant
sees is durable. The order is the message id; clients sort by it.
"""

import uuid
from dataclasses import asdict
from datetime import UTC

import asyncpg

from app import clock
from app.chat import repo
from app.chat.repo import ChatMessage
from app.chat.rules import ChatError, validate_body
from app.gifs.models import GifRef
from app.sessions import hub as hub_module
from app.sessions.hub import SessionHub


def message_dict(message: ChatMessage) -> dict:
    """The wire shape (spec 007 plan, Contracts): `{id, sender_name, sent_at, kind}` plus
    `text` for a text message or `gif` (a GifResult) for a GIF; `sent_at` ISO-8601 UTC.
    Spec 012: plus the sender's `participant_id` and `signed_in` (read server-side)."""
    wire: dict = {
        "id": message.id,
        "sender_name": message.sender_name,
        "sent_at": message.sent_at.astimezone(UTC).isoformat(),
        "kind": message.kind,
        "participant_id": str(message.participant_id),
        "signed_in": message.signed_in,
    }
    if message.kind == "gif" and message.gif is not None:
        wire["gif"] = asdict(message.gif)
    else:
        wire["text"] = message.text
    return wire


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


async def send_gif(
    conn: asyncpg.Connection,
    hub: SessionHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    sender_name: str,
    gif: GifRef,
    client_id: str,
) -> ChatError | None:
    """Spec 007 FR-3, FR-4, FR-8: as `send`, for an already-resolved GIF reference. The
    row is stored (with server time) before the `chat_message` frame goes to everyone."""
    if await repo.session_is_stale(conn, session_id):
        return ChatError.STALE
    message = await repo.insert_gif(conn, session_id, participant_id, sender_name, gif)
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
