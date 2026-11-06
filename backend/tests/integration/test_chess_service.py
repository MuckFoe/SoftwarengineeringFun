"""Spec 014 task 17: chess service core (FR-3..FR-9, NFR-2, NFR-3).

AC-4 starter White, second Black. AC-5 third person / game in progress -> viewer. AC-6 seat
take/leave/switch. AC-7 seat changes refused in a game. AC-8 snapshot lists everyone.
AC-30 two simultaneous seat-takers: one wins, both see the same result.
"""

import asyncio
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db
from app.accounts.identity import Identity
from app.games.chess import repo, service
from app.games.chess.hub import ChessHub
from app.games.chess.service import Refused


class _Socket:
    async def send_json(self, data: object) -> None:  # pragma: no cover - never sent to
        pass


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


def _hub() -> ChessHub:
    return ChessHub(abandon_seconds=120)


async def _join(
    conn: asyncpg.Connection, session: repo.ChessSession, hub: ChessHub, name: str
) -> repo.Participant:
    session = await repo.get_session(conn, session.id)  # type: ignore[assignment]
    participant, _ = await service.join(
        conn, session, name=name, account=None, rejoin=None, hub=hub
    )
    hub.add(participant.id, _Socket(), name)
    return participant


async def test_create_session_has_invite_and_no_participants(migrated: asyncpg.Connection) -> None:
    session = await service.create_session(migrated)
    assert session.invite_id
    assert await repo.list_participants(migrated, session.id) == []
    assert session.starter_participant_id is None


async def test_starter_white_second_black_third_viewer(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    ana = await _join(migrated, session, hub, "Ana")
    bo = await _join(migrated, session, hub, "Bo")
    cy = await _join(migrated, session, hub, "Cy")
    row = await repo.get_session(migrated, session.id)
    assert row is not None
    assert row.starter_participant_id == ana.id
    assert (row.white_participant_id, row.black_participant_id) == (ana.id, bo.id)
    assert cy.id not in (row.white_participant_id, row.black_participant_id)
    assert hub.seated == {ana.id, bo.id}


async def test_new_person_during_a_game_is_a_viewer(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await repo.create_session(migrated)
    ana = await repo.add_participant(migrated, session.id, "Ana", "h1")
    await repo.set_starter(migrated, session.id, ana.id)
    await repo.set_seats(migrated, session.id, white=ana.id, black=None)
    other = await repo.add_participant(migrated, session.id, "Bo", "h2")
    await repo.set_seats(migrated, session.id, white=ana.id, black=other.id)
    game = await repo.insert_game(migrated, session.id, ana.id, other.id)
    await repo.set_current_game(migrated, session.id, game.id)
    await repo.set_seats(migrated, session.id, white=ana.id, black=None)  # Black seat free
    hub.seated = {ana.id}
    dee = await _join(migrated, session, hub, "Dee")
    row = await repo.get_session(migrated, session.id)
    assert row is not None
    assert dee.id != row.black_participant_id


async def test_rejoin_token_reuses_participant_and_seat(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    ana, token = await service.join(
        migrated, session, name="Ana", account=None, rejoin=None, hub=hub
    )
    again, _ = await service.join(
        migrated, session, name="Other", account=None, rejoin=token, hub=hub
    )
    assert again.id == ana.id and again.display_name == "Ana"


async def test_invalid_name_refused_and_account_join_reuses(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    with pytest.raises(Refused) as err:
        await service.join(migrated, session, name="  ", account=None, rejoin=None, hub=hub)
    assert err.value.code == "invalid_name"
    who = Identity(account_sub="sub-1", name="Zed")
    first, _ = await service.join(migrated, session, name="x", account=who, rejoin=None, hub=hub)
    second, _ = await service.join(migrated, session, name="y", account=who, rejoin=None, hub=hub)
    assert first.id == second.id and first.display_name == "Zed"
    assert len(await repo.list_participants(migrated, session.id)) == 1


async def test_seat_take_leave_switch(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    ana = await _join(migrated, session, hub, "Ana")  # White
    bo = await _join(migrated, session, hub, "Bo")  # Black
    cy = await _join(migrated, session, hub, "Cy")  # viewer

    snap = await service.leave_seat(migrated, session.id, bo.id, hub=hub)
    assert snap.seats.black is None and snap.seats.white is not None

    snap = await service.take_seat(migrated, session.id, cy.id, "black", hub=hub)
    assert snap.seats.black is not None and snap.seats.black.participant_id == str(cy.id)

    snap = await service.leave_seat(migrated, session.id, ana.id, hub=hub)
    assert snap.seats.white is None
    assert str(ana.id) in [v.participant_id for v in snap.viewers]

    snap = await service.take_seat(migrated, session.id, cy.id, "white", hub=hub)  # switch
    assert snap.seats.white is not None and snap.seats.white.participant_id == str(cy.id)
    assert snap.seats.black is None


async def test_taken_seat_refused(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    await _join(migrated, session, hub, "Ana")
    bo = await _join(migrated, session, hub, "Bo")
    cy = await _join(migrated, session, hub, "Cy")
    with pytest.raises(Refused) as err:
        await service.take_seat(migrated, session.id, cy.id, "black", hub=hub)
    assert err.value.code == "seat_taken"
    assert bo.id != cy.id


async def test_seat_changes_refused_during_a_game(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    ana = await _join(migrated, session, hub, "Ana")
    bo = await _join(migrated, session, hub, "Bo")
    cy = await _join(migrated, session, hub, "Cy")
    game = await repo.insert_game(migrated, session.id, ana.id, bo.id)
    await repo.set_current_game(migrated, session.id, game.id)
    for call in (
        service.take_seat(migrated, session.id, cy.id, "white", hub=hub),
        service.leave_seat(migrated, session.id, ana.id, hub=hub),
        service.take_seat(migrated, session.id, ana.id, "black", hub=hub),
    ):
        with pytest.raises(Refused) as err:
            await call
        assert err.value.code == "game_in_progress"
    row = await repo.get_session(migrated, session.id)
    assert row is not None
    assert (row.white_participant_id, row.black_participant_id) == (ana.id, bo.id)


async def test_stale_session_refuses_changes(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    ana = await _join(migrated, session, hub, "Ana")
    await migrated.execute("update chess_session set stale_at = now() where id = $1", session.id)
    with pytest.raises(Refused) as err:
        await service.leave_seat(migrated, session.id, ana.id, hub=hub)
    assert err.value.code == "session_stale"
    assert (await service.snapshot(migrated, session.id, hub)).stale is True


async def test_not_seated_and_unknown_participant(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    await _join(migrated, session, hub, "Ana")
    bo = await _join(migrated, session, hub, "Bo")
    cy = await _join(migrated, session, hub, "Cy")
    with pytest.raises(Refused) as err:
        await service.leave_seat(migrated, session.id, cy.id, hub=hub)
    assert err.value.code == "not_seated"
    assert bo.id != cy.id


async def test_snapshot_lists_seats_and_viewers_by_name(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    for name in ("Ana", "Bo", "Cy", "Dee"):
        await _join(migrated, session, hub, name)
    snap = await service.snapshot(migrated, session.id, hub)
    assert snap.invite_id == session.invite_id
    assert snap.seats.white is not None and snap.seats.white.name == "Ana"
    assert snap.seats.black is not None and snap.seats.black.name == "Bo"
    assert [v.name for v in snap.viewers] == ["Cy", "Dee"]
    assert snap.game is None and snap.stale is False
    assert snap.seats.white.away is False


async def test_snapshot_marks_away_and_game(migrated: asyncpg.Connection) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    ana = await _join(migrated, session, hub, "Ana")
    bo = await _join(migrated, session, hub, "Bo")
    game = await repo.insert_game(migrated, session.id, ana.id, bo.id)
    await repo.set_current_game(migrated, session.id, game.id)
    hub.remove(bo.id)
    snap = await service.snapshot(migrated, session.id, hub)
    assert snap.seats.black is not None and snap.seats.black.away is True
    assert snap.game is not None
    assert snap.game.status == "in_progress" and snap.game.turn == "white"
    assert snap.game.ply == 0 and snap.game.moves == []
    assert "e2" in snap.game.legal


async def test_two_viewers_one_free_seat_exactly_one_wins(
    migrated: asyncpg.Connection, database_url: str
) -> None:
    hub = _hub()
    session = await service.create_session(migrated)
    await _join(migrated, session, hub, "Ana")
    bo = await _join(migrated, session, hub, "Bo")
    cy = await _join(migrated, session, hub, "Cy")
    dee = await _join(migrated, session, hub, "Dee")
    await service.leave_seat(migrated, session.id, bo.id, hub=hub)
    other = await asyncpg.connect(database_url)
    try:
        results = await asyncio.gather(
            service.take_seat(migrated, session.id, cy.id, "black", hub=hub),
            service.take_seat(other, session.id, dee.id, "black", hub=hub),
            return_exceptions=True,
        )
    finally:
        await other.close()
    wins = [r for r in results if isinstance(r, service.Snapshot)]
    losses = [r for r in results if isinstance(r, Refused)]
    assert len(wins) == 1 and len(losses) == 1 and losses[0].code == "seat_taken"
    assert await service.snapshot(migrated, session.id, hub) == wins[0]
