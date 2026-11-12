"""The learning-session WebSocket (spec 006 plan.md "Contracts — WebSocket"): join, presence,
the cap of 5, step actions, chat. FR-7–FR-14a, FR-18–FR-21, FR-24, FR-26, FR-29, NFR-2, NFR-4.

Join mirrors the coding-session socket (`app.sessions.ws`): the same identity rule
(`app.accounts.identity`), seat reservation in `app.sessions.hub` (keyed by the learning
session's UUID, so it never shares a hub with a coding session) and close codes. Spec 012:
a signed-in join is the account's one participant in the session; a second device replaces
the first, which is closed `4409` (FR-1, FR-3, FR-5, FR-7, FR-14, NFR-2).

Each step action goes to `service`, which returns the committed events; they go to
everyone, in order. A refusal goes to the sender only, as `error {code}`. A malformed frame
is ignored, as on the coding-session socket.
Chat (`chat_send`, `welcome.chat`) is the coding-session socket's: a chat refusal carries the
sender's `client_id` (and `limit` for `chat_too_long`) so the client can settle that send.
"""

import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import anyio
import asyncpg
from fastapi import APIRouter, WebSocket

from app.accounts.identity import identity_for
from app.chat.rules import MAX_CHAT_CHARS, ChatError
from app.deletion import repo as deletion_repo
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
CLOSE_REPLACED = 4409
# Spec 019: the session was deleted from a profile. The same code chess uses.
CLOSE_DELETED = 4411

Action = Callable[[], Awaitable[list[dict]]]


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


async def close_deleted(session_id: uuid.UUID, by: Literal["host", "admin"]) -> None:
    """Spec 019 FR-7, after a deletion commits: tells everyone `session_deleted`, closes
    every socket 4411 and drops the hub. No hub (nobody connected) is a no-op."""
    hub = hub_module._hubs.pop(session_id, None)  # noqa: SLF001
    if hub is None:
        return
    await hub_module.broadcast(hub, {"type": "session_deleted", "by": by})
    connections = list(hub.connections.values())
    # Emptied first, so each socket's own handler finds nothing to leave (no DB write).
    hub.connections.clear()
    for connection in connections:
        try:
            await connection.websocket.close(code=CLOSE_DELETED)  # type: ignore[attr-defined]
        except Exception:  # noqa: S110  (already gone)
            pass


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
            deleted = await deletion_repo.is_tombstoned(conn, "learning", invite)
            await websocket.close(code=CLOSE_DELETED if deleted else CLOSE_NOT_FOUND)
            return
        if session.stale_at is not None:
            await websocket.close(code=CLOSE_STALE)
            return
        identity = identity_for(websocket.session, name)
        if identity is None:
            await websocket.close(code=CLOSE_INVALID_NAME)
            return
        session_hub = hub_module.get_hub(session.id)
        signed_in = identity.account_sub is not None
        replaced: hub_module.Connection | None = None
        if identity.account_sub is not None:
            async with conn.transaction():
                participant = await repo.join_as_account(
                    conn, session.id, identity.account_sub, identity.name
                )
                await repo.touch_activity(conn, session.id)
            # No await between the check and the add/replace, so the seat count holds (FR-7):
            # an account already connected takes no seat and its older socket is replaced.
            if participant.id in session_hub.connections:
                replaced = session_hub.replace(participant.id, websocket)
            elif session_hub.try_reserve():
                session_hub.add(
                    hub_module.Connection(websocket, participant.id, participant.display_name, True)
                )
            else:
                await repo.leave_participant(conn, participant.id)
                await websocket.close(code=CLOSE_FULL)
                return
        else:
            # Reserved before the awaits below, so concurrent joins can't all pass the cap (FR-8).
            if not session_hub.try_reserve():
                await websocket.close(code=CLOSE_FULL)
                return
            try:
                participant = await service.join(conn, session.id, identity.name)
            except LearnError:
                # Marked stale between the check above and the join.
                session_hub.release_reservation()
                await websocket.close(code=CLOSE_STALE)
                return
            except BaseException:
                session_hub.release_reservation()
                raise
            session_hub.add(hub_module.Connection(websocket, participant.id, identity.name))
    you_name = participant.display_name

    try:
        if replaced is not None:
            try:
                await replaced.websocket.close(code=CLOSE_REPLACED)  # type: ignore[attr-defined]
            except Exception:  # noqa: S110  (already gone)
                pass
        async with pool.acquire() as conn:
            # Re-read: the session may have moved on since the lookup above (FR-9).
            current = await repo.get_session_by_invite(conn, invite) or session
            welcome = {
                "type": "welcome",
                "you": {
                    "participant_id": str(participant.id),
                    "name": you_name,
                    "signed_in": signed_in,
                },
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
                    you_name,
                    base_path,
                    text,
                )
    finally:
        # Shielded, as on the coding-session socket: a cancelled scope must not cut this
        # off before the leave is recorded and presence is updated.
        with anyio.CancelScope(shield=True):
            # Only the participant's current socket leaves: a replaced one changes nothing.
            if session_hub.remove(participant.id, websocket):
                async with pool.acquire() as conn:
                    await repo.leave_participant(conn, participant.id)
                await hub_module.broadcast(
                    session_hub, {"type": "presence", "participants": session_hub.presence()}
                )
