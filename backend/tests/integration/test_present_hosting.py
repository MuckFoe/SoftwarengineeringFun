"""Spec 013 task 17: hosting rules (FR-8, FR-16, FR-25–FR-29).

AC-8 the first to connect hosts; AC-15 away and return within the grace; AC-15b hand-over;
AC-15c promotion of the longest-connected after the grace, 59 s vs 60 s; AC-15d a lone joiner
claims hosting after the grace; AC-15e a former host returns as a participant; AC-15f the host
is kept (away) for a joiner within the grace. The place never changes (FR-29). A real
database, a real `PresentHub` with fake sockets, and explicit instants (clock frozen too).
"""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app import db as app_db
from app.present import hosting, repo, service
from app.present.hosting import HostEvent
from app.present.hub import PresentHub
from tests.conftest import FrozenClock

T0 = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
GRACE = 60.0
SLIDES = "".join(f"<section>Slide {i}</section>" for i in range(4)).encode()


class FakeSocket:
    async def send_json(self, data: object) -> None:
        pass


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
def clock_at(frozen_clock: FrozenClock) -> FrozenClock:
    frozen_clock.set(T0)
    return frozen_clock


class Room:
    """A started session, its live hub, and helpers that connect/disconnect by name."""

    def __init__(self, conn: asyncpg.Connection, session: repo.PresentSession) -> None:
        self.conn = conn
        self.session = session
        self.hub = PresentHub()
        self.ids: dict[str, uuid.UUID] = {}

    async def join(self, name: str) -> uuid.UUID:
        joined = await service.join(self.conn, self.session.id, name, None)
        self.ids[name] = joined.participant.id
        return joined.participant.id

    async def connect(self, name: str, at: datetime) -> HostEvent | None:
        pid = self.ids.get(name) or await self.join(name)
        assert self.hub.try_reserve(pid)
        self.hub.add(pid, FakeSocket(), name, at)
        return await hosting.on_connect(self.conn, self.hub, self.session.id, pid, at, grace=GRACE)

    async def disconnect(self, name: str, at: datetime) -> HostEvent | None:
        pid = self.ids[name]
        assert self.hub.remove(pid)
        return await hosting.on_disconnect(self.conn, self.hub, self.session.id, pid, at)

    async def promote(self, at: datetime) -> HostEvent | None:
        return await hosting.promote_if_due(self.conn, self.hub, self.session.id, at, GRACE)

    async def stored(self) -> repo.PresentSession:
        found = await repo.get_session_by_invite(self.conn, self.session.invite_id)
        assert found is not None
        return found


@pytest.fixture
async def room(migrated: asyncpg.Connection, clock_at: FrozenClock) -> Room:
    entry = await service.add_presentation(
        migrated, title="Intro to DNS", topic="Networking", data=SLIDES, by_sub="editor-sub"
    )
    session = await service.start_session(migrated, entry.id)
    return Room(migrated, session)


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


async def _ana_hosts_on_slide_2(room: Room) -> None:
    await room.connect("Ana", at(0))
    await service.set_place(room.conn, room.session.id, room.ids["Ana"], 2, None)


# --- AC-8, AC-15 -------------------------------------------------------------------------------


async def test_first_connect_becomes_host(room: Room) -> None:
    event = await room.connect("Ana", at(0))

    assert event == HostEvent(room.ids["Ana"], "Ana", False, "start")
    stored = await room.stored()
    assert (stored.host_participant_id, stored.host_away_since) == (room.ids["Ana"], None)


async def test_second_connect_changes_nothing(room: Room) -> None:
    await room.connect("Ana", at(0))
    assert await room.connect("Ben", at(1)) is None
    assert (await room.stored()).host_participant_id == room.ids["Ana"]


async def test_host_disconnect_is_away_and_return_within_grace_keeps_host(room: Room) -> None:
    await _ana_hosts_on_slide_2(room)
    await room.connect("Ben", at(1))

    away = await room.disconnect("Ana", at(10))
    assert away == HostEvent(room.ids["Ana"], "Ana", True, "away")
    stored = await room.stored()
    assert (stored.host_participant_id, stored.host_away_since, stored.slide) == (
        room.ids["Ana"],
        at(10),
        2,
    )

    back = await room.connect("Ana", at(40))
    assert back == HostEvent(room.ids["Ana"], "Ana", False, "returned")
    stored = await room.stored()
    assert (stored.host_participant_id, stored.host_away_since) == (room.ids["Ana"], None)
    # Still host: she can move, and Ben follows the stored place.
    await service.set_place(room.conn, room.session.id, room.ids["Ana"], 3, None)
    assert (await room.stored()).slide == 3


async def test_non_host_disconnect_changes_nothing(room: Room) -> None:
    await room.connect("Ana", at(0))
    await room.connect("Ben", at(1))
    assert await room.disconnect("Ben", at(5)) is None
    assert (await room.stored()).host_away_since is None


# --- AC-15c -------------------------------------------------------------------------------------


async def test_promote_longest_connected_after_grace_place_unchanged(room: Room) -> None:
    await _ana_hosts_on_slide_2(room)
    await room.connect("Ben", at(1))
    await room.connect("Cleo", at(2))
    await room.disconnect("Ana", at(10))

    assert await room.promote(at(10 + 59)) is None
    assert (await room.stored()).host_participant_id == room.ids["Ana"]

    event = await room.promote(at(10 + 60))
    assert event == HostEvent(room.ids["Ben"], "Ben", False, "timeout")
    stored = await room.stored()
    assert (stored.host_participant_id, stored.host_away_since, stored.slide) == (
        room.ids["Ben"],
        None,
        2,
    )


async def test_promote_when_host_present_or_nobody_connected_is_none(room: Room) -> None:
    await room.connect("Ana", at(0))
    assert await room.promote(at(500)) is None  # host present

    await room.disconnect("Ana", at(10))
    assert await room.promote(at(500)) is None  # nobody to promote
    assert (await room.stored()).host_participant_id == room.ids["Ana"]


async def test_promote_before_anyone_hosted_is_none(room: Room) -> None:
    assert await room.promote(at(500)) is None


# --- AC-15b -------------------------------------------------------------------------------------


async def test_hand_over_makes_target_host_and_old_host_cannot_move(room: Room) -> None:
    await _ana_hosts_on_slide_2(room)
    await room.connect("Ben", at(1))
    await room.connect("Cleo", at(2))

    event = await hosting.hand_over(
        room.conn, room.hub, room.session.id, room.ids["Ana"], room.ids["Cleo"]
    )

    assert event == HostEvent(room.ids["Cleo"], "Cleo", False, "handover")
    stored = await room.stored()
    assert (stored.host_participant_id, stored.slide) == (room.ids["Cleo"], 2)
    await service.set_place(room.conn, room.session.id, room.ids["Cleo"], 3, None)
    assert (await room.stored()).slide == 3
    with pytest.raises(service.NotHost):
        await service.set_place(room.conn, room.session.id, room.ids["Ana"], 1, None)


async def test_hand_over_by_non_host_is_refused(room: Room) -> None:
    await room.connect("Ana", at(0))
    await room.connect("Ben", at(1))
    await room.connect("Cleo", at(2))

    with pytest.raises(service.NotHost) as refused:
        await hosting.hand_over(
            room.conn, room.hub, room.session.id, room.ids["Ben"], room.ids["Cleo"]
        )
    assert refused.value.code == "not_host"
    assert (await room.stored()).host_participant_id == room.ids["Ana"]


async def test_hand_over_to_disconnected_participant_is_refused(room: Room) -> None:
    await room.connect("Ana", at(0))
    await room.connect("Ben", at(1))
    await room.disconnect("Ben", at(2))
    stranger = uuid.uuid4()

    for target in (room.ids["Ben"], stranger):
        with pytest.raises(hosting.NotConnected) as refused:
            await hosting.hand_over(room.conn, room.hub, room.session.id, room.ids["Ana"], target)
        assert refused.value.code == "not_connected"
    assert (await room.stored()).host_participant_id == room.ids["Ana"]


# --- AC-15d, AC-15e, AC-15f ---------------------------------------------------------------------


async def test_lone_joiner_claims_after_grace(room: Room) -> None:
    await _ana_hosts_on_slide_2(room)
    await room.disconnect("Ana", at(10))

    event = await room.connect("Ben", at(10 + 61))

    assert event == HostEvent(room.ids["Ben"], "Ben", False, "claimed")
    stored = await room.stored()
    assert (stored.host_participant_id, stored.host_away_since, stored.slide) == (
        room.ids["Ben"],
        None,
        2,
    )


async def test_connect_after_missed_timer_promotes_longest_connected(room: Room) -> None:
    """FR-26 catch-up: the timer didn't fire (e.g. a restart); a later connect applies it."""
    await room.connect("Ana", at(0))
    await room.connect("Ben", at(1))
    await room.disconnect("Ana", at(10))

    event = await room.connect("Cleo", at(10 + 90))

    assert event == HostEvent(room.ids["Ben"], "Ben", False, "timeout")
    assert (await room.stored()).host_participant_id == room.ids["Ben"]


async def test_former_host_returns_as_participant(room: Room) -> None:
    await room.connect("Ana", at(0))
    await room.connect("Ben", at(1))
    await room.disconnect("Ana", at(10))
    await room.promote(at(70))

    assert await room.connect("Ana", at(80)) is None
    assert (await room.stored()).host_participant_id == room.ids["Ben"]
    with pytest.raises(service.NotHost):
        await service.set_place(room.conn, room.session.id, room.ids["Ana"], 1, None)


async def test_everyone_leaves_and_joiner_within_grace_keeps_host(room: Room) -> None:
    await room.connect("Ana", at(0))
    await room.connect("Cleo", at(1))
    await hosting.hand_over(room.conn, room.hub, room.session.id, room.ids["Ana"], room.ids["Cleo"])
    await service.set_place(room.conn, room.session.id, room.ids["Cleo"], 3, None)
    assert await room.disconnect("Ana", at(5)) is None
    await room.disconnect("Cleo", at(6))

    assert await room.connect("Dana", at(6 + 30)) is None

    stored = await room.stored()
    assert (stored.host_participant_id, stored.host_away_since, stored.slide) == (
        room.ids["Cleo"],
        at(6),
        3,
    )
    state = await service.session_state(room.conn, room.session.invite_id)
    assert state.host_name == "Cleo"


# --- spec 012 FR-8: the host's signed-in mark ---------------------------------------------------


async def _join_account(room: Room, name: str) -> uuid.UUID:
    participant, _ = await repo.join_as_account(
        room.conn, room.session.id, f"{name}-sub", name, uuid.uuid4().hex
    )
    room.ids[name] = participant.id
    return participant.id


async def test_signed_in_host_carries_signed_in_until_hosting_passes(room: Room) -> None:
    await _join_account(room, "newuser")

    start = await room.connect("newuser", at(0))
    assert start == HostEvent(room.ids["newuser"], "newuser", False, "start", True)
    assert await hosting.host_signed_in(room.conn, room.ids["newuser"]) is True

    await room.connect("Ben", at(1))
    away = await room.disconnect("newuser", at(10))
    assert away is not None and away.host_signed_in is True

    promoted = await room.promote(at(10 + 60))
    assert promoted == HostEvent(room.ids["Ben"], "Ben", False, "timeout", False)
    assert await hosting.host_signed_in(room.conn, room.ids["Ben"]) is False


async def test_hand_over_between_signed_in_and_anonymous(room: Room) -> None:
    await room.connect("Ana", at(0))
    await _join_account(room, "newuser")
    await room.connect("newuser", at(1))

    to_account = await hosting.hand_over(
        room.conn, room.hub, room.session.id, room.ids["Ana"], room.ids["newuser"]
    )
    assert to_account.host_signed_in is True
    back = await hosting.hand_over(
        room.conn, room.hub, room.session.id, room.ids["newuser"], room.ids["Ana"]
    )
    assert back.host_signed_in is False
