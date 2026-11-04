"""Spec 012 task 3: `SessionHub` keeps one connection per participant, newest wins
(FR-5, FR-7), and presence entries carry `signed_in` (FR-8)."""

import uuid

from app.sessions.hub import MAX_PARTICIPANTS, Connection, SessionHub


class FakeSocket:
    async def send_json(self, data: object) -> None:
        pass

    async def send_bytes(self, data: bytes) -> None:
        pass


def join(hub: SessionHub, name: str, *, signed_in: bool = False) -> uuid.UUID:
    pid = uuid.uuid4()
    assert hub.try_reserve(pid)
    hub.add(Connection(FakeSocket(), pid, name, signed_in=signed_in))
    return pid


# --- FR-7: a second device takes no seat -----------------------------------------------


def test_fr7_rejoin_from_second_device_takes_no_seat_and_a_fifth_can_join() -> None:
    assert MAX_PARTICIPANTS == 5
    hub = SessionHub()
    newuser = join(hub, "newuser", signed_in=True)
    for name in ("Ada", "Ben", "Cleo"):
        join(hub, name)
    assert len(hub.connections) == 4

    assert hub.try_reserve(newuser)
    assert hub.reserved == 0
    hub.replace(newuser, FakeSocket())
    assert len(hub.connections) == 4

    assert hub.try_reserve()
    hub.add(Connection(FakeSocket(), uuid.uuid4(), "Dana"))
    assert len(hub.connections) == 5
    assert not hub.try_reserve()
    assert not hub.try_reserve(uuid.uuid4())


def test_connected_participant_reserves_even_when_full() -> None:
    hub = SessionHub()
    pids = [join(hub, f"P{i}") for i in range(MAX_PARTICIPANTS)]
    assert hub.try_reserve(pids[0])
    assert hub.reserved == 0


def test_try_reserve_without_participant_still_works_for_existing_callers() -> None:
    hub = SessionHub()
    for _ in range(MAX_PARTICIPANTS):
        assert hub.try_reserve()
    assert not hub.try_reserve()
    hub.release_reservation()
    assert hub.try_reserve()


# --- FR-5: one entry per participant, the older socket is the one replaced -------------


def test_fr5_replace_keeps_one_entry_and_returns_old_connection() -> None:
    hub = SessionHub()
    ws1, ws2 = FakeSocket(), FakeSocket()
    pid = uuid.uuid4()
    assert hub.try_reserve(pid)
    hub.add(Connection(ws1, pid, "newuser", signed_in=True))

    assert hub.try_reserve(pid)
    old = hub.replace(pid, ws2)

    assert old.websocket is ws1
    assert hub.connections[pid].websocket is ws2
    assert hub.connections[pid].name == "newuser"
    assert hub.connections[pid].signed_in is True
    entries = [p for p in hub.presence() if p["id"] == str(pid)]
    assert len(entries) == 1


def test_fr5_removing_the_replaced_socket_leaves_the_new_one_connected() -> None:
    hub = SessionHub()
    ws1, ws2 = FakeSocket(), FakeSocket()
    pid = uuid.uuid4()
    hub.try_reserve(pid)
    hub.add(Connection(ws1, pid, "newuser"))
    hub.replace(pid, ws2)

    assert hub.remove(pid, ws1) is False
    assert hub.connections[pid].websocket is ws2

    assert hub.remove(pid, ws2) is True
    assert pid not in hub.connections


def test_remove_without_socket_removes_unconditionally() -> None:
    hub = SessionHub()
    pid = join(hub, "Ada")
    assert hub.remove(pid) is True
    assert pid not in hub.connections
    assert hub.remove(pid) is False


# --- FR-8: presence entries -------------------------------------------------------------


def test_presence_entries_are_id_name_signed_in() -> None:
    hub = SessionHub()
    ada = join(hub, "Ada")
    newuser = join(hub, "newuser", signed_in=True)
    assert hub.presence() == [
        {"id": str(ada), "name": "Ada", "signed_in": False},
        {"id": str(newuser), "name": "newuser", "signed_in": True},
    ]


def test_connection_signed_in_defaults_to_false() -> None:
    assert Connection(FakeSocket(), uuid.uuid4(), "Ada").signed_in is False
