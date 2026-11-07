"""Spec 012 task 10: `GET /api/me/sessions`, the account's recent sessions (plan.md
"Contracts — GET /api/me/sessions"). FR-2, FR-4, FR-12, NFR-1.

Participant rows are seeded with `account_sub` directly (the socket joins are other tasks);
`last_activity_at` is set to fixed instants, so the order is controlled. Real Postgres, real
test Keycloak (`signed_in_jar`); the account `sub` is read from Keycloak's admin API.
"""

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

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
               truncate participant, session_problem, session, learning_participant,
                        learning_session, presentation_participant, presentation_session,
                        chess_participant, chess_session
                        cascade"""
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


def _invite() -> str:
    return uuid.uuid4().hex[:12]


async def _coding(
    conn: asyncpg.Connection, title: str, sub: str | None, at: datetime
) -> tuple[str, uuid.UUID]:
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ($1, '', 'def f(): ...', 'f', '[]'::jsonb, 'None') returning id""",
        title,
    )
    invite = _invite()
    session_id = await conn.fetchval(
        """insert into session (invite_id, current_problem_id, last_activity_at)
           values ($1, $2, $3) returning id""",
        invite,
        problem_id,
        at,
    )
    await conn.execute(
        "insert into participant (session_id, display_name, account_sub) values ($1, 'x', $2)",
        session_id,
        sub,
    )
    return invite, session_id


async def _learning(conn: asyncpg.Connection, title: str, sub: str, at: datetime) -> str:
    version_id = await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $1, $2::jsonb) returning id""",
        uuid.uuid4().hex,
        json.dumps({"title": title}),
    )
    invite = _invite()
    session_id = await conn.fetchval(
        """insert into learning_session (invite_id, lesson_version_id, last_activity_at)
           values ($1, $2, $3) returning id""",
        invite,
        version_id,
        at,
    )
    await conn.execute(
        """insert into learning_participant (session_id, display_name, account_sub)
           values ($1, 'x', $2)""",
        session_id,
        sub,
    )
    return invite


async def _presentation(
    conn: asyncpg.Connection, title: str, sub: str, at: datetime, *, host: bool = False
) -> tuple[str, uuid.UUID]:
    presentation_id = await conn.fetchval(
        """insert into presentation (title, topic, created_by_sub)
           values ($1, 'T', 'e') returning id""",
        title,
    )
    version_id = await conn.fetchval(
        """insert into presentation_version (presentation_id, html, kind, slide_count,
                                             created_by_sub)
           values ($1, '<p>x</p>', 'page', 0, 'e') returning id""",
        presentation_id,
    )
    await conn.execute(
        "update presentation set current_version_id = $1 where id = $2", version_id, presentation_id
    )
    invite = _invite()
    session_id = await conn.fetchval(
        """insert into presentation_session (invite_id, version_id, last_activity_at)
           values ($1, $2, $3) returning id""",
        invite,
        version_id,
        at,
    )
    participant_id = await conn.fetchval(
        """insert into presentation_participant (session_id, display_name, rejoin_token_hash,
                                                 account_sub)
           values ($1, 'x', $2, $3) returning id""",
        session_id,
        uuid.uuid4().hex,
        sub,
    )
    if host:
        await conn.execute(
            "update presentation_session set host_participant_id = $1 where id = $2",
            participant_id,
            session_id,
        )
    return invite, session_id


def _list(client: TestClient, jar) -> list[dict]:
    response = client.get("/api/me/sessions", headers=cookie_header(jar))
    assert response.status_code == 200, response.text
    return response.json()


# --- FR-2 -------------------------------------------------------------------------------------


async def test_fr2_lists_own_sessions_most_recent_first(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me, someone = _sub("newuser"), _sub("other")
    s1, _ = await _coding(db_conn, "Two Sum", me, NOW - timedelta(days=1))
    l1 = await _learning(db_conn, "Lists", me, NOW - timedelta(hours=1))
    p1, _ = await _presentation(db_conn, "Intro to Git", me, NOW)
    s2, _ = await _coding(db_conn, "Reverse", someone, NOW + timedelta(minutes=5))
    await _coding(db_conn, "Anonymous", None, NOW + timedelta(minutes=6))

    rows = _list(client, signed_in_jar(client, "newuser"))

    assert rows == [
        {
            "kind": "presentation",
            "invite_id": p1,
            "title": "Intro to Git",
            "last_activity_at": NOW.isoformat(),
            "stale": False,
            "hosted_by_me": False,
            "live": False,
        },
        {
            "kind": "learning",
            "invite_id": l1,
            "title": "Lists",
            "last_activity_at": (NOW - timedelta(hours=1)).isoformat(),
            "stale": False,
            "hosted_by_me": False,
            "live": False,
        },
        {
            "kind": "coding",
            "invite_id": s1,
            "title": "Two Sum",
            "last_activity_at": (NOW - timedelta(days=1)).isoformat(),
            "stale": False,
            "hosted_by_me": False,
            "live": False,
        },
    ]
    assert s2 not in {r["invite_id"] for r in rows}


async def test_fr2_equal_activity_orders_by_invite_and_hidden_rows_are_left_out(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me = _sub("newuser")
    a, _ = await _coding(db_conn, "A", me, NOW)
    b = await _learning(db_conn, "B", me, NOW)
    _, hidden_id = await _coding(db_conn, "Hidden", me, NOW + timedelta(hours=1))
    await db_conn.execute(
        "update participant set hidden_at = now() where session_id = $1", hidden_id
    )

    rows = _list(client, signed_in_jar(client, "newuser"))

    assert [r["invite_id"] for r in rows] == sorted([a, b])


# --- FR-4 -------------------------------------------------------------------------------------


async def test_fr4_stale_session_is_listed_as_stale(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me = _sub("newuser")
    s1, s1_id = await _coding(db_conn, "Two Sum", me, NOW - timedelta(days=40))
    l1 = await _learning(db_conn, "Lists", me, NOW - timedelta(days=41))
    p1, p1_id = await _presentation(db_conn, "Intro", me, NOW - timedelta(days=42))
    await db_conn.execute("update session set stale_at = now() where id = $1", s1_id)
    await db_conn.execute("update learning_session set stale_at = now() where invite_id = $1", l1)
    jar = signed_in_jar(client, "newuser")

    stale = {r["invite_id"]: r["stale"] for r in _list(client, jar)}

    assert stale == {s1: True, l1: True, p1: False}
    await db_conn.execute("update presentation_session set stale_at = now() where id = $1", p1_id)
    assert {r["invite_id"]: r["stale"] for r in _list(client, jar)}[p1] is True


# --- FR-12 ------------------------------------------------------------------------------------


async def test_fr12_hosted_by_me_follows_the_host(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me = _sub("newuser")
    p1, p1_id = await _presentation(db_conn, "Hosted", me, NOW, host=True)
    p2, _ = await _presentation(db_conn, "Watched", me, NOW - timedelta(minutes=1))
    jar = signed_in_jar(client, "newuser")

    hosted = {r["invite_id"]: r["hosted_by_me"] for r in _list(client, jar)}
    assert hosted == {p1: True, p2: False}

    someone_else = await db_conn.fetchval(
        """insert into presentation_participant (session_id, display_name, rejoin_token_hash)
           values ($1, 'y', $2) returning id""",
        p1_id,
        uuid.uuid4().hex,
    )
    await db_conn.execute(
        "update presentation_session set host_participant_id = $1 where id = $2",
        someone_else,
        p1_id,
    )

    hosted = {r["invite_id"]: r["hosted_by_me"] for r in _list(client, jar)}
    assert hosted == {p1: False, p2: False}


# --- NFR-1 ------------------------------------------------------------------------------------


async def test_nfr1_each_cookie_sees_only_its_own_sessions(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me, someone = _sub("newuser"), _sub("other")
    mine, _ = await _coding(db_conn, "Mine", me, NOW)
    theirs = await _learning(db_conn, "Theirs", someone, NOW)
    jar = signed_in_jar(client, "other")

    assert [r["invite_id"] for r in _list(client, jar)] == [theirs]
    # No parameter names an account: anything passed is ignored.
    for params in ({"account_sub": me}, {"sub": me}, {"account": "newuser"}):
        response = client.get("/api/me/sessions", params=params, headers=cookie_header(jar))
        assert [r["invite_id"] for r in response.json()] == [theirs]
    assert [r["invite_id"] for r in _list(client, signed_in_jar(client, "newuser"))] == [mine]


def test_nfr1_signed_out_is_401_and_route_takes_no_parameters(client: TestClient) -> None:
    response = client.get("/api/me/sessions")

    assert response.status_code == 401
    operation = client.get("/openapi.json").json()["paths"]["/api/me/sessions"]["get"]
    assert not operation.get("parameters")


# --- spec 014 FR-31, FR-34 --------------------------------------------------------------------


async def _chess(conn: asyncpg.Connection, sub: str, at: datetime) -> tuple[str, uuid.UUID]:
    invite = _invite()
    session_id = await conn.fetchval(
        "insert into chess_session (invite_id, last_activity_at) values ($1, $2) returning id",
        invite,
        at,
    )
    await conn.execute(
        """insert into chess_participant (session_id, display_name, rejoin_token_hash,
                                         account_sub)
           values ($1, 'x', $2, $3)""",
        session_id,
        uuid.uuid4().hex,
        sub,
    )
    return invite, session_id


async def test_014_ac28_chess_sessions_are_listed_with_kind_chess(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me = _sub("newuser")
    c1, _ = await _chess(db_conn, me, NOW)
    c2, c2_id = await _chess(db_conn, me, NOW - timedelta(hours=1))
    await db_conn.execute("update chess_session set stale_at = now() where id = $1", c2_id)
    jar = signed_in_jar(client, "newuser")

    rows = _list(client, jar)

    assert rows == [
        {
            "kind": "chess",
            "invite_id": c1,
            "title": "Chess",
            "last_activity_at": NOW.isoformat(),
            "stale": False,
            "hosted_by_me": False,
            "live": False,
        },
        {
            "kind": "chess",
            "invite_id": c2,
            "title": "Chess",
            "last_activity_at": (NOW - timedelta(hours=1)).isoformat(),
            "stale": True,
            "hosted_by_me": False,
            "live": False,
        },
    ]


async def test_014_ac34_deleted_and_hidden_chess_sessions_are_gone_for_every_account(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me, someone = _sub("newuser"), _sub("other")
    gone, gone_id = await _chess(db_conn, me, NOW)
    await db_conn.execute(
        """insert into chess_participant (session_id, display_name, rejoin_token_hash,
                                         account_sub)
           values ($1, 'y', $2, $3)""",
        gone_id,
        uuid.uuid4().hex,
        someone,
    )
    _, hidden_id = await _chess(db_conn, me, NOW)
    kept, _ = await _chess(db_conn, me, NOW - timedelta(minutes=1))
    await db_conn.execute(
        "update chess_participant set hidden_at = now() where session_id = $1", hidden_id
    )
    mine, theirs = signed_in_jar(client, "newuser"), signed_in_jar(client, "other")
    assert gone in {r["invite_id"] for r in _list(client, mine)}
    assert gone in {r["invite_id"] for r in _list(client, theirs)}

    await db_conn.execute(
        "update chess_session set deleted_at = now(), deleted_reason = 'admin' where id = $1",
        gone_id,
    )

    assert [r["invite_id"] for r in _list(client, mine)] == [kept]
    assert _list(client, theirs) == []


async def test_014_hide_accepts_the_chess_kind(
    client: TestClient,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    from app.accounts import repo

    me = _sub("newuser")
    invite, _ = await _chess(db_conn, me, NOW)

    assert await repo.hide(db_conn, me, "chess", invite) is True
    assert _list(client, signed_in_jar(client, "newuser")) == []
