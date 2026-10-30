"""The learning-session WebSocket (spec 006 plan.md "Contracts — WebSocket"): join, presence,
the cap of 5, step actions, chat. FR-7–FR-14a, FR-18–FR-21, FR-24, FR-26, FR-29, NFR-2, NFR-4.

Join mirrors the coding-session socket (`app.sessions.ws`): the same name rule, seat
reservation in `app.sessions.hub` (keyed by the learning session's UUID, so it never shares
a hub with a coding session) and close codes. Each step action goes to `service`, which
returns the committed events; they go to everyone, in order. A refusal goes to the sender
only, as `error {code}`. A malformed frame is ignored, as on the coding-session socket.
Chat (`chat_send`, `welcome.chat`) is the coding-session socket's: a chat refusal carries the
sender's `client_id` (and `limit` for `chat_too_long`) so the client can settle that send.
"""

import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import anyio
import asyncpg
from fastapi import APIRouter, WebSocket

from app.chat.rules import MAX_CHAT_CHARS, ChatError
from app.learn import chat, repo, service
from app.learn.service import LearnError
from app.sessions import hub as hub_module
from app.sessions.hub import SessionHub

router = APIRouter()

# The coding-session socket's close codes (`app.sessions.ws`), so clients treat both alike.
CLOSE_NOT_FOUND = 4404
CLOSE_FULL = 4403
CLOSE_STALE = 4410
CLOSE_INVALID_NAME = 4422

Action = Callable[[], Awaitable[list[dict]]]


def _valid_name(raw: str) -> str | None:
    """The coding-session name rule (FR-7): stripped, 1–30 characters."""
    name = raw.strip()
    return name if 1 <= len(name) <= 30 else None


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _action(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    name: str,
    base_path: str,
    payload: dict,
) -> Action | None:
    """The service call a client message asks for, or None if the message is malformed."""
    msg_type, step = payload.get("type"), payload.get("step")
    if not _is_int(step):
        return None
    if msg_type == "submit_choice":
        selected = payload.get("selected")
        if not isinstance(selected, list) or not all(_is_int(i) for i in selected):
            return None
        return lambda: service.submit_choice(
            conn, session_id, participant_id, name, step, selected, base_path=base_path
        )
    if msg_type == "submit_text":
        text = payload.get("text")
        if not isinstance(text, str):
            return None
        return lambda: service.submit_text(
            conn, session_id, participant_id, name, step, text, base_path=base_path
        )
    if msg_type == "submit_command":
        command = payload.get("command")
        if not isinstance(command, str):
            return None
        return lambda: service.submit_command(
            conn, session_id, participant_id, name, step, command, base_path=base_path
        )
    if msg_type == "continue":
        return lambda: service.continue_(
            conn, session_id, participant_id, name, step, base_path=base_path
        )
    if msg_type == "reveal_hint":
        return lambda: service.reveal_hint(
            conn, session_id, participant_id, step, base_path=base_path
        )
    if msg_type == "show_answer":
        return lambda: service.show_answer(conn, session_id, participant_id, step)
    return None


async def _handle_text(
    websocket: WebSocket,
    pool: asyncpg.Pool,
    session_id: uuid.UUID,
    hub: SessionHub,
    participant_id: uuid.UUID,
    name: str,
    base_path: str,
    text: str,
) -> None:
    try:
        payload = json.loads(text)
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    if payload.get("type") == "chat_send":
        client_id, body = payload.get("client_id"), payload.get("text")
        if not isinstance(client_id, str) or not isinstance(body, str):
            return
        async with pool.acquire() as conn:
            refused = await chat.send(conn, hub, session_id, participant_id, name, body, client_id)
        if refused is not None:
            error: dict = {"type": "error", "code": refused.value, "client_id": client_id}
            if refused is ChatError.TOO_LONG:
                error["limit"] = MAX_CHAT_CHARS
            await websocket.send_json(error)
        return
    async with pool.acquire() as conn:
        action = _action(conn, session_id, participant_id, name, base_path, payload)
        if action is None:
            return
        try:
            events = await action()
        except LearnError as refused:
            await websocket.send_json({"type": "error", "code": refused.code})
            return
    for event in events:
        await hub_module.broadcast(hub, event)


@router.websocket("/api/learn/sessions/{invite}/ws")
async def learn_ws(websocket: WebSocket, invite: str, name: str = "") -> None:
    await websocket.accept()
    pool = websocket.app.state.pool
    base_path = websocket.app.state.settings.base_path
    # A connection is borrowed per step (join, each message, leave), never held while the
    # socket idles: 3 sessions x 5 learners must fit the pool (NFR-3, AC-30).
    async with pool.acquire() as conn:
        session = await repo.get_session_by_invite(conn, invite)
        if session is None:
            await websocket.close(code=CLOSE_NOT_FOUND)
            return
        if session.stale_at is not None:
            await websocket.close(code=CLOSE_STALE)
            return
        valid_name = _valid_name(name)
        if valid_name is None:
            await websocket.close(code=CLOSE_INVALID_NAME)
            return
        session_hub = hub_module.get_hub(session.id)
        # Reserved before the awaits below, so concurrent joins can't all pass the cap (FR-8).
        if not session_hub.try_reserve():
            await websocket.close(code=CLOSE_FULL)
            return

        try:
            participant = await service.join(conn, session.id, valid_name)
        except LearnError:
            # Marked stale between the check above and the join.
            session_hub.release_reservation()
            await websocket.close(code=CLOSE_STALE)
            return
        except BaseException:
            session_hub.release_reservation()
            raise
        session_hub.add(hub_module.Connection(websocket, participant.id, valid_name))

    try:
        async with pool.acquire() as conn:
            # Re-read: the session may have moved on since the lookup above (FR-9).
            current = await repo.get_session_by_invite(conn, invite) or session
            welcome = {
                "type": "welcome",
                "you": {"participant_id": str(participant.id)},
                "record": await service.record(conn, current, base_path),
                "chat": [chat.message_dict(m) for m in await chat.history(conn, session.id)],
            }
        await websocket.send_json(welcome)
        await hub_module.broadcast(
            session_hub, {"type": "presence", "participants": session_hub.presence()}
        )

        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            text = message.get("text")
            if text is not None:
                await _handle_text(
                    websocket,
                    pool,
                    session.id,
                    session_hub,
                    participant.id,
                    valid_name,
                    base_path,
                    text,
                )
    finally:
        # Shielded, as on the coding-session socket: a cancelled scope must not cut this
        # off before the leave is recorded and presence is updated.
        with anyio.CancelScope(shield=True):
            session_hub.remove(participant.id)
            async with pool.acquire() as conn:
                await repo.leave_participant(conn, participant.id)
            await hub_module.broadcast(
                session_hub, {"type": "presence", "participants": session_hub.presence()}
            )
