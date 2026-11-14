"""Spec 012 task 28: the recent-sessions list and preferences survive a restart, and a list
of 200 sessions is fast (plan.md "Test strategy" rows NFR-3, NFR-4). Both tests are `slow`.

A "restart" is what a deploy does (as in `test_learn_persistence.py`): the startup step
(`asgi._migrate_and_seed`) runs again on the same database and a fresh app is built. The
api runs in-process in tests (the test stack has no api container), so nothing but
Postgres carries over. The session cookie stays valid because the cookie key is config.

Participant rows are seeded with `account_sub` directly. Real Postgres, real test Keycloak
(`signed_in_jar`); the account `sub` is read from Keycloak's admin API.
"""

import json
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import asgi
from app import db as app_db
from app.accounts import repo as accounts_repo
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

pytestmark = pytest.mark.slow

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
ACCOUNT_INDEXES = {
    "participant_account",
    "learning_participant_account",
    "presentation_participant_account",
}


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
async def db_conn(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
        await conn.execute(
            """update presentation_session set host_participant_id = null;
               truncate chat_message, participant, session_problem, session,
                        learning_participant, learning_session, presentation_participant,
                        presentation_session, account_preference cascade"""
        )
        yield conn
    finally:
        await conn.close()


@contextmanager
def _deployed(kc: Keycloak, database_url: str) -> Iterator[TestClient]:
    """A fresh app on the database, as after a (re)start."""
    with TestClient(create_app(_settings(kc, database_url))) as client:
        yield client


def _invite() -> str:
    return uuid.uuid4().hex[:12]


async def _coding(conn: asyncpg.Connection, title: str, subs: list[str], at: datetime) -> str:
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
    await conn.executemany(
        "insert into participant (session_id, display_name, account_sub) values ($1, 'x', $2)",
        [(session_id, sub) for sub in subs],
    )
    return invite


async def _learning(conn: asyncpg.Connection, title: str, subs: list[str], at: datetime) -> str:
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
    await conn.executemany(
        """insert into learning_participant (session_id, display_name, account_sub)
           values ($1, 'x', $2)""",
        [(session_id, sub) for sub in subs],
    )
    return invite


async def _presentation(conn: asyncpg.Connection, title: str, subs: list[str], at: datetime) -> str:
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
    invite = _invite()
    session_id = await conn.fetchval(
        """insert into presentation_session (invite_id, version_id, last_activity_at)
           values ($1, $2, $3) returning id""",
        invite,
        version_id,
        at,
    )
    await conn.executemany(
        """insert into presentation_participant (session_id, display_name, rejoin_token_hash,
                                                 account_sub)
           values ($1, 'x', $2, $3)""",
        [(session_id, uuid.uuid4().hex, sub) for sub in subs],
    )
    return invite


def _invites(client: TestClient, jar) -> list[str]:
    response = client.get("/api/me/sessions", headers=cookie_header(jar))
    assert response.status_code == 200, response.text
    return [r["invite_id"] for r in response.json()]


def _preferences(client: TestClient, jar) -> dict | None:
    response = client.get("/api/me", headers=cookie_header(jar))
    assert response.status_code == 200, response.text
    return response.json()["preferences"]


def _index_names(plan: object) -> set[str]:
    """Every `Index Name` in an `explain (format json)` plan tree."""
    if isinstance(plan, dict):
        found = {plan["Index Name"]} if "Index Name" in plan else set()
        for value in plan.values():
            found |= _index_names(value)
        return found
    if isinstance(plan, list):
        return set().union(*(_index_names(item) for item in plan))
    return set()


def _scanned_relations(plan: object, node_type: str) -> set[str]:
    """The relations scanned by nodes of `node_type` anywhere in the plan tree."""
    if isinstance(plan, dict):
        found = {plan["Relation Name"]} if plan.get("Node Type") == node_type else set()
        for value in plan.values():
            found |= _scanned_relations(value, node_type)
        return found
    if isinstance(plan, list):
        return set().union(*(_scanned_relations(item, node_type) for item in plan))
    return set()


# --- NFR-3 ------------------------------------------------------------------------------------


async def test_nfr3_list_hidden_sessions_and_preferences_survive_a_restart(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
    tmp_path: Path,
) -> None:
    me = _sub("newuser")
    s1 = await _coding(db_conn, "Two Sum", [me], NOW - timedelta(hours=2))
    s2 = await _coding(db_conn, "Reverse", [me], NOW - timedelta(hours=1))
    l1 = await _learning(db_conn, "Lists", [me], NOW)

    with _deployed(keycloak, database_url) as client:
        jar = signed_in_jar(client, "newuser")
        hide = client.post(f"/api/me/sessions/coding/{s2}/hide", headers=cookie_header(jar))
        assert hide.status_code == 204
        put = client.put(
            "/api/me/preferences", json={"appearance": "dark"}, headers=cookie_header(jar)
        )
        assert put.status_code == 200, put.text
        assert _invites(client, jar) == [l1, s1]
        assert _preferences(client, jar) == {
            "appearance": "dark",
            "chat_visible": True,
            "text_size": "s",
        }

    # Restart: the startup step runs again on the same database, then a fresh app.
    await asgi._migrate_and_seed(_settings(keycloak, database_url), lessons_dir=tmp_path)

    with _deployed(keycloak, database_url) as client:
        assert _invites(client, jar) == [l1, s1]
        assert _preferences(client, jar) == {
            "appearance": "dark",
            "chat_visible": True,
            "text_size": "s",
        }


# --- NFR-4 ------------------------------------------------------------------------------------


async def test_nfr4_two_hundred_sessions_list_within_one_second_via_the_account_index(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
    db_conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    me = _sub("newuser")
    # Other accounts in the same sessions, so each participant table is mostly not `me`'s
    # and a sequential scan would be the slow path the index avoids.
    others = [f"other-{i}" for i in range(30)]
    seeders = (_coding, _learning, _presentation)
    invites = []
    for i in range(200):
        seed = seeders[i % 3]
        invites.append(await seed(db_conn, f"Session {i}", [me, *others], NOW - timedelta(i)))
    await db_conn.execute("analyze")

    with _deployed(keycloak, database_url) as client:
        jar = signed_in_jar(client, "newuser")
        started = time.perf_counter()
        response = client.get("/api/me/sessions", headers=cookie_header(jar))
        elapsed = time.perf_counter() - started

    assert response.status_code == 200, response.text
    assert [r["invite_id"] for r in response.json()] == invites  # most recent first
    assert elapsed < 1.0, f"GET /api/me/sessions took {elapsed:.3f}s for 200 sessions"

    plan = json.loads(
        await db_conn.fetchval(
            f"explain (format json) {accounts_repo._RECENT_SESSIONS}",  # noqa: S608  (fixed SQL)
            me,
        )
    )
    assert _index_names(plan) >= ACCOUNT_INDEXES, plan
    participant_tables = {"participant", "learning_participant", "presentation_participant"}
    assert not (_scanned_relations(plan, "Seq Scan") & participant_tables), plan
