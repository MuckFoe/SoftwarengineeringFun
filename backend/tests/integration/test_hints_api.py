"""Spec 020 task 13: `GET /api/sessions/{invite}/hints` (`hints/api.py`).

AC-2 (FR-3) a stale session still shows its earlier hints; AC-13 (FR-15) every hint by
(problem, number) with asker and note, read-only; unknown invite 404, deleted 410.
Real Postgres only; no sign-in is involved, the invite is the only key.
"""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.deletion import repo as deletion_repo
from app.hints import repo as hints_repo
from app.main import create_app
from app.sessions import repo as sessions_repo


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="test-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


async def _problem(conn: asyncpg.Connection, title: str) -> uuid.UUID:
    return await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ($1, $1, 'def add(a: int, b: int) -> int', 'add', '[]'::jsonb, 'int')
           returning id""",
        title,
    )


async def _session(conn: asyncpg.Connection) -> tuple[str, uuid.UUID, uuid.UUID, uuid.UUID]:
    """A session on problem A plus a problem B; returns (invite, session_id, a, b)."""
    a = await _problem(conn, f"A {uuid.uuid4().hex}")
    b = await _problem(conn, f"B {uuid.uuid4().hex}")
    invite = uuid.uuid4().hex
    session_id = await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        invite,
        a,
    )
    return invite, session_id, a, b


async def test_ac2_ac13_stale_session_returns_every_hint_with_asker_and_note(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite, session_id, a, b = await _session(db)
    stored = [
        await hints_repo.insert_next(db, session_id, a, "Ana", "stuck on empty input", "One."),
        await hints_repo.insert_next(db, session_id, b, "Guest", None, "Other problem."),
        await hints_repo.insert_next(db, session_id, a, "Guest", None, "Two."),
    ]
    await sessions_repo.set_stale(db, session_id)

    response = client.get(f"/api/sessions/{invite}/hints")

    assert response.status_code == 200
    expected = await hints_repo.list_for_session(db, session_id)
    assert response.json() == {"hints": [hints_repo.hint_dict(r) for r in expected]}
    hints = response.json()["hints"]
    assert len(hints) == len(stored)
    by_problem = sorted([(h["problem_id"], h["number"]) for h in hints])
    assert by_problem == [(h["problem_id"], h["number"]) for h in hints]
    first = next(h for h in hints if h["problem_id"] == str(a) and h["number"] == 1)
    assert first["asked_by"] == "Ana"
    assert first["note"] == "stuck on empty input"
    assert first["body"] == "One."


async def test_active_session_returns_hints_and_none_of_another_session(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite, session_id, a, _ = await _session(db)
    _, other_id, other_a, _ = await _session(db)
    await hints_repo.insert_next(db, session_id, a, "Ana", None, "Mine.")
    await hints_repo.insert_next(db, other_id, other_a, "Bo", None, "Not mine.")

    response = client.get(f"/api/sessions/{invite}/hints")

    assert response.status_code == 200
    assert [h["body"] for h in response.json()["hints"]] == ["Mine."]


async def test_session_without_hints_returns_empty_list(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite, _, _, _ = await _session(db)
    response = client.get(f"/api/sessions/{invite}/hints")
    assert response.status_code == 200
    assert response.json() == {"hints": []}


async def test_ac13_route_offers_no_write_method(
    client: TestClient, db: asyncpg.Connection
) -> None:
    invite, _, _, _ = await _session(db)
    for method in ("post", "put", "patch", "delete"):
        response = client.request(method.upper(), f"/api/sessions/{invite}/hints", json={})
        assert response.status_code == 405, method


def test_unknown_invite_is_404(client: TestClient) -> None:
    response = client.get(f"/api/sessions/{uuid.uuid4().hex}/hints")
    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}


async def test_deleted_session_is_410(client: TestClient, db: asyncpg.Connection) -> None:
    invite = uuid.uuid4().hex
    await deletion_repo.tombstone(db, "coding", invite, "host")
    response = client.get(f"/api/sessions/{invite}/hints")
    assert response.status_code == 410
    assert response.json() == {"error": "session_deleted"}
