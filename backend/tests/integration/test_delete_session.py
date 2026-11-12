"""Spec 019 task 9: `DELETE /api/me/sessions/{kind}/{invite}` (FR-2, FR-6, FR-7, FR-9, FR-11,
FR-12, FR-14; AC-2, AC-5, AC-6, AC-8–AC-12).

Real Postgres, the real app, real WebSockets and the real test Keycloak (hold the stack lock).
Sessions are seeded with `test_deletion_repo`'s helpers (one row in every table of the purge
list) or started through the real endpoints when a socket has to join them.
"""

import dataclasses
import json
import secrets
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import ExitStack, contextmanager

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.main import create_app
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    _admin_client,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)
from tests.integration.test_chess_ws import _Socket, _url
from tests.integration.test_deletion_repo import (
    _chess,
    _coding,
    _counts,
    _learning,
    _presentation,
    _shared,
)
from tests.integration.test_learn_ws import LESSON

_COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
_TABLE = {
    "coding": "session",
    "learning": "learning_session",
    "presentation": "presentation_session",
    "chess": "chess_session",
}
KINDS = sorted(_TABLE)


def _sub(username: str) -> str:
    with _admin_client() as admin:
        (user,) = admin.get("/users", params={"username": username, "exact": "true"}).json()
    return user["id"]


@pytest.fixture
async def client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer=keycloak.issuer,
        oidc_client_id=keycloak.client_id,
        oidc_client_secret=keycloak.client_secret,
        session_cookie_key=_COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def jars(client: TestClient, signed_in_jar) -> dict[str, dict[str, str]]:  # noqa: F811
    """`jars[username]`: that user's signed-in cookie header, signed in on first use."""

    class _Jars(dict):
        def __missing__(self, user: str) -> dict[str, str]:
            self[user] = cookie_header(signed_in_jar(client, user))
            return self[user]

    return _Jars()


@pytest.fixture
def subs() -> dict[str, str]:
    return {u: _sub(u) for u in ("newuser", "other", "admin1")}


async def _seed(db: asyncpg.Connection, kind: str, host: str, joiner: str) -> tuple[uuid.UUID, str]:
    """A session of `kind` hosted by `host`, joined by `joiner`; (id, invite)."""
    if kind == "coding":
        sid = await _coding(db, host, (host, joiner))
    elif kind == "learning":
        sid = await _learning(db, host, (host, joiner))
    elif kind == "chess":
        sid = await _chess(db, host, (host, joiner))
    else:
        sid = await _presentation(db, host)
        await db.execute(
            """insert into presentation_participant
                   (session_id, display_name, rejoin_token_hash, account_sub)
               values ($1, 'J', $2, $3)""",
            sid,
            secrets.token_hex(16),
            joiner,
        )
    invite = await db.fetchval(f"select invite_id from {_TABLE[kind]} where id = $1", sid)  # noqa: S608
    return sid, invite


def _delete(client: TestClient, kind: str, invite: str, headers: dict[str, str]):
    return client.delete(f"/api/me/sessions/{kind}/{invite}", headers=headers)


async def _tombstone(db: asyncpg.Connection, kind: str, invite: str) -> str | None:
    return await db.fetchval(
        "select deleted_by from deleted_session where kind = $1 and invite_id = $2", kind, invite
    )


# --- AC-5: the host deletes; every row goes, a tombstone stays --------------------------------


@pytest.mark.parametrize("kind", KINDS)
async def test_ac5_host_deletes_and_every_row_of_the_session_is_gone(
    kind: str, client: TestClient, db: asyncpg.Connection, jars, subs
) -> None:
    sid, invite = await _seed(db, kind, subs["newuser"], subs["other"])
    shared = await _shared(db)

    response = _delete(client, kind, invite, jars["newuser"])

    assert response.status_code == 204, response.text
    assert set((await _counts(db, kind, sid)).values()) == {0}
    assert await _tombstone(db, kind, invite) == "host"
    assert await _shared(db) == shared


# --- AC-2 (server): an admin deletes someone else's session ------------------------------------


@pytest.mark.parametrize("kind", KINDS)
async def test_ac2_admin_deletes_a_session_someone_else_hosts(
    kind: str, client: TestClient, db: asyncpg.Connection, jars, subs
) -> None:
    sid, invite = await _seed(db, kind, subs["newuser"], subs["admin1"])

    response = _delete(client, kind, invite, jars["admin1"])

    assert response.status_code == 204, response.text
    assert set((await _counts(db, kind, sid)).values()) == {0}
    assert await _tombstone(db, kind, invite) == "admin"


# --- AC-9: a second delete answers 410 ----------------------------------------------------------


async def test_ac9_a_second_delete_answers_410(
    client: TestClient, db: asyncpg.Connection, jars, subs
) -> None:
    _, invite = await _seed(db, "coding", subs["newuser"], subs["other"])
    assert _delete(client, "coding", invite, jars["newuser"]).status_code == 204

    again = _delete(client, "coding", invite, jars["newuser"])

    assert again.status_code == 410
    assert again.json() == {"error": "session_deleted"}


# --- AC-10: who may not delete -----------------------------------------------------------------


@pytest.mark.parametrize("kind", KINDS)
async def test_ac10_a_joined_non_host_gets_403_and_nothing_changes(
    kind: str, client: TestClient, db: asyncpg.Connection, jars, subs
) -> None:
    sid, invite = await _seed(db, kind, subs["newuser"], subs["other"])
    before = await _counts(db, kind, sid)

    response = _delete(client, kind, invite, jars["other"])

    assert response.status_code == 403
    assert response.json() == {"error": "not_host"}
    assert await _counts(db, kind, sid) == before
    assert await _tombstone(db, kind, invite) is None


async def test_ac10_anonymous_gets_401_and_a_non_participant_gets_404(
    client: TestClient, db: asyncpg.Connection, jars, subs
) -> None:
    sid, invite = await _seed(db, "coding", subs["newuser"], subs["other"])
    before = await _counts(db, "coding", sid)

    assert _delete(client, "coding", invite, {}).status_code == 401
    outsider = _delete(client, "coding", invite, jars["plain1"])
    assert outsider.status_code == 404
    assert outsider.json() == {"error": "not_found"}
    assert await _counts(db, "coding", sid) == before


async def test_unknown_kind_or_invite_is_404(client: TestClient, jars) -> None:
    assert _delete(client, "poker", "nope", jars["newuser"]).status_code == 404
    unknown = _delete(client, "coding", "never-existed", jars["newuser"])
    assert unknown.status_code == 404
    assert unknown.json() == {"error": "not_found"}


# --- AC-8: other participants' lists and home screens drop it ----------------------------------


async def test_ac8_another_participants_profile_and_home_no_longer_show_it(
    client: TestClient, db: asyncpg.Connection, jars, subs
) -> None:
    _, invite = await _seed(db, "coding", subs["newuser"], subs["other"])
    listed = client.get("/api/me/sessions", headers=jars["other"]).json()
    assert invite in {r["invite_id"] for r in listed}

    assert _delete(client, "coding", invite, jars["newuser"]).status_code == 204

    listed = client.get("/api/me/sessions", headers=jars["other"]).json()
    assert invite not in {r["invite_id"] for r in listed}
    home = client.get("/api/home", headers=jars["other"])
    assert home.status_code == 200
    assert invite not in home.text


# --- AC-11: hide still affects only the caller -------------------------------------------------


async def test_ac11_hide_leaves_the_session_for_other_participants(
    client: TestClient, db: asyncpg.Connection, jars, subs
) -> None:
    _, invite = await _seed(db, "coding", subs["newuser"], subs["other"])

    hidden = client.post(f"/api/me/sessions/coding/{invite}/hide", headers=jars["other"])

    assert hidden.status_code == 204
    mine = client.get("/api/me/sessions", headers=jars["other"]).json()
    theirs = client.get("/api/me/sessions", headers=jars["newuser"]).json()
    assert invite not in {r["invite_id"] for r in mine}
    assert invite in {r["invite_id"] for r in theirs}
    assert await _tombstone(db, "coding", invite) is None


# --- AC-6: connected participants are told and disconnected -----------------------------------


async def _problem_and_lesson(db: asyncpg.Connection) -> tuple[uuid.UUID, str, uuid.UUID]:
    """A problem, a current lesson and a presentation to start sessions on."""
    problem_id = await db.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ('Del', '', 'def f() -> int', 'f', '[]'::jsonb, 'int') returning id"""
    )
    lesson_key = f"019-del/{secrets.token_hex(4)}"
    version_id = await db.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $1, $2::jsonb) returning id""",
        lesson_key,
        json.dumps({**dataclasses.asdict(LESSON), "images": {}}),
    )
    await db.execute(
        """insert into lesson (key, topic_key, topic_title, current_version_id)
           values ($1, '019-del', 'Del', $2)""",
        lesson_key,
        version_id,
    )
    presentation_id = await db.fetchval(
        """insert into presentation (title, topic, created_by_sub)
           values ('Del deck', 'T', 'e') returning id"""
    )
    pv = await db.fetchval(
        """insert into presentation_version (presentation_id, html, kind, slide_count,
                                             created_by_sub)
           values ($1, '<p>x</p>', 'page', 0, 'e') returning id""",
        presentation_id,
    )
    await db.execute(
        "update presentation set current_version_id = $1 where id = $2", pv, presentation_id
    )
    return problem_id, lesson_key, presentation_id


_WS = {
    "coding": "/api/sessions/{invite}/ws?name={name}",
    "learning": "/api/learn/sessions/{invite}/ws?name={name}",
    "presentation": "/api/present/sessions/{invite}/ws?name={name}",
}


def _start(
    client: TestClient, kind: str, ids: tuple[uuid.UUID, str, uuid.UUID], host: dict[str, str]
) -> str:
    problem_id, lesson_key, presentation_id = ids
    path, body = {
        "coding": ("/api/sessions", {"problem_id": str(problem_id)}),
        "learning": ("/api/learn/sessions", {"lesson_key": lesson_key}),
        "presentation": ("/api/present/sessions", {"presentation_id": str(presentation_id)}),
    }[kind]
    response = client.post(path, json=body, headers=host)
    assert response.status_code == 201, response.text
    return response.json()["invite_id"]


@contextmanager
def _connected(client: TestClient, kind: str, invite: str, name: str, headers: dict[str, str]):
    url = _WS[kind].format(invite=invite, name=name)
    with client.websocket_connect(url, headers=headers) as ws:
        ws.receive_json()  # the first frame: the socket has joined the hub
        yield ws


def _until_closed(ws, wanted: str) -> tuple[dict | None, int]:
    """Reads until the socket closes: the last `wanted` frame seen, and the close code."""
    seen = None
    with pytest.raises(WebSocketDisconnect) as info:
        while True:
            frame = ws.receive_json()
            if frame.get("type") == wanted:
                seen = frame
    return seen, info.value.code


@pytest.mark.parametrize("kind", ["coding", "learning", "presentation"])
async def test_ac6_connected_participants_get_session_deleted_and_close_4411(
    kind: str, client: TestClient, db: asyncpg.Connection, jars
) -> None:
    invite = _start(client, kind, await _problem_and_lesson(db), jars["newuser"])
    with ExitStack() as stack:
        # The host joins signed in (a presentation's first signed-in joiner presents).
        host = stack.enter_context(_connected(client, kind, invite, "Host", jars["newuser"]))
        guest = stack.enter_context(_connected(client, kind, invite, "Guest", {}))
        started = time.monotonic()

        response = _delete(client, kind, invite, jars["newuser"])

        assert response.status_code == 204, response.text
        for ws in (guest, host):
            frame, code = _until_closed(ws, "session_deleted")
            assert frame == {"type": "session_deleted", "by": "host"}
            assert code == 4411
        assert time.monotonic() - started < 2


# --- AC-12: chess players get session_closed, as for chess's own deletion ----------------------


@pytest.mark.parametrize(("who", "reason"), [("newuser", "starter"), ("admin1", "admin")])
async def test_ac12_chess_players_get_session_closed_and_close_4411(
    who: str, reason: str, client: TestClient, jars
) -> None:
    invite = client.post("/api/games/chess/sessions", headers=jars["newuser"]).json()["invite_id"]
    with ExitStack() as stack:
        # The host plays signed in (so the game is in their list); the opponent is a guest.
        players = [
            _Socket(stack.enter_context(client.websocket_connect(_url(invite, name), headers=h)))
            for name, h in (("Ann", jars["newuser"]), ("Bob", {}))
        ]
        for player in players:
            player.next("welcome")

        response = _delete(client, "chess", invite, jars[who])

        assert response.status_code == 204, response.text
        for player in players:
            assert player.next("session_closed") == {
                "type": "session_closed",
                "result": None,
                "reason": reason,
            }
            assert player.expect_close() == 4411
