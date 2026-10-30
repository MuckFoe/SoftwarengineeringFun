"""Spec 006 task 26: stale learning sessions (`learn/stale.py`, REST, lifespan). FR-27, NFR-5.

AC-26: no activity for 30 days marks a session stale (WS 4410, GET 423, record still served);
an admin reactivates it and the group carries on from the step where it stopped. Only admins
may list or reactivate. Nothing is ever deleted. A real database, Keycloak and the real app.
"""

import asyncio
import dataclasses
import json
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import clock
from app import db as app_db
from app.config import Settings
from app.learn import repo, service, stale
from app.learn.lesson_file import ChoiceCheck, Lesson, Step
from app.main import create_app, lifespan
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)

LESSON = Lesson(
    title="Stale basics",
    summary="Two steps.",
    minutes=5,
    images=(),
    steps=(
        Step(kind="explanation", title="Intro", body="Read this.", hint=None, check=None),
        Step(
            kind="quiz",
            title="Pick",
            body="Pick the second.",
            hint=None,
            check=ChoiceCheck(options=("a", "b"), correct=(2,), multiple=False),
        ),
    ),
)

LEARN_TABLES = (
    "learning_session",
    "learning_participant",
    "learning_step",
    "learning_attempt",
    "learning_chat_message",
    "lesson",
    "lesson_version",
)


def _settings(kc: Keycloak, database_url: str) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )


def _plain_settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    await db.execute("truncate learning_session cascade")
    yield db


@pytest.fixture
async def client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
    migrated: asyncpg.Connection,
) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


async def _session(conn: asyncpg.Connection, title: str = "Stale basics") -> repo.LearningSession:
    key = f"zz-stale/{secrets.token_hex(4)}"
    content = {**dataclasses.asdict(dataclasses.replace(LESSON, title=title)), "images": {}}
    version_id = await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $2, $3::jsonb) returning id""",
        key,
        secrets.token_hex(16),
        json.dumps(content),
    )
    await conn.execute(
        """insert into lesson (key, topic_key, topic_title, current_version_id)
           values ($1, 'zz-stale', 'Stale', $2)""",
        key,
        version_id,
    )
    return await service.create_session(conn, key)


async def _age(conn: asyncpg.Connection, session_id: uuid.UUID, age: timedelta) -> None:
    await conn.execute(
        "update learning_session set last_activity_at = $2 where id = $1",
        session_id,
        clock.now() - age,
    )


async def _set_stale(conn: asyncpg.Connection, session_id: uuid.UUID, at: datetime) -> None:
    await conn.execute("update learning_session set stale_at = $2 where id = $1", session_id, at)


async def _row_counts(conn: asyncpg.Connection) -> dict[str, int]:
    return {t: await conn.fetchval(f"select count(*) from {t}") for t in LEARN_TABLES}  # noqa: S608


def _close_code(client: TestClient, invite: str, name: str) -> int:
    with client.websocket_connect(f"/api/learn/sessions/{invite}/ws?name={name}") as ws:
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
    return info.value.code


# --- mark_stale ------------------------------------------------------------------------------


async def test_fr27_a_session_inactive_for_31_days_is_marked_stale_and_nothing_deleted(
    migrated: asyncpg.Connection,
) -> None:
    session = await _session(migrated)
    await _age(migrated, session.id, timedelta(days=31))
    before = await _row_counts(migrated)

    marked = await stale.mark_stale(migrated, clock.now())

    assert marked == [session.id]
    row = await repo.get_session_by_invite(migrated, session.invite_id)
    assert row is not None
    assert row.stale_at is not None
    assert await _row_counts(migrated) == before


async def test_a_session_inactive_for_29_days_is_not_marked(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    await _age(migrated, session.id, timedelta(days=29))

    assert await stale.mark_stale(migrated, clock.now()) == []
    row = await repo.get_session_by_invite(migrated, session.invite_id)
    assert row is not None
    assert row.stale_at is None


async def test_an_already_stale_session_keeps_its_stale_at(migrated: asyncpg.Connection) -> None:
    session = await _session(migrated)
    await _age(migrated, session.id, timedelta(days=40))
    first = clock.now() - timedelta(days=5)
    await _set_stale(migrated, session.id, first)

    assert await stale.mark_stale(migrated, clock.now()) == []
    row = await repo.get_session_by_invite(migrated, session.invite_id)
    assert row is not None
    assert row.stale_at == first


def test_nothing_is_ever_deleted() -> None:
    assert "delete from" not in Path(stale.__file__).read_text().lower()


async def test_run_periodically_runs_mark_stale_on_a_timer(
    migrated: asyncpg.Connection, database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = await _session(migrated)
    await _age(migrated, session.id, timedelta(days=31))
    monkeypatch.setattr(stale, "CHECK_INTERVAL_S", 0.02)
    pool = await app_db.create_pool(database_url)
    task = asyncio.create_task(stale.run_periodically(pool))
    try:
        await asyncio.sleep(0.2)
    finally:
        task.cancel()
        await pool.close()

    row = await repo.get_session_by_invite(migrated, session.invite_id)
    assert row is not None
    assert row.stale_at is not None


async def test_lifespan_starts_the_learning_stale_job(
    migrated: asyncpg.Connection, database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = await _session(migrated)
    await _age(migrated, session.id, timedelta(days=31))
    monkeypatch.setattr(stale, "CHECK_INTERVAL_S", 0.02)

    app = create_app(_plain_settings(database_url))
    async with lifespan(app):
        await asyncio.sleep(0.2)

    row = await repo.get_session_by_invite(migrated, session.invite_id)
    assert row is not None
    assert row.stale_at is not None


# --- AC-26 end to end ------------------------------------------------------------------------


async def test_ac26_stale_after_30_days_then_admin_reactivates_and_the_group_carries_on(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    person = await service.join(migrated, session.id, "Setup")
    await service.continue_(migrated, session.id, person.id, "Setup", 0)
    await repo.leave_participant(migrated, person.id)
    await _age(migrated, session.id, timedelta(days=30, minutes=1))
    invite = session.invite_id

    assert await stale.mark_stale(migrated, clock.now()) == [session.id]

    # Read-only and marked stale.
    assert _close_code(client, invite, "Ada") == 4410
    anonymous = client.get(f"/api/learn/sessions/{invite}")
    assert anonymous.status_code == 423
    assert anonymous.json() == {"error": "stale", "can_reactivate": False}
    record = client.get(f"/api/learn/sessions/{invite}/record")
    assert record.status_code == 200
    assert record.json()["stale"] is True
    assert record.json()["current_step"] == 1

    login_as(client, "admin1")
    as_admin = client.get(f"/api/learn/sessions/{invite}")
    assert as_admin.status_code == 423
    assert as_admin.json() == {"error": "stale", "can_reactivate": True}

    response = client.post(f"/api/learn/sessions/{invite}/reactivate")

    assert response.status_code == 200
    assert response.json() == {}
    row = await repo.get_session_by_invite(migrated, invite)
    assert row is not None
    assert row.stale_at is None
    assert row.last_activity_at > clock.now() - timedelta(minutes=5)
    assert client.get(f"/api/learn/sessions/{invite}").json() == {"state": "active"}

    # Join and submit from the step where the group stopped.
    with client.websocket_connect(f"/api/learn/sessions/{invite}/ws?name=Ada") as ws:
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome"
        assert welcome["record"]["current_step"] == 1
        assert ws.receive_json()["type"] == "presence"
        ws.send_text(json.dumps({"type": "submit_choice", "step": 1, "selected": [1]}))
        attempt = ws.receive_json()
        assert attempt["type"] == "attempt"
        assert attempt["attempt"]["correct"] is True
        assert ws.receive_json()["type"] in {"step_passed", "completed"}


async def test_reactivating_a_session_that_is_not_stale_gives_409(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    login_as(client, "admin1")

    response = client.post(f"/api/learn/sessions/{session.invite_id}/reactivate")

    assert response.status_code == 409
    assert response.json() == {"error": "not_stale"}


async def test_reactivating_an_unknown_invite_gives_404(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    login_as(client, "admin1")

    response = client.post("/api/learn/sessions/no-such-invite/reactivate")

    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}


# --- admin stale list ------------------------------------------------------------------------


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


async def test_admin_gets_only_stale_learning_sessions_newest_stale_first(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    base = datetime.fromisoformat("2026-10-01T12:00:00+00:00")
    older = await _session(migrated, "Older stale")
    newer = await _session(migrated, "Newer stale")
    active = await _session(migrated, "Active")
    await _set_stale(migrated, older.id, base)
    await _set_stale(migrated, newer.id, base + timedelta(hours=1))
    login_as(client, "admin1")

    response = client.get("/api/learn/sessions/stale")

    assert response.status_code == 200
    rows = response.json()
    assert [r["invite_id"] for r in rows] == [newer.invite_id, older.invite_id]
    assert active.invite_id not in {r["invite_id"] for r in rows}
    first = rows[0]
    assert set(first) == {"invite_id", "lesson_title", "stale_at", "last_activity_at"}
    assert first["lesson_title"] == "Newer stale"
    assert _parse(first["stale_at"]) == base + timedelta(hours=1)
    _parse(first["last_activity_at"])


async def test_a_reactivated_session_leaves_the_list(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    await _set_stale(migrated, session.id, clock.now())
    login_as(client, "admin1")
    listed = client.get("/api/learn/sessions/stale").json()
    assert [r["invite_id"] for r in listed] == [session.invite_id]

    assert client.post(f"/api/learn/sessions/{session.invite_id}/reactivate").status_code == 200

    assert client.get("/api/learn/sessions/stale").json() == []


async def test_nfr5_the_lists_are_separate(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    await _set_stale(migrated, session.id, clock.now())
    await migrated.execute("truncate session cascade")
    login_as(client, "admin1")

    assert client.get("/api/sessions/stale").json() == []
    learn = client.get("/api/learn/sessions/stale").json()
    assert [r["invite_id"] for r in learn] == [session.invite_id]


async def test_stale_is_not_routed_to_the_invite_handler(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    session = await _session(migrated)
    await migrated.execute(
        "update learning_session set invite_id = 'stale' where id = $1", session.id
    )
    login_as(client, "admin1")

    response = client.get("/api/learn/sessions/stale")

    assert response.status_code == 200
    assert response.json() == []


# --- refused for non-admins, as for coding sessions --------------------------------------------


@pytest.mark.parametrize("user", ["editor1"])
async def test_a_non_admin_gets_403_for_the_list_and_reactivate(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
    user: str,
) -> None:
    session = await _session(migrated)
    await _set_stale(migrated, session.id, clock.now())
    login_as(client, user)

    listed = client.get("/api/learn/sessions/stale")
    reactivated = client.post(f"/api/learn/sessions/{session.invite_id}/reactivate")

    for response in (listed, reactivated):
        assert response.status_code == 403
        assert response.json() == {"error": "missing_role", "role": "admin"}
    row = await repo.get_session_by_invite(migrated, session.invite_id)
    assert row is not None
    assert row.stale_at is not None


async def test_an_anonymous_caller_gets_401_for_the_list_and_reactivate(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _set_stale(migrated, session.id, clock.now())

    assert client.get("/api/learn/sessions/stale").status_code == 401
    assert client.post(f"/api/learn/sessions/{session.invite_id}/reactivate").status_code == 401
    row = await repo.get_session_by_invite(migrated, session.invite_id)
    assert row is not None
    assert row.stale_at is not None
