"""Hosting rules of a presentation session (spec 013 plan.md "Hosting"; FR-8, FR-16,
FR-25–FR-29), kept out of `service.py` to keep it small.

Each function runs under the session's lock (`service.lock`, shared with place changes),
persists `host_participant_id` / `host_away_since` and returns a `HostEvent` for the caller
to broadcast as `{type: "host", ...}`, or None when nothing changed. The place is never
touched (FR-29). Nothing here broadcasts or schedules the host timer.

The caller updates the hub first: `on_connect` after the connection is added, `on_disconnect`
after it is removed.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import asyncpg

from app.present import repo
from app.present.hub import PresentHub
from app.present.service import NotHost, PresentError, SessionNotFound, lock

Reason = Literal["start", "returned", "away", "timeout", "handover", "claimed"]


class NotConnected(PresentError):
    """A hand-over to a participant with no live connection."""

    code = "not_connected"


@dataclass(frozen=True)
class HostEvent:
    host_id: uuid.UUID
    host_name: str
    away: bool
    reason: Reason
    host_signed_in: bool = False  # spec 012 FR-8, NFR-2: from the participant's account_sub


async def _host(
    conn: asyncpg.Connection, session_id: uuid.UUID
) -> tuple[uuid.UUID | None, datetime | None]:
    row = await conn.fetchrow(
        "select host_participant_id, host_away_since from presentation_session where id = $1",
        session_id,
    )
    if row is None:
        raise SessionNotFound()
    return row["host_participant_id"], row["host_away_since"]


async def host_signed_in(conn: asyncpg.Connection, host_id: uuid.UUID) -> bool:
    """Spec 012 FR-8, NFR-2: whether the host is an account's participant, read server-side."""
    return bool(
        await conn.fetchval(
            "select account_sub is not null from presentation_participant where id = $1",
            host_id,
        )
    )


async def _event(
    conn: asyncpg.Connection, host_id: uuid.UUID, *, away: bool, reason: Reason
) -> HostEvent:
    row = await conn.fetchrow(
        """select display_name, account_sub is not null as signed_in
           from presentation_participant where id = $1""",
        host_id,
    )
    return HostEvent(host_id, row["display_name"], away, reason, row["signed_in"])


async def _make_host(
    conn: asyncpg.Connection, hub: PresentHub, session_id: uuid.UUID, host_id: uuid.UUID
) -> None:
    await repo.set_host(conn, session_id, host_id)
    hub.cancel_host_timer()


async def on_connect(
    conn: asyncpg.Connection,
    hub: PresentHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    now: datetime,
    *,
    grace: float,
) -> HostEvent | None:
    """No host yet: the joiner hosts (`start`, FR-8). The away host is back: `returned`
    (FR-16). The host has been away ≥ `grace`: the longest-connected hosts — the joiner
    alone `claimed` (FR-27), otherwise `timeout` (FR-26 catch-up). Else None (FR-28)."""
    async with lock(session_id):
        host_id, away_since = await _host(conn, session_id)
        if host_id is None:
            await _make_host(conn, hub, session_id, participant_id)
            return await _event(conn, participant_id, away=False, reason="start")
        if host_id == participant_id:
            if away_since is None:
                return None
            await _make_host(conn, hub, session_id, participant_id)
            return await _event(conn, participant_id, away=False, reason="returned")
        if away_since is not None and now - away_since >= timedelta(seconds=grace):
            successor = hub.longest_connected(exclude=host_id) or participant_id
            await _make_host(conn, hub, session_id, successor)
            reason: Reason = "claimed" if successor == participant_id else "timeout"
            return await _event(conn, successor, away=False, reason=reason)
        return None


async def on_disconnect(
    conn: asyncpg.Connection,
    hub: PresentHub,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    now: datetime,
) -> HostEvent | None:
    """The host's last connection dropped: away since `now` (FR-16). Else None."""
    async with lock(session_id):
        host_id, away_since = await _host(conn, session_id)
        if host_id != participant_id or away_since is not None or participant_id in hub.connections:
            return None
        await repo.set_host_away(conn, session_id, now)
        return await _event(conn, participant_id, away=True, reason="away")


async def hand_over(
    conn: asyncpg.Connection,
    hub: PresentHub,
    session_id: uuid.UUID,
    from_id: uuid.UUID,
    to_id: uuid.UUID,
) -> HostEvent:
    """FR-25: the host passes hosting to a connected participant. NotHost if `from_id`
    isn't host; NotConnected if `to_id` has no live connection."""
    async with lock(session_id):
        host_id, _ = await _host(conn, session_id)
        if host_id != from_id:
            raise NotHost()
        if to_id not in hub.connections:
            raise NotConnected()
        await _make_host(conn, hub, session_id, to_id)
        return await _event(conn, to_id, away=False, reason="handover")


async def promote_if_due(
    conn: asyncpg.Connection,
    hub: PresentHub,
    session_id: uuid.UUID,
    now: datetime,
    grace: float,
) -> HostEvent | None:
    """FR-26: the host has been away ≥ `grace` and someone is connected: the participant
    connected longest hosts (`timeout`). Else None. Leaves `hub.host_timer` alone, since
    the timer task calling this may be that very task."""
    async with lock(session_id):
        host_id, away_since = await _host(conn, session_id)
        if host_id is None or away_since is None:
            return None
        if now - away_since < timedelta(seconds=grace):
            return None
        successor = hub.longest_connected(exclude=host_id)
        if successor is None:
            return None
        await repo.set_host(conn, session_id, successor)
        return await _event(conn, successor, away=False, reason="timeout")
