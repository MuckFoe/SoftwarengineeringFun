"""Spec 020 task 3: the `session_hint` table and `hints/repo.py` (FR-6, FR-13, FR-15)."""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db
from app.hints import repo


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _problem(conn: asyncpg.Connection, title: str) -> uuid.UUID:
    return await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ($1, $1, 'def add(a: int, b: int) -> int', 'add', '[]'::jsonb, 'int')
           returning id""",
        title,
    )


async def _session(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """A new session on problem A, plus a problem B; returns (session_id, a, b)."""
    a = await _problem(conn, "A")
    b = await _problem(conn, "B")
    session_id = await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        a,
    )
    return session_id, a, b


async def test_ac11_numbers_count_per_problem_and_continue_after_switching_back(
    migrated: asyncpg.Connection,
) -> None:
    session_id, a, b = await _session(migrated)

    rows = [
        await repo.insert_next(migrated, session_id, problem, "Ana", None, f"hint {i}")
        for i, problem in enumerate([a, a, b, a])
    ]

    assert [r.number for r in rows] == [1, 2, 1, 3]
    assert [r.problem_id for r in rows] == [a, a, b, a]


async def test_insert_next_returns_the_stored_row(migrated: asyncpg.Connection) -> None:
    session_id, a, _ = await _session(migrated)

    row = await repo.insert_next(
        migrated, session_id, a, "Guest", "stuck on empty input", "Check the empty case."
    )

    assert isinstance(row.id, uuid.UUID)
    assert row.session_id == session_id
    assert row.problem_id == a
    assert row.number == 1
    assert row.asked_by == "Guest"
    assert row.note == "stuck on empty input"
    assert row.body == "Check the empty case."
    assert row.created_at is not None


async def test_ac13_list_for_session_orders_by_problem_then_number(
    migrated: asyncpg.Connection,
) -> None:
    session_id, a, b = await _session(migrated)
    other_session, _, _ = await _session(migrated)
    await repo.insert_next(migrated, session_id, a, "Ana", "first", "a1")
    await repo.insert_next(migrated, session_id, b, "Bo", None, "b1")
    await repo.insert_next(migrated, session_id, a, "Bo", None, "a2")
    await repo.insert_next(migrated, other_session, a, "Zed", None, "elsewhere")

    hints = await repo.list_for_session(migrated, session_id)

    # Postgres orders uuids bytewise, the same as Python's UUID comparison.
    assert [(h.problem_id, h.number) for h in hints] == sorted([(a, 1), (a, 2), (b, 1)])
    by_body = {h.body: h for h in hints}
    assert set(by_body) == {"a1", "a2", "b1"}
    assert (by_body["a1"].asked_by, by_body["a1"].note) == ("Ana", "first")
    assert (by_body["a2"].asked_by, by_body["a2"].note) == ("Bo", None)


async def test_ac13_list_for_problem_returns_one_problems_hints_in_order(
    migrated: asyncpg.Connection,
) -> None:
    session_id, a, b = await _session(migrated)
    await repo.insert_next(migrated, session_id, a, "Ana", None, "a1")
    await repo.insert_next(migrated, session_id, b, "Ana", None, "b1")
    await repo.insert_next(migrated, session_id, a, "Bo", "again", "a2")

    hints = await repo.list_for_problem(migrated, session_id, a)

    assert [(h.number, h.body, h.asked_by, h.note) for h in hints] == [
        (1, "a1", "Ana", None),
        (2, "a2", "Bo", "again"),
    ]


async def test_hint_dict_has_the_contract_shape(migrated: asyncpg.Connection) -> None:
    session_id, a, _ = await _session(migrated)
    row = await repo.insert_next(migrated, session_id, a, "Ana", "n", "body")

    d = repo.hint_dict(row)

    assert d == {
        "id": str(row.id),
        "problem_id": str(a),
        "number": 1,
        "asked_by": "Ana",
        "note": "n",
        "body": "body",
        "created_at": row.created_at.isoformat(),
    }


async def test_no_account_id_is_stored(migrated: asyncpg.Connection) -> None:
    columns = await migrated.fetch(
        "select column_name from information_schema.columns where table_name = 'session_hint'"
    )
    assert {c["column_name"] for c in columns} == {
        "id",
        "session_id",
        "problem_id",
        "number",
        "asked_by",
        "note",
        "body",
        "created_at",
    }


async def test_unique_session_problem_number_rejects_a_duplicate(
    migrated: asyncpg.Connection,
) -> None:
    session_id, a, _ = await _session(migrated)
    await repo.insert_next(migrated, session_id, a, "Ana", None, "a1")

    with pytest.raises(asyncpg.UniqueViolationError):
        await migrated.execute(
            """insert into session_hint (session_id, problem_id, number, asked_by, body)
               values ($1, $2, 1, 'Bo', 'dup')""",
            session_id,
            a,
        )


@pytest.mark.parametrize(
    ("note", "body"),
    [
        ("line\nbreak", "ok"),
        ("carriage\rreturn", "ok"),
        ("", "ok"),
        ("x" * 201, "ok"),
        (None, ""),
        (None, "x" * 601),
    ],
    ids=["note-newline", "note-cr", "note-empty", "note-201", "body-empty", "body-601"],
)
async def test_database_rejects_bad_note_or_body(
    migrated: asyncpg.Connection, note: str | None, body: str
) -> None:
    session_id, a, _ = await _session(migrated)

    with pytest.raises(asyncpg.CheckViolationError):
        await repo.insert_next(migrated, session_id, a, "Ana", note, body)


async def test_database_accepts_the_limits(migrated: asyncpg.Connection) -> None:
    session_id, a, _ = await _session(migrated)

    row = await repo.insert_next(migrated, session_id, a, "Ana", "x" * 200, "y" * 600)

    assert (len(row.note or ""), len(row.body)) == (200, 600)
