"""The chess WebSocket (spec 014 plan.md "Contracts — WebSocket", "Participant cap").
FR-3..FR-9, FR-21, FR-28, FR-31, FR-32, NFR-2.

Join mirrors the presentation socket (`app.present.ws`): a signed-in user gets the account's
participant, otherwise a valid `rejoin` token reuses its participant, otherwise a valid `name`
makes a new one. A place is reserved in the session's `ChessHub` before the participant is
added, so concurrent joins cannot pass the cap; a participant still connected takes no place
and its older socket is closed with 4409. A pooled connection is borrowed per step, never held
while the socket idles.

Live hubs are kept in `app.state.chess_hubs` (session id -> hub), which the REST pre-join check
also reads. A hub is loaded on first access with every seated player away (so after a restart an
absent player gets the whole interval again) and dropped when it is empty and nobody is seated.

The service returns a snapshot after every committed change; this module sends it to every
connection as `state`. A refused call goes to the sender only, as `error {code}`. Malformed or
unknown frames are ignored.
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
from app.games.chess import chat, repo, service
from app.games.chess.hub import ChessHub
from app.games.chess.service import Refused, Snapshot
from app.gifs import service as gif_service

router = APIRouter()

# The other session sockets' close codes, so clients treat all alike (plan.md: 4411 is new).
CLOSE_NOT_FOUND = 4404
CLOSE_FULL = 4403
CLOSE_DELETED = 4411
CLOSE_INVALID_NAME = 4422
CLOSE_REPLACED = 4409


def encode_snapshot(snapshot: Snapshot) -> dict:
    """The wire form: the dataclass tree as dicts, with `from_` written as `from`."""
    data = dataclasses.asdict(snapshot)
    game = data["game"]
    if game is not None:
        for move in [*game["moves"], game["last_move"]]:
            if move is not None:
                move["from"] = move.pop("from_")
    return data


async def broadcast(hub: ChessHub, message: dict, *, exclude: uuid.UUID | None = None) -> None:
    """Sends to every live connection of the hub but `exclude`."""
    for participant_id, connection in list(hub.connections.items()):
        if participant_id == exclude:
            continue
        try:
            await connection.websocket.send_json(message)
        except Exception:  # noqa: S110  (a dead socket is cleaned up by its own handler)
            pass


async def broadcast_state(hub: ChessHub, snapshot: Snapshot, *, exclude: uuid.UUID | None = None):
    await broadcast(hub, {"type": "state", "state": encode_snapshot(snapshot)}, exclude=exclude)


# --- hub registry -----------------------------------------------------------------------------


def hubs_of(app: FastAPI) -> dict[uuid.UUID, ChessHub]:
    return app.state.chess_hubs  # type: ignore[no-any-return]


async def hub_for(app: FastAPI, conn: asyncpg.Connection, session: repo.ChessSession) -> ChessHub:
    """The session's live hub, loaded on first access."""
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
    hub.seated = {
        p for p in (session.white_participant_id, session.black_participant_id) if p is not None
    }
    hub.mark_all_seated_away(clock.now())
    if game is not None and game.ended_at is None:
        hub.set_game_in_progress(True)
    hubs[session.id] = hub
    return hub


def _abandon_elapsed(
    app: FastAPI, session_id: uuid.UUID, hub: ChessHub
) -> Callable[[uuid.UUID], Awaitable[None]]:
    """The hub's timer callback: an away player's interval is up, so everyone gets a fresh
    snapshot in which `claim_available_to` is set (FR-33)."""

    async def elapsed(_participant_id: uuid.UUID) -> None:
        try:
            async with app.state.pool.acquire() as conn:
                snapshot = await service.snapshot(conn, session_id, hub)
            await broadcast_state(hub, snapshot)
        except Exception:  # noqa: S110  (session gone or pool closing: nothing to tell)
            pass

    return elapsed


def drop_if_empty(app: FastAPI, session_id: uuid.UUID) -> None:
    """Forgets a hub nobody is connected to and nobody is seated in; a seated player who is
    away keeps theirs (their away state lives there)."""
    hub = hubs_of(app).get(session_id)
    if hub is not None and not hub.connections and not hub.seated and not hub.reserved:
        hub.cancel_timers()
        del hubs_of(app)[session_id]


# --- frames -----------------------------------------------------------------------------------


@dataclass
class Context:
    websocket: WebSocket
    pool: asyncpg.Pool
    hub: ChessHub
    session_id: uuid.UUID
    participant_id: uuid.UUID


Handler = Callable[[Context, dict], Awaitable[None]]


async def _run(ctx: Context, call: Callable[[asyncpg.Connection], Awaitable[Snapshot]]) -> None:
    """Runs a service call on a borrowed connection, then tells everyone, or just the sender
    why not."""
    try:
        async with ctx.pool.acquire() as conn:
            snapshot = await call(conn)
    except Refused as refused:
        await ctx.websocket.send_json({"type": "error", "code": refused.code})
        return
    await broadcast_state(ctx.hub, snapshot)


async def _take_seat(ctx: Context, frame: dict) -> None:
    color = frame.get("color")
    await _run(
        ctx,
        lambda conn: service.take_seat(
            conn, ctx.session_id, ctx.participant_id, str(color), hub=ctx.hub
        ),
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


async def _move(ctx: Context, frame: dict) -> None:
    frm, to, ply = frame.get("from"), frame.get("to"), frame.get("ply")
    promotion = frame.get("promotion")
    if not (isinstance(frm, str) and isinstance(to, str)) or not _is_int(ply):
        return
    if promotion is not None and not isinstance(promotion, str):
        return
    await _run(
        ctx,
        lambda conn: service.move(
            conn, ctx.session_id, ctx.participant_id, frm, to, promotion, ply, hub=ctx.hub
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


async def close_session(app: FastAPI, session_id: uuid.UUID, closed: service.Closed) -> None:
    """After a delete commits (FR-34): tells everyone `session_closed`, closes every socket
    4411 and drops the hub. Used by resign, delete, the admin REST call and the claim."""
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


async def _close_after(
    ctx: Context, call: Callable[[asyncpg.Connection], Awaitable[service.Closed]]
):
    try:
        async with ctx.pool.acquire() as conn:
            closed = await call(conn)
    except Refused as refused:
        await ctx.websocket.send_json({"type": "error", "code": refused.code})
        return
    await close_session(ctx.websocket.app, ctx.session_id, closed)


async def _resign(ctx: Context, frame: dict) -> None:
    await _close_after(ctx, lambda conn: service.resign(conn, ctx.session_id, ctx.participant_id))


async def _delete_session(ctx: Context, frame: dict) -> None:
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


async def _claim_win(ctx: Context, frame: dict) -> None:
    await _close_after(
        ctx, lambda conn: service.claim_win(conn, ctx.session_id, ctx.participant_id, ctx.hub)
    )


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


# --- chat and GIFs (FR-30; specs 002, 007), as on the presentation socket -----------------------

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
    "move": _move,
    "offer_draw": _offer_draw,
    "answer_draw": _answer_draw,
    "claim_win": _claim_win,
}


CHANGING_FRAMES = frozenset(
    {
        "take_seat",
        "leave_seat",
        "start",
        "move",
        "resign",
        "offer_draw",
        "answer_draw",
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
    # FR-29: the one stale guard. A stale session refuses every changing frame (seat, start,
    # move, draw, resign, claim, delete, chat) here, whichever task wrote the handler, and even
    # before a handler for it exists. Only frames that change nothing would skip it.
    if kind in CHANGING_FRAMES or handler is not None:
        async with ctx.pool.acquire() as conn:
            session = await repo.get_session(conn, ctx.session_id)
        if session is not None and session.stale_at is not None:
            await ctx.websocket.send_json({"type": "error", "code": "session_stale"})
            return
    if handler is not None:
        await handler(ctx, frame)


# --- join and leave ---------------------------------------------------------------------------


async def _existing(
    conn: asyncpg.Connection, session_id: uuid.UUID, identity, rejoin: str
) -> repo.Participant | None:
    """The participant this join would reuse, if any (before anything is written)."""
    if identity is not None and identity.account_sub is not None:
        return await repo.get_participant_by_account(conn, session_id, identity.account_sub)
    if rejoin:
        return await repo.get_participant_by_token_hash(conn, session_id, service._hash(rejoin))
    return None


@router.websocket("/api/games/chess/sessions/{invite}/ws")
async def chess_ws(websocket: WebSocket, invite: str, name: str = "", rejoin: str = "") -> None:
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
        # A place is taken before anything is written, in a single synchronous step (FR-32).
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
            snapshot = await service.snapshot(conn, session.id, hub)
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
                "state": encode_snapshot(snapshot),
            }
        )
        await broadcast_state(hub, snapshot, exclude=participant.id)
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
    player's last socket closing makes them away (FR-28) and the others are told."""
    hub = ctx.hub
    if not hub.remove(ctx.participant_id, ctx.websocket):
        return
    if hub.connections:
        try:
            async with ctx.pool.acquire() as conn:
                snapshot = await service.snapshot(conn, ctx.session_id, hub)
            await broadcast_state(hub, snapshot)
        except Refused:
            pass
    drop_if_empty(app, ctx.session_id)
