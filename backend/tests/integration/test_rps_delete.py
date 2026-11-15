"""Spec 021 task 28: deleting a Rock Paper Siege session (FR-2, as chess in spec 014 and spec 019).

The starter deletes with the `delete_session` frame and an admin with `DELETE
/api/games/rps/sessions/{invite}` (chess's own soft delete); the host or an admin deletes from
the profile with `DELETE /api/me/sessions/rps/{invite}` (spec 019: every `rps_*` row purged, a
`deleted_session` tombstone of kind `rps`). Everyone connected gets `session_closed` and close
4411; anyone else is refused. Real Postgres and the real app; the account tests use the test
Keycloak (hold the stack lock).
"""

import secrets
import uuid
from collections.abc import AsyncIterator
from contextlib import ExitStack

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.main import create_app
from tests.fixtures.rps_board import fixed_game, pieces
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)
from tests.integration.test_rps_ws import _close_code, _Socket, _url

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
BOARD = pieces({3: "a flag", 8: "a rock", 38: "b flag", 31: "b paper"})
# Every table holding a row of an rps session, with how to find its rows.
_ROWS = {
    "rps_session": "select count(*) from rps_session where id = $1",
    "rps_participant": "select count(*) from rps_participant where session_id = $1",
    "rps_game": "select count(*) from rps_game where session_id = $1",
    "rps_piece": """select count(*) from rps_piece
                     where game_id in (select id from rps_game where session_id = $1)""",
    "rps_duel": """select count(*) from rps_duel
                    where game_id in (select id from rps_game where session_id = $1)""",
    "rps_chat_message": "select count(*) from rps_chat_message where session_id = $1",
}


async def _app(database_url: str, kc: Keycloak | None = None) -> TestClient:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    oidc = (
        (kc.issuer, kc.client_id, kc.client_secret)
        if kc is not None
        else ("http://unused", "unused", "unused")
    )
    return TestClient(
        create_app(
            Settings(
                oidc_issuer=oidc[0],
                oidc_client_id=oidc[1],
                oidc_client_secret=oidc[2],
                session_cookie_key=COOKIE_KEY,
                database_url=database_url,
                runner_url="http://unused",
            )
        )
    )


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    with await _app(database_url) as test_client:
        yield test_client


@pytest.fixture
async def account_client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
) -> AsyncIterator[TestClient]:
    with await _app(database_url, keycloak) as test_client:
        yield test_client


def _connect(stack: ExitStack, client: TestClient, url: str, headers=None) -> _Socket:
    socket = _Socket(stack.enter_context(client.websocket_connect(url, headers=headers or {})))
    socket.next("welcome")
    return socket


def _three(stack: ExitStack, client: TestClient, fixed) -> tuple[_Socket, ...]:
    """The starter A and B by rejoin token, then a viewer."""
    invite = fixed.session.invite_id
    return (
        _connect(stack, client, _url(invite, rejoin=fixed.token_a)),
        _connect(stack, client, _url(invite, rejoin=fixed.token_b)),
        _connect(stack, client, _url(invite, "Cy")),
    )


def _all_closed(sockets, reason: str) -> None:
    for s in sockets:
        assert s.next("session_closed") == {
            "type": "session_closed",
            "result": None,
            "reason": reason,
        }
        with pytest.raises(WebSocketDisconnect) as info:
            s.ws.receive_json()
        assert info.value.code == 4411


async def _row(db: asyncpg.Connection, invite: str) -> asyncpg.Record:
    return await db.fetchrow(
        "select deleted_at, deleted_reason, deleted_by_sub from rps_session where invite_id = $1",
        invite,
    )


async def _counts(db: asyncpg.Connection, session_id: uuid.UUID) -> dict[str, int]:
    return {table: await db.fetchval(sql, session_id) for table, sql in _ROWS.items()}


async def _tombstone(db: asyncpg.Connection, invite: str) -> str | None:
    return await db.fetchval(
        "select deleted_by from deleted_session where kind = 'rps' and invite_id = $1", invite
    )


# --- the session's own deletion (as chess, spec 014 FR-34, FR-35) -----------------------------


async def test_starter_deletes_mid_game_and_everyone_is_closed(
    client: TestClient, db: asyncpg.Connection
) -> None:
    fixed = await fixed_game(db, BOARD)
    invite = fixed.session.invite_id
    with ExitStack() as stack:
        socks = _three(stack, client, fixed)
        socks[0].send(type="delete_session")
        _all_closed(socks, "starter")
    row = await _row(db, invite)
    assert row["deleted_reason"] == "starter"
    assert row["deleted_by_sub"] is None
    assert client.get(f"/api/games/rps/sessions/{invite}").status_code == 410
    assert _close_code(client, _url(invite, "Late")) == 4411


async def test_a_non_starter_player_or_viewer_is_refused(
    client: TestClient, db: asyncpg.Connection
) -> None:
    fixed = await fixed_game(db, BOARD)
    invite = fixed.session.invite_id
    with ExitStack() as stack:
        _, b, viewer = _three(stack, client, fixed)
        for s in (b, viewer):
            s.send(type="delete_session")
            assert s.next("error")["code"] == "not_starter"
    assert (await _row(db, invite))["deleted_at"] is None
    assert client.get(f"/api/games/rps/sessions/{invite}").status_code == 200


def test_anonymous_rest_delete_is_refused(client: TestClient) -> None:
    invite = client.post("/api/games/rps/sessions").json()["invite_id"]
    assert client.delete(f"/api/games/rps/sessions/{invite}").status_code in (401, 403)
    assert client.get(f"/api/games/rps/sessions/{invite}").status_code == 200


async def test_admin_rest_delete_closes_everyone_and_a_plain_user_is_refused(
    account_client: TestClient,
    login_as,  # noqa: F811
    db: asyncpg.Connection,
) -> None:
    fixed = await fixed_game(db, BOARD)
    invite = fixed.session.invite_id
    with ExitStack() as stack:
        socks = _three(stack, account_client, fixed)
        login_as(account_client, "plain1")
        assert account_client.delete(f"/api/games/rps/sessions/{invite}").status_code == 403
        assert (await _row(db, invite))["deleted_at"] is None
        login_as(account_client, "admin1")
        assert account_client.delete(f"/api/games/rps/sessions/{invite}").status_code == 204
        _all_closed(socks, "admin")
    row = await _row(db, invite)
    assert row["deleted_reason"] == "admin"
    assert row["deleted_by_sub"]
    assert account_client.delete(f"/api/games/rps/sessions/{invite}").status_code == 410
    assert account_client.delete("/api/games/rps/sessions/nope").status_code == 404


# --- deletion from the profile (spec 019, kind `rps`) ------------------------------------------


@pytest.fixture
def jars(account_client: TestClient, signed_in_jar) -> dict[str, dict[str, str]]:  # noqa: F811
    class _Jars(dict):
        def __missing__(self, user: str) -> dict[str, str]:
            self[user] = cookie_header(signed_in_jar(account_client, user))
            return self[user]

    return _Jars()


async def _played(
    stack: ExitStack, client: TestClient, db: asyncpg.Connection, jars
) -> tuple[uuid.UUID, str, tuple[_Socket, ...]]:
    """Started by `newuser`, who plays side a signed in against `other`; a guest views. A game
    runs, with a pending duel and a chat line, so every `rps_*` table holds a row."""
    invite = client.post("/api/games/rps/sessions", headers=jars["newuser"]).json()["invite_id"]
    socks = (
        _connect(stack, client, _url(invite, "Ann"), jars["newuser"]),
        _connect(stack, client, _url(invite, "Bob"), jars["other"]),
        _connect(stack, client, _url(invite, "Cy")),
    )
    socks[0].send(type="start")
    socks[0].state(lambda st: st["game"] is not None)
    sid = await db.fetchval("select id from rps_session where invite_id = $1", invite)
    game, pid = await db.fetchrow(
        "select current_game_id, a_participant_id from rps_session where id = $1", sid
    )
    await db.execute(
        "insert into rps_duel (game_id, from_square, to_square, attacker) values ($1, 8, 15, 'a')",
        game,
    )
    await db.execute(
        """insert into rps_chat_message (session_id, participant_id, sender_name, body, sent_at)
           values ($1, $2, 'Ann', $3, now())""",
        sid,
        pid,
        secrets.token_hex(4),
    )
    assert all((await _counts(db, sid)).values())
    return sid, invite, socks


@pytest.mark.parametrize(
    ("who", "by", "reason"), [("newuser", "host", "starter"), ("admin1", "admin", "admin")]
)
async def test_profile_delete_purges_every_rps_row_and_writes_the_tombstone(
    who: str,
    by: str,
    reason: str,
    account_client: TestClient,
    db: asyncpg.Connection,
    jars,
) -> None:
    with ExitStack() as stack:
        sid, invite, socks = await _played(stack, account_client, db, jars)
        response = account_client.delete(f"/api/me/sessions/rps/{invite}", headers=jars[who])
        assert response.status_code == 204, response.text
        _all_closed(socks, reason)
    assert await _counts(db, sid) == dict.fromkeys(_ROWS, 0)
    assert await _tombstone(db, invite) == by
    assert account_client.get(f"/api/games/rps/sessions/{invite}").status_code == 410
    again = account_client.delete(f"/api/me/sessions/rps/{invite}", headers=jars[who])
    assert again.status_code == 410


async def test_profile_delete_by_a_non_starter_player_is_refused(
    account_client: TestClient, db: asyncpg.Connection, jars
) -> None:
    with ExitStack() as stack:
        sid, invite, _ = await _played(stack, account_client, db, jars)
        before = await _counts(db, sid)
        response = account_client.delete(f"/api/me/sessions/rps/{invite}", headers=jars["other"])
        assert response.status_code == 403
        assert response.json() == {"error": "not_host"}
    assert await _counts(db, sid) == before
    assert await _tombstone(db, invite) is None
