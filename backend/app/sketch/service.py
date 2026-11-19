"""Sketch board service (spec 022 plan, Architecture — Ordering, Stale; Data model).

FR-9 (an action reaches everyone), FR-10 (one order for all: every insert and its
broadcast run under the session's `asyncio.Lock`, so broadcast order = `seq` order — valid
because there is one `api` process, as for `sessions/hub.py`), FR-12 (clear, with pruning),
FR-13 (undo only one's own action), FR-16 (a stale session stores nothing), FR-18/NFR-3
(the visible drawing stays within `BUDGET_BYTES`). `author_id` never leaves this module.
"""

import asyncio
import uuid

import asyncpg

from app.sessions import hub as hub_module
from app.sessions.hub import SessionHub
from app.sketch import repo
from app.sketch.rules import (
    BUDGET_BYTES,
    Action,
    SketchError,
    action_bytes,
    parse_action,
    valid_client_id,
)

_CLEAR = Action("clear", None, None)
# The smallest action there is: a one-point erase. A board is full when not even it fits.
_SMALLEST_BYTES = action_bytes(Action("erase", None, [0, 0]))

_locks: dict[uuid.UUID, asyncio.Lock] = {}


def _lock(session_id: uuid.UUID) -> asyncio.Lock:
    lock = _locks.get(session_id)
    if lock is None:
        lock = _locks[session_id] = asyncio.Lock()
    return lock


def _wire(stored: repo.StoredAction) -> dict:
    """The action as clients see it: `color`/`points` only where the kind has them."""
    wire: dict = {"seq": stored.seq, "client_id": stored.client_id, "kind": stored.kind}
    if stored.color is not None:
        wire["color"] = stored.color
    if stored.points is not None:
        wire["points"] = stored.points
    return wire


async def _broadcast_added(hub: SessionHub, stored: repo.StoredAction) -> None:
    await hub_module.broadcast(hub, {"type": "sketch_added", "action": _wire(stored)})


async def add(
    conn: asyncpg.Connection,
    hub: SessionHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    client_id: str,
    raw_action: object,
) -> SketchError | None:
    if not valid_client_id(client_id):
        return SketchError.INVALID
    action = parse_action(raw_action)
    if isinstance(action, SketchError):
        return action
    bytes_ = action_bytes(action)
    async with _lock(session_id):
        if await repo.visible_bytes(conn, session_id) + bytes_ > BUDGET_BYTES:
            return SketchError.FULL
        stored = await repo.insert(conn, session_id, participant_id, client_id, action, bytes_)
        if stored is None:
            return SketchError.STALE
        await _broadcast_added(hub, stored)
    return None


class _Stale(Exception):
    """Rolls back a clear's prune when its insert finds the session stale."""


async def clear(
    conn: asyncpg.Connection,
    hub: SessionHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    client_id: str,
) -> SketchError | None:
    if not valid_client_id(client_id):
        return SketchError.INVALID
    async with _lock(session_id):
        try:
            async with conn.transaction():
                await repo.prune_before_latest_clear(conn, session_id)
                stored = await repo.insert(
                    conn, session_id, participant_id, client_id, _CLEAR, action_bytes(_CLEAR)
                )
                if stored is None:
                    raise _Stale
        except _Stale:
            return SketchError.STALE
        await _broadcast_added(hub, stored)
    return None


async def undo(
    conn: asyncpg.Connection,
    hub: SessionHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    seq: int,
) -> SketchError | None:
    async with _lock(session_id):
        if not await repo.delete_own(conn, session_id, participant_id, seq):
            return SketchError.NOT_YOURS
        await hub_module.broadcast(hub, {"type": "sketch_removed", "seq": seq})
    return None


async def snapshot(conn: asyncpg.Connection, session_id: uuid.UUID) -> dict:
    """Visible actions plus those the latest clear hid, in `seq` order (plan, Contracts)."""
    actions = await repo.list_actions(conn, session_id)
    used = await repo.visible_bytes(conn, session_id)
    return {
        "actions": [_wire(stored) for stored in actions],
        "full": used + _SMALLEST_BYTES > BUDGET_BYTES,
    }
