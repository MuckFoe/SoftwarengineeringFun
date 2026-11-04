"""In-memory hub of live WebSocket connections per session (plan.md "Presence and the cap
of 5", "Live editing"). Valid only because there is one `api` process (config.py, compose
`--workers 1`).
"""

import uuid
from dataclasses import dataclass, field, replace
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
    # Computed server-side from `account_sub is not null`, never from the client (FR-8).
    signed_in: bool = False


@dataclass
class SessionHub:
    connections: dict[uuid.UUID, Connection] = field(default_factory=dict)
    # Throttles `last_activity_at` writes from doc edits to at most once a minute.
    last_activity_touch: datetime | None = None
    # Seats taken by joins that passed the cap check but haven't been added yet (FR-13).
    reserved: int = 0

    def try_reserve(self, participant_id: uuid.UUID | None = None) -> bool:
        """Takes a seat if one is free. A participant who is already connected (a
        second device that will `replace`) needs no seat and takes none (FR-7).
        Synchronous, so check-and-take is atomic with respect to the event loop; the
        join's awaits come after it."""
        if participant_id is not None and participant_id in self.connections:
            return True
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

    def replace(self, participant_id: uuid.UUID, websocket: SocketLike) -> Connection:
        """Swaps in a newer socket for a connected participant and returns the old
        connection (to be closed with 4409), so the participant appears once (FR-5).
        KeyError if not connected."""
        old = self.connections[participant_id]
        self.connections[participant_id] = replace(old, websocket=websocket)
        return old

    def remove(self, participant_id: uuid.UUID, websocket: SocketLike | None = None) -> bool:
        """Removes the participant's connection — only if it is still `websocket`, when
        given, so a replaced socket's handler can't remove its successor."""
        current = self.connections.get(participant_id)
        if current is None or (websocket is not None and current.websocket is not websocket):
            return False
        del self.connections[participant_id]
        return True

    def presence(self) -> list[dict]:
        return [
            {"id": str(c.participant_id), "name": c.name, "signed_in": c.signed_in}
            for c in self.connections.values()
        ]


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
