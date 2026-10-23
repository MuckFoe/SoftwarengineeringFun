"""Task 23: the server-side collaborative document (`sessions/collab.py`). FR-16, FR-19, FR-27."""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pycrdt
import pytest

from app import db as app_db
from app.sessions import collab
from app.sessions import repo as sessions_repo

ADD_SIGNATURE = "def add(a: int, b: int) -> int"


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _problem(conn: asyncpg.Connection, signature: str = ADD_SIGNATURE) -> uuid.UUID:
    return await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter)
           values ('p', 'd', $1, 'add', '[]'::jsonb, 'int', false)
           returning id""",
        signature,
    )


async def _session(conn: asyncpg.Connection) -> uuid.UUID:
    problem_id = await _problem(conn)
    session = await sessions_repo.create(conn, problem_id)
    return session.id


async def test_fr16_a_new_session_has_the_starter_code(migrated: asyncpg.Connection) -> None:
    session_id = await _session(migrated)
    session_doc = await collab.load(migrated, session_id)

    await session_doc.ensure_problem_text(migrated, "p1", ADD_SIGNATURE)

    assert session_doc.get_code("p1") == "def add(a: int, b: int) -> int:\n    pass\n"


async def test_ensure_problem_text_does_not_overwrite_existing_code(
    migrated: asyncpg.Connection,
) -> None:
    session_id = await _session(migrated)
    session_doc = await collab.load(migrated, session_id)
    await session_doc.ensure_problem_text(migrated, "p1", ADD_SIGNATURE)
    ytext = session_doc.code_text("p1")
    ytext += "extra"

    await session_doc.ensure_problem_text(migrated, "p1", ADD_SIGNATURE)

    assert session_doc.get_code("p1").endswith("extra")


async def test_fr19_concurrent_inserts_on_different_lines_converge(
    migrated: asyncpg.Connection,
) -> None:
    session_id = await _session(migrated)
    server = await collab.load(migrated, session_id)
    await server.ensure_problem_text(migrated, "p1", ADD_SIGNATURE)
    base_update = server.doc.get_update()

    client1 = pycrdt.Doc()
    client1.apply_update(base_update)
    text1 = client1.get("code:p1", type=pycrdt.Text)
    client2 = pycrdt.Doc()
    client2.apply_update(base_update)
    text2 = client2.get("code:p1", type=pycrdt.Text)

    state1_before = client1.get_state()
    text1.insert(0, "# client1 was here\n")
    update1 = client1.get_update(state1_before)

    state2_before = client2.get_state()
    text2 += "# client2 too\n"
    update2 = client2.get_update(state2_before)

    await server.apply_update(migrated, update1)
    await server.apply_update(migrated, update2)
    client1.apply_update(update2)
    client2.apply_update(update1)

    merged = server.get_code("p1")
    assert merged == str(text1) == str(text2)
    assert "client1 was here" in merged
    assert "client2 too" in merged


async def test_fr27_a_freshly_loaded_doc_equals_the_in_memory_one(
    migrated: asyncpg.Connection,
) -> None:
    session_id = await _session(migrated)
    original = await collab.load(migrated, session_id)
    await original.ensure_problem_text(migrated, "p1", ADD_SIGNATURE)

    # A client's edit, arriving as an update the way the real WebSocket handler would.
    client = pycrdt.Doc()
    client.apply_update(original.doc.get_update())
    state_before = client.get_state()
    client_text = client.get("code:p1", type=pycrdt.Text)
    client_text += "# extra edit\n"
    await original.apply_update(migrated, client.get_update(state_before))

    reloaded = await collab.load(migrated, session_id)

    assert reloaded.get_code("p1") == original.get_code("p1")
    assert "extra edit" in reloaded.get_code("p1")


async def test_get_or_load_caches_one_doc_per_session(migrated: asyncpg.Connection) -> None:
    session_a = await _session(migrated)
    session_b = await _session(migrated)

    first = await collab.get_or_load(migrated, session_a)
    second = await collab.get_or_load(migrated, session_a)
    other = await collab.get_or_load(migrated, session_b)

    assert first is second
    assert other is not first
