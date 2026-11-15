"""The Rock Paper Siege WebSocket (spec 021 plan.md "WebSocket", Decision 2). FR-2, FR-7,
FR-22, FR-23, FR-24, NFR-1.

Join, cap, rejoin token, close codes and the stale guard are `app.games.chess.ws` adapted to
seats `a`/`b`, on a `ChessHub` per session in `app.state.rps_hubs` (its `board` stays `None`).

Unlike chess, no snapshot goes to everyone alike: after every committed change each connection
gets its own `views.state_for` (and `views.event_for` when the change has an event), for its
role worked out at that moment, so a viewer who takes a seat gets a player's view from then on
(FR-23). A refused call goes to the sender only, as `error {code}`. Malformed or unknown frames
are ignored.
"""

import asyncio
import contextlib
import dataclasses
import json
import uuid
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from typing import Any

import anyio
import asyncpg
from fastapi import APIRouter, FastAPI, WebSocket

from app import clock
from app.accounts.identity import identity_for
from app.chat.rules import MAX_CHAT_CHARS, ChatError
from app.games.chess.hub import ChessHub
from app.games.chess.ws import (
    CLOSE_DELETED,
    CLOSE_FULL,
    CLOSE_INVALID_NAME,
    CLOSE_NOT_FOUND,
    CLOSE_REPLACED,
)
from app.games.rps import chat, repo, service, views
from app.games.rps.service import Closed, Refused
from app.games.rps.views import FullState, RawEvent, Recipient
from app.gifs import service as gif_service

router = APIRouter()


# --- per-recipient sends (Decision 2) -----------------------------------------------------------


def recipient_of(full: FullState, participant_id: uuid.UUID) -> Recipient:
    """The participant's role now: a seated player plays that side, everyone else views. Seats
    cannot change while a game runs, so this is also their role in the current game."""
    pid = str(participant_id)
    if full.seat_a is not None and full.seat_a.participant_id == pid:
        return "a"
    if full.seat_b is not None and full.seat_b.participant_id == pid:
        return "b"
    return "viewer"


def state_message(
    full: FullState, participant_id: uuid.UUID, event: RawEvent | None = None
) -> dict:
    """The `state` frame for one participant, filtered by `views` for their role."""
    recipient = recipient_of(full, participant_id)
    message: dict = {"type": "state", "state": views.state_for(full, recipient)}
    if event is not None:
        wire = views.event_for(event, recipient)
        if wire is not None:
            message["event"] = wire
    return message


async def broadcast(hub: ChessHub, message: dict, *, exclude: uuid.UUID | None = None) -> None:
    """The same message to every live connection but `exclude` (only for frames that carry no
    game state: `session_closed`, chat)."""
    for participant_id, connection in list(hub.connections.items()):
        if participant_id == exclude:
            continue
        try:
            await connection.websocket.send_json(message)
        except Exception:  # noqa: S110  (a dead socket is cleaned up by its own handler)
            pass


async def broadcast_state(
    hub: ChessHub,
    full: FullState,
    event: RawEvent | None = None,
    *,
    exclude: uuid.UUID | None = None,
) -> None:
    """Each live connection but `exclude` gets its own view of `full` (and of `event`)."""
    for participant_id, connection in list(hub.connections.items()):
        if participant_id == exclude:
            continue
        try:
            await connection.websocket.send_json(state_message(full, participant_id, event))
        except Exception:  # noqa: S110  (a dead socket is cleaned up by its own handler)
            pass


# --- hub registry -------------------------------------------------------------------------------


def hubs_of(app: FastAPI) -> dict[uuid.UUID, ChessHub]:
    return app.state.rps_hubs  # type: ignore[no-any-return]


async def hub_for(app: FastAPI, conn: asyncpg.Connection, session: repo.RpsSession) -> ChessHub:
    """The session's live hub, loaded on first access with every seated player away."""
    hubs = hubs_of(app)
    hub = hubs.get(session.id)
    if hub is not None:
        return hub
    game = await repo.get_game(conn, session.current_game_id) if session.current_game_id else None
    loaded = hubs.get(session.id)  # another join may have loaded it while we read
    if loaded is not None:
        return loaded
    hub = ChessHub(abandon_seconds=app.state.settings.chess_abandon_seconds)
    hub.on_abandon_elapsed = _abandon_elapsed(app, session.id, hub)
    hub.seated = {p for p in (session.a_participant_id, session.b_participant_id) if p is not None}
    hub.mark_all_seated_away(clock.now())
    if game is not None and game.ended_at is None:
        hub.set_game_in_progress(True)
    hubs[session.id] = hub
    return hub


def _abandon_elapsed(
    app: FastAPI, session_id: uuid.UUID, hub: ChessHub
) -> Callable[[uuid.UUID], Awaitable[None]]:
    """The hub's timer callback: everyone gets a fresh state with `claim_available_to` set."""

    async def elapsed(_participant_id: uuid.UUID) -> None:
        try:
            async with app.state.pool.acquire() as conn:
                full = await service.snapshot(conn, session_id, hub)
            await broadcast_state(hub, full)
        except Exception:  # noqa: S110  (session gone or pool closing: nothing to tell)
            pass

    return elapsed


def drop_if_empty(app: FastAPI, session_id: uuid.UUID) -> None:
    """Forgets a hub nobody is connected to, seated in or joining."""
    hub = hubs_of(app).get(session_id)
    if hub is not None and not hub.connections and not hub.seated and not hub.reserved:
        hub.cancel_timers()
        del hubs_of(app)[session_id]


async def close_session(app: FastAPI, session_id: uuid.UUID, closed: Closed) -> None:
    """After a delete commits: tells everyone `session_closed`, closes every socket 4411 and
    drops the hub. For resign, claim, delete, the admin REST call and the account deletion."""
    hub = hubs_of(app).pop(session_id, None)
    if hub is None:
        return
    hub.cancel_timers()
    await broadcast(
        hub, {"type": "session_closed", "result": closed.result, "reason": closed.reason}
    )
    connections = list(hub.connections.values())
    hub.connections.clear()
    for connection in connections:
        try:
            await connection.websocket.close(code=CLOSE_DELETED)  # type: ignore[attr-defined]
        except Exception:  # noqa: S110  (already gone)
            pass


# --- frames -------------------------------------------------------------------------------------


@dataclass
class Context:
    websocket: WebSocket
    pool: asyncpg.Pool
    hub: ChessHub
    session_id: uuid.UUID
    participant_id: uuid.UUID


Handler = Callable[[Context, dict], Awaitable[None]]


async def _run(ctx: Context, call: Callable[[asyncpg.Connection], Awaitable[FullState]]) -> None:
    """Runs a service call on a borrowed connection, then sends everyone their own view, or
    just the sender why not."""
    try:
        async with ctx.pool.acquire() as conn:
            full = await call(conn)
    except Refused as refused:
        await ctx.websocket.send_json({"type": "error", "code": refused.code})
        return
    await broadcast_state(ctx.hub, full)


async def _take_seat(ctx: Context, frame: dict) -> None:
    side = frame.get("side")
    if not isinstance(side, str):
        return
    await _run(
        ctx,
        lambda conn: service.take_seat(conn, ctx.session_id, ctx.participant_id, side, hub=ctx.hub),
    )


async def _leave_seat(ctx: Context, frame: dict) -> None:
    await _run(
        ctx,
        lambda conn: service.leave_seat(conn, ctx.session_id, ctx.participant_id, hub=ctx.hub),
    )


async def _start(ctx: Context, frame: dict) -> None:
    await _run(
        ctx, lambda conn: service.start(conn, ctx.session_id, ctx.participant_id, hub=ctx.hub)
    )


async def _place(ctx: Context, frame: dict) -> None:
    what, square = frame.get("what"), frame.get("square")
    if not isinstance(what, str) or not _is_int(square):
        return
    await _run(
        ctx,
        lambda conn: service.place(
            conn,
            ctx.session_id,
            ctx.participant_id,
            what,  # type: ignore[arg-type]  (the service refuses anything but flag/trap)
            square,  # type: ignore[arg-type]
            hub=ctx.hub,
        ),
    )


async def _redeal(ctx: Context, frame: dict) -> None:
    await _run(
        ctx, lambda conn: service.redeal(conn, ctx.session_id, ctx.participant_id, hub=ctx.hub)
    )


async def _ready(ctx: Context, frame: dict) -> None:
    await _run(
        ctx, lambda conn: service.ready(conn, ctx.session_id, ctx.participant_id, hub=ctx.hub)
    )


# --- game frames (FR-9..FR-20) -------------------------------------------------------------------


async def _run_with_event(
    ctx: Context,
    call: Callable[[asyncpg.Connection], Awaitable[tuple[FullState, RawEvent | None]]],
) -> None:
    """`_run` for calls that may also produce an event: each connection gets its own view of
    both (a trap's weapon, for one, is withheld from the trap's owner)."""
    try:
        async with ctx.pool.acquire() as conn:
            full, event = await call(conn)
    except Refused as refused:
        await ctx.websocket.send_json({"type": "error", "code": refused.code})
        return
    await broadcast_state(ctx.hub, full, event)


async def _move(ctx: Context, frame: dict) -> None:
    frm, to = frame.get("from"), frame.get("to")
    if not _is_int(frm) or not _is_int(to):
        return
    await _run_with_event(
        ctx,
        lambda conn: service.move(
            conn,
            ctx.session_id,
            ctx.participant_id,
            frm,  # type: ignore[arg-type]
            to,  # type: ignore[arg-type]
            hub=ctx.hub,
        ),
    )


async def _duel_pick(ctx: Context, frame: dict) -> None:
    weapon = frame.get("weapon")
    if not isinstance(weapon, str):
        return
    await _run_with_event(
        ctx,
        lambda conn: service.duel_pick(
            conn, ctx.session_id, ctx.participant_id, weapon, hub=ctx.hub
        ),
    )


async def _offer_draw(ctx: Context, frame: dict) -> None:
    await _run(
        ctx,
        lambda conn: service.offer_draw(conn, ctx.session_id, ctx.participant_id, hub=ctx.hub),
    )


async def _answer_draw(ctx: Context, frame: dict) -> None:
    accept = frame.get("accept")
    if not isinstance(accept, bool):
        return
    await _run(
        ctx,
        lambda conn: service.answer_draw(
            conn, ctx.session_id, ctx.participant_id, accept, hub=ctx.hub
        ),
    )


async def _close_after(
    ctx: Context, call: Callable[[asyncpg.Connection], Awaitable[Closed]]
) -> None:
    """Runs a call that ends the game and deletes the session. After commit, when a game was
    ended, everyone first gets their view of the ended game (how it ended and every kind,
    FR-20), then `session_closed` and the 4411 close."""
    try:
        async with ctx.pool.acquire() as conn:
            closed = await call(conn)
            final = None
            if closed.result is not None:
                try:
                    final = await service.snapshot(conn, ctx.session_id, ctx.hub)
                except Refused:
                    final = None
    except Refused as refused:
        await ctx.websocket.send_json({"type": "error", "code": refused.code})
        return
    if final is not None:
        await broadcast_state(ctx.hub, final)
    await close_session(ctx.websocket.app, ctx.session_id, closed)


async def _resign(ctx: Context, frame: dict) -> None:
    await _close_after(ctx, lambda conn: service.resign(conn, ctx.session_id, ctx.participant_id))


async def _claim_win(ctx: Context, frame: dict) -> None:
    await _close_after(
        ctx, lambda conn: service.claim_win(conn, ctx.session_id, ctx.participant_id, ctx.hub)
    )


async def _delete_session(ctx: Context, frame: dict) -> None:
    """The starter deletes the session (as chess): no final state, `session_closed` with
    reason `starter`; anyone else is refused `not_starter`."""
    await _close_after(
        ctx,
        lambda conn: service.delete_session(
            conn,
            ctx.session_id,
            reason="starter",
            by_participant=ctx.participant_id,
            by_sub=None,
        ),
    )


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


# --- chat and GIFs (FR-2; specs 002, 007), as on the chess socket --------------------------------

_GIF_TASKS: set[asyncio.Task] = set()


def _spawn_gif_task(coro: Coroutine[None, None, None]) -> None:
    """A slow GIPHY never blocks the socket."""
    task = asyncio.create_task(coro)
    _GIF_TASKS.add(task)
    task.add_done_callback(_GIF_TASKS.discard)


def _name(ctx: Context) -> str:
    connection = ctx.hub.connections.get(ctx.participant_id)
    return connection.name if connection is not None else ""


async def _on_chat_send(ctx: Context, frame: dict) -> None:
    """Stored, then broadcast to everyone by `chat.send`; a refusal to the sender only."""
    client_id, body = frame.get("client_id"), frame.get("text")
    if not isinstance(client_id, str) or not isinstance(body, str):
        return
    async with ctx.pool.acquire() as conn:
        refused = await chat.send(
            conn, ctx.hub, ctx.session_id, ctx.participant_id, _name(ctx), body, client_id
        )
    if refused is not None:
        extra: dict[str, Any] = {"client_id": client_id}
        if refused is ChatError.TOO_LONG:
            extra["limit"] = MAX_CHAT_CHARS
        await ctx.websocket.send_json({"type": "error", "code": refused.value, **extra})


async def _gif_search(ctx: Context, request_id: str, q: str) -> None:
    state = ctx.websocket.app.state
    first, second = await gif_service.search(
        state.giphy, state.gif_search_limiter, (ctx.session_id, _name(ctx)), q
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
    with contextlib.suppress(Exception):  # the sender may have left while GIPHY answered
        await ctx.websocket.send_json(reply)


async def _gif_post(ctx: Context, client_id: str, gif_id: str) -> None:
    state = ctx.websocket.app.state
    resolved = await gif_service.resolve_for_post(
        state.giphy, state.gif_post_limiter, (ctx.session_id, _name(ctx)), gif_id
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
                conn, ctx.hub, ctx.session_id, ctx.participant_id, _name(ctx), resolved, client_id
            )
        if refused is not None:
            error = {"type": "error", "code": refused.value, "client_id": client_id}
    if error is not None:
        with contextlib.suppress(Exception):
            await ctx.websocket.send_json(error)


async def _on_gif_search(ctx: Context, frame: dict) -> None:
    request_id, q = frame.get("request_id"), frame.get("q")
    if not isinstance(request_id, str) or not isinstance(q, str):
        return
    _spawn_gif_task(_gif_search(ctx, request_id, q))


async def _on_chat_send_gif(ctx: Context, frame: dict) -> None:
    client_id, gif_id = frame.get("client_id"), frame.get("gif_id")
    if not isinstance(client_id, str) or not isinstance(gif_id, str):
        return
    _spawn_gif_task(_gif_post(ctx, client_id, gif_id))


HANDLERS: dict[str, Handler] = {
    "chat_send": _on_chat_send,
    "chat_send_gif": _on_chat_send_gif,
    "gif_search": _on_gif_search,
    "take_seat": _take_seat,
    "leave_seat": _leave_seat,
    "start": _start,
    "place": _place,
    "redeal": _redeal,
    "ready": _ready,
    "move": _move,
    "duel_pick": _duel_pick,
    "offer_draw": _offer_draw,
    "answer_draw": _answer_draw,
    "resign": _resign,
    "claim_win": _claim_win,
    "delete_session": _delete_session,
}


# Every frame that changes anything, including those whose handlers come later (game frames,
# chat), so the one stale guard covers them from the start.
CHANGING_FRAMES = frozenset(
    {
        "take_seat",
        "leave_seat",
        "start",
        "place",
        "redeal",
        "ready",
        "move",
        "duel_pick",
        "offer_draw",
        "answer_draw",
        "resign",
        "claim_win",
        "delete_session",
        "chat_send",
        "gif_search",
        "chat_send_gif",
    }
)


async def _handle_text(ctx: Context, text: str) -> None:
    try:
        frame = json.loads(text)
    except ValueError:
        return
    if not isinstance(frame, dict):
        return
    kind = str(frame.get("type"))
    handler = HANDLERS.get(kind)
    # The one stale guard (as chess FR-29): a stale session refuses every changing frame here.
    if kind in CHANGING_FRAMES or handler is not None:
        async with ctx.pool.acquire() as conn:
            session = await repo.get_session(conn, ctx.session_id)
        if session is not None and session.stale_at is not None:
            await ctx.websocket.send_json({"type": "error", "code": "session_stale"})
            return
    if handler is not None:
        await handler(ctx, frame)


# --- join and leave -----------------------------------------------------------------------------


async def _existing(
    conn: asyncpg.Connection, session_id: uuid.UUID, identity, rejoin: str
) -> repo.Participant | None:
    """The participant this join would reuse, if any (before anything is written)."""
    if identity is not None and identity.account_sub is not None:
        return await repo.get_participant_by_account(conn, session_id, identity.account_sub)
    if rejoin:
        return await repo.get_participant_by_token_hash(conn, session_id, service._hash(rejoin))
    return None


@router.websocket("/api/games/rps/sessions/{invite}/ws")
async def rps_ws(websocket: WebSocket, invite: str, name: str = "", rejoin: str = "") -> None:
    await websocket.accept()
    app = websocket.app
    pool = app.state.pool
    replaced = None

    async with pool.acquire() as conn:
        session = await repo.get_session_by_invite(conn, invite)
        if session is None:
            deleted = await repo.is_deleted_invite(conn, invite)
            await websocket.close(code=CLOSE_DELETED if deleted else CLOSE_NOT_FOUND)
            return
        hub = await hub_for(app, conn, session)
        identity = identity_for(websocket.session, name)
        existing = await _existing(conn, session.id, identity, rejoin)
        # A place is taken before anything is written, in one synchronous step.
        ticket = existing.id if existing is not None else uuid.uuid4()
        if not hub.try_reserve(ticket):
            drop_if_empty(app, session.id)
            await websocket.close(code=CLOSE_FULL)
            return
        try:
            participant, token = await service.join(
                conn,
                session,
                name=name or None,
                account=identity,
                rejoin=rejoin or None,
                hub=hub,
            )
        except Refused as refused:
            hub.release_reservation(ticket)
            drop_if_empty(app, session.id)
            # `not_found` here means the session was deleted since it was looked up.
            await websocket.close(
                code=CLOSE_INVALID_NAME if refused.code == "invalid_name" else CLOSE_DELETED
            )
            return
        if participant.id != ticket:
            hub.release_reservation(ticket)
            hub.try_reserve(participant.id)
        if participant.id in hub.connections:
            replaced = hub.replace(participant.id, websocket)
        else:
            hub.add(
                participant.id, websocket, participant.display_name, signed_in=participant.signed_in
            )
        try:
            current = await repo.get_session(conn, session.id)
            full = await service.snapshot(conn, session.id, hub)
        except BaseException:
            hub.remove(participant.id, websocket)
            drop_if_empty(app, session.id)
            raise

    is_starter = current is not None and current.starter_participant_id == participant.id
    ctx = Context(websocket, pool, hub, session.id, participant.id)
    try:
        if replaced is not None:
            try:
                await replaced.websocket.close(code=CLOSE_REPLACED)  # type: ignore[attr-defined]
            except Exception:  # noqa: S110  (already gone)
                pass
        await websocket.send_json(
            {
                "type": "welcome",
                "you": {"participant_id": str(participant.id), "is_starter": is_starter},
                "rejoin_token": token,
                "state": views.state_for(full, recipient_of(full, participant.id)),
            }
        )
        await broadcast_state(hub, full, exclude=participant.id)
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            text = message.get("text")
            if text is not None:
                await _handle_text(ctx, text)
    finally:
        # Shielded: a cancelled scope must not cut the leave short.
        with anyio.CancelScope(shield=True):
            await _leave(app, ctx)


async def _leave(app: FastAPI, ctx: Context) -> None:
    """Only the participant's current socket leaves; a replaced one changes nothing. A seated
    player's last socket closing makes them away and the others are told."""
    hub = ctx.hub
    if not hub.remove(ctx.participant_id, ctx.websocket):
        return
    if hub.connections:
        try:
            async with ctx.pool.acquire() as conn:
                full = await service.snapshot(conn, ctx.session_id, hub)
            await broadcast_state(hub, full)
        except Refused:
            pass
    drop_if_empty(app, ctx.session_id)
