"""Spec 014 task 25: resign and delete a session (`games/chess/{service,ws,api}.py`).
AC-22 (FR-24, FR-34) resignation closes the session; AC-34 (FR-34) the invite no longer opens;
AC-35 (FR-35) the starter and an admin delete, anyone else is refused.
Real Postgres and the real app; the admin tests use the test Keycloak (hold the stack lock).
"""

from contextlib import ExitStack

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.games.chess import repo
from tests.integration.test_chess_ws import (  # noqa: F401  (pytest fixtures)
    _close_code,
    _invite,
    _joined,
    _url,
    account_client,
    client,
    keycloak,
    login_as,
)


def _closed(socket) -> dict:
    return socket.next("session_closed")


def _playing(stack: ExitStack, http: TestClient, invite: str, *names: str):
    socks = [stack.enter_context(_joined(http, invite, n))[0] for n in names]
    socks[0].send(type="start")
    for s in socks:
        s.state(lambda st: st["game"] is not None)
    return socks


async def _row(db: asyncpg.Connection, invite: str) -> asyncpg.Record:
    return await db.fetchrow(
        "select deleted_at, deleted_reason, deleted_by_sub from chess_session where invite_id = $1",
        invite,
    )


async def test_ac22_black_resigns_everyone_told_and_link_is_gone(
    client: TestClient,  # noqa: F811
    db: asyncpg.Connection,
) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        white, black, viewer = _playing(stack, client, invite, "Ann", "Bob", "Cy")
        black.send(type="resign")
        for s in (white, black, viewer):
            assert _closed(s) == {
                "type": "session_closed",
                "result": "white",
                "reason": "resignation",
            }
            assert s.expect_close() == 4411
    assert client.get(f"/api/games/chess/sessions/{invite}").status_code == 410
    row = await _row(db, invite)
    assert row["deleted_reason"] == "resignation"
    game = await db.fetchrow(
        "select g.result, g.reason, g.ended_at from chess_game g"
        " join chess_session s on s.id = g.session_id where s.invite_id = $1",
        invite,
    )
    assert (game["result"], game["reason"]) == ("white", "resignation")
    assert game["ended_at"] is not None


def test_resign_by_viewer_or_without_a_game_is_refused(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with ExitStack() as stack:
        a, _ = stack.enter_context(_joined(client, invite, "Ann"))
        a.send(type="resign")
        assert a.next("error")["code"] == "no_game"
        b, _ = stack.enter_context(_joined(client, invite, "Bob"))
        c, _ = stack.enter_context(_joined(client, invite, "Cy"))
        a.send(type="start")
        c.state(lambda st: st["game"] is not None)
        c.send(type="resign")
        assert c.next("error")["code"] == "not_a_player"
    assert client.get(f"/api/games/chess/sessions/{invite}").status_code == 200


def test_ac34_new_visitors_are_told_the_session_is_gone(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with _joined(client, invite, "Ann") as (a, _):
        a.send(type="delete_session")
        assert _closed(a)["reason"] == "starter"
    assert client.get(f"/api/games/chess/sessions/{invite}").status_code == 410
    assert _close_code(client, _url(invite, "Late")) == 4411


async def test_ac35_starter_deletes_and_everyone_is_told(
    client: TestClient,  # noqa: F811
    db: asyncpg.Connection,
) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        white, black, viewer = _playing(stack, client, invite, "Ann", "Bob", "Cy")
        white.send(type="delete_session")
        for s in (white, black, viewer):
            assert _closed(s) == {"type": "session_closed", "result": None, "reason": "starter"}
            assert s.expect_close() == 4411
    assert (await _row(db, invite))["deleted_reason"] == "starter"
    assert client.get(f"/api/games/chess/sessions/{invite}").status_code == 410


async def test_ac35_a_non_starter_is_refused_and_nothing_changes(
    client: TestClient,  # noqa: F811
    db: asyncpg.Connection,
) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        _, black, viewer = _playing(stack, client, invite, "Ann", "Bob", "Cy")
        for s in (black, viewer):
            s.send(type="delete_session")
            assert s.next("error")["code"] == "not_starter"
    assert (await _row(db, invite))["deleted_at"] is None
    assert client.get(f"/api/games/chess/sessions/{invite}").status_code == 200
    with _joined(client, invite, "Dee"):
        pass


def test_ac35_anonymous_rest_delete_is_refused(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    assert client.delete(f"/api/games/chess/sessions/{invite}").status_code in (401, 403)
    assert client.get(f"/api/games/chess/sessions/{invite}").status_code == 200


async def test_ac35_admin_delete_closes_everyone_and_non_admin_is_refused(
    account_client: TestClient,  # noqa: F811
    login_as,  # noqa: F811
    db: asyncpg.Connection,
) -> None:
    invite = _invite(account_client)
    with ExitStack() as stack:
        socks = _playing(stack, account_client, invite, "Ann", "Bob")
        login_as(account_client, "plain1")
        refused = account_client.delete(f"/api/games/chess/sessions/{invite}")
        assert refused.status_code == 403
        assert (await _row(db, invite))["deleted_at"] is None
        login_as(account_client, "admin1")
        assert account_client.delete(f"/api/games/chess/sessions/{invite}").status_code == 204
        for s in socks:
            assert _closed(s)["reason"] == "admin"
            assert s.expect_close() == 4411
    row = await _row(db, invite)
    assert row["deleted_reason"] == "admin"
    assert row["deleted_by_sub"]
    again = account_client.delete(f"/api/games/chess/sessions/{invite}")
    assert again.status_code == 410
    assert account_client.delete("/api/games/chess/sessions/nope").status_code == 404


async def test_service_delete_session_is_not_found_twice(
    client: TestClient,  # noqa: F811
    db: asyncpg.Connection,
) -> None:
    from app.games.chess import service

    invite = _invite(client)
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    closed = await service.delete_session(
        db, session.id, reason="admin", by_participant=None, by_sub="sub-1"
    )
    assert closed == service.Closed(result=None, reason="admin")
    with pytest.raises(service.Refused) as info:
        await service.delete_session(
            db, session.id, reason="admin", by_participant=None, by_sub="sub-1"
        )
    assert info.value.code == "not_found"
