"""Spec 022 task 7: sketch service — add, clear, undo, snapshot.

AC-4/AC-9 add stores and broadcasts `sketch_added` (no `author_id`). AC-12 clear broadcasts;
a second clear prunes the first and what it hid. AC-13 undo deletes only one's own row.
AC-16 a stale session refuses drawing. AC-18 2,000 typical actions fit; past the budget
`full`; a clear frees room. AC-22 malformed actions are refused.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db
from app.sessions.hub import Connection, SessionHub
from app.sketch import repo, service
from app.sketch.rules import BUDGET_BYTES, SketchError


class _Socket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, data: object) -> None:
        assert isinstance(data, dict)
        self.sent.append(data)

    async def send_bytes(self, data: bytes) -> None:  # pragma: no cover
        raise AssertionError("no binary frames expected")


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """A new coding session with Ana and Ben; returns (session_id, ana_id, ben_id)."""
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ('Add', 'Add', 'def add(a: int, b: int) -> int', 'add', '[]'::jsonb, 'int')
           returning id"""
    )
    session_id = await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        problem_id,
    )
    ids = [
        await conn.fetchval(
            "insert into participant (session_id, display_name) values ($1, $2) returning id",
            session_id,
            name,
        )
        for name in ("Ana", "Ben")
    ]
    return session_id, ids[0], ids[1]


def _hub(*participants: uuid.UUID) -> tuple[SessionHub, list[_Socket]]:
    hub = SessionHub()
    sockets = []
    for participant_id in participants:
        socket = _Socket()
        hub.try_reserve()
        hub.add(Connection(websocket=socket, participant_id=participant_id, name="x"))
        sockets.append(socket)
    return hub, sockets


PEN = {"kind": "pen", "color": "blue", "points": [10, 20, 30, 40]}
BOX = {"kind": "box", "color": "red", "points": [100, 100, 300, 200]}
ELLIPSE = {"kind": "ellipse", "color": "green", "points": [400, 400, 600, 500]}
# A typical pen line: 45 points, under 500 bytes (plan, Open question 2).
TYPICAL = {"kind": "pen", "color": "ink", "points": [1234, 567] * 45}
BIG = {"kind": "pen", "color": "ink", "points": [1600, 1000] * 1000}


def _no_author_id(messages: list[dict]) -> None:
    for message in messages:
        assert "author_id" not in str(message)


async def _rows(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[repo.StoredAction]:
    return await repo.list_actions(conn, session_id)


async def test_ac9_add_stores_and_broadcasts_to_everyone(migrated: asyncpg.Connection) -> None:
    session_id, ana, ben = await _session(migrated)
    hub, (ana_socket, ben_socket) = _hub(ana, ben)

    result = await service.add(migrated, hub, session_id, ana, "c-1", ELLIPSE)

    assert result is None
    (stored,) = await _rows(migrated, session_id)
    assert stored.author_id == ana
    expected = {
        "type": "sketch_added",
        "action": {
            "seq": stored.seq,
            "client_id": "c-1",
            "kind": "ellipse",
            "color": "green",
            "points": [400, 400, 600, 500],
        },
    }
    assert ben_socket.sent == [expected]
    assert ana_socket.sent == [expected]
    _no_author_id(ben_socket.sent)


async def test_ac22_malformed_action_is_invalid_and_nothing_happens(
    migrated: asyncpg.Connection,
) -> None:
    session_id, ana, ben = await _session(migrated)
    hub, sockets = _hub(ana, ben)
    malformed = [
        {"kind": "pen", "color": "<script>", "points": [1, 2]},
        {"kind": "star", "points": [1, 2]},
        {"kind": "clear"},
        {"kind": "pen", "color": "red", "points": [1.5, 2]},
        "not an object",
    ]

    for raw in malformed:
        assert await service.add(migrated, hub, session_id, ana, "c-1", raw) == SketchError.INVALID
    assert await service.add(migrated, hub, session_id, ana, 42, PEN) == SketchError.INVALID  # type: ignore[arg-type]
    assert await service.add(migrated, hub, session_id, ana, "x" * 65, PEN) == SketchError.INVALID
    assert await service.clear(migrated, hub, session_id, ana, "") == SketchError.INVALID

    assert await _rows(migrated, session_id) == []
    assert all(socket.sent == [] for socket in sockets)


async def test_ac12_clear_broadcasts_and_a_second_clear_prunes_the_first(
    migrated: asyncpg.Connection,
) -> None:
    session_id, ana, ben = await _session(migrated)
    hub, (_, ben_socket) = _hub(ana, ben)
    await service.add(migrated, hub, session_id, ana, "c-1", PEN)

    assert await service.clear(migrated, hub, session_id, ben, "c-2") is None

    first_clear = (await _rows(migrated, session_id))[-1]
    assert first_clear.kind == "clear"
    assert ben_socket.sent[-1] == {
        "type": "sketch_added",
        "action": {
            "seq": first_clear.seq,
            "client_id": "c-2",
            "kind": "clear",
        },  # no null color/points keys: the wire shape matches sketchTypes.ts
    }
    snap = await service.snapshot(migrated, session_id)
    assert [a["kind"] for a in snap["actions"]] == ["pen", "clear"]  # hidden pen kept for undo

    await service.add(migrated, hub, session_id, ana, "c-3", BOX)
    assert await service.clear(migrated, hub, session_id, ana, "c-4") is None

    kinds = [row.kind for row in await _rows(migrated, session_id)]
    assert kinds == ["box", "clear"]
    _no_author_id(ben_socket.sent)


async def test_ac13_undo_removes_only_own_actions(migrated: asyncpg.Connection) -> None:
    session_id, ana, ben = await _session(migrated)
    hub, (_, ben_socket) = _hub(ana, ben)
    await service.add(migrated, hub, session_id, ana, "a-1", PEN)
    await service.add(migrated, hub, session_id, ana, "a-2", BOX)
    await service.add(migrated, hub, session_id, ben, "b-1", ELLIPSE)
    line, box, circle = await _rows(migrated, session_id)

    assert await service.undo(migrated, hub, session_id, ana, box.seq) is None
    assert ben_socket.sent[-1] == {"type": "sketch_removed", "seq": box.seq}
    assert [r.seq for r in await _rows(migrated, session_id)] == [line.seq, circle.seq]

    sent_before = len(ben_socket.sent)
    assert await service.undo(migrated, hub, session_id, ana, circle.seq) == SketchError.NOT_YOURS
    assert await service.undo(migrated, hub, session_id, ana, 10**12) == SketchError.NOT_YOURS
    assert await service.undo(migrated, hub, session_id, ana, box.seq) == SketchError.NOT_YOURS
    assert [r.seq for r in await _rows(migrated, session_id)] == [line.seq, circle.seq]
    assert len(ben_socket.sent) == sent_before

    assert await service.undo(migrated, hub, session_id, ana, line.seq) is None
    assert [r.seq for r in await _rows(migrated, session_id)] == [circle.seq]


async def test_ac16_stale_session_refuses_drawing(migrated: asyncpg.Connection) -> None:
    session_id, ana, ben = await _session(migrated)
    hub, sockets = _hub(ana, ben)
    await service.add(migrated, hub, session_id, ana, "c-1", PEN)
    await migrated.execute("update session set stale_at = now() where id = $1", session_id)
    before = await _rows(migrated, session_id)
    sent_before = [len(s.sent) for s in sockets]

    assert await service.add(migrated, hub, session_id, ana, "c-2", BOX) == SketchError.STALE
    assert await service.clear(migrated, hub, session_id, ana, "c-3") == SketchError.STALE

    assert await _rows(migrated, session_id) == before  # the clear's prune rolled back too
    assert [len(s.sent) for s in sockets] == sent_before


async def test_ac18_budget_full_unchanged_and_clear_frees(migrated: asyncpg.Connection) -> None:
    session_id, ana, ben = await _session(migrated)
    hub, (_, ben_socket) = _hub(ana, ben)

    for i in range(2000):
        assert await service.add(migrated, hub, session_id, ana, f"t-{i}", TYPICAL) is None
    snap = await service.snapshot(migrated, session_id)
    assert len(snap["actions"]) == 2000
    assert snap["full"] is False

    # Fill up with big lines until one no longer fits.
    i = 0
    while (result := await service.add(migrated, hub, session_id, ana, f"b-{i}", BIG)) is None:
        i += 1
    assert result == SketchError.FULL
    before = await _rows(migrated, session_id)
    sent_before = len(ben_socket.sent)

    assert await service.add(migrated, hub, session_id, ben, "x", BIG) == SketchError.FULL

    assert await _rows(migrated, session_id) == before
    assert len(ben_socket.sent) == sent_before
    assert await repo.visible_bytes(migrated, session_id) <= BUDGET_BYTES

    # Fill the last bytes with tiny actions until even the smallest is refused.
    tiny = {"kind": "erase", "points": [0, 0]}
    while (result := await service.add(migrated, hub, session_id, ana, "t", tiny)) is None:
        pass
    assert result == SketchError.FULL
    assert (await service.snapshot(migrated, session_id))["full"] is True

    assert await service.clear(migrated, hub, session_id, ben, "c") is None
    assert (await service.snapshot(migrated, session_id))["full"] is False
    assert await service.add(migrated, hub, session_id, ana, "after", BIG) is None


async def test_snapshot_of_a_new_board_is_empty(migrated: asyncpg.Connection) -> None:
    session_id, _, _ = await _session(migrated)

    assert await service.snapshot(migrated, session_id) == {"actions": [], "full": False}


async def test_snapshot_lists_actions_in_seq_order_without_author(
    migrated: asyncpg.Connection,
) -> None:
    session_id, ana, ben = await _session(migrated)
    hub, _ = _hub(ana, ben)
    await service.add(migrated, hub, session_id, ana, "c-1", PEN)
    await service.add(migrated, hub, session_id, ben, "c-2", BOX)

    snap = await service.snapshot(migrated, session_id)

    seqs = [a["seq"] for a in snap["actions"]]
    assert seqs == sorted(seqs)
    assert snap["actions"][1] == {"seq": seqs[1], "client_id": "c-2", **BOX}
    _no_author_id([snap])


async def test_ac10_concurrent_adds_broadcast_in_seq_order(
    migrated: asyncpg.Connection, database_url: str
) -> None:
    session_id, ana, ben = await _session(migrated)
    hub, (ana_socket, ben_socket) = _hub(ana, ben)
    conns = [await asyncpg.connect(database_url) for _ in range(3)]
    try:
        await asyncio.gather(
            *(
                service.add(conn, hub, session_id, ana, f"c-{i}-{j}", PEN)
                for j in range(5)
                for i, conn in enumerate(conns)
            )
        )
    finally:
        for conn in conns:
            await conn.close()

    seqs = [m["action"]["seq"] for m in ben_socket.sent]
    assert len(seqs) == 15
    assert seqs == sorted(seqs)
    assert ana_socket.sent == ben_socket.sent
