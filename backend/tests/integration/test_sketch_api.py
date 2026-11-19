"""Spec 022 task 12: `GET /api/sessions/{invite}/sketch`, the read-only board (`sketch/api.py`).

AC-16 a stale session's board is served with `read_only: true`, a live one's with `false`.
AC-20 an unknown or deleted invite is 404 with no board data; no write route exists.
AC-19 `/api/home`'s tile for a coding session is identical before and after drawing.
Real Postgres, the real Keycloak test realm (for `/api/home`'s signed-in cookie).
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import asyncpg
from fastapi.testclient import TestClient

from app.deletion import repo as deletion_repo
from app.sessions.hub import SessionHub
from app.sketch import service
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)
from tests.integration.test_me_sessions import (  # noqa: F401  (pytest fixtures)
    _coding,
    _sub,
    client,
    db_conn,
)

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
PEN = {"kind": "pen", "color": "blue", "points": [10, 20, 30, 40]}
BOX = {"kind": "box", "color": "red", "points": [100, 100, 300, 200]}


async def _draw(conn: asyncpg.Connection, session_id: uuid.UUID, *actions: dict) -> None:
    """Draws through the real service; a fresh hub, as nobody is connected while seeding."""
    participant_id = await conn.fetchval(
        "select id from participant where session_id = $1 limit 1", session_id
    )
    for action in actions:
        refused = await service.add(
            conn, SessionHub(), session_id, participant_id, uuid.uuid4().hex, action
        )
        assert refused is None


def _sketch(client: TestClient, invite: str) -> Any:  # noqa: F811
    return client.get(f"/api/sessions/{invite}/sketch")


async def test_ac16_live_session_board_is_served_not_read_only(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    invite, session_id = await _coding(db_conn, "live", None, NOW)
    await _draw(db_conn, session_id, PEN, BOX)

    response = _sketch(client, invite)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"actions", "read_only"}
    assert body["read_only"] is False
    assert [(a["kind"], a["color"], a["points"]) for a in body["actions"]] == [
        ("pen", "blue", [10, 20, 30, 40]),
        ("box", "red", [100, 100, 300, 200]),
    ]
    assert body["actions"] == (await service.snapshot(db_conn, session_id))["actions"]
    assert all("author_id" not in a for a in body["actions"])


async def test_ac16_stale_session_board_is_served_read_only(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    invite, session_id = await _coding(db_conn, "stale", None, NOW)
    await _draw(db_conn, session_id, PEN)
    await db_conn.execute("update session set stale_at = now() where id = $1", session_id)

    response = _sketch(client, invite)

    assert response.status_code == 200
    body = response.json()
    assert body["read_only"] is True
    assert [a["kind"] for a in body["actions"]] == ["pen"]


async def test_ac16_empty_board_is_an_empty_list(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    invite, _ = await _coding(db_conn, "empty", None, NOW)

    assert _sketch(client, invite).json() == {"actions": [], "read_only": False}


async def test_ac20_unknown_invite_is_404_with_no_board(
    client: TestClient,  # noqa: F811
) -> None:
    response = _sketch(client, uuid.uuid4().hex[:12])

    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}


async def test_ac20_deleted_session_is_404_with_no_board(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    invite, session_id = await _coding(db_conn, "deleted", None, NOW)
    await _draw(db_conn, session_id, PEN)
    async with db_conn.transaction():
        await deletion_repo.purge(db_conn, "coding", session_id)
        await deletion_repo.tombstone(db_conn, "coding", invite, "host")

    response = _sketch(client, invite)

    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}


async def test_ac20_no_write_route_exists(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
) -> None:
    invite, session_id = await _coding(db_conn, "writes", None, NOW)
    path = f"/api/sessions/{invite}/sketch"

    for method in ("POST", "PUT", "PATCH", "DELETE"):
        response = client.request(method, path, json={"action": PEN})
        assert response.status_code == 405, method
    assert client.delete(f"{path}/1").status_code == 404
    assert (
        await db_conn.fetchval(
            "select count(*) from sketch_action where session_id = $1", session_id
        )
        == 0
    )


async def test_ac19_home_tile_is_identical_with_and_without_a_board(
    client: TestClient,  # noqa: F811
    db_conn: asyncpg.Connection,  # noqa: F811
    signed_in_jar,  # noqa: F811
) -> None:
    jar = signed_in_jar(client, "newuser")
    _, session_id = await _coding(db_conn, "drawn on", _sub("newuser"), NOW)

    def tile() -> dict[str, Any]:
        response = client.get("/api/home", headers=cookie_header(jar))
        assert response.status_code == 200, response.text
        (only,) = response.json()["sessions"]
        return only

    before = tile()
    await _draw(db_conn, session_id, PEN, BOX)

    assert tile() == before
