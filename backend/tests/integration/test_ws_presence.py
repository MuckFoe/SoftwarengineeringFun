"""Task 34: WebSocket join, presence, cap and name validation (`sessions/hub.py`,
`sessions/ws.py`). FR-12, FR-12a, FR-13, FR-14, FR-15, FR-30.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from types import SimpleNamespace
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.sessions import hub as hub_module
from app.sessions import repo as sessions_repo
from app.sessions.ws import CLOSE_FULL, session_ws

ADD = parse_signature("def add(a: int, b: int) -> int")


def _settings(database_url: str) -> Settings:
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
    yield db


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[TestClient]:
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


async def _session(conn: asyncpg.Connection) -> sessions_repo.Session:
    problem_id = await problems_repo.create(
        conn,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    return await sessions_repo.create(conn, problem_id)


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _nth(ws, count: int) -> dict:
    """Receives exactly `count` messages (each join/leave sends a known, fixed number of
    broadcasts) and returns the last one."""
    msg = None
    for _ in range(count):
        msg = ws.receive_json()
    assert msg is not None
    return msg


async def test_fr12_a_second_visitor_joins_as_ada_both_see_presence(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as ws1:
        ws1.receive_json()  # welcome
        with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws2:
            welcome2 = ws2.receive_json()  # welcome: already carries presence including Ada
            assert any(p["name"] == "Ada" for p in welcome2["presence"])

            presence_to_linus = ws1.receive_json()  # exactly one broadcast from Ada's join
            assert presence_to_linus["type"] == "presence"
            assert any(p["name"] == "Ada" for p in presence_to_linus["participants"])


async def test_fr12a_a_31_character_name_closes_4422_and_adds_no_participant(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    with client.websocket_connect(_ws_url(session.invite_id, "a" * 31)) as ws:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
    assert exc_info.value.code == 4422

    rows = await migrated.fetch("select id from participant where session_id = $1", session.id)
    assert rows == []


async def test_fr12a_a_30_character_name_joins(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    with client.websocket_connect(_ws_url(session.invite_id, "a" * 30)) as ws:
        welcome = ws.receive_json()
    assert welcome["type"] == "welcome"


async def test_fr13_a_sixth_connection_closes_4403_and_presence_stays_at_5(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    sockets = [client.websocket_connect(_ws_url(session.invite_id, f"user{i}")) for i in range(5)]
    opened = [s.__enter__() for s in sockets]
    try:
        for ws in opened:
            ws.receive_json()  # welcome

        with client.websocket_connect(_ws_url(session.invite_id, "user5")) as sixth:
            with pytest.raises(WebSocketDisconnect) as exc_info:
                sixth.receive_json()
        assert exc_info.value.code == 4403

        # user0 (joined first) got exactly one broadcast per later join (users 1-4).
        presence = _nth(opened[0], 4)
        assert presence["type"] == "presence"
        assert len(presence["participants"]) == 5
    finally:
        for s in sockets:
            s.__exit__(None, None, None)


class _HeldSocket:
    """Stands in for a WebSocket handed straight to `session_ws`, so several joins can run
    concurrently on one event loop. It stays connected until `release` is set."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.app = SimpleNamespace(
            state=SimpleNamespace(pool=pool, settings=SimpleNamespace(runner_url="http://unused"))
        )
        self.close_code: int | None = None
        self.settled = asyncio.Event()  # joined (waiting in receive) or closed
        self.release = asyncio.Event()

    async def accept(self) -> None:
        pass

    async def close(self, code: int) -> None:
        self.close_code = code
        self.settled.set()

    async def send_json(self, data: object) -> None:
        pass

    async def send_bytes(self, data: bytes) -> None:
        pass

    async def receive(self) -> dict:
        self.settled.set()
        await self.release.wait()
        return {"type": "websocket.disconnect"}


async def test_fr13_six_concurrent_joins_admit_only_5(
    database_url: str, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    pool = await asyncpg.create_pool(database_url)
    sockets = [_HeldSocket(pool) for _ in range(6)]
    handlers = [
        asyncio.create_task(session_ws(s, session.invite_id, f"user{i}"))  # type: ignore[arg-type]
        for i, s in enumerate(sockets)
    ]
    try:
        async with asyncio.timeout(10):
            await asyncio.gather(*(s.settled.wait() for s in sockets))
        assert len(hub_module.get_hub(session.id).connections) == 5
        assert [s.close_code for s in sockets].count(CLOSE_FULL) == 1
    finally:
        for s in sockets:
            s.release.set()
        await asyncio.gather(*handlers)
        await pool.close()


async def test_fr14_an_unknown_invite_closes_4404(client: TestClient) -> None:
    with client.websocket_connect(_ws_url("doesnotexist", "Ada")) as ws:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
    assert exc_info.value.code == 4404


async def test_fr15_a_clean_disconnect_drops_presence(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws1:
        ws1.receive_json()  # welcome
        with client.websocket_connect(_ws_url(session.invite_id, "Linus")) as ws2:
            ws2.receive_json()  # welcome
            joined = ws1.receive_json()  # broadcast from Linus's join
            assert any(p["name"] == "Linus" for p in joined["participants"])

        left = ws1.receive_json()  # broadcast from Linus's clean disconnect
        assert [p["name"] for p in left["participants"]] == ["Ada"]


async def test_fr30_a_stale_session_closes_4410(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await sessions_repo.set_stale(migrated, session.id)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
    assert exc_info.value.code == 4410
