"""Spec 019: who hosts a session (FR-0).

Task 4 (`test_ac0_start_*`): the start endpoints record the starter's account as
`started_by_sub`, or null for a signed-out start. Real Postgres, real test Keycloak.
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

# --- task 4: start endpoints record started_by_sub (AC-0, start part) -------------------------

_T4_COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
_T4_LESSON_KEY = "019-host/01-start"


def _t4_sub(username: str) -> str:
    with _admin_client() as admin:
        (user,) = admin.get("/users", params={"username": username, "exact": "true"}).json()
    return user["id"]


@pytest.fixture
async def _t4_client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer=keycloak.issuer,
        oidc_client_id=keycloak.client_id,
        oidc_client_secret=keycloak.client_secret,
        session_cookie_key=_T4_COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
async def _t4_seeded(_t4_client: TestClient, database_url: str) -> AsyncIterator[uuid.UUID]:
    """A problem to start a coding session on, and a current lesson to start a learning one."""
    conn = await asyncpg.connect(database_url)
    try:
        problem_id = await conn.fetchval(
            """insert into problem (title, description, signature, function_name, params,
                                    return_type)
               values ('Host', '', 'def f(): ...', 'f', '[]'::jsonb, 'None') returning id"""
        )
        version_id = await conn.fetchval(
            """insert into lesson_version (lesson_key, content_hash, content)
               values ($1, $1, $2::jsonb)
               on conflict (lesson_key, content_hash) do update set content = excluded.content
               returning id""",
            _T4_LESSON_KEY,
            json.dumps({"title": "Host"}),
        )
        await conn.execute(
            """insert into lesson (key, topic_key, topic_title, current_version_id)
               values ($1, '019-host', 'Host', $2)
               on conflict (key) do update set current_version_id = excluded.current_version_id""",
            _T4_LESSON_KEY,
            version_id,
        )
        yield problem_id
    finally:
        await conn.close()


def _t4_start_all(client: TestClient, problem_id: uuid.UUID, headers: dict[str, str]) -> dict:
    coding = client.post("/api/sessions", json={"problem_id": str(problem_id)}, headers=headers)
    learning = client.post(
        "/api/learn/sessions", json={"lesson_key": _T4_LESSON_KEY}, headers=headers
    )
    chess = client.post("/api/games/chess/sessions", headers=headers)
    for response in (coding, learning, chess):
        assert response.status_code == 201, response.text
    return {
        "session": coding.json()["invite_id"],
        "learning_session": learning.json()["invite_id"],
        "chess_session": chess.json()["invite_id"],
    }


async def _t4_starters(database_url: str, invites: dict[str, str]) -> dict[str, str | None]:
    conn = await asyncpg.connect(database_url)
    try:
        return {
            table: await conn.fetchval(
                f"select started_by_sub from {table} where invite_id = $1",  # noqa: S608
                invite,
            )
            for table, invite in invites.items()
        }
    finally:
        await conn.close()


async def test_ac0_start_signed_in_records_the_starter(
    _t4_client: TestClient,
    _t4_seeded: uuid.UUID,
    database_url: str,
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(_t4_client, "newuser")

    invites = _t4_start_all(_t4_client, _t4_seeded, cookie_header(jar))

    me = _t4_sub("newuser")
    assert await _t4_starters(database_url, invites) == dict.fromkeys(invites, me)


async def test_ac0_start_signed_out_records_null(
    _t4_client: TestClient, _t4_seeded: uuid.UUID, database_url: str
) -> None:
    invites = _t4_start_all(_t4_client, _t4_seeded, {})

    assert await _t4_starters(database_url, invites) == dict.fromkeys(invites)


# --- task 5: host rule and can_delete in the profile list (AC-0 profile part, AC-1–AC-3) ------
#
# Sessions and participants are seeded directly, `started_by_sub` set in the DB. Nothing is
# truncated: each test asserts only on the invites it created.

_T5_COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
_T5_NOW = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)


def _t5_sub(username: str) -> str:
    with _admin_client() as admin:
        (user,) = admin.get("/users", params={"username": username, "exact": "true"}).json()
    return user["id"]


@pytest.fixture
async def _t5_client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer=keycloak.issuer,
        oidc_client_id=keycloak.client_id,
        oidc_client_secret=keycloak.client_secret,
        session_cookie_key=_T5_COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
async def _t5_db(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    conn = await asyncpg.connect(database_url)
    try:
        yield conn
    finally:
        await conn.close()


def _t5_invite() -> str:
    return uuid.uuid4().hex[:12]


async def _t5_coding(
    conn: asyncpg.Connection, started_by: str | None, joiners: list[str | None]
) -> str:
    """A coding session; `joiners` join in order, one second apart (None: a guest)."""
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ('T5 coding', '', 'def f(): ...', 'f', '[]'::jsonb, 'None') returning id"""
    )
    invite = _t5_invite()
    session_id = await conn.fetchval(
        """insert into session (invite_id, current_problem_id, last_activity_at, started_by_sub)
           values ($1, $2, $3, $4) returning id""",
        invite,
        problem_id,
        _T5_NOW,
        started_by,
    )
    for i, sub in enumerate(joiners):
        await conn.execute(
            """insert into participant (session_id, display_name, account_sub, joined_at)
               values ($1, 'x', $2, $3)""",
            session_id,
            sub,
            _T5_NOW + timedelta(seconds=i),
        )
    return invite


async def _t5_learning(
    conn: asyncpg.Connection, started_by: str | None, joiners: list[str | None]
) -> str:
    version_id = await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $1, $2::jsonb) returning id""",
        uuid.uuid4().hex,
        json.dumps({"title": "T5 lesson"}),
    )
    invite = _t5_invite()
    session_id = await conn.fetchval(
        """insert into learning_session (invite_id, lesson_version_id, last_activity_at,
                                         started_by_sub)
           values ($1, $2, $3, $4) returning id""",
        invite,
        version_id,
        _T5_NOW,
        started_by,
    )
    for i, sub in enumerate(joiners):
        await conn.execute(
            """insert into learning_participant (session_id, display_name, account_sub,
                                                 joined_at)
               values ($1, 'x', $2, $3)""",
            session_id,
            sub,
            _T5_NOW + timedelta(seconds=i),
        )
    return invite


async def _t5_chess(
    conn: asyncpg.Connection,
    started_by: str | None,
    joiners: list[str | None],
    *,
    starter_index: int | None = None,
) -> str:
    """A chess session; `starter_index` picks the joiner recorded as `starter_participant_id`."""
    invite = _t5_invite()
    session_id = await conn.fetchval(
        """insert into chess_session (invite_id, last_activity_at, started_by_sub)
           values ($1, $2, $3) returning id""",
        invite,
        _T5_NOW,
        started_by,
    )
    for i, sub in enumerate(joiners):
        participant_id = await conn.fetchval(
            """insert into chess_participant (session_id, display_name, rejoin_token_hash,
                                              account_sub, joined_at)
               values ($1, 'x', $2, $3, $4) returning id""",
            session_id,
            uuid.uuid4().hex,
            sub,
            _T5_NOW + timedelta(seconds=i),
        )
        if i == starter_index:
            await conn.execute(
                "update chess_session set starter_participant_id = $1 where id = $2",
                participant_id,
                session_id,
            )
    return invite


async def _t5_presentation(conn: asyncpg.Connection, host: str, joiners: list[str]) -> str:
    """A presentation session hosted (presented) by `host`, joined by `joiners`."""
    presentation_id = await conn.fetchval(
        """insert into presentation (title, topic, created_by_sub)
           values ('T5 deck', 'T', 'e') returning id"""
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
    invite = _t5_invite()
    session_id = await conn.fetchval(
        """insert into presentation_session (invite_id, version_id, last_activity_at)
           values ($1, $2, $3) returning id""",
        invite,
        version_id,
        _T5_NOW,
    )
    for sub in [host, *joiners]:
        participant_id = await conn.fetchval(
            """insert into presentation_participant (session_id, display_name,
                                                     rejoin_token_hash, account_sub)
               values ($1, 'x', $2, $3) returning id""",
            session_id,
            uuid.uuid4().hex,
            sub,
        )
        if sub == host:
            await conn.execute(
                "update presentation_session set host_participant_id = $1 where id = $2",
                participant_id,
                session_id,
            )
    return invite


def _t5_rows(client: TestClient, jar, invites: list[str]) -> dict[str, dict]:
    """The caller's profile rows for `invites`, keyed by invite."""
    response = client.get("/api/me/sessions", headers=cookie_header(jar))
    assert response.status_code == 200, response.text
    return {r["invite_id"]: r for r in response.json() if r["invite_id"] in invites}


async def test_ac0_profile_starter_is_host_of_coding_learning_and_chess(
    _t5_client: TestClient,
    _t5_db: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    starter, joiner = _t5_sub("newuser"), _t5_sub("other")
    # The joiner's row comes first, so only `started_by_sub` makes the starter the host.
    invites = [
        await _t5_coding(_t5_db, starter, [joiner, starter]),
        await _t5_learning(_t5_db, starter, [joiner, starter]),
        await _t5_chess(_t5_db, starter, [joiner, starter], starter_index=0),
    ]

    as_starter = _t5_rows(_t5_client, signed_in_jar(_t5_client, "newuser"), invites)
    as_joiner = _t5_rows(_t5_client, signed_in_jar(_t5_client, "other"), invites)

    assert {i: r["hosted_by_me"] for i, r in as_starter.items()} == dict.fromkeys(invites, True)
    assert {i: r["hosted_by_me"] for i, r in as_joiner.items()} == dict.fromkeys(invites, False)


async def test_ac0_profile_older_sessions_fall_back_to_first_signed_in_participant(
    _t5_client: TestClient,
    _t5_db: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    a, b = _t5_sub("newuser"), _t5_sub("other")
    # No starter recorded; a guest joined first, then A, then B.
    coding = await _t5_coding(_t5_db, None, [None, a, b])
    learning = await _t5_learning(_t5_db, None, [None, a, b])
    chess_first = await _t5_chess(_t5_db, None, [None, a, b])
    # Chess records its starter participant: B, though A joined first.
    chess_starter = await _t5_chess(_t5_db, None, [a, b], starter_index=1)
    invites = [coding, learning, chess_first, chess_starter]

    as_a = _t5_rows(_t5_client, signed_in_jar(_t5_client, "newuser"), invites)
    as_b = _t5_rows(_t5_client, signed_in_jar(_t5_client, "other"), invites)

    assert {i: r["hosted_by_me"] for i, r in as_a.items()} == {
        coding: True,
        learning: True,
        chess_first: True,
        chess_starter: False,
    }
    assert {i: r["hosted_by_me"] for i, r in as_b.items()} == {
        coding: False,
        learning: False,
        chess_first: False,
        chess_starter: True,
    }


async def test_ac1_host_can_delete_every_kind(
    _t5_client: TestClient,
    _t5_db: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    host, joiner = _t5_sub("newuser"), _t5_sub("other")
    invites = [
        await _t5_coding(_t5_db, host, [host, joiner]),
        await _t5_learning(_t5_db, host, [host, joiner]),
        await _t5_presentation(_t5_db, host, [joiner]),
        await _t5_chess(_t5_db, host, [host, joiner], starter_index=0),
    ]

    rows = _t5_rows(_t5_client, signed_in_jar(_t5_client, "newuser"), invites)

    assert {i: (r["hosted_by_me"], r["can_delete"]) for i, r in rows.items()} == dict.fromkeys(
        invites, (True, True)
    )


async def test_ac2_admin_can_delete_a_session_someone_else_hosts(
    _t5_client: TestClient,
    _t5_db: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    host, admin = _t5_sub("newuser"), _t5_sub("admin1")
    invites = [
        await _t5_coding(_t5_db, host, [host, admin]),
        await _t5_presentation(_t5_db, host, [admin]),
        await _t5_chess(_t5_db, None, [host, admin]),
    ]

    rows = _t5_rows(_t5_client, signed_in_jar(_t5_client, "admin1"), invites)

    assert {i: (r["hosted_by_me"], r["can_delete"]) for i, r in rows.items()} == dict.fromkeys(
        invites, (False, True)
    )


async def test_ac3_non_admin_joiner_cannot_delete(
    _t5_client: TestClient,
    _t5_db: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    host, joiner = _t5_sub("newuser"), _t5_sub("other")
    invites = [
        await _t5_coding(_t5_db, host, [host, joiner]),
        await _t5_learning(_t5_db, None, [host, joiner]),
        await _t5_presentation(_t5_db, host, [joiner]),
        await _t5_chess(_t5_db, host, [joiner, host]),
    ]

    rows = _t5_rows(_t5_client, signed_in_jar(_t5_client, "other"), invites)

    assert {i: (r["hosted_by_me"], r["can_delete"]) for i, r in rows.items()} == dict.fromkeys(
        invites, (False, False)
    )
