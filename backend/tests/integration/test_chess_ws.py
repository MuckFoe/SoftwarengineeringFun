"""Spec 014 task 21: the chess socket's join, welcome, seat frames, away and cap
(`games/chess/ws.py`). AC-2..AC-8, AC-25, AC-28, AC-32. Real Postgres, the real app and,
for the signed-in tests, the test Keycloak; nothing mocked.
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.games.chess import repo
from app.main import create_app
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


async def _migrated(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",  # noqa: S106
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
async def account_client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
    settings = Settings(
        oidc_issuer=keycloak.issuer,
        oidc_client_id=keycloak.client_id,
        oidc_client_secret=keycloak.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _invite(client: TestClient) -> str:
    return client.post("/api/games/chess/sessions").json()["invite_id"]


def _url(invite: str, name: str | None = None, rejoin: str | None = None) -> str:
    query = []
    if name is not None:
        query.append(f"name={quote(name)}")
    if rejoin is not None:
        query.append(f"rejoin={quote(rejoin)}")
    return f"/api/games/chess/sessions/{invite}/ws" + (f"?{'&'.join(query)}" if query else "")


class _Socket:
    def __init__(self, ws) -> None:
        self.ws = ws

    def send(self, **frame: object) -> None:
        self.ws.send_json(frame)

    def next(self, type_: str) -> dict:
        while True:
            frame = self.ws.receive_json()
            if frame["type"] == type_:
                return frame

    def state(self, until=lambda s: True) -> dict:
        while True:
            state = self.next("state")["state"]
            if until(state):
                return state

    def expect_close(self) -> int:
        with pytest.raises(WebSocketDisconnect) as info:
            while True:
                self.ws.receive_json()
        return info.value.code


@contextmanager
def _joined(
    client: TestClient,
    invite: str,
    name: str | None = None,
    *,
    rejoin: str | None = None,
    jar=None,
) -> Iterator[tuple[_Socket, dict]]:
    headers = cookie_header(jar) if jar is not None else {}
    with client.websocket_connect(_url(invite, name, rejoin), headers=headers) as ws:
        socket = _Socket(ws)
        welcome = socket.next("welcome")
        yield socket, welcome


def _close_code(client: TestClient, url: str) -> int:
    with pytest.raises(WebSocketDisconnect) as info, client.websocket_connect(url) as ws:
        ws.receive_json()
    return info.value.code


# --- AC-2 ----------------------------------------------------------------------------------


def test_ac2_first_join_is_starter_and_white_with_no_game(client: TestClient) -> None:
    invite = _invite(client)
    with _joined(client, invite, "Ann") as (_, welcome):
        assert welcome["you"]["is_starter"] is True
        assert welcome["rejoin_token"]
        state = welcome["state"]
        assert state["game"] is None
        assert state["invite_id"] == invite
        assert state["seats"]["white"]["participant_id"] == welcome["you"]["participant_id"]
        assert state["seats"]["white"]["name"] == "Ann"
        assert state["seats"]["white"]["away"] is False
        assert state["seats"]["black"] is None
        assert state["viewers"] == []


# --- close codes ---------------------------------------------------------------------------


def test_unknown_invite_closes_4404(client: TestClient) -> None:
    assert _close_code(client, _url("nope", "Ann")) == 4404


async def test_deleted_session_closes_4411(client: TestClient, db: asyncpg.Connection) -> None:
    invite = _invite(client)
    session = await repo.get_session_by_invite(db, invite)
    assert session is not None
    await repo.soft_delete(db, session.id, reason="starter", by_sub=None)
    assert _close_code(client, _url(invite, "Ann")) == 4411


def test_ac3_invalid_name_closes_4422(client: TestClient) -> None:
    invite = _invite(client)
    assert _close_code(client, _url(invite, "")) == 4422
    assert _close_code(client, _url(invite, "x" * 200)) == 4422
    assert _close_code(client, _url(invite)) == 4422


# --- AC-4, AC-5, AC-6, AC-8 ----------------------------------------------------------------


def test_join_order_and_seat_frames_broadcast_one_snapshot(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        a, wa = stack.enter_context(_joined(client, invite, "Ann"))
        b, wb = stack.enter_context(_joined(client, invite, "Bob"))
        c, wc = stack.enter_context(_joined(client, invite, "Cy"))
        pa, pb, pc = (w["you"]["participant_id"] for w in (wa, wb, wc))
        assert wb["state"]["seats"]["black"]["participant_id"] == pb
        assert wb["you"]["is_starter"] is False
        assert wc["state"]["seats"]["white"]["participant_id"] == pa
        assert [v["participant_id"] for v in wc["state"]["viewers"]] == [pc]

        # Ann leaves her seat; everyone gets the same snapshot.
        a.send(type="leave_seat")
        seen = [s.state(lambda st: st["seats"]["white"] is None) for s in (a, b, c)]
        assert seen[0] == seen[1] == seen[2]
        assert {v["participant_id"] for v in seen[0]["viewers"]} == {pa, pc}

        # Cy takes the free white seat.
        c.send(type="take_seat", color="white")
        seen = [s.state(lambda st: st["seats"]["white"] is not None) for s in (a, b, c)]
        assert seen[0] == seen[1] == seen[2]
        assert seen[0]["seats"]["white"]["participant_id"] == pc

        # Taken seat is refused to the sender only.
        a.send(type="take_seat", color="black")
        assert a.next("error")["code"] == "seat_taken"

        # Bob switches to... white is Cy's; a switch needs a free seat. Bob leaves, then takes.
        b.send(type="leave_seat")
        b.state(lambda st: st["seats"]["black"] is None)
        a.send(type="take_seat", color="black")
        final = a.state(lambda st: st["seats"]["black"] is not None)
        assert final["seats"]["black"]["participant_id"] == pa


def test_leave_seat_when_not_seated_is_refused(client: TestClient) -> None:
    invite = _invite(client)
    with _joined(client, invite, "Ann"), _joined(client, invite, "Bob"):
        with _joined(client, invite, "Cy") as (c, _):
            c.send(type="leave_seat")
            assert c.next("error")["code"] == "not_seated"


# --- AC-7 ----------------------------------------------------------------------------------


async def test_ac7_seat_frames_during_a_game_are_refused(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        a, wa = stack.enter_context(_joined(client, invite, "Ann"))
        b, wb = stack.enter_context(_joined(client, invite, "Bob"))
        session = await repo.get_session_by_invite(db, invite)
        assert session is not None
        game = await repo.insert_game(
            db,
            session.id,
            uuid.UUID(wa["you"]["participant_id"]),
            uuid.UUID(wb["you"]["participant_id"]),
        )
        await repo.set_current_game(db, session.id, game.id)
        a.send(type="leave_seat")
        assert a.next("error")["code"] == "game_in_progress"
        b.send(type="take_seat", color="white")
        assert b.next("error")["code"] == "game_in_progress"
        after = await repo.get_session_by_invite(db, invite)
        assert after is not None
        assert after.white_participant_id == uuid.UUID(wa["you"]["participant_id"])
        assert after.black_participant_id == uuid.UUID(wb["you"]["participant_id"])


# --- AC-25 ---------------------------------------------------------------------------------


def test_ac25_away_seat_is_kept_and_rejoin_restores_it(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        a, _ = stack.enter_context(_joined(client, invite, "Ann"))
        with _joined(client, invite, "Bob") as (_, wb):
            black_id = wb["you"]["participant_id"]
            token = wb["rejoin_token"]
        away = a.state(lambda st: st["seats"]["black"]["away"])
        assert away["seats"]["black"]["participant_id"] == black_id

        with _joined(client, invite, "Cy") as (c, _):
            c.send(type="take_seat", color="black")
            assert c.next("error")["code"] == "seat_taken"

        with _joined(client, invite, "ignored", rejoin=token) as (_, back):
            assert back["you"]["participant_id"] == black_id
            assert back["state"]["seats"]["black"]["away"] is False
        a.state(lambda st: st["seats"]["black"]["away"])


# --- AC-32 ---------------------------------------------------------------------------------


def test_ac32_sixth_is_refused_and_away_seated_player_still_gets_in(client: TestClient) -> None:
    invite = _invite(client)
    with ExitStack() as stack:
        stack.enter_context(_joined(client, invite, "Ann"))
        with _joined(client, invite, "Bob") as (_, wb):
            token = wb["rejoin_token"]
        for name in ("Cy", "Di", "Ed"):
            stack.enter_context(_joined(client, invite, name))
        # Ann (white) + 3 viewers connected, Bob (black) away: five places taken.
        full = client.get(f"/api/games/chess/sessions/{invite}").json()["full"]
        assert full is True
        assert _close_code(client, _url(invite, "Flo")) == 4403
        with _joined(client, invite, "Bob", rejoin=token) as (_, back):
            assert back["state"]["seats"]["black"]["away"] is False


def test_not_full_before_anyone_is_in(client: TestClient) -> None:
    invite = _invite(client)
    assert client.get(f"/api/games/chess/sessions/{invite}").json()["full"] is False


# --- AC-3, AC-28: signed in ----------------------------------------------------------------


def test_ac3_signed_in_joins_under_username_without_a_name(
    account_client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = _invite(account_client)
    jar = signed_in_jar(account_client, "newuser")
    with _joined(account_client, invite, jar=jar) as (_, welcome):
        assert welcome["state"]["seats"]["white"]["name"] == "newuser"
        assert welcome["state"]["seats"]["white"]["signed_in"] is True


def test_ac28_signed_in_reconnect_is_the_same_participant_and_seat(
    account_client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = _invite(account_client)
    jar = signed_in_jar(account_client, "newuser")
    with _joined(account_client, invite, "Ann") as (other, _):
        with _joined(account_client, invite, jar=jar) as (_, first):
            black = first["state"]["seats"]["black"]["participant_id"]
            assert first["you"]["participant_id"] == black
        other.state(lambda st: st["seats"]["black"]["away"])
        with _joined(account_client, invite, jar=jar) as (_, second):
            assert second["you"]["participant_id"] == black
            assert second["state"]["seats"]["black"]["participant_id"] == black
            assert second["state"]["seats"]["black"]["away"] is False
