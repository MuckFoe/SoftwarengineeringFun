"""In-memory hub of live chess connections per session (plan.md "Away tracking and the
claim", "Participant cap"): sockets, who is away, the abandon timers and the cached board.
Never persisted. Valid only because there is one `api` process, as `app.sessions.hub`.
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Protocol

import chess

from app import clock
from app.sessions.hub import MAX_PARTICIPANTS


class SocketLike(Protocol):
    async def send_json(self, data: object) -> None: ...


@dataclass(frozen=True)
class ChessConnection:
    websocket: SocketLike
    participant_id: uuid.UUID
    name: str
    signed_in: bool = False


@dataclass
class ChessHub:
    abandon_seconds: float
    # Called with the away player's id when their timer fires; the service broadcasts.
    on_abandon_elapsed: Callable[[uuid.UUID], Awaitable[None]] | None = None
    connections: dict[uuid.UUID, ChessConnection] = field(default_factory=dict)
    seated: set[uuid.UUID] = field(default_factory=set)
    away_since: dict[uuid.UUID, datetime] = field(default_factory=dict)
    timers: dict[uuid.UUID, asyncio.Task] = field(default_factory=dict)
    game_in_progress: bool = False
    board: chess.Board | None = None
    reserved: set[uuid.UUID] = field(default_factory=set)

    # --- cap (FR-32) -------------------------------------------------------------------

    def try_reserve(self, participant_id: uuid.UUID) -> bool:
        """Takes a place if one is free. A seated player (connected or away) already
        holds theirs, and a connected participant's second device takes none. Counts
        connected non-seated participants plus every seated one. Synchronous, so
        check-and-take is atomic with respect to the event loop."""
        if participant_id in self.seated or participant_id in self.connections:
            return True
        if participant_id in self.reserved:
            return True
        non_seated = sum(1 for p in self.connections if p not in self.seated)
        taken = non_seated + len(self.seated) + len(self.reserved)
        if taken >= MAX_PARTICIPANTS:
            return False
        self.reserved.add(participant_id)
        return True

    def release_reservation(self, participant_id: uuid.UUID) -> None:
        self.reserved.discard(participant_id)

    # --- connections -------------------------------------------------------------------

    def add(
        self,
        participant_id: uuid.UUID,
        websocket: SocketLike,
        name: str,
        *,
        signed_in: bool = False,
    ) -> ChessConnection:
        """Adds a connection, consuming its reservation. A returning seated player is
        no longer away and their abandon timer is cancelled (FR-28, FR-33)."""
        self.reserved.discard(participant_id)
        connection = ChessConnection(websocket, participant_id, name, signed_in)
        self.connections[participant_id] = connection
        self.away_since.pop(participant_id, None)
        self._cancel_timer(participant_id)
        return connection

    def replace(self, participant_id: uuid.UUID, websocket: SocketLike) -> ChessConnection:
        """Swaps in a newer socket and returns the old connection (to be closed 4409).
        KeyError if not connected."""
        old = self.connections[participant_id]
        self.connections[participant_id] = replace(old, websocket=websocket)
        return old

    def remove(self, participant_id: uuid.UUID, websocket: SocketLike | None = None) -> bool:
        """Removes the participant's connection, only if it is still `websocket` when
        given. A seated player's last socket closing makes them away."""
        current = self.connections.get(participant_id)
        if current is None or (websocket is not None and current.websocket is not websocket):
            return False
        del self.connections[participant_id]
        if participant_id in self.seated:
            self._mark_away(participant_id, clock.now())
        return True

    def presence(self) -> list[dict]:
        return [
            {"id": str(c.participant_id), "name": c.name, "signed_in": c.signed_in}
            for c in self.connections.values()
        ]

    # --- away tracking (FR-28, FR-33) --------------------------------------------------

    def mark_all_seated_away(self, now: datetime) -> None:
        """Used when a hub is first loaded (after a restart): everyone seated starts
        away, so an absent player gets the full interval again."""
        for pid in self.seated:
            if pid not in self.connections:
                self._mark_away(pid, now)

    def set_game_in_progress(self, active: bool) -> None:
        """Timers exist only during a game (NFR-6): starting one arms a timer for each
        seated player already away; ending it cancels them all."""
        self.game_in_progress = active
        if active:
            for pid in self.away_since:
                self._start_timer(pid)
        else:
            self.cancel_timers()

    def cancel_timers(self) -> None:
        for pid in list(self.timers):
            self._cancel_timer(pid)

    def _mark_away(self, participant_id: uuid.UUID, now: datetime) -> None:
        self.away_since[participant_id] = now
        if self.game_in_progress:
            self._start_timer(participant_id)

    def _start_timer(self, participant_id: uuid.UUID) -> None:
        self._cancel_timer(participant_id)
        self.timers[participant_id] = asyncio.get_running_loop().create_task(
            self._abandon_after(participant_id)
        )

    def _cancel_timer(self, participant_id: uuid.UUID) -> None:
        task = self.timers.pop(participant_id, None)
        if task is not None:
            task.cancel()

    async def _abandon_after(self, participant_id: uuid.UUID) -> None:
        await asyncio.sleep(self.abandon_seconds)
        self.timers.pop(participant_id, None)
        if self.on_abandon_elapsed is not None:
            await self.on_abandon_elapsed(participant_id)
