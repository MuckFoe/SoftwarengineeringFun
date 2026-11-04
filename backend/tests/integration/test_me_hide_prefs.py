"""Spec 012 task 11: hide a session, account preferences, and `/api/me` with preferences
(plan.md "Contracts — POST /api/me/sessions/{kind}/{invite}/hide, PUT /api/me/preferences,
GET /api/me"). FR-13, FR-15, FR-16, NFR-1, NFR-2.

Participant rows are seeded with `account_sub` directly (the socket joins are other tasks).
Real Postgres, real test Keycloak (`signed_in_jar`); the account `sub` is read from
Keycloak's admin API.
"""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import asyncpg
import pytest
from fastapi.testclient import TestClient

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

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
NOT_FOUND = {"error": "not_found"}


def _settings(kc: Keycloak, database_url: str) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )


def _sub(username: str) -> str:
    """The account's `sub`: Keycloak's user id, which the app's cookie stores."""
    with _admin_client() as admin:
        (user,) = admin.get("/users", params={"username": username, "exact": "true"}).json()
    return user["id"]


@pytest.fixture
async def client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
        await conn.execute(
            """update presentation_session set host_participant_id = null;
               truncate chat_message, participant, session_problem, session,
                        learning_participant, learning_session, presentation_participant,
                        presentation_session, account_preference cascade"""
        )
    finally:
        await conn.close()
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


@pytest.fixture
async def db_conn(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    conn = await asyncpg.connect(database_url)
    try:
        yield conn
    finally:
        await conn.close()


async def _coding(conn: asyncpg.Connection, *subs: str) -> tuple[str, uuid.UUID]:
    """A coding session with one account participant per `sub`, each with a chat message."""
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ('Two Sum', '', 'def f(): ...', 'f', '[]'::jsonb, 'None') returning id"""
    )
    invite = uuid.uuid4().hex[:12]
    session_id = await conn.fetchval(
        """insert into session (invite_id, current_problem_id, last_activity_at)
           values ($1, $2, $3) returning id""",
        invite,
        problem_id,
        NOW,
    )
    for i, sub in enumerate(subs):
        participant_id = await conn.fetchval(
            """insert into participant (session_id, display_name, account_sub)
               values ($1, $2, $3) returning id""",
            session_id,
            f"p{i}",
            sub,
        )
        await conn.execute(
            """insert into chat_message (session_id, participant_id, sender_name, body, sent_at)
               values ($1, $2, $3, $4, $5)""",
            session_id,
            participant_id,
            f"p{i}",
            f"hello from p{i}",
            NOW,
        )
    return invite, session_id


async def _participants(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[tuple]:
    rows = await conn.fetch(
        "select id, display_name, account_sub from participant where session_id = $1 order by id",
        session_id,
    )
    return [tuple(r) for r in rows]


def _invites(client: TestClient, jar) -> list[str]:
    response = client.get("/api/me/sessions", headers=cookie_header(jar))
    assert response.status_code == 200, response.text
    return [r["invite_id"] for r in response.json()]


def _hide(client: TestClient, jar, kind: str, invite: str):
    return client.post(f"/api/me/sessions/{kind}/{invite}/hide", headers=cookie_header(jar))


def _me(client: TestClient, jar) -> dict:
    response = client.get("/api/me", headers=cookie_header(jar))
    assert response.status_code == 200, response.text
    return response.json()


def _put(client: TestClient, jar, body):
    return client.put("/api/me/preferences", json=body, headers=cookie_header(jar))


# --- FR-13 ------------------------------------------------------------------------------------


async def test_fr13_hide_removes_only_from_the_callers_list_and_changes_nothing_else(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me, someone = _sub("newuser"), _sub("other")
    s1, s1_id = await _coding(db_conn, me, someone)
    mine, theirs = signed_in_jar(client, "newuser"), signed_in_jar(client, "other")
    session_before = dict(await db_conn.fetchrow("select * from session where id = $1", s1_id))
    participants_before = await _participants(db_conn, s1_id)
    chat_before = client.get(f"/api/sessions/{s1}/chat").json()
    assert s1 in _invites(client, mine)

    response = _hide(client, mine, "coding", s1)

    assert response.status_code == 204
    assert response.content == b""
    assert s1 not in _invites(client, mine)
    assert s1 in _invites(client, theirs)
    assert dict(await db_conn.fetchrow("select * from session where id = $1", s1_id)) == (
        session_before
    )
    assert await _participants(db_conn, s1_id) == participants_before
    chat_after = client.get(f"/api/sessions/{s1}/chat").json()
    assert chat_after == chat_before
    assert {m["text"] for m in chat_after["messages"]} == {"hello from p0", "hello from p1"}
    # Only the caller's participant is hidden.
    hidden = await db_conn.fetch(
        "select account_sub from participant where session_id = $1 and hidden_at is not null",
        s1_id,
    )
    assert [r["account_sub"] for r in hidden] == [me]


async def test_fr13_hide_is_idempotent(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    s1, _ = await _coding(db_conn, _sub("newuser"))
    jar = signed_in_jar(client, "newuser")

    assert _hide(client, jar, "coding", s1).status_code == 204
    assert _hide(client, jar, "coding", s1).status_code == 204
    assert s1 not in _invites(client, jar)


async def test_fr13_hide_works_for_learning_and_presentation(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me = _sub("newuser")
    lesson = await db_conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $1, '{"title": "Lists"}'::jsonb) returning id""",
        uuid.uuid4().hex,
    )
    l1 = uuid.uuid4().hex[:12]
    l1_id = await db_conn.fetchval(
        """insert into learning_session (invite_id, lesson_version_id, last_activity_at)
           values ($1, $2, $3) returning id""",
        l1,
        lesson,
        NOW,
    )
    await db_conn.execute(
        """insert into learning_participant (session_id, display_name, account_sub)
           values ($1, 'x', $2)""",
        l1_id,
        me,
    )
    presentation = await db_conn.fetchval(
        "insert into presentation (title, topic, created_by_sub) values ('P', 'T', 'e') "
        "returning id"
    )
    version = await db_conn.fetchval(
        """insert into presentation_version (presentation_id, html, kind, slide_count,
                                             created_by_sub)
           values ($1, '<p>x</p>', 'page', 0, 'e') returning id""",
        presentation,
    )
    p1 = uuid.uuid4().hex[:12]
    p1_id = await db_conn.fetchval(
        """insert into presentation_session (invite_id, version_id, last_activity_at)
           values ($1, $2, $3) returning id""",
        p1,
        version,
        NOW,
    )
    await db_conn.execute(
        """insert into presentation_participant (session_id, display_name, rejoin_token_hash,
                                                 account_sub)
           values ($1, 'x', $2, $3)""",
        p1_id,
        uuid.uuid4().hex,
        me,
    )
    jar = signed_in_jar(client, "newuser")
    assert set(_invites(client, jar)) == {l1, p1}

    # The kind picks the table: the wrong kind for an invite is not found.
    assert _hide(client, jar, "coding", l1).status_code == 404
    assert _hide(client, jar, "learning", l1).status_code == 204
    assert _hide(client, jar, "presentation", p1).status_code == 204
    assert _invites(client, jar) == []


# --- NFR-1 ------------------------------------------------------------------------------------


async def test_nfr1_not_in_session_unknown_invite_and_unknown_kind_are_the_same_404(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    s1, s1_id = await _coding(db_conn, _sub("newuser"))
    jar = signed_in_jar(client, "other")

    not_in = _hide(client, jar, "coding", s1)
    unknown = _hide(client, jar, "coding", "nosuchinvite")
    bad_kind = _hide(client, jar, "chess", s1)

    for response in (not_in, unknown, bad_kind):
        assert response.status_code == 404
        assert response.json() == NOT_FOUND
    assert (
        await db_conn.fetchval(
            "select count(*) from participant where session_id = $1 and hidden_at is not null",
            s1_id,
        )
        == 0
    )


async def test_nfr1_preferences_are_per_account(
    client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    mine, theirs = signed_in_jar(client, "newuser"), signed_in_jar(client, "other")

    assert _put(client, mine, {"appearance": "dark", "chat_visible": False}).status_code == 200

    assert _me(client, theirs)["preferences"] is None
    assert _put(client, theirs, {"appearance": "light"}).json() == {
        "appearance": "light",
        "chat_visible": True,
    }
    assert _me(client, mine)["preferences"] == {"appearance": "dark", "chat_visible": False}
    assert _me(client, theirs)["preferences"] == {"appearance": "light", "chat_visible": True}


def test_nfr1_signed_out_is_401_and_no_me_route_names_an_account(client: TestClient) -> None:
    assert client.post("/api/me/sessions/coding/abc/hide").status_code == 401
    assert client.put("/api/me/preferences", json={"appearance": "dark"}).status_code == 401

    paths = client.get("/openapi.json").json()["paths"]
    me_routes = {path: ops for path, ops in paths.items() if path.startswith("/api/me")}
    assert "/api/me/sessions/{kind}/{invite}/hide" in me_routes
    assert "/api/me/preferences" in me_routes
    for path, ops in me_routes.items():
        assert "sub" not in path and "account" not in path, path
        for op in ops.values():
            names = {p["name"] for p in op.get("parameters", [])}
            assert names <= {"kind", "invite"}, (path, names)


# --- FR-15 ------------------------------------------------------------------------------------


async def test_fr15_preferences_follow_the_account_to_another_device(
    client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    device_a, device_b = signed_in_jar(client, "newuser"), signed_in_jar(client, "newuser")

    response = _put(client, device_a, {"appearance": "dark", "chat_visible": False})

    assert response.status_code == 200
    assert response.json() == {"appearance": "dark", "chat_visible": False}
    assert _me(client, device_b)["preferences"] == {"appearance": "dark", "chat_visible": False}


async def test_fr15_a_later_write_of_one_field_keeps_the_other(
    client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    _put(client, jar, {"appearance": "dark", "chat_visible": False})

    assert _put(client, jar, {"chat_visible": True}).json() == {
        "appearance": "dark",
        "chat_visible": True,
    }
    assert _me(client, jar)["preferences"] == {"appearance": "dark", "chat_visible": True}


# --- FR-16 input ------------------------------------------------------------------------------


async def test_fr16_preferences_null_until_written_then_defaults_fill_the_gap(
    client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me = _me(client, jar)
    assert me["preferences"] is None
    assert set(me) == {"signed_in", "name", "roles", "preferences"}  # never the sub

    response = _put(client, jar, {"appearance": "dark"})

    assert response.status_code == 200
    assert response.json() == {"appearance": "dark", "chat_visible": True}
    assert _me(client, jar)["preferences"] == {"appearance": "dark", "chat_visible": True}


async def test_fr16_first_write_of_chat_only_defaults_appearance_to_system(
    client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")

    assert _put(client, jar, {"chat_visible": False}).json() == {
        "appearance": "system",
        "chat_visible": False,
    }


@pytest.mark.parametrize(
    "body", [{}, {"appearance": "blue"}, {"chat_visible": "nope"}, {"appearance": None}]
)
async def test_fr16_empty_or_invalid_body_is_422_and_stores_nothing(
    client: TestClient,
    signed_in_jar,  # noqa: F811
    body: dict,
) -> None:
    jar = signed_in_jar(client, "newuser")

    assert _put(client, jar, body).status_code == 422
    assert _me(client, jar)["preferences"] is None


# --- NFR-2 ------------------------------------------------------------------------------------


async def test_nfr2_roles_come_only_from_the_cookie(
    client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")

    for params in ({}, {"roles": "admin"}, {"role": "editor"}):
        response = client.get(
            "/api/me",
            params=params,
            headers={**cookie_header(jar), "x-roles": "admin", "x-forwarded-user": "editor1"},
        )
        assert response.json()["roles"] == []
        assert response.json()["name"] == "newuser"
