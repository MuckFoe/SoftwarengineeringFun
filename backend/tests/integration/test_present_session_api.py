"""Spec 013 task 20: presentation session REST and the SPA's `frame-src` (plan.md "Contracts —
REST", "Isolation" 1 and 3). FR-4, FR-5, FR-8, FR-17, FR-30, FR-31, FR-32, NFR-2.

AC-8 anyone starts a session; AC-4 a session keeps its version; AC-5 removal → frame 410,
state unavailable; AC-16 frame headers and the app page's `frame-src 'self'`; AC-15g stale
state, admin-only reactivate; AC-15h chat history and admin-only removal. The stale job is
started and cancelled by the app's lifespan. Real Postgres; admin tests use the test Keycloak.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.present import chat, repo, service
from app.present import stale as present_stale
from app.present.frame import FRAME_HEADERS
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


def _slides(n: int) -> str:
    return "".join(f"<section><h1>Slide {i} of {n}</h1></section>" for i in range(n))


def _settings(database_url: str, kc: Keycloak | None = None) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer if kc else "http://unused",
        oidc_client_id=kc.client_id if kc else "unused",
        oidc_client_secret=kc.client_secret if kc else "unused",
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )


async def _reset(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
        await conn.execute(
            """truncate presentation_chat_message, presentation_participant,
                        presentation_session, presentation_version, presentation cascade"""
        )
    finally:
        await conn.close()


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    """Signed out; no Keycloak needed."""
    await _reset(database_url)
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


@pytest.fixture
async def kc_client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    await _reset(database_url)
    with TestClient(create_app(_settings(database_url, keycloak))) as test_client:
        yield test_client


@pytest.fixture
async def conn(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    connection = await asyncpg.connect(database_url)
    try:
        yield connection
    finally:
        await connection.close()


async def _presentation(conn: asyncpg.Connection, html: str, kind: str, count: int) -> uuid.UUID:
    created = await repo.create_presentation(
        conn,
        title="Intro to DNS",
        topic="Networking",
        html=html,
        kind=kind,
        slide_count=count,
        created_by_sub="editor-sub",
    )
    return created.id


def _start(client: TestClient, presentation_id: uuid.UUID) -> str:
    response = client.post("/api/present/sessions", json={"presentation_id": str(presentation_id)})
    assert response.status_code == 201, response.text
    return response.json()["invite_id"]


async def _stale(conn: asyncpg.Connection, invite: str) -> None:
    await conn.execute(
        "update presentation_session set stale_at = now() where invite_id = $1", invite
    )


# --- AC-8: start ------------------------------------------------------------------------------


async def test_anyone_starts_a_session(client: TestClient, conn: asyncpg.Connection) -> None:
    presentation_id = await _presentation(conn, _slides(4), "slides", 4)

    response = client.post("/api/present/sessions", json={"presentation_id": str(presentation_id)})

    assert response.status_code == 201
    invite = response.json()["invite_id"]
    assert set(response.json()) == {"invite_id"}
    state = client.get(f"/api/present/sessions/{invite}")
    assert state.status_code == 200
    assert state.json() == {
        "title": "Intro to DNS",
        "topic": "Networking",
        "kind": "slides",
        "slide_count": 4,
        "available": True,
        "stale": False,
        "can_reactivate": False,
        "host_name": None,
        "host_signed_in": False,
        "place": {"slide": 0, "anchor": None},
    }


async def test_a_page_session_starts_at_the_top(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    presentation_id = await _presentation(conn, "<h1>One page</h1>", "page", 0)

    invite = _start(client, presentation_id)

    body = client.get(f"/api/present/sessions/{invite}").json()
    assert body["kind"] == "page"
    assert body["place"] == {"slide": None, "anchor": None}


async def test_start_unknown_or_removed_is_404(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    unknown = client.post("/api/present/sessions", json={"presentation_id": str(uuid.uuid4())})
    assert unknown.status_code == 404
    assert unknown.json() == {"error": "not_found"}

    presentation_id = await _presentation(conn, _slides(2), "slides", 2)
    await repo.mark_removed(conn, presentation_id, "editor-sub")
    removed = client.post("/api/present/sessions", json={"presentation_id": str(presentation_id)})
    assert removed.status_code == 404


async def test_unknown_invite_is_404(client: TestClient) -> None:
    for path in ("", "/frame", "/chat"):
        response = client.get(f"/api/present/sessions/nope{path}")
        assert response.status_code == 404, path
        assert response.json() == {"error": "not_found"}


async def test_state_shows_the_host_and_stored_place(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    presentation_id = await _presentation(conn, _slides(4), "slides", 4)
    invite = _start(client, presentation_id)
    session = await repo.get_session_by_invite(conn, invite)
    assert session is not None
    joined = await service.join(conn, session.id, "Ana", None)
    await conn.execute(
        "update presentation_session set host_participant_id = $2 where id = $1",
        session.id,
        joined.participant.id,
    )
    anchor = {"path": [0, 1], "fx": 0.25, "fy": 0.5}
    await service.set_place(conn, session.id, joined.participant.id, 2, anchor)

    body = client.get(f"/api/present/sessions/{invite}").json()

    assert body["host_name"] == "Ana"
    assert body["host_signed_in"] is False
    assert body["place"] == {"slide": 2, "anchor": anchor}


# --- spec 012 FR-8: the host's signed-in mark -------------------------------------------------


def _until_host(ws) -> dict:
    while True:
        frame = ws.receive_json()
        if frame["type"] == "host":
            return frame


async def test_signed_in_host_is_marked_until_hosting_passes_to_anonymous(
    kc_client: TestClient,
    conn: asyncpg.Connection,
    signed_in_jar,  # noqa: F811
) -> None:
    invite = _start(kc_client, await _presentation(conn, _slides(3), "slides", 3))
    jar = signed_in_jar(kc_client, "newuser")
    url = f"/api/present/sessions/{invite}/ws"

    with kc_client.websocket_connect(url, headers=cookie_header(jar)) as host_ws:
        welcome = host_ws.receive_json()
        assert welcome["type"] == "welcome"
        newuser_id = welcome["you"]["participant_id"]
        assert welcome["host"] == {
            "id": newuser_id,
            "name": "newuser",
            "away": False,
            "signed_in": True,
        }
        assert _until_host(host_ws)["host"]["signed_in"] is True
        body = kc_client.get(f"/api/present/sessions/{invite}").json()
        assert (body["host_name"], body["host_signed_in"]) == ("newuser", True)

        with kc_client.websocket_connect(f"{url}?name=newuser") as guest_ws:
            guest = guest_ws.receive_json()
            assert guest["you"]["signed_in"] is False
            assert guest["host"]["signed_in"] is True
            guest_id = guest["you"]["participant_id"]

            host_ws.send_json({"type": "hand_over", "participant_id": guest_id})
            passed = _until_host(guest_ws)
            assert passed["host"] == {
                "id": guest_id,
                "name": "newuser",
                "away": False,
                "signed_in": False,
            }
            body = kc_client.get(f"/api/present/sessions/{invite}").json()
            assert (body["host_name"], body["host_signed_in"]) == ("newuser", False)


# --- AC-4, AC-16: frame -----------------------------------------------------------------------


async def test_frame_keeps_the_sessions_version_and_carries_frame_headers(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    presentation_id = await _presentation(conn, _slides(4), "slides", 4)
    old_invite = _start(client, presentation_id)
    await repo.add_version(
        conn,
        presentation_id,
        html=_slides(6),
        kind="slides",
        slide_count=6,
        created_by_sub="editor-sub",
    )
    new_invite = _start(client, presentation_id)

    old = client.get(f"/api/present/sessions/{old_invite}/frame")
    new = client.get(f"/api/present/sessions/{new_invite}/frame")

    assert old.status_code == 200
    assert old.headers["content-type"].startswith("text/html")
    assert "Slide 3 of 4" in old.text
    assert "of 6" not in old.text
    assert "Slide 5 of 6" in new.text
    assert "window.__SDD" in old.text  # the bridge is injected
    for response in (old, new):
        for name, value in FRAME_HEADERS.items():
            assert response.headers[name] == value, name
    assert client.get(f"/api/present/sessions/{old_invite}").json()["slide_count"] == 4
    assert client.get(f"/api/present/sessions/{new_invite}").json()["slide_count"] == 6


async def test_app_page_allows_only_same_origin_frames(client: TestClient) -> None:
    for path in ("/", "/present/s/x"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert response.headers["content-security-policy"] == "frame-src 'self'", path
        assert response.headers["cache-control"] == "no-cache", path


# --- AC-5: removal ----------------------------------------------------------------------------


async def test_after_removal_frame_is_410_and_state_unavailable(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    presentation_id = await _presentation(conn, _slides(4), "slides", 4)
    invite = _start(client, presentation_id)
    await repo.mark_removed(conn, presentation_id, "editor-sub")

    frame = client.get(f"/api/present/sessions/{invite}/frame")
    state = client.get(f"/api/present/sessions/{invite}")

    assert frame.status_code == 410
    assert frame.json() == {"error": "presentation_removed"}
    assert state.status_code == 200
    assert state.json()["available"] is False


# --- AC-15g: stale ----------------------------------------------------------------------------


async def test_stale_state_cannot_be_reactivated_by_anyone_signed_out(
    client: TestClient, conn: asyncpg.Connection
) -> None:
    invite = _start(client, await _presentation(conn, _slides(3), "slides", 3))
    await _stale(conn, invite)

    body = client.get(f"/api/present/sessions/{invite}").json()
    assert body["stale"] is True
    assert body["can_reactivate"] is False
    assert client.post(f"/api/present/sessions/{invite}/reactivate").status_code == 401


async def test_admin_reactivates_a_stale_session(
    kc_client: TestClient,
    conn: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    invite = _start(kc_client, await _presentation(conn, _slides(3), "slides", 3))

    login_as(kc_client, "plain1")
    await _stale(conn, invite)
    assert kc_client.get(f"/api/present/sessions/{invite}").json()["can_reactivate"] is False
    refused = kc_client.post(f"/api/present/sessions/{invite}/reactivate")
    assert refused.status_code == 403
    assert refused.json() == {"error": "missing_role", "role": "admin"}

    login_as(kc_client, "admin1")
    body = kc_client.get(f"/api/present/sessions/{invite}").json()
    assert body["stale"] is True
    assert body["can_reactivate"] is True
    reactivated = kc_client.post(f"/api/present/sessions/{invite}/reactivate")
    assert reactivated.status_code == 200
    assert reactivated.json() == {}
    after = kc_client.get(f"/api/present/sessions/{invite}").json()
    assert after["stale"] is False
    assert after["can_reactivate"] is False

    not_stale = kc_client.post(f"/api/present/sessions/{invite}/reactivate")
    assert not_stale.status_code == 409
    assert not_stale.json() == {"error": "not_stale"}
    assert kc_client.post("/api/present/sessions/nope/reactivate").status_code == 404


# --- AC-15h: chat -----------------------------------------------------------------------------


async def _chat_session(client: TestClient, conn: asyncpg.Connection) -> tuple[str, list[int]]:
    invite = _start(client, await _presentation(conn, _slides(3), "slides", 3))
    session = await repo.get_session_by_invite(conn, invite)
    assert session is not None
    joined = await service.join(conn, session.id, "Ben", None)
    ids = []
    for text in ("hello", "second"):
        message = await chat.insert(
            conn, session.id, joined.participant.id, "Ben", text, session.created_at
        )
        ids.append(message.id)
    return invite, ids


async def test_chat_history_and_read_only(client: TestClient, conn: asyncpg.Connection) -> None:
    invite, ids = await _chat_session(client, conn)

    body = client.get(f"/api/present/sessions/{invite}/chat").json()
    assert body["read_only"] is False
    assert [(m["id"], m["sender_name"], m["text"]) for m in body["messages"]] == [
        (ids[0], "Ben", "hello"),
        (ids[1], "Ben", "second"),
    ]

    await _stale(conn, invite)
    stale = client.get(f"/api/present/sessions/{invite}/chat").json()
    assert stale["read_only"] is True
    assert len(stale["messages"]) == 2


async def test_chat_removal_signed_out_is_401(client: TestClient, conn: asyncpg.Connection) -> None:
    invite, ids = await _chat_session(client, conn)

    assert client.delete(f"/api/present/sessions/{invite}/chat/{ids[0]}").status_code == 401


async def test_admin_removes_a_chat_message(
    kc_client: TestClient,
    conn: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    invite, ids = await _chat_session(kc_client, conn)

    login_as(kc_client, "plain1")
    refused = kc_client.delete(f"/api/present/sessions/{invite}/chat/{ids[0]}")
    assert refused.status_code == 403

    login_as(kc_client, "admin1")
    removed = kc_client.delete(f"/api/present/sessions/{invite}/chat/{ids[0]}")
    assert removed.status_code == 204
    messages = kc_client.get(f"/api/present/sessions/{invite}/chat").json()["messages"]
    assert [m["id"] for m in messages] == [ids[1]]
    again = kc_client.delete(f"/api/present/sessions/{invite}/chat/{ids[0]}")
    assert again.status_code == 404
    other = kc_client.delete(f"/api/present/sessions/nope/chat/{ids[1]}")
    assert other.status_code == 404


# --- lifespan: the stale job --------------------------------------------------------------------


async def test_lifespan_starts_and_cancels_the_stale_job(
    database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    events: list[str] = []

    async def fake_run_periodically(pool: asyncpg.Pool) -> None:
        events.append("started")
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            events.append("cancelled")
            raise

    monkeypatch.setattr(present_stale, "run_periodically", fake_run_periodically)
    await _reset(database_url)

    with TestClient(create_app(_settings(database_url))) as test_client:
        test_client.get("/api/present/presentations")
        assert events == ["started"]
    assert events == ["started", "cancelled"]
