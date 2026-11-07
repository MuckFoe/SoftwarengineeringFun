"""Spec 011 task 8: startup reconcile of interrupted scratch runs (FR-9, FR-10).

Real PostgreSQL. The restart cases are `slow` (a restart is a fresh app on the same
database); the first test calls the reconcile function directly.
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.config import Settings
from app.main import create_app, reconcile_scratch_runs
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.scratch import repo
from app.sessions import repo as sessions_repo


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> sessions_repo.Session:
    problem_id = await problems_repo.create(
        conn,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=parse_signature("def add(a: int, b: int) -> int"),
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    return await sessions_repo.create(conn, problem_id)


@contextmanager
def _app(database_url: str) -> Iterator[TestClient]:
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",  # noqa: S106
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as client:
        yield client


def _welcome(client: TestClient, invite: str) -> dict:
    with client.websocket_connect(f"/api/sessions/{invite}/ws?name={quote('A')}") as ws:
        while True:
            message = ws.receive_json()
            if message["type"] == "welcome":
                return message


async def test_fr9_reconcile_interrupts_a_running_row_and_a_new_run_can_be_claimed(
    migrated: asyncpg.Connection, database_url: str
) -> None:
    await migrated.execute("delete from session_scratch_run")
    session = await _session(migrated)
    assert await repo.claim(migrated, session.id, "A", "in")
    await repo.save_progress(migrated, session.id, [{"s": "out", "t": "partial"}])

    pool = await app_db.create_pool(database_url)
    try:
        await reconcile_scratch_runs(pool)
    finally:
        await pool.close()

    run = await repo.get(migrated, session.id)
    assert run is not None
    assert run.status == "interrupted" and run.ended_at is not None
    assert run.output == [{"s": "out", "t": "partial"}]
    assert await repo.claim(migrated, session.id, "A", "again")


@pytest.mark.slow
async def test_fr10_after_a_restart_the_finished_run_is_still_shown(
    migrated: asyncpg.Connection, database_url: str
) -> None:
    session = await _session(migrated)
    await repo.claim(migrated, session.id, "A", "in")
    await repo.finish(migrated, session.id, "finished", 0, [{"s": "out", "t": "hi\n"}])
    with _app(database_url) as client:
        before = _welcome(client, session.invite_id)["scratch_run"]
    with _app(database_url) as client:  # restarted
        after = _welcome(client, session.invite_id)["scratch_run"]
    assert before is not None and after == before


@pytest.mark.slow
async def test_fr10_after_a_restart_mid_run_the_run_is_interrupted_with_its_output(
    migrated: asyncpg.Connection, database_url: str
) -> None:
    session = await _session(migrated)
    await repo.claim(migrated, session.id, "A", "in")
    await repo.save_progress(migrated, session.id, [{"s": "out", "t": "so far"}])
    with _app(database_url) as client:  # the restart
        run = _welcome(client, session.invite_id)["scratch_run"]
    assert run["status"] == "interrupted"
    assert "so far" in "".join(s["t"] for s in run["output"])
    assert await repo.claim(migrated, session.id, "A", "again")  # Run is available
