"""Spec 014 task 26: claiming the win after abandonment (`service.claim_win`, the hub's abandon
timer). AC-33, AC-25. Real Postgres and the real app; time is `app.clock.frozen`.
"""

from collections.abc import AsyncIterator
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.config import Settings
from app.main import create_app
from tests.integration.test_chess_ws import (  # noqa: F401  (fixtures and helpers)
    COOKIE_KEY,
    _invite,
    _joined,
    _migrated,
    client,
)

T0 = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


def _at(seconds: float):
    return clock.frozen(T0 + timedelta(seconds=seconds))


def _started(stack: ExitStack, web: TestClient, invite: str):
    """Ann (White, starter), Bob (Black), with a game in progress. Returns both sockets, Bob's
    rejoin token and Ann's socket having seen the game."""
    ann, _ = stack.enter_context(_joined(web, invite, "Ann"))
    bob_cm = _joined(web, invite, "Bob")
    bob, welcome = bob_cm.__enter__()
    ann.send(type="start")
    ann.state(lambda st: st["game"] is not None)
    return ann, bob, bob_cm, welcome["rejoin_token"]


def test_ac33_claim_needs_the_full_interval(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with ExitStack() as stack, _at(0):
        ann, _, bob_cm, _ = _started(stack, client, invite)
        bob_cm.__exit__(None, None, None)
        ann.state(lambda st: st["seats"]["black"]["away"])
        with _at(119):
            ann.send(type="claim_win")
            assert ann.next("error")["code"] == "claim_not_available"
            viewer, welcome = stack.enter_context(_joined(client, invite, "Cy"))
            assert welcome["state"]["game"]["claim_available_to"] is None
        with _at(120):
            viewer2, welcome = stack.enter_context(_joined(client, invite, "Di"))
            assert welcome["state"]["game"]["claim_available_to"] == "white"
            viewer2.send(type="claim_win")
            assert viewer2.next("error")["code"] == "claim_not_available"
            ann.send(type="claim_win")
            closed = ann.next("session_closed")
            assert (closed["result"], closed["reason"]) == ("white", "abandonment")
            assert ann.expect_close() == 4411
            assert viewer.next("session_closed")["reason"] == "abandonment"
    assert client.get(f"/api/games/chess/sessions/{invite}").status_code == 410


def test_ac33_an_opponent_who_came_back_resets_the_interval(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with ExitStack() as stack, _at(0):
        ann, _, bob_cm, token = _started(stack, client, invite)
        bob_cm.__exit__(None, None, None)
        ann.state(lambda st: st["seats"]["black"]["away"])
        with _at(90):
            with _joined(client, invite, rejoin=token):
                ann.state(lambda st: not st["seats"]["black"]["away"])
            ann.state(lambda st: st["seats"]["black"]["away"])
        with _at(150):  # 60 s since the second departure, 150 s since the first
            ann.send(type="claim_win")
            assert ann.next("error")["code"] == "claim_not_available"
        with _at(210):
            ann.send(type="claim_win")
            assert ann.next("session_closed")["reason"] == "abandonment"


def test_claim_is_refused_when_nobody_is_away(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with ExitStack() as stack, _at(0):
        ann, bob, bob_cm, _ = _started(stack, client, invite)
        with _at(500):
            ann.send(type="claim_win")
            assert ann.next("error")["code"] == "claim_not_available"
            bob.send(type="claim_win")
            assert bob.next("error")["code"] == "claim_not_available"
        bob_cm.__exit__(None, None, None)


def test_ac25_reopening_within_the_interval_keeps_the_game(client: TestClient) -> None:  # noqa: F811
    invite = _invite(client)
    with ExitStack() as stack, _at(0):
        ann, _, bob_cm, token = _started(stack, client, invite)
        ann.send(type="move", **{"from": "e2", "to": "e4"}, ply=0)
        ann.state(lambda st: st["game"]["ply"] == 1)
        bob_cm.__exit__(None, None, None)
        ann.state(lambda st: st["seats"]["black"]["away"])
        with _at(60), _joined(client, invite, rejoin=token) as (bob, welcome):
            assert welcome["state"]["game"]["claim_available_to"] is None
            bob.send(type="move", **{"from": "e7", "to": "e5"}, ply=1)
            state = bob.state(lambda st: st["game"]["ply"] == 2)
            assert state["game"]["claim_available_to"] is None


@pytest.fixture
async def quick_client(database_url: str) -> AsyncIterator[TestClient]:
    await _migrated(database_url)
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",  # noqa: S106
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
        chess_abandon_seconds=0.3,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_the_hub_timer_tells_everyone_the_claim_is_open(quick_client: TestClient) -> None:
    invite = _invite(quick_client)
    with ExitStack() as stack:
        ann, _, bob_cm, _ = _started(stack, quick_client, invite)
        bob_cm.__exit__(None, None, None)
        state = ann.state(lambda st: st["game"]["claim_available_to"] == "white")
        assert state["seats"]["black"]["away"] is True
        ann.send(type="claim_win")
        assert ann.next("session_closed")["result"] == "white"
