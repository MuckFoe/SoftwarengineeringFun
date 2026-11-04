"""Presentation-session chat, text and GIF (spec 013 plan.md "Chat"). FR-32.

The coding-session chat's rules and wire shapes (spec 002 `app.chat.rules`, spec 007 GIF
messages): `ChatMessage` from `app.chat.repo`, serialised by `app.chat.service.message_dict`.
Rows live in `presentation_chat_message`; every query is scoped by the presentation
session's id. A message is broadcast only after its insert commits; removal hides a row and
never erases it. A stale session refuses sending (`session_stale`), its history stays
readable. Sending is activity, touched at most once a minute (plan "Session lifetime").
GIF search and resolving a posted GIF (`app.gifs.service`) belong to the socket.
Spec 012 (FR-3, FR-8, NFR-2): every message read carries its `participant_id` and
`signed_in`, read by joining `presentation_participant` (`account_sub is not null`).
"""

import uuid
from datetime import datetime, timedelta

import asyncpg

from app import clock
from app.chat.repo import ChatMessage
from app.chat.rules import ChatError, validate_body
from app.chat.service import message_dict
from app.gifs.models import GifRef
from app.present import repo
from app.present.hub import PresentHub

ACTIVITY_TOUCH_INTERVAL = timedelta(minutes=1)

_COLUMNS = """m.id, m.sender_name, m.body, m.sent_at, m.participant_id, m.kind, m.gif_id,
              m.gif_title, m.gif_url, m.gif_still_url, m.gif_width, m.gif_height,
              p.account_sub is not null as signed_in"""

# An insert's returned row, joined to its participant for `signed_in`.
_INSERTED = f"""select {_COLUMNS}
                from inserted m join presentation_participant p on p.id = m.participant_id"""  # noqa: S608


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
                insert into presentation_chat_message
                    (session_id, participant_id, sender_name, body, sent_at)
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
    """A reference to the GIF, never its bytes (spec 007 FR-12); sent now by `clock`."""
    row = await conn.fetchrow(
        f"""with inserted as (
                insert into presentation_chat_message
                    (session_id, participant_id, sender_name, sent_at, kind, gif_id, gif_title,
                     gif_url, gif_still_url, gif_width, gif_height)
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
            from presentation_chat_message m
                join presentation_participant p on p.id = m.participant_id
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
        """update presentation_chat_message set removed_at = $3, removed_by_sub = $4
           where id = $2 and session_id = $1 and removed_at is null""",
        session_id,
        message_id,
        clock.now(),
        admin_sub,
    )
    return status == "UPDATE 1"


async def _is_stale(conn: asyncpg.Connection, session_id: uuid.UUID) -> bool:
    """Re-read before each send: a session gone stale mid-connection refuses chat (FR-31)."""
    return bool(
        await conn.fetchval(
            "select stale_at is not null from presentation_session where id = $1", session_id
        )
    )


# --- service -------------------------------------------------------------------------------


async def _broadcast(hub: PresentHub, message: dict) -> None:
    for connection in list(hub.connections.values()):
        try:
            await connection.websocket.send_json(message)
        except Exception:  # noqa: S110  (a dead socket is cleaned up by its own handler)
            pass


async def touch_activity(conn: asyncpg.Connection, hub: PresentHub, session_id: uuid.UUID) -> None:
    now = clock.now()
    last = hub.last_activity_touch
    if last is not None and now - last < ACTIVITY_TOUCH_INTERVAL:
        return
    await repo.touch_activity(conn, session_id)
    hub.last_activity_touch = now


async def _deliver(hub: PresentHub, message: ChatMessage, client_id: str) -> None:
    await _broadcast(
        hub, {"type": "chat_message", "message": message_dict(message), "client_id": client_id}
    )


async def send(
    conn: asyncpg.Connection,
    hub: PresentHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    sender_name: str,
    text: str,
    client_id: str,
) -> ChatError | None:
    """Stores the message, then broadcasts `chat_message` to everyone, the sender included.
    A refusal is returned for the caller to answer to the sender only."""
    if await _is_stale(conn, session_id):
        return ChatError.STALE
    refused = validate_body(text)
    if refused:
        return refused
    async with conn.transaction():
        message = await insert(conn, session_id, participant_id, sender_name, text, clock.now())
        await touch_activity(conn, hub, session_id)
    await _deliver(hub, message, client_id)
    return None


async def send_gif(
    conn: asyncpg.Connection,
    hub: PresentHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    sender_name: str,
    gif: GifRef,
    client_id: str,
) -> ChatError | None:
    """As `send`, for a GIF reference the socket already resolved (spec 007 FR-3, FR-8)."""
    if await _is_stale(conn, session_id):
        return ChatError.STALE
    async with conn.transaction():
        message = await insert_gif(conn, session_id, participant_id, sender_name, gif)
        await touch_activity(conn, hub, session_id)
    await _deliver(hub, message, client_id)
    return None


async def remove(
    conn: asyncpg.Connection,
    hub: PresentHub | None,
    session_id: uuid.UUID,
    message_id: int,
    admin_sub: str,
) -> bool:
    """Hides the message, then sends `chat_removed` to whoever is connected (`hub` is None
    when no one is). False when the message isn't in this session or is already removed."""
    if not await mark_removed(conn, session_id, message_id, admin_sub):
        return False
    if hub is not None:
        await _broadcast(hub, {"type": "chat_removed", "id": message_id})
    return True


__all__ = [
    "ChatMessage",
    "history",
    "insert",
    "insert_gif",
    "mark_removed",
    "message_dict",
    "remove",
    "send",
    "send_gif",
    "touch_activity",
]
