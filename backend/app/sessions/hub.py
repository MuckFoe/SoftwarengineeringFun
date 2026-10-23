"""In-memory hub of live WebSocket connections per session (plan.md "Presence and the cap
of 5", "Live editing"). Valid only because there is one `api` process (config.py, compose
`--workers 1`).
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

MAX_PARTICIPANTS = 5


class SocketLike(Protocol):
    async def send_json(self, data: object) -> None: ...
    async def send_bytes(self, data: bytes) -> None: ...


@dataclass(frozen=True)
class Connection:
    websocket: SocketLike
    participant_id: uuid.UUID
    name: str


@dataclass
class SessionHub:
    connections: dict[uuid.UUID, Connection] = field(default_factory=dict)
    # Throttles `last_activity_at` writes from doc edits to at most once a minute.
    last_activity_touch: datetime | None = None
    # Seats taken by joins that passed the cap check but haven't been added yet (FR-13).
    reserved: int = 0

    def try_reserve(self) -> bool:
        """Takes a seat if one is free. Synchronous, so check-and-take is atomic with
        respect to the event loop; the join's awaits come after it."""
        if len(self.connections) + self.reserved >= MAX_PARTICIPANTS:
            return False
        self.reserved += 1
        return True

    def release_reservation(self) -> None:
        """Gives back a seat from `try_reserve` that `add` will not consume."""
        self.reserved -= 1

    def add(self, connection: Connection) -> None:
        """Adds a connection, consuming the seat its join reserved."""
        self.reserved -= 1
        self.connections[connection.participant_id] = connection

    def remove(self, participant_id: uuid.UUID) -> None:
        self.connections.pop(participant_id, None)

    def presence(self) -> list[dict]:
        return [{"id": str(c.participant_id), "name": c.name} for c in self.connections.values()]


_hubs: dict[uuid.UUID, SessionHub] = {}


def get_hub(session_id: uuid.UUID) -> SessionHub:
    hub = _hubs.get(session_id)
    if hub is None:
        hub = SessionHub()
        _hubs[session_id] = hub
    return hub


def peek_hub(session_id: uuid.UUID) -> SessionHub | None:
    """The session's hub if it is currently live, without creating one."""
    return _hubs.get(session_id)


async def broadcast(hub: SessionHub, message: dict, *, exclude: uuid.UUID | None = None) -> None:
    for participant_id, connection in list(hub.connections.items()):
        if participant_id == exclude:
            continue
        try:
            await connection.websocket.send_json(message)
        except Exception:  # noqa: S110  (a dead socket is cleaned up by its own handler)
            pass


async def broadcast_bytes(
    hub: SessionHub, data: bytes, *, exclude: uuid.UUID | None = None
) -> None:
    """Relays a binary (Yjs sync or awareness) frame to the other connections."""
    for participant_id, connection in list(hub.connections.items()):
        if participant_id == exclude:
            continue
        try:
            await connection.websocket.send_bytes(data)
        except Exception:  # noqa: S110  (a dead socket is cleaned up by its own handler)
            pass
