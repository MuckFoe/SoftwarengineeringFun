"""Spec 017 task 1: `GET /api/home`, the signed-in account's home snapshot (plan.md
"Contracts"). FR-1, FR-3, FR-8, FR-10.

Rows are seeded straight into Postgres (as test_me_sessions does); "live" is made by putting
a connection into the real in-memory hub for the seeded participant. Real Postgres, real
test Keycloak.
"""

import hashlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.sessions import hub as session_hub
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)
from tests.integration.test_me_sessions import (  # noqa: F401  (pytest fixtures)
    _coding,
    _learning,
    _presentation,
    _sub,
    client,
    db_conn,
)

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


class _Socket:
    async def send_json(self, data: object) -> None: ...
    async def send_bytes(self, data: bytes) -> None: ...


@pytest.fixture(autouse=True)
def _clean_hubs() -> Iterator[None]:
    session_hub._hubs.clear()  # noqa: SLF001
    yield
    session_hub._hubs.clear()  # noqa: SLF001


async def _go_live(conn: asyncpg.Connection, session_id: uuid.UUID, *subs: str) -> None:
    """Connects the given accounts' participants of this coding session to its hub."""
    for sub in subs:
        pid = await conn.fetchval(
            "select id from participant where session_id = $1 and account_sub = $2",
            session_id,
            sub,
        )
        session_hub.get_hub(session_id).connections[pid] = session_hub.Connection(
            _Socket(), pid, sub[:6], signed_in=True
        )


async def _join(conn: asyncpg.Connection, session_id: uuid.UUID, sub: str) -> None:
    await conn.execute(
        "insert into participant (session_id, display_name, account_sub) values ($1, 'y', $2)",
        session_id,
        sub,
    )


def _home(client: TestClient, jar: Any) -> dict[str, Any]:  # noqa: F811
    response = client.get("/api/home", headers=cookie_header(jar))
    assert response.status_code == 200, response.text
    return response.json()


async def test_fr3_live_first_then_idle_with_counts_and_last_active(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me, other = _sub("newuser"), _sub("other")
    _, idle_old = await _coding(db_conn, "idle old", me, NOW - timedelta(days=3))
    _, live_a = await _coding(db_conn, "live a", me, NOW - timedelta(days=2))
    _, idle_new = await _coding(db_conn, "idle new", me, NOW - timedelta(days=1))
    _, live_b = await _coding(db_conn, "live b", me, NOW - timedelta(days=5))
    await _join(db_conn, live_a, other)
    await _go_live(db_conn, live_a, me, other)
    await _go_live(db_conn, live_b, me)

    body = _home(client, jar)

    tiles = body["sessions"]
    assert [t["title"] for t in tiles] == ["live a", "live b", "idle new", "idle old"]
    live_a_tile, live_b_tile, new_tile, old_tile = tiles
    assert live_a_tile["live"] and live_a_tile["participant_count"] == 2
    assert len(live_a_tile["participants"]) == 2
    assert {"id", "name", "avatar_url"} <= set(live_a_tile["participants"][0])
    assert live_a_tile["last_active_at"] is None
    assert live_b_tile["live"] and live_b_tile["participant_count"] == 1
    for idle in (new_tile, old_tile):
        assert idle["live"] is False and idle["last_active_at"] is not None
    assert new_tile["id"] == str(idle_new) and old_tile["id"] == str(idle_old)
    assert tiles[0]["kind"] == "coding"
    assert body["games"] == []
    assert body["user"]["username"] == "newuser"


async def test_fr3_idle_capped_at_eight_with_total(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me = _sub("newuser")
    for i in range(10):
        await _coding(db_conn, f"idle {i}", me, NOW - timedelta(hours=i))

    body = _home(client, jar)

    assert len(body["sessions"]) == 8
    assert body["idle_total"] == 10
    assert [t["title"] for t in body["sessions"]][:2] == ["idle 0", "idle 1"]


async def test_fr8_sessions_the_user_may_not_open_never_appear(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    a, b = _sub("newuser"), _sub("other")
    _, private = await _coding(db_conn, "A private", a, NOW)
    await _go_live(db_conn, private, a)
    jar_b = signed_in_jar(client, "other")
    _, mine = await _coding(db_conn, "B own", b, NOW)

    body = _home(client, jar_b)

    assert [t["title"] for t in body["sessions"]] == ["B own"]
    assert str(private) not in repr(body)
    assert body["live_participant_count"] == 0
    assert body["idle_total"] == 1
    assert mine is not None


async def test_fr1_live_participant_count_is_distinct_people_including_viewer(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me, other = _sub("newuser"), _sub("other")
    _, one = await _coding(db_conn, "one", me, NOW)
    _, two = await _coding(db_conn, "two", me, NOW - timedelta(minutes=1))
    await _join(db_conn, one, other)
    await _join(db_conn, two, other)
    await _go_live(db_conn, one, me, other)
    await _go_live(db_conn, two, me, other)

    assert _home(client, jar)["live_participant_count"] == 2


async def test_fr10_earlier_sessions_of_every_kind_are_tiles(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me = _sub("newuser")
    await _coding(db_conn, "code", me, NOW)
    await _learning(db_conn, "lesson", me, NOW - timedelta(hours=1))
    await _presentation(db_conn, "talk", me, NOW - timedelta(hours=2), host=True)

    body = _home(client, jar)

    assert [(t["kind"], t["title"]) for t in body["sessions"]] == [
        ("coding", "code"),
        ("learning", "lesson"),
        ("presentation", "talk"),
    ]
    assert body["live_participant_count"] == 0


async def test_signed_out_is_401(client: TestClient) -> None:  # noqa: F811
    assert client.get("/api/home").status_code == 401


# --- task 5: chess games (FR-6) ---------------------------------------------------------------


async def _chess_game(
    conn: asyncpg.Connection,
    white: str,
    black: str | None,
    *,
    moves: tuple[str, ...] = (),
    ended: bool = False,
) -> uuid.UUID:
    """A chess session with `white` seated (and `black`, with a game started, if given)."""
    session_id = await conn.fetchval(
        "insert into chess_session (invite_id) values ($1) returning id", uuid.uuid4().hex[:12]
    )
    ids = {}
    for color, sub in (("white", white), ("black", black)):
        if sub is None:
            continue
        ids[color] = await conn.fetchval(
            """insert into chess_participant (session_id, display_name, rejoin_token_hash,
                                              account_sub)
               values ($1, $2, $3, $4) returning id""",
            session_id,
            f"{color}-name",
            uuid.uuid4().hex,
            sub,
        )
    await conn.execute(
        "update chess_session set white_participant_id = $2, black_participant_id = $3 "
        "where id = $1",
        session_id,
        ids.get("white"),
        ids.get("black"),
    )
    if black is not None:
        game_id = await conn.fetchval(
            """insert into chess_game (session_id, white_participant_id, black_participant_id,
                                       started_at, ended_at, result, reason)
               values ($1, $2, $3, now(), $4, $5, $6) returning id""",
            session_id,
            ids["white"],
            ids["black"],
            NOW if ended else None,
            "white" if ended else None,
            "resignation" if ended else None,
        )
        for ply, uci in enumerate(moves, 1):
            await conn.execute(
                """insert into chess_move (game_id, ply, uci, san, participant_id, made_at)
                   values ($1, $2, $3, $3, $4, now())""",
                game_id,
                ply,
                uci,
                ids["white" if ply % 2 else "black"],
            )
        await conn.execute(
            "update chess_session set current_game_id = $2 where id = $1", session_id, game_id
        )
    return session_id


async def test_fr6_game_tile_has_opponent_turn_and_fen(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me, other = _sub("newuser"), _sub("other")
    mine = await _chess_game(db_conn, me, other, moves=("e2e4",))
    await _chess_game(db_conn, other, me, moves=("e2e4",))  # I am Black and it is my move

    games = _home(client, jar)["games"]

    by_turn = {g["turn"]: g for g in games}
    assert set(by_turn) == {"you", "opponent"}
    assert by_turn["opponent"]["id"] == str(mine)
    assert by_turn["opponent"]["status"] == "in_progress"
    assert by_turn["opponent"]["opponent"]["name"] == "black-name"
    assert by_turn["opponent"]["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")
    assert by_turn["you"]["opponent"]["name"] == "white-name"
    assert by_turn["you"]["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")
    assert {"id", "title", "opponent", "status", "turn", "fen"} <= set(games[0])
    assert {"id", "name"} <= set(games[0]["opponent"])


async def test_fr6_waiting_game_has_no_opponent_and_turn_none(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    await _chess_game(db_conn, _sub("newuser"), None)

    (game,) = _home(client, jar)["games"]

    assert game["status"] == "waiting" and game["turn"] == "none"
    assert game["opponent"] is None
    assert game["fen"].startswith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w")


async def test_fr6_no_game_or_only_finished_means_empty_games(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    assert _home(client, jar)["games"] == []
    me, other = _sub("newuser"), _sub("other")
    await _chess_game(db_conn, me, other, moves=("e2e4",), ended=True)

    assert _home(client, jar)["games"] == []


async def test_fr6_hidden_other_peoples_stale_and_deleted_games_are_excluded(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me, other, third = _sub("newuser"), _sub("other"), "someone-else-sub"
    hidden = await _chess_game(db_conn, me, other)
    await db_conn.execute(
        "update chess_participant set hidden_at = now() where session_id = $1 and account_sub = $2",
        hidden,
        me,
    )
    await _chess_game(db_conn, other, third)  # not mine
    stale = await _chess_game(db_conn, me, other)
    await db_conn.execute("update chess_session set stale_at = now() where id = $1", stale)
    gone = await _chess_game(db_conn, me, other)
    await db_conn.execute(
        "update chess_session set deleted_at = now(), deleted_reason = 'admin' where id = $1",
        gone,
    )

    assert _home(client, jar)["games"] == []


# --- task 7: guests and chess invitees (FR-11, Privacy) ---------------------------------------


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _as_guest(client: TestClient, token: str, path: str = "/api/home") -> Any:  # noqa: F811
    return client.get(path, headers={"x-rejoin-token": token})


async def _guest_presentation(conn: asyncpg.Connection, title: str, token: str) -> uuid.UUID:
    """A presentation the guest `token` joined, and nothing tying it to an account."""
    _, session_id = await _presentation(conn, title, "someone-else", NOW)
    await conn.execute(
        """update presentation_participant set account_sub = null, rejoin_token_hash = $2
            where session_id = $1""",
        session_id,
        _token_hash(token),
    )
    return session_id


async def test_privacy_guest_sees_only_their_session_and_null_count(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    mine = await _guest_presentation(db_conn, "Joined talk", "guest-token")
    await _guest_presentation(db_conn, "Secret other talk", "someone-elses-token")
    await _coding(db_conn, "Secret code", "another-sub", NOW)

    response = _as_guest(client, "guest-token")

    assert response.status_code == 200, response.text
    body = response.json()
    assert [t["id"] for t in body["sessions"]] == [str(mine)]
    assert body["games"] == []
    assert body["live_participant_count"] is None
    assert body["idle_total"] == 0
    assert "Secret" not in response.text


async def test_fr11_chess_invitee_sees_only_the_game(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    game = await _chess_game(db_conn, "host-sub", None)
    await _chess_game(db_conn, "other-sub", None)
    invitee = await db_conn.fetchval(
        """insert into chess_participant (session_id, display_name, rejoin_token_hash)
           values ($1, 'Invitee', $2) returning id""",
        game,
        _token_hash("invitee-token"),
    )
    await db_conn.execute(
        "update chess_session set black_participant_id = $2 where id = $1", game, invitee
    )
    await _guest_presentation(db_conn, "Secret talk", "someone-elses-token")

    body = _as_guest(client, "invitee-token").json()

    assert [g["id"] for g in body["games"]] == [str(game)]
    assert body["sessions"] == []
    assert body["live_participant_count"] is None
    assert body["games"][0]["opponent"] is None or body["games"][0]["opponent"]["name"]


async def test_unknown_or_missing_guest_token_is_401(client: TestClient) -> None:  # noqa: F811
    assert _as_guest(client, "nope").status_code == 401
    assert client.get("/api/home/preview/" + str(uuid.uuid4())).status_code == 401


async def test_privacy_guest_preview_of_another_session_is_404_same_as_missing(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    await _guest_presentation(db_conn, "Joined talk", "guest-token")
    _, other_id = await _coding(db_conn, "Secret code", "another-sub", NOW)

    other_response = _as_guest(client, "guest-token", f"/api/home/preview/{other_id}")
    missing = _as_guest(client, "guest-token", f"/api/home/preview/{uuid.uuid4()}")

    assert other_response.status_code == 404
    assert (other_response.status_code, other_response.text) == (missing.status_code, missing.text)


# --- task 12: additive invite_id on tiles -----------------------------------------------------


async def test_invite_id_on_session_tiles_is_the_real_invite(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me = _sub("newuser")
    code_invite, code_id = await _coding(db_conn, "code", me, NOW)
    talk_invite, talk_id = await _presentation(db_conn, "talk", me, NOW - timedelta(days=1))

    tiles = {t["id"]: t for t in _home(client, jar)["sessions"]}

    assert tiles[str(code_id)]["invite_id"] == code_invite
    assert tiles[str(talk_id)]["invite_id"] == talk_invite


async def test_invite_id_on_game_tiles_is_the_real_invite(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    game = await _chess_game(db_conn, _sub("newuser"), _sub("other"), moves=("e2e4",))
    invite = await db_conn.fetchval("select invite_id from chess_session where id = $1", game)

    games = _home(client, jar)["games"]

    assert [g["invite_id"] for g in games] == [invite]


async def test_invite_id_present_in_guest_and_invitee_snapshots(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    talk = await _guest_presentation(db_conn, "Joined talk", "guest-token")
    talk_invite = await db_conn.fetchval(
        "select invite_id from presentation_session where id = $1", talk
    )
    game = await _chess_game(db_conn, "host-sub", None)
    invitee = await db_conn.fetchval(
        """insert into chess_participant (session_id, display_name, rejoin_token_hash)
           values ($1, 'Invitee', $2) returning id""",
        game,
        _token_hash("invitee-token"),
    )
    await db_conn.execute(
        "update chess_session set black_participant_id = $2 where id = $1", game, invitee
    )
    game_invite = await db_conn.fetchval("select invite_id from chess_session where id = $1", game)

    guest = _as_guest(client, "guest-token").json()
    seated = _as_guest(client, "invitee-token").json()

    assert [t["invite_id"] for t in guest["sessions"]] == [talk_invite]
    assert [g["invite_id"] for g in seated["games"]] == [game_invite]
