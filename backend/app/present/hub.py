"""In-memory hub of live presentation connections per session (plan.md "Drawing",
"Hosting"): who is connected and since when, each participant's colour, the live strokes
and the host timer handle. Never persisted (FR-24). Separate from the coding sessions'
registry; valid only because there is one `api` process, as `app.sessions.hub`.
"""

import asyncio
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Protocol

from app.sessions.hub import MAX_PARTICIPANTS

PALETTE_SIZE = 5
MAX_POINTS_PER_STROKE = 2000
MAX_STROKES = 500


class SocketLike(Protocol):
    async def send_json(self, data: object) -> None: ...


class DrawingFull(Exception):
    """A stroke or point past the NFR-3 caps; the socket answers `error drawing_full`."""


@dataclass(frozen=True)
class PresentConnection:
    websocket: SocketLike
    participant_id: uuid.UUID
    name: str
    connected_at: datetime
    color: int
    signed_in: bool = False  # spec 012 FR-8: the participant is an account's


@dataclass
class Stroke:
    id: str
    participant_id: uuid.UUID
    color: int
    anchor: dict | None
    points: list[list[float]]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "participant_id": str(self.participant_id),
            "color": self.color,
            "anchor": self.anchor,
            "points": [list(p) for p in self.points],
        }


@dataclass
class PresentHub:
    connections: dict[uuid.UUID, PresentConnection] = field(default_factory=dict)
    # Seats taken by joins that passed the cap check but haven't been added yet.
    reserved: int = 0
    # Insertion-ordered (dict order), so joiners get strokes in drawing order (FR-23).
    strokes: dict[str, Stroke] = field(default_factory=dict)
    # The pending "host away for the grace period" timer, owned by the hosting rules.
    host_timer: asyncio.Task | None = None
    # Throttles `last_activity_at` writes to at most once a minute.
    last_activity_touch: datetime | None = None

    # --- seats -------------------------------------------------------------------------

    def try_reserve(self, participant_id: uuid.UUID | None = None) -> bool:
        """Takes a seat if one is free. A participant who is already connected (a
        reconnect that will `replace`) needs no seat and takes none. Synchronous, so
        check-and-take is atomic with respect to the event loop."""
        if participant_id is not None and participant_id in self.connections:
            return True
        if len(self.connections) + self.reserved >= MAX_PARTICIPANTS:
            return False
        self.reserved += 1
        return True

    def release_reservation(self) -> None:
        """Gives back a seat from `try_reserve` that `add` will not consume."""
        self.reserved -= 1

    # --- connections -------------------------------------------------------------------

    def add(
        self,
        participant_id: uuid.UUID,
        websocket: SocketLike,
        name: str,
        now: datetime,
        *,
        signed_in: bool = False,
    ) -> PresentConnection:
        """Adds a new connection, consuming the seat its join reserved, with the lowest
        colour not used by a connected participant (FR-20)."""
        self.reserved -= 1
        used = {c.color for c in self.connections.values()}
        color = next(i for i in range(PALETTE_SIZE) if i not in used)
        connection = PresentConnection(websocket, participant_id, name, now, color, signed_in)
        self.connections[participant_id] = connection
        return connection

    def replace(self, participant_id: uuid.UUID, websocket: SocketLike) -> PresentConnection:
        """Swaps in a newer socket for a connected participant and returns the old
        connection (to be closed with 4409). The participant stays continuously
        connected: colour and `connected_at` are kept. KeyError if not connected."""
        old = self.connections[participant_id]
        self.connections[participant_id] = replace(old, websocket=websocket)
        return old

    def remove(self, participant_id: uuid.UUID, websocket: SocketLike | None = None) -> bool:
        """Removes the participant's connection — only if it is still `websocket`, when
        given, so a replaced socket's handler can't remove its successor. Removing the
        last connection clears the strokes (FR-24)."""
        current = self.connections.get(participant_id)
        if current is None or (websocket is not None and current.websocket is not websocket):
            return False
        del self.connections[participant_id]
        if not self.connections:
            self.strokes.clear()
        return True

    def presence(self) -> list[dict]:
        return [
            {
                "id": str(c.participant_id),
                "name": c.name,
                "color": c.color,
                "signed_in": c.signed_in,
            }
            for c in self.connections.values()
        ]

    def longest_connected(self, exclude: uuid.UUID | None = None) -> uuid.UUID | None:
        """The connected participant with the earliest `connected_at` (FR-26)."""
        candidates = [c for c in self.connections.values() if c.participant_id != exclude]
        if not candidates:
            return None
        return min(candidates, key=lambda c: c.connected_at).participant_id

    # --- strokes -----------------------------------------------------------------------

    def start(
        self,
        stroke_id: str,
        participant_id: uuid.UUID,
        anchor: dict | None,
        points: list[list[float]],
    ) -> Stroke:
        """Starts a stroke in the drawer's colour. DrawingFull past either cap; KeyError
        if the drawer isn't connected."""
        if len(self.strokes) >= MAX_STROKES or len(points) > MAX_POINTS_PER_STROKE:
            raise DrawingFull
        color = self.connections[participant_id].color
        stroke = Stroke(stroke_id, participant_id, color, anchor, [list(p) for p in points])
        self.strokes[stroke_id] = stroke
        return stroke

    def append(self, participant_id: uuid.UUID, stroke_id: str, points: list[list[float]]) -> bool:
        """Adds points to the participant's own stroke. False (ignored) for an unknown
        or someone else's stroke; DrawingFull if the batch would pass the point cap."""
        stroke = self.strokes.get(stroke_id)
        if stroke is None or stroke.participant_id != participant_id:
            return False
        if len(stroke.points) + len(points) > MAX_POINTS_PER_STROKE:
            raise DrawingFull
        stroke.points.extend(list(p) for p in points)
        return True

    def clear(self) -> None:
        self.strokes.clear()

    def stroke_dicts(self) -> list[dict]:
        return [s.to_dict() for s in self.strokes.values()]

    # --- host timer --------------------------------------------------------------------

    def cancel_host_timer(self) -> None:
        if self.host_timer is not None:
            self.host_timer.cancel()
            self.host_timer = None


_hubs: dict[uuid.UUID, PresentHub] = {}


def get_hub(session_id: uuid.UUID) -> PresentHub:
    hub = _hubs.get(session_id)
    if hub is None:
        hub = PresentHub()
        _hubs[session_id] = hub
    return hub


def peek_hub(session_id: uuid.UUID) -> PresentHub | None:
    """The session's hub if it is currently live, without creating one."""
    return _hubs.get(session_id)


def drop_if_empty(session_id: uuid.UUID) -> None:
    """Forgets a hub nobody is connected to or joining. Its host timer is cancelled:
    with nobody connected the timer has nobody to promote, and the next connect
    applies the catch-up rule (FR-27)."""
    hub = _hubs.get(session_id)
    if hub is not None and not hub.connections and hub.reserved == 0:
        hub.cancel_host_timer()
        del _hubs[session_id]
