"""Spec 019 task 2: `close_deleted` tells and disconnects everyone in a deleted coding,
learning or presentation session (AC-6, hook part; FR-7)."""

import asyncio
import uuid
from datetime import UTC, datetime

import pytest

from app.learn import ws as learn_ws
from app.present import hub as present_hub
from app.present import ws as present_ws
from app.sessions import hub as session_hub
from app.sessions import ws as sessions_ws

T0 = datetime(2026, 11, 12, 12, 0, tzinfo=UTC)


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[object] = []
        self.closed_with: int | None = None

    async def send_json(self, data: object) -> None:
        self.sent.append(data)

    async def send_bytes(self, data: bytes) -> None:
        pass

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code


def _assert_told_and_closed(sockets: list[FakeSocket], by: str) -> None:
    for socket in sockets:
        assert socket.sent == [{"type": "session_deleted", "by": by}]
        assert socket.closed_with == 4411


def _session_hub_with_two(session_id: uuid.UUID) -> list[FakeSocket]:
    hub = session_hub.get_hub(session_id)
    sockets = [FakeSocket(), FakeSocket()]
    for socket in sockets:
        assert hub.try_reserve()
        hub.add(session_hub.Connection(socket, uuid.uuid4(), "P"))
    return sockets


@pytest.mark.parametrize("module", [sessions_ws, learn_ws], ids=["coding", "learning"])
async def test_ac6_close_deleted_tells_closes_and_drops_session_hub(module) -> None:
    assert module.CLOSE_DELETED == 4411
    session_id = uuid.uuid4()
    sockets = _session_hub_with_two(session_id)

    await module.close_deleted(session_id, "host")

    _assert_told_and_closed(sockets, "host")
    assert session_hub.peek_hub(session_id) is None


async def test_ac6_close_deleted_by_admin_says_admin() -> None:
    session_id = uuid.uuid4()
    sockets = _session_hub_with_two(session_id)

    await sessions_ws.close_deleted(session_id, "admin")

    _assert_told_and_closed(sockets, "admin")


async def test_ac6_close_deleted_tells_closes_and_drops_presentation_hub() -> None:
    assert present_ws.CLOSE_DELETED == 4411
    session_id = uuid.uuid4()
    hub = present_hub.get_hub(session_id)
    sockets = [FakeSocket(), FakeSocket()]
    for socket in sockets:
        assert hub.try_reserve()
        hub.add(uuid.uuid4(), socket, "P", T0)
    timer = asyncio.create_task(asyncio.sleep(60))
    hub.host_timer = timer

    await present_ws.close_deleted(session_id, "host")

    _assert_told_and_closed(sockets, "host")
    assert present_hub.peek_hub(session_id) is None
    await asyncio.sleep(0)
    assert timer.cancelled()


async def test_close_deleted_tolerates_a_socket_that_is_already_gone() -> None:
    class DeadSocket(FakeSocket):
        async def send_json(self, data: object) -> None:
            raise RuntimeError("gone")

        async def close(self, code: int = 1000) -> None:
            raise RuntimeError("gone")

    session_id = uuid.uuid4()
    hub = session_hub.get_hub(session_id)
    alive = FakeSocket()
    for socket in (DeadSocket(), alive):
        assert hub.try_reserve()
        hub.add(session_hub.Connection(socket, uuid.uuid4(), "P"))

    await sessions_ws.close_deleted(session_id, "host")

    _assert_told_and_closed([alive], "host")
    assert session_hub.peek_hub(session_id) is None


@pytest.mark.parametrize(
    "module", [sessions_ws, learn_ws, present_ws], ids=["coding", "learning", "presentation"]
)
async def test_close_deleted_without_a_hub_is_a_no_op(module) -> None:
    await module.close_deleted(uuid.uuid4(), "host")
