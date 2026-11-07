"""Spec 014 task 29: a chess session survives an app restart. AC-24 (FR-27, NFR-4), plus
the threefold count and the away timer after a restart (plan.md "Away tracking").

A "restart" is a fresh app on the same database; the hub, the board cache and the away
timers are in memory and are gone, so everything below must come back from the tables.
Real Postgres and the real app; nothing mocked. Marked `slow`.
"""

import asyncio
import time
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.integration.test_chess_ws import COOKIE_KEY, _invite, _joined, _migrated
from tests.integration.test_chess_ws_game import _mv, _play

pytestmark = pytest.mark.slow

ABANDON_SECONDS = 3
OPENING = [("e2", "e4"), ("e7", "e5"), ("g1", "f3"), ("b8", "c6")]
# Knights out and back: each cycle repeats the position it started from.
SHUFFLE = [("g1", "f3"), ("g8", "f6"), ("f3", "g1"), ("f6", "g8")]


@contextmanager
def _app(database_url: str) -> Iterator[TestClient]:
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",  # noqa: S106
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
        chess_abandon_seconds=ABANDON_SECONDS,
    )
    with TestClient(create_app(settings)) as client:
        yield client


def _without_away(state: dict) -> dict:
    seats = {
        c: s and {k: v for k, v in s.items() if k != "away"} for c, s in state["seats"].items()
    }
    return {**state, "seats": seats}


def _chat(client: TestClient, invite: str) -> list[dict]:
    response = client.get(f"/api/games/chess/sessions/{invite}/chat")
    assert response.status_code == 200, response.text
    return response.json()["messages"]


def _say(sock, text: str) -> None:
    client_id = f"c-{text}"
    sock.send(type="chat_send", text=text, client_id=client_id)
    # Everyone gets every broadcast, so an earlier speaker's message may already be queued on
    # this socket: wait for our own echo, which is sent only once the message is stored.
    while sock.next("chat_message")["client_id"] != client_id:
        pass


async def test_ac24_after_a_restart_everything_is_as_it_was_and_play_continues(
    database_url: str,
) -> None:
    await _migrated(database_url)
    with _app(database_url) as client:
        invite = _invite(client)
        with ExitStack() as stack:
            ann, ann_welcome = stack.enter_context(_joined(client, invite, "Ann"))
            bob, bob_welcome = stack.enter_context(_joined(client, invite, "Bob"))
            cy, cy_welcome = stack.enter_context(_joined(client, invite, "Cy"))
            ann.send(type="start")
            for s in (ann, bob, cy):
                s.state(lambda st: st["game"] is not None)
            _play(ann, bob, OPENING)
            _say(ann, "good luck")
            _say(cy, "watching")
        tokens = {
            "Ann": ann_welcome["rejoin_token"],
            "Bob": bob_welcome["rejoin_token"],
            "Cy": cy_welcome["rejoin_token"],
        }
        # Cy's welcome now is the snapshot to compare against (the only viewer either way).
        with _joined(client, invite, rejoin=tokens["Cy"]) as (_, before_welcome):
            pass
        chat_before = _chat(client, invite)
    assert [m["text"] for m in chat_before] == ["good luck", "watching"]
    before = _without_away(before_welcome["state"])
    assert before["game"]["ply"] == 4
    assert len(before["game"]["moves"]) == 4

    with _app(database_url) as client:  # restarted
        with ExitStack() as stack:
            cy, after_welcome = stack.enter_context(_joined(client, invite, rejoin=tokens["Cy"]))
            assert after_welcome["you"]["participant_id"] == cy_welcome["you"]["participant_id"]
            assert _without_away(after_welcome["state"]) == before
            # Both seated players are away until they rejoin.
            assert [s["away"] for s in after_welcome["state"]["seats"].values()] == [True, True]
            assert _chat(client, invite) == chat_before

            ann, ann_welcome = stack.enter_context(_joined(client, invite, rejoin=tokens["Ann"]))
            bob, bob_welcome = stack.enter_context(_joined(client, invite, rejoin=tokens["Bob"]))
            assert ann_welcome["state"]["game"]["moves"] == before["game"]["moves"]
            # Play continues: White's fifth ply is accepted and everyone sees it.
            _mv(ann, "f1", "c4", 4)
            for s in (ann, bob, cy):
                game = s.state(lambda st: st["game"]["ply"] == 5)["game"]
                assert game["moves"][-1]["from"] == "f1"
            _say(bob, "after restart")
        assert [m["text"] for m in _chat(client, invite)][-1] == "after restart"


async def test_a_repeated_position_before_the_restart_counts_after_it(database_url: str) -> None:
    await _migrated(database_url)
    with _app(database_url) as client:
        invite = _invite(client)
        with ExitStack() as stack:
            ann, ann_welcome = stack.enter_context(_joined(client, invite, "Ann"))
            bob, bob_welcome = stack.enter_context(_joined(client, invite, "Bob"))
            ann.send(type="start")
            for s in (ann, bob):
                s.state(lambda st: st["game"] is not None)
            _play(ann, bob, SHUFFLE)  # the start position has now occurred twice
        tokens = (ann_welcome["rejoin_token"], bob_welcome["rejoin_token"])

    with _app(database_url) as client:
        with ExitStack() as stack:
            ann, _ = stack.enter_context(_joined(client, invite, rejoin=tokens[0]))
            bob, _ = stack.enter_context(_joined(client, invite, rejoin=tokens[1]))
            for i, (frm, to) in enumerate(SHUFFLE):
                mover = ann if i % 2 == 0 else bob
                _mv(mover, frm, to, 4 + i)
                if i < len(SHUFFLE) - 1:
                    for s in (ann, bob):
                        s.state(lambda st, n=5 + i: st["game"]["ply"] == n)
            # A finished game is announced as an ended state; `session_closed` is for deletes.
            game = ann.state(lambda st: st["game"]["status"] == "ended")["game"]
            assert game["result"] == "draw"
            assert game["reason"] == "threefold_repetition"


async def test_after_a_restart_seated_players_are_away_and_no_claim_for_the_full_interval(
    database_url: str,
) -> None:
    await _migrated(database_url)
    with _app(database_url) as client:
        invite = _invite(client)
        with ExitStack() as stack:
            ann, ann_welcome = stack.enter_context(_joined(client, invite, "Ann"))
            bob, _ = stack.enter_context(_joined(client, invite, "Bob"))
            cy, cy_welcome = stack.enter_context(_joined(client, invite, "Cy"))
            ann.send(type="start")
            for s in (ann, bob):
                s.state(lambda st: st["game"] is not None)

    with _app(database_url) as client:
        started = time.monotonic()
        with _joined(client, invite, rejoin=cy_welcome["rejoin_token"]) as (cy, welcome):
            seats = welcome["state"]["seats"]
            assert seats["white"]["away"] is True
            assert seats["black"]["away"] is True
            assert welcome["state"]["game"]["claim_available_to"] is None
            # Nothing may announce a claim before the interval has run from the restart.
            await asyncio.sleep(ABANDON_SECONDS - 1 - (time.monotonic() - started))
        with _joined(client, invite, rejoin=cy_welcome["rejoin_token"]) as (_, later):
            assert time.monotonic() - started < ABANDON_SECONDS
            assert later["state"]["game"]["claim_available_to"] is None
