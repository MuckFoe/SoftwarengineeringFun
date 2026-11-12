"""The presentation WebSocket (spec 013 plan.md "Contracts — WebSocket", "Hosting",
"Following", "Session lifetime"). FR-5, FR-8–FR-16, FR-25–FR-31.

Join mirrors the other session sockets (`app.learn.ws`): the same close codes, a seat
reserved in the session's `PresentHub` before the participant is added, and a pooled
connection borrowed per step (join, each message, leave), never held while the socket idles.
A valid `rejoin` token reuses its participant (FR-16, FR-28); if that participant is still
connected, its older socket is closed with 4409 and the newer one takes its place.

Each client frame type has a handler in `HANDLERS`; drawing (FR-19–FR-24) and chat (FR-32)
are here. Refusals go to the sender only, as `error {code}`. Malformed frames are ignored.

Chat and GIFs (FR-32) are exactly the coding-session socket's (`app.sessions.ws`, specs 002
and 007): `chat_send` answers a refusal with its `client_id`; `gif_search` and
`chat_send_gif` each run as their own task (a slow GIPHY never blocks the socket), drained
on shutdown by `drain_gif_tasks` from `main.lifespan`; search answers the sender only.

Hosting: `hosting` decides, this module broadcasts `host` and runs one host timer per hub,
which calls `promote_if_due` once the grace (`settings.present_host_grace_seconds`) after
the host went away has passed.
"""

import asyncio
import contextlib
import dataclasses
import json
import logging
import math
import secrets
import uuid
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

import anyio
import asyncpg
from fastapi import APIRouter, WebSocket

from app import clock
from app.accounts.identity import identity_for
from app.chat.rules import MAX_CHAT_CHARS, ChatError
from app.deletion import repo as deletion_repo
from app.gifs import service as gif_service
from app.present import chat, hosting, repo, service
from app.present import hub as hub_module
from app.present.hosting import HostEvent
from app.present.hub import DrawingFull, PresentHub, drop_if_empty, get_hub
from app.present.service import PresentError

log = logging.getLogger(__name__)

router = APIRouter()

# The other session sockets' close codes, so clients treat all alike.
CLOSE_NOT_FOUND = 4404
CLOSE_FULL = 4403
CLOSE_STALE = 4410
CLOSE_INVALID_NAME = 4422
CLOSE_REPLACED = 4409
# Spec 019: the session was deleted from a profile. The same code chess uses.
CLOSE_DELETED = 4411

# `asyncio.sleep` and the wall clock may disagree by a hair; wake just after the grace.
TIMER_SLACK = 0.01

# A client-chosen stroke id longer than this is malformed.
MAX_STROKE_ID_LENGTH = 64

# Each GIF call to GIPHY is its own task, so a slow one never blocks the socket (007 NFR-4).
_GIF_TASKS: set[asyncio.Task] = set()


async def drain_gif_tasks() -> None:
    """Waits for in-flight GIF calls; called on shutdown before the GIPHY client closes."""
    await asyncio.gather(*_GIF_TASKS, return_exceptions=True)


def _spawn_gif_task(coro: Coroutine[None, None, None]) -> None:
    task = asyncio.create_task(coro)
    _GIF_TASKS.add(task)
    task.add_done_callback(_GIF_TASKS.discard)


async def broadcast(hub: PresentHub, message: dict, *, exclude: uuid.UUID | None = None) -> None:
    """Sends to every live connection of the hub but `exclude`."""
    for participant_id, connection in list(hub.connections.items()):
        if participant_id == exclude:
            continue
        try:
            await connection.websocket.send_json(message)
        except Exception:  # noqa: S110  (a dead socket is cleaned up by its own handler)
            pass


async def close_deleted(session_id: uuid.UUID, by: Literal["host", "admin"]) -> None:
    """Spec 019 FR-7, after a deletion commits: tells everyone `session_deleted`, closes
    every socket 4411 and drops the hub with its host timer and drawings. No hub (nobody
    connected) is a no-op."""
    hub = hub_module._hubs.pop(session_id, None)  # noqa: SLF001
    if hub is None:
        return
    hub.cancel_host_timer()
    await broadcast(hub, {"type": "session_deleted", "by": by})
    connections = list(hub.connections.values())
    # Emptied first, so each socket's own handler finds nothing to leave (no DB write).
    hub.connections.clear()
    hub.strokes.clear()
    for connection in connections:
        try:
            await connection.websocket.close(code=CLOSE_DELETED)  # type: ignore[attr-defined]
        except Exception:  # noqa: S110  (already gone)
            pass


def _host_message(event: HostEvent) -> dict:
    return {
        "type": "host",
        "host": {
            "id": str(event.host_id),
            "name": event.host_name,
            "away": event.away,
            "signed_in": event.host_signed_in,
        },
        "reason": event.reason,
    }


async def _presence(hub: PresentHub) -> None:
    await broadcast(hub, {"type": "presence", "participants": hub.presence()})


# --- host timer -------------------------------------------------------------------------------


async def _host_timer(
    pool: asyncpg.Pool, hub: PresentHub, session_id: uuid.UUID, delay: float, grace: float
) -> None:
    try:
        await asyncio.sleep(max(delay, 0.0) + TIMER_SLACK)
        async with pool.acquire() as conn:
            event = await hosting.promote_if_due(conn, hub, session_id, clock.now(), grace)
        if event is not None:
            await broadcast(hub, _host_message(event))
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("present host timer failed for session %s", session_id)
    finally:
        if hub.host_timer is asyncio.current_task():
            hub.host_timer = None


def _start_host_timer(
    pool: asyncpg.Pool,
    hub: PresentHub,
    session_id: uuid.UUID,
    away_since: datetime,
    grace: float,
) -> None:
    """Schedules the promotion for when the host has been away `grace` seconds, unless a
    timer is pending already or nobody is connected to be promoted."""
    if hub.host_timer is not None or not hub.connections:
        return
    delay = grace - (clock.now() - away_since).total_seconds()
    hub.host_timer = asyncio.create_task(_host_timer(pool, hub, session_id, delay, grace))


# --- client frames ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Context:
    """One live connection, as the frame handlers see it."""

    websocket: WebSocket
    pool: asyncpg.Pool
    hub: PresentHub
    session_id: uuid.UUID
    participant_id: uuid.UUID
    name: str
    grace: float

    async def refuse(self, code: str, **extra: Any) -> None:
        await self.websocket.send_json({"type": "error", "code": code, **extra})


Handler = Callable[[Context, dict], Awaitable[None]]


def _anchor(value: Any) -> tuple[bool, dict | None]:
    """(ok, anchor): an anchor is an object or null."""
    if value is None or isinstance(value, dict):
        return True, value
    return False, None


async def _session_flags(
    conn: asyncpg.Connection, session_id: uuid.UUID
) -> tuple[uuid.UUID | None, bool]:
    row = await conn.fetchrow(
        "select host_participant_id, stale_at is not null as stale "
        "from presentation_session where id = $1",
        session_id,
    )
    return (None, True) if row is None else (row["host_participant_id"], row["stale"])


async def _on_place(ctx: Context, payload: dict) -> None:
    """FR-10, FR-11, FR-14: the host's place, to everyone (the host too, so every client
    clears its strokes alike); a slide change clears the live drawings (FR-21)."""
    ok, anchor = _anchor(payload.get("anchor"))
    if not ok or "slide" not in payload:
        return
    try:
        async with ctx.pool.acquire() as conn:
            change = await service.set_place(
                conn, ctx.session_id, ctx.participant_id, payload["slide"], anchor
            )
    except PresentError as refused:
        await ctx.refuse(refused.code)
        return
    await broadcast(ctx.hub, {"type": "place", "slide": change.slide, "anchor": change.anchor})
    if change.slide_changed:
        ctx.hub.clear()
        await broadcast(ctx.hub, {"type": "drawings_cleared"})


async def _on_pointer(ctx: Context, payload: dict) -> None:
    """FR-15: the host's pointer, to everyone else. Anyone else's is dropped."""
    ok, anchor = _anchor(payload.get("anchor"))
    if not ok:
        return
    async with ctx.pool.acquire() as conn:
        host_id, stale = await _session_flags(conn, ctx.session_id)
    if stale:
        await ctx.refuse("session_stale")
        return
    if host_id != ctx.participant_id:
        return
    await broadcast(ctx.hub, {"type": "pointer", "anchor": anchor}, exclude=ctx.participant_id)


async def _on_hand_over(ctx: Context, payload: dict) -> None:
    """FR-25: the host passes hosting to a connected participant."""
    try:
        to_id = uuid.UUID(str(payload.get("participant_id")))
    except ValueError:
        return
    try:
        async with ctx.pool.acquire() as conn:
            _, stale = await _session_flags(conn, ctx.session_id)
            if stale:
                raise service.SessionStale()
            event = await hosting.hand_over(
                conn, ctx.hub, ctx.session_id, ctx.participant_id, to_id
            )
    except PresentError as refused:
        await ctx.refuse(refused.code)
        return
    await broadcast(ctx.hub, _host_message(event))


# --- drawing (FR-19–FR-24, NFR-3) --------------------------------------------------------------


def _points(value: Any) -> list[list[float]] | None:
    """A list of [x, y] finite numbers, or None if malformed."""
    if not isinstance(value, list):
        return None
    points = []
    for point in value:
        if not isinstance(point, list) or len(point) != 2:
            return None
        if not all(
            isinstance(n, int | float) and not isinstance(n, bool) and math.isfinite(n)
            for n in point
        ):
            return None
        points.append([float(point[0]), float(point[1])])
    return points


def _stroke_id(value: Any) -> str | None:
    if isinstance(value, str) and 0 < len(value) <= MAX_STROKE_ID_LENGTH:
        return value
    return None


async def _drawing_allowed(ctx: Context, *, touch: bool) -> bool:
    """Refuses drawing in a stale session (FR-31); a drawing action counts as activity,
    touched at most once a minute through the same throttle as chat."""
    async with ctx.pool.acquire() as conn:
        _, stale = await _session_flags(conn, ctx.session_id)
        if not stale and touch:
            await chat.touch_activity(conn, ctx.hub, ctx.session_id)
    if stale:
        await ctx.refuse("session_stale")
    return not stale


async def _on_stroke_start(ctx: Context, payload: dict) -> None:
    """FR-20: a new stroke, in the drawer's colour, to everyone else. The server sets
    `participant_id` and `color`; a duplicate id is ignored."""
    stroke_id = _stroke_id(payload.get("id"))
    ok, anchor = _anchor(payload.get("anchor"))
    points = _points(payload.get("points"))
    if stroke_id is None or not ok or points is None or stroke_id in ctx.hub.strokes:
        return
    if not await _drawing_allowed(ctx, touch=True):
        return
    try:
        stroke = ctx.hub.start(stroke_id, ctx.participant_id, anchor, points)
    except DrawingFull:
        await ctx.refuse("drawing_full")
        return
    except KeyError:
        await ctx.refuse("not_connected")
        return
    await broadcast(
        ctx.hub, {"type": "stroke_start", "stroke": stroke.to_dict()}, exclude=ctx.participant_id
    )


async def _on_stroke_points(ctx: Context, payload: dict) -> None:
    """FR-20: more points of the drawer's own stroke, relayed at once to everyone else.
    Someone else's or an unknown stroke is ignored."""
    stroke_id = _stroke_id(payload.get("id"))
    points = _points(payload.get("points"))
    if stroke_id is None or not points:
        return
    stroke = ctx.hub.strokes.get(stroke_id)
    if stroke is None or stroke.participant_id != ctx.participant_id:
        return
    if not await _drawing_allowed(ctx, touch=False):
        return
    try:
        if not ctx.hub.append(ctx.participant_id, stroke_id, points):
            return
    except DrawingFull:
        await ctx.refuse("drawing_full")
        return
    await broadcast(
        ctx.hub,
        {"type": "stroke_points", "id": stroke_id, "points": points},
        exclude=ctx.participant_id,
    )


async def _on_clear_drawings(ctx: Context, payload: dict) -> None:
    """FR-22: anyone clears all drawings, for everyone (the sender too)."""
    if not await _drawing_allowed(ctx, touch=True):
        return
    ctx.hub.clear()
    await broadcast(ctx.hub, {"type": "drawings_cleared"})


# --- chat and GIFs (FR-32; specs 002, 007) ------------------------------------------------------


async def _on_chat_send(ctx: Context, payload: dict) -> None:
    """Stored, then broadcast to everyone by `chat.send`; a refusal to the sender only."""
    client_id, body = payload.get("client_id"), payload.get("text")
    if not isinstance(client_id, str) or not isinstance(body, str):
        return
    async with ctx.pool.acquire() as conn:
        refused = await chat.send(
            conn, ctx.hub, ctx.session_id, ctx.participant_id, ctx.name, body, client_id
        )
    if refused is not None:
        extra: dict[str, Any] = {"client_id": client_id}
        if refused is ChatError.TOO_LONG:
            extra["limit"] = MAX_CHAT_CHARS
        await ctx.refuse(refused.value, **extra)


async def _gif_search(ctx: Context, request_id: str, q: str) -> None:
    """Answers the sender only. Keyed by (session, name), as on the coding-session socket."""
    state = ctx.websocket.app.state
    first, second = await gif_service.search(
        state.giphy, state.gif_search_limiter, (ctx.session_id, ctx.name), q
    )
    if isinstance(first, gif_service.GifError):
        reply: dict = {"type": "error", "code": first.value, "request_id": request_id}
        if second is not None:
            reply["retry_after"] = second
    else:
        reply = {
            "type": "gif_results",
            "request_id": request_id,
            "trending": first,
            "results": [dataclasses.asdict(gif) for gif in second],
        }
    # The sender may have left while GIPHY answered; there is no one to tell then.
    with contextlib.suppress(Exception):
        await ctx.websocket.send_json(reply)


async def _gif_post(ctx: Context, client_id: str, gif_id: str) -> None:
    """Every stored field comes from the server's own lookup of `gif_id`; errors to the
    sender only, success broadcast by `chat.send_gif`."""
    state = ctx.websocket.app.state
    resolved = await gif_service.resolve_for_post(
        state.giphy, state.gif_post_limiter, (ctx.session_id, ctx.name), gif_id
    )
    error: dict | None = None
    if isinstance(resolved, tuple):
        code, retry_after = resolved
        error = {"type": "error", "code": code.value, "client_id": client_id}
        if retry_after is not None:
            error["retry_after"] = retry_after
    else:
        async with ctx.pool.acquire() as conn:
            refused = await chat.send_gif(
                conn, ctx.hub, ctx.session_id, ctx.participant_id, ctx.name, resolved, client_id
            )
        if refused is not None:
            error = {"type": "error", "code": refused.value, "client_id": client_id}
    if error is not None:
        with contextlib.suppress(Exception):
            await ctx.websocket.send_json(error)


async def _on_gif_search(ctx: Context, payload: dict) -> None:
    request_id, q = payload.get("request_id"), payload.get("q")
    if not isinstance(request_id, str) or not isinstance(q, str):
        return
    _spawn_gif_task(_gif_search(ctx, request_id, q))


async def _on_chat_send_gif(ctx: Context, payload: dict) -> None:
    client_id, gif_id = payload.get("client_id"), payload.get("gif_id")
    if not isinstance(client_id, str) or not isinstance(gif_id, str):
        return
    _spawn_gif_task(_gif_post(ctx, client_id, gif_id))


HANDLERS: dict[str, Handler] = {
    "place": _on_place,
    "pointer": _on_pointer,
    "hand_over": _on_hand_over,
    "stroke_start": _on_stroke_start,
    "stroke_points": _on_stroke_points,
    "clear_drawings": _on_clear_drawings,
    "chat_send": _on_chat_send,
    "chat_send_gif": _on_chat_send_gif,
    "gif_search": _on_gif_search,
}


async def _handle_text(ctx: Context, text: str) -> None:
    try:
        payload = json.loads(text)
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    handler = HANDLERS.get(payload.get("type"))  # type: ignore[arg-type]
    if handler is not None:
        await handler(ctx, payload)


# --- join, welcome, leave ---------------------------------------------------------------------


async def _welcome(
    conn: asyncpg.Connection, invite: str, hub: PresentHub, joined: service.Joined
) -> dict:
    state = await service.session_state(conn, invite)
    host = (
        None
        if state.host_id is None
        else {
            "id": str(state.host_id),
            "name": state.host_name,
            "away": state.host_away_since is not None,
            "signed_in": await hosting.host_signed_in(conn, state.host_id),
        }
    )
    return {
        "type": "welcome",
        "you": {
            "participant_id": str(joined.participant.id),
            "rejoin_token": joined.token,
            "name": joined.participant.display_name,
            "signed_in": joined.participant.signed_in,
        },
        "available": state.available,
        "kind": state.kind,
        "slide_count": state.slide_count,
        "host": host,
        "place": {"slide": state.slide, "anchor": state.anchor},
        "participants": hub.presence(),
        "strokes": hub.stroke_dicts(),
        "chat": [
            chat.message_dict(m) for m in await chat.history(conn, joined.participant.session_id)
        ],
    }


async def _join(
    conn: asyncpg.Connection, websocket: WebSocket, session_id: uuid.UUID, name: str, rejoin: str
) -> service.Joined:
    """Spec 012: signed in, the account's participant (the name and any token are ignored,
    NFR-2), its rejoin token rotated; signed out, the token-or-name rule (FR-6). Either way
    the join is activity (FR-2's ordering)."""
    identity = identity_for(websocket.session, name)
    if identity is not None and identity.account_sub is not None:
        token = secrets.token_urlsafe(32)
        participant, reused = await repo.join_as_account(
            conn, session_id, identity.account_sub, identity.name, service._hash(token)
        )
        joined = service.Joined(participant, token, reused=reused)
    else:
        joined = await service.join(conn, session_id, name, rejoin or None)
    await repo.touch_activity(conn, session_id)
    return joined


@router.websocket("/api/present/sessions/{invite}/ws")
async def present_ws(websocket: WebSocket, invite: str, name: str = "", rejoin: str = "") -> None:
    await websocket.accept()
    pool = websocket.app.state.pool
    grace = websocket.app.state.settings.present_host_grace_seconds
    replaced = None
    event: HostEvent | None = None

    async with pool.acquire() as conn:
        session = await repo.get_session_by_invite(conn, invite)
        if session is None:
            deleted = await deletion_repo.is_tombstoned(conn, "presentation", invite)
            await websocket.close(code=CLOSE_DELETED if deleted else CLOSE_NOT_FOUND)
            return
        if session.stale_at is not None:
            await websocket.close(code=CLOSE_STALE)
            return
        try:
            joined = await _join(conn, websocket, session.id, name, rejoin)
        except service.SessionStale:
            await websocket.close(code=CLOSE_STALE)
            return
        except PresentError:
            await websocket.close(code=CLOSE_INVALID_NAME)
            return
        participant = joined.participant
        hub = get_hub(session.id)
        # No await between the seat check and taking it, so concurrent joins can't all
        # pass the cap; a participant still connected takes no seat and is replaced.
        if not hub.try_reserve(participant.id):
            if not joined.reused:
                await repo.leave_participant(conn, participant.id)
            drop_if_empty(session.id)
            await websocket.close(code=CLOSE_FULL)
            return
        if participant.id in hub.connections:
            replaced = hub.replace(participant.id, websocket)
        else:
            hub.add(
                participant.id,
                websocket,
                participant.display_name,
                clock.now(),
                signed_in=participant.signed_in,
            )
        try:
            if replaced is None:
                event = await hosting.on_connect(
                    conn, hub, session.id, participant.id, clock.now(), grace=grace
                )
            welcome = await _welcome(conn, invite, hub, joined)
            away_since = await conn.fetchval(
                "select host_away_since from presentation_session where id = $1", session.id
            )
        except BaseException:
            hub.remove(participant.id, websocket)
            drop_if_empty(session.id)
            raise

    ctx = Context(websocket, pool, hub, session.id, participant.id, participant.display_name, grace)
    try:
        if replaced is not None:
            try:
                await replaced.websocket.close(code=CLOSE_REPLACED)  # type: ignore[attr-defined]
            except Exception:  # noqa: S110  (already gone)
                pass
        await websocket.send_json(welcome)
        await _presence(hub)
        if event is not None:
            await broadcast(hub, _host_message(event))
        if away_since is not None:
            # The host is away and hasn't come back: promote whoever is connected longest
            # once the grace runs out (FR-26), even if this hub is new since they left.
            _start_host_timer(pool, hub, session.id, away_since, grace)

        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            text = message.get("text")
            if text is not None:
                await _handle_text(ctx, text)
    finally:
        # Shielded: a cancelled scope must not cut this off before the leave is recorded.
        with anyio.CancelScope(shield=True):
            await _leave(ctx)


async def _leave(ctx: Context) -> None:
    """Only the participant's current socket leaves: a replaced one changes nothing."""
    hub = ctx.hub
    if hub.remove(ctx.participant_id, ctx.websocket):
        now = clock.now()
        async with ctx.pool.acquire() as conn:
            await repo.leave_participant(conn, ctx.participant_id)
            event = await hosting.on_disconnect(conn, hub, ctx.session_id, ctx.participant_id, now)
        await _presence(hub)
        if event is not None:
            await broadcast(hub, _host_message(event))
            _start_host_timer(ctx.pool, hub, ctx.session_id, now, ctx.grace)
    drop_if_empty(ctx.session_id)
