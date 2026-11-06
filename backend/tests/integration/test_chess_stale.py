"""Spec 014 task 28: stale chess sessions and admin reactivation. AC-26 (FR-29).
Real Postgres and the real app; admin tests use the test Keycloak.
"""

from contextlib import ExitStack
from datetime import timedelta

import asyncpg
from fastapi.testclient import TestClient

from app import clock
from app.games.chess import stale
from tests.conftest import FrozenClock
from tests.integration.test_chess_ws import (  # noqa: F401  (pytest fixtures)
    _invite,
    _joined,
    account_client,
    client,
    keycloak,
    login_as,
)

FRAMES = (
    {"type": "take_seat", "color": "black"},
    {"type": "leave_seat"},
    {"type": "start"},
    {"type": "move", "from": "e2", "to": "e4", "ply": 0},
    {"type": "offer_draw"},
    {"type": "answer_draw", "accept": True},
    {"type": "resign"},
    {"type": "claim_win"},
    {"type": "delete_session"},
    {"type": "chat_send", "text": "hello"},
)


def _error(socket) -> str:
    return socket.next("error")["code"]


async def _make_stale(db: asyncpg.Connection, frozen_clock: FrozenClock) -> None:
    frozen_clock.advance(timedelta(days=30, seconds=1))
    assert len(await stale.mark_stale(db, clock.now())) == 1


async def test_ac26_stale_session_refuses_every_changing_frame_but_still_serves_state(
    client: TestClient,  # noqa: F811
    db: asyncpg.Connection,
    frozen_clock: FrozenClock,
) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        ann, _ = stack.enter_context(_joined(client, invite, "Ann"))
        bob, _ = stack.enter_context(_joined(client, invite, "Bob"))
        ann.send(type="take_seat", color="white")
        ann.send(type="start")
        ann.state(lambda st: st["game"] is not None)
        bob.state(lambda st: st["game"] is not None)
        ann.send(type="move", **{"from": "e2", "to": "e4"}, ply=0)
        ann.state(lambda st: st["game"]["ply"] == 1)

        await _make_stale(db, frozen_clock)

        for frame in FRAMES:
            bob.send(**frame)
            assert _error(bob) == "session_stale", frame

    # Read-only: a new joiner still gets the board and the move list.
    with _joined(client, invite, "Cy") as (_, welcome):
        assert welcome["state"]["stale"] is True
        assert [m["to"] for m in welcome["state"]["game"]["moves"]] == ["e4"]


async def test_session_with_activity_29_days_ago_is_not_marked_and_deleted_is_never(
    client: TestClient,  # noqa: F811
    db: asyncpg.Connection,
    frozen_clock: FrozenClock,
) -> None:
    fresh = _invite(client)
    deleted = _invite(client)
    await db.execute(
        "update chess_session set deleted_at = now(), deleted_reason = 'admin'"
        " where invite_id = $1",
        deleted,
    )
    frozen_clock.advance(timedelta(days=29))
    assert await stale.mark_stale(db, clock.now()) == []
    frozen_clock.advance(timedelta(days=2))

    marked = await stale.mark_stale(db, clock.now())

    assert len(marked) == 1
    rows = {
        r["invite_id"]: r["stale_at"]
        for r in await db.fetch("select invite_id, stale_at from chess_session")
    }
    assert rows[fresh] is not None
    assert rows[deleted] is None


async def test_ac26_admin_reactivates_and_play_resumes(
    account_client: TestClient,  # noqa: F811
    db: asyncpg.Connection,
    frozen_clock: FrozenClock,
    login_as,  # noqa: F811
) -> None:
    kc = account_client
    invite = _invite(kc)
    with ExitStack() as stack:
        ann, _ = stack.enter_context(_joined(kc, invite, "Ann"))
        bob, _ = stack.enter_context(_joined(kc, invite, "Bob"))
        ann.send(type="start")
        ann.state(lambda st: st["game"] is not None)
        # Reactivating a fresh session is a conflict.
        login_as(kc, "admin1")
        fresh = kc.post(f"/api/games/chess/sessions/{invite}/reactivate")
        assert fresh.status_code == 409
        assert fresh.json() == {"error": "not_stale"}

        await _make_stale(db, frozen_clock)
        ann.send(type="move", **{"from": "e2", "to": "e4"}, ply=0)
        assert _error(ann) == "session_stale"

        kc.cookies.clear()
        assert kc.post(f"/api/games/chess/sessions/{invite}/reactivate").status_code == 401
        login_as(kc, "plain1")
        assert kc.post(f"/api/games/chess/sessions/{invite}/reactivate").status_code == 403
        login_as(kc, "admin1")
        assert kc.get(f"/api/games/chess/sessions/{invite}").json()["stale"] is True
        done = kc.post(f"/api/games/chess/sessions/{invite}/reactivate")
        assert done.status_code == 200
        assert done.json() == {"invite_id": invite, "stale": False}

        ann.send(type="move", **{"from": "e2", "to": "e4"}, ply=0)
        assert ann.state(lambda st: st["game"]["ply"] == 1)["game"]["moves"][0]["to"] == "e4"
        assert bob.state(lambda st: st["game"]["ply"] == 1)
