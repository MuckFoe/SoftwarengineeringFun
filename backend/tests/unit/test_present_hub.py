"""Task 5: live presentation hub — connections, colours, strokes, longest connected
(AC-15c, AC-19, AC-20, AC-21, AC-22, AC-23, NFR-3)."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.present import hub as hub_module
from app.present.hub import (
    MAX_POINTS_PER_STROKE,
    MAX_STROKES,
    PALETTE_SIZE,
    DrawingFull,
    PresentHub,
    drop_if_empty,
    get_hub,
    peek_hub,
)
from app.sessions import hub as coding_hub
from app.sessions.hub import MAX_PARTICIPANTS

T0 = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)


class FakeSocket:
    async def send_json(self, data: object) -> None:
        pass


def join(hub: PresentHub, name: str, at: datetime = T0) -> uuid.UUID:
    pid = uuid.uuid4()
    assert hub.try_reserve(pid)
    hub.add(pid, FakeSocket(), name, at)
    return pid


# --- colours (AC-19) -------------------------------------------------------------------


def test_two_participants_get_different_colours() -> None:
    hub = PresentHub()
    ben = join(hub, "Ben")
    cleo = join(hub, "Cleo")
    assert hub.connections[ben].color != hub.connections[cleo].color
    assert {hub.connections[ben].color, hub.connections[cleo].color} <= set(range(PALETTE_SIZE))


def test_freed_colour_is_reused_by_next_joiner() -> None:
    hub = PresentHub()
    ana = join(hub, "Ana")
    ben = join(hub, "Ben")
    join(hub, "Cleo")
    ben_colour = hub.connections[ben].color
    hub.remove(ben)
    dana = join(hub, "Dana")
    assert hub.connections[dana].color == ben_colour
    assert hub.connections[ana].color != ben_colour


def test_palette_covers_the_participant_cap() -> None:
    assert PALETTE_SIZE >= MAX_PARTICIPANTS
    hub = PresentHub()
    pids = [join(hub, f"P{i}") for i in range(MAX_PARTICIPANTS)]
    assert len({hub.connections[p].color for p in pids}) == MAX_PARTICIPANTS


def test_presence_lists_id_name_colour_signed_in() -> None:
    hub = PresentHub()
    ana = join(hub, "Ana")
    ben = uuid.uuid4()
    hub.try_reserve(ben)
    hub.add(ben, FakeSocket(), "ben", datetime.now(UTC), signed_in=True)
    assert hub.presence() == [
        {"id": str(ana), "name": "Ana", "color": 0, "signed_in": False},
        {"id": str(ben), "name": "ben", "color": 1, "signed_in": True},
    ]


# --- seats (NFR-3) ---------------------------------------------------------------------


def test_cap_of_five_connections() -> None:
    hub = PresentHub()
    for i in range(MAX_PARTICIPANTS):
        join(hub, f"P{i}")
    assert not hub.try_reserve(uuid.uuid4())
    assert not hub.try_reserve()


def test_reservations_count_against_cap_and_can_be_released() -> None:
    hub = PresentHub()
    for _ in range(MAX_PARTICIPANTS):
        assert hub.try_reserve()
    assert not hub.try_reserve()
    hub.release_reservation()
    assert hub.try_reserve()


def test_reconnect_of_connected_participant_needs_no_seat() -> None:
    hub = PresentHub()
    pids = [join(hub, f"P{i}") for i in range(MAX_PARTICIPANTS)]
    assert hub.try_reserve(pids[0])
    assert hub.reserved == 0


def test_replace_returns_old_connection_and_keeps_colour_and_connected_at() -> None:
    hub = PresentHub()
    ana = join(hub, "Ana", T0)
    old = hub.connections[ana]
    new_socket = FakeSocket()
    returned = hub.replace(ana, new_socket)
    assert returned is old
    current = hub.connections[ana]
    assert current.websocket is new_socket
    assert current.color == old.color
    assert current.connected_at == old.connected_at
    assert current.name == "Ana"


def test_remove_by_replaced_socket_keeps_new_connection() -> None:
    hub = PresentHub()
    ana = join(hub, "Ana")
    old_socket = hub.connections[ana].websocket
    hub.replace(ana, FakeSocket())
    assert hub.remove(ana, old_socket) is False
    assert ana in hub.connections
    assert hub.remove(ana, hub.connections[ana].websocket) is True
    assert ana not in hub.connections


# --- longest connected (AC-15c) --------------------------------------------------------


def test_longest_connected_is_earliest_connected_at() -> None:
    hub = PresentHub()
    cleo = join(hub, "Cleo", T0 + timedelta(seconds=5))
    ben = join(hub, "Ben", T0 + timedelta(seconds=1))
    ana = join(hub, "Ana", T0)
    assert hub.longest_connected() == ana
    assert hub.longest_connected(exclude=ana) == ben
    hub.remove(ben)
    assert hub.longest_connected(exclude=ana) == cleo


def test_longest_connected_none_when_nobody() -> None:
    hub = PresentHub()
    assert hub.longest_connected() is None
    ana = join(hub, "Ana")
    assert hub.longest_connected(exclude=ana) is None


# --- strokes (AC-20, AC-21, AC-22, AC-23, NFR-3) ---------------------------------------


def test_strokes_in_insertion_order_with_points() -> None:
    hub = PresentHub()
    ben = join(hub, "Ben")
    cleo = join(hub, "Cleo")
    anchor = {"path": [0, 1], "fx": 0.5, "fy": 0.25}
    hub.start("s1", ben, anchor, [[0.1, 0.1]])
    hub.start("s2", cleo, None, [[0.9, 0.9]])
    assert hub.append(ben, "s1", [[0.2, 0.2], [0.3, 0.3]])
    assert hub.stroke_dicts() == [
        {
            "id": "s1",
            "participant_id": str(ben),
            "color": hub.connections[ben].color,
            "anchor": anchor,
            "points": [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]],
        },
        {
            "id": "s2",
            "participant_id": str(cleo),
            "color": hub.connections[cleo].color,
            "anchor": None,
            "points": [[0.9, 0.9]],
        },
    ]


def test_append_to_unknown_or_foreign_stroke_is_ignored() -> None:
    hub = PresentHub()
    ben = join(hub, "Ben")
    cleo = join(hub, "Cleo")
    hub.start("s1", ben, None, [])
    assert not hub.append(cleo, "s1", [[0.5, 0.5]])
    assert not hub.append(ben, "nope", [[0.5, 0.5]])
    assert hub.stroke_dicts()[0]["points"] == []


def test_clear_empties_strokes() -> None:
    hub = PresentHub()
    ben = join(hub, "Ben")
    hub.start("s1", ben, None, [[0.1, 0.1]])
    hub.start("s2", ben, None, [[0.2, 0.2]])
    hub.clear()
    assert hub.stroke_dicts() == []


def test_removing_last_connection_empties_strokes() -> None:
    hub = PresentHub()
    ana = join(hub, "Ana")
    ben = join(hub, "Ben")
    hub.start("s1", ben, None, [[0.1, 0.1]])
    hub.remove(ben)
    assert len(hub.stroke_dicts()) == 1
    hub.remove(ana)
    assert hub.stroke_dicts() == []


def test_point_cap_refuses_2001st_point() -> None:
    assert MAX_POINTS_PER_STROKE == 2000
    hub = PresentHub()
    ben = join(hub, "Ben")
    hub.start("s1", ben, None, [[0.0, 0.0]] * 1999)
    assert hub.append(ben, "s1", [[0.5, 0.5]])
    with pytest.raises(DrawingFull):
        hub.append(ben, "s1", [[0.6, 0.6]])
    assert len(hub.stroke_dicts()[0]["points"]) == 2000
    with pytest.raises(DrawingFull):
        hub.start("s2", ben, None, [[0.0, 0.0]] * 2001)


def test_stroke_cap_refuses_501st_stroke() -> None:
    assert MAX_STROKES == 500
    hub = PresentHub()
    ben = join(hub, "Ben")
    for i in range(500):
        hub.start(f"s{i}", ben, None, [])
    with pytest.raises(DrawingFull):
        hub.start("s500", ben, None, [])
    assert len(hub.stroke_dicts()) == 500


# --- host timer slot and registry ------------------------------------------------------


async def test_host_timer_slot_cancel() -> None:
    hub = PresentHub()
    assert hub.host_timer is None
    hub.host_timer = asyncio.create_task(asyncio.sleep(10))
    task = hub.host_timer
    hub.cancel_host_timer()
    assert hub.host_timer is None
    await asyncio.sleep(0)
    assert task.cancelled()


def test_registry_get_peek_drop_and_separate_from_coding_sessions() -> None:
    sid = uuid.uuid4()
    assert peek_hub(sid) is None
    hub = get_hub(sid)
    assert get_hub(sid) is hub
    assert peek_hub(sid) is hub
    assert coding_hub.peek_hub(sid) is None
    ana = join(hub, "Ana")
    drop_if_empty(sid)
    assert peek_hub(sid) is hub
    hub.remove(ana)
    drop_if_empty(sid)
    assert peek_hub(sid) is None
    assert sid not in hub_module._hubs


def test_drop_if_empty_keeps_hub_with_pending_reservation() -> None:
    sid = uuid.uuid4()
    hub = get_hub(sid)
    assert hub.try_reserve()
    drop_if_empty(sid)
    assert peek_hub(sid) is hub
    hub.release_reservation()
    drop_if_empty(sid)
    assert peek_hub(sid) is None
