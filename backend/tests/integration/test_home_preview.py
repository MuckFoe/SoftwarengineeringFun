"""Spec 017 task 8: `GET /api/home/preview/{session_id}` and `has_preview` in `/api/home`
(plan.md "Contracts"). FR-4, FR-8, Privacy. Real Postgres, real test Keycloak."""

import uuid
from collections.abc import Iterator
from typing import Any

import asyncpg
import pycrdt
import pytest
from fastapi.testclient import TestClient

from app.sessions import collab
from app.sessions import hub as session_hub
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)
from tests.integration.test_home import NOW, _go_live, _home
from tests.integration.test_me_sessions import (  # noqa: F401  (pytest fixtures)
    _coding,
    _sub,
    client,
    db_conn,
)


@pytest.fixture(autouse=True)
def _clean() -> Iterator[None]:
    session_hub._hubs.clear()  # noqa: SLF001
    collab._active.clear()  # noqa: SLF001
    yield
    session_hub._hubs.clear()  # noqa: SLF001
    collab._active.clear()  # noqa: SLF001


async def _write_code(conn: asyncpg.Connection, session_id: uuid.UUID, code: str) -> None:
    problem_id = await conn.fetchval(
        "select current_problem_id from session where id = $1", session_id
    )
    doc = pycrdt.Doc()
    doc.get(f"code:{problem_id}", type=pycrdt.Text).__iadd__(code)
    await conn.execute(
        "insert into yjs_update (session_id, update) values ($1, $2)",
        session_id,
        doc.get_update(),
    )


def _get(client: TestClient, jar: Any, session_id: object) -> Any:  # noqa: F811
    return client.get(f"/api/home/preview/{session_id}", headers=cookie_header(jar))


async def test_fr4_excerpt_is_first_eight_lines_truncated(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me = _sub("newuser")
    _, sid = await _coding(db_conn, "t", me, NOW)
    lines = [f"line {i} " + "x" * 100 for i in range(12)]
    await _write_code(db_conn, sid, "\n".join(lines))
    await _go_live(db_conn, sid, me)

    response = _get(client, jar, sid)

    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == str(sid) and body["language"]
    got = body["excerpt"].split("\n")
    assert len(got) == 8
    assert got == [line[:80] for line in lines[:8]]
    assert _home(client, jar)["sessions"][0]["has_preview"] is True


async def test_fr4_no_code_is_204_and_has_preview_false(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    me = _sub("newuser")
    _, sid = await _coding(db_conn, "t", me, NOW)
    await _go_live(db_conn, sid, me)

    response = _get(client, jar, sid)

    assert response.status_code == 204
    assert _home(client, jar)["sessions"][0]["has_preview"] is False


async def test_fr8_private_session_404_identical_to_missing(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    _, private = await _coding(db_conn, "A private", _sub("newuser"), NOW)
    await _write_code(db_conn, private, "secret = 1")
    jar_b = signed_in_jar(client, "other")

    hidden = _get(client, jar_b, private)
    missing = _get(client, jar_b, uuid.uuid4())

    assert hidden.status_code == missing.status_code == 404
    assert hidden.text == missing.text


async def test_privacy_guest_gets_404_for_another_session(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    _, sid = await _coding(db_conn, "t", _sub("newuser"), NOW)
    await _write_code(db_conn, sid, "secret = 1")

    assert client.get(f"/api/home/preview/{sid}").status_code in (401, 404)
