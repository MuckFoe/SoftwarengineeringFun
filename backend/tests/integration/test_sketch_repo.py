"""Spec 022 task 5: `sketch_action` table and repository (FR-1, FR-11–FR-13, FR-16, NFR-4)."""

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app import db as app_db
from app.sketch import repo
from app.sketch.rules import Action, action_bytes


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


async def _session(conn: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """A new coding session with Ana and Ben; returns (session_id, ana_id, ben_id)."""
    problem_id = await conn.fetchval(
        """insert into problem (title, description, signature, function_name, params,
                                return_type)
           values ('Add', 'Add', 'def add(a: int, b: int) -> int', 'add', '[]'::jsonb, 'int')
           returning id"""
    )
    session_id = await conn.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        problem_id,
    )
    ids = [
        await conn.fetchval(
            "insert into participant (session_id, display_name) values ($1, $2) returning id",
            session_id,
            name,
        )
        for name in ("Ana", "Ben")
    ]
    return session_id, ids[0], ids[1]


PEN = Action("pen", "blue", [10, 20, 30, 40, 50, 60])
BOX = Action("box", "red", [0, 0, 1600, 1000])
ERASE = Action("erase", None, [5, 5])
CLEAR = Action("clear", None, None)


async def _add(
    conn: asyncpg.Connection, session_id: uuid.UUID, author: uuid.UUID, action: Action
) -> repo.StoredAction:
    stored = await repo.insert(
        conn, session_id, author, uuid.uuid4().hex, action, action_bytes(action)
    )
    assert stored is not None
    return stored


async def _count(conn: asyncpg.Connection, session_id: uuid.UUID) -> int:
    return await conn.fetchval(
        "select count(*) from sketch_action where session_id = $1", session_id
    )


async def test_ac1_a_new_session_has_an_empty_board(migrated: asyncpg.Connection) -> None:
    session_id, _, _ = await _session(migrated)

    assert await repo.list_actions(migrated, session_id) == []
    assert await repo.visible_bytes(migrated, session_id) == 0


async def test_ac11_actions_come_back_in_seq_order_unchanged(
    migrated: asyncpg.Connection, database_url: str
) -> None:
    session_id, ana, ben = await _session(migrated)
    stored = [
        await repo.insert(migrated, session_id, ana, "c-1", PEN, action_bytes(PEN)),
        await repo.insert(migrated, session_id, ben, "c-2", BOX, action_bytes(BOX)),
        await repo.insert(migrated, session_id, ana, "c-3", ERASE, action_bytes(ERASE)),
        await repo.insert(migrated, session_id, ben, "c-4", CLEAR, action_bytes(CLEAR)),
    ]

    other = await asyncpg.connect(database_url)  # a new connection, as after a reload
    try:
        listed = await repo.list_actions(other, session_id)
    finally:
        await other.close()

    assert listed == stored
    assert [a.seq for a in listed] == sorted(a.seq for a in listed)
    assert [(a.kind, a.color, a.points) for a in listed] == [
        ("pen", "blue", [10, 20, 30, 40, 50, 60]),
        ("box", "red", [0, 0, 1600, 1000]),
        ("erase", None, [5, 5]),
        ("clear", None, None),
    ]
    assert [a.client_id for a in listed] == ["c-1", "c-2", "c-3", "c-4"]
    assert [a.author_id for a in listed] == [ana, ben, ana, ben]
    assert listed[0].action == PEN


async def test_list_actions_is_scoped_to_its_session(migrated: asyncpg.Connection) -> None:
    first, ana, _ = await _session(migrated)
    second, _, _ = await _session(migrated)
    await _add(migrated, first, ana, PEN)

    assert await repo.list_actions(migrated, second) == []


async def test_ac13_delete_own_removes_only_the_authors_row(
    migrated: asyncpg.Connection,
) -> None:
    session_id, ana, ben = await _session(migrated)
    line = await _add(migrated, session_id, ana, PEN)

    assert await repo.delete_own(migrated, session_id, ben, line.seq) is False
    assert [a.seq for a in await repo.list_actions(migrated, session_id)] == [line.seq]

    assert await repo.delete_own(migrated, session_id, ana, line.seq) is True
    assert await repo.list_actions(migrated, session_id) == []
    assert await repo.delete_own(migrated, session_id, ana, line.seq) is False  # already gone


async def test_delete_own_needs_the_matching_session(migrated: asyncpg.Connection) -> None:
    session_id, ana, _ = await _session(migrated)
    other, _, _ = await _session(migrated)
    line = await _add(migrated, session_id, ana, PEN)

    assert await repo.delete_own(migrated, other, ana, line.seq) is False
    assert await _count(migrated, session_id) == 1


async def test_ac16_insert_into_a_stale_session_stores_nothing(
    migrated: asyncpg.Connection,
) -> None:
    session_id, ana, _ = await _session(migrated)
    await migrated.execute("update session set stale_at = now() where id = $1", session_id)

    assert await repo.insert(migrated, session_id, ana, "c-1", PEN, action_bytes(PEN)) is None
    assert await _count(migrated, session_id) == 0


async def test_ac16_delete_own_on_a_stale_session_removes_nothing(
    migrated: asyncpg.Connection,
) -> None:
    session_id, ana, _ = await _session(migrated)
    line = await _add(migrated, session_id, ana, PEN)
    await migrated.execute("update session set stale_at = now() where id = $1", session_id)

    assert await repo.delete_own(migrated, session_id, ana, line.seq) is False
    assert await _count(migrated, session_id) == 1


async def test_insert_into_a_missing_session_returns_none(migrated: asyncpg.Connection) -> None:
    _, ana, _ = await _session(migrated)

    assert await repo.insert(migrated, uuid.uuid4(), ana, "c-1", PEN, action_bytes(PEN)) is None


async def test_ac18_visible_bytes_counts_only_rows_after_the_latest_clear(
    migrated: asyncpg.Connection,
) -> None:
    session_id, ana, ben = await _session(migrated)
    await _add(migrated, session_id, ana, PEN)
    await _add(migrated, session_id, ben, BOX)
    assert await repo.visible_bytes(migrated, session_id) == action_bytes(PEN) + action_bytes(BOX)

    await _add(migrated, session_id, ana, CLEAR)
    assert await repo.visible_bytes(migrated, session_id) == 0

    await _add(migrated, session_id, ben, ERASE)
    await _add(migrated, session_id, ana, BOX)
    assert await repo.visible_bytes(migrated, session_id) == action_bytes(ERASE) + action_bytes(BOX)


async def test_prune_deletes_rows_up_to_the_latest_clear(migrated: asyncpg.Connection) -> None:
    session_id, ana, ben = await _session(migrated)
    await _add(migrated, session_id, ana, PEN)
    first_clear = await _add(migrated, session_id, ben, CLEAR)
    hidden = await _add(migrated, session_id, ana, BOX)

    await repo.prune_before_latest_clear(migrated, session_id)  # removes PEN and first clear
    assert [a.seq for a in await repo.list_actions(migrated, session_id)] == [hidden.seq]
    assert first_clear.seq not in [a.seq for a in await repo.list_actions(migrated, session_id)]

    await repo.prune_before_latest_clear(migrated, session_id)  # no clear left: no-op
    assert [a.seq for a in await repo.list_actions(migrated, session_id)] == [hidden.seq]


async def test_prune_leaves_other_sessions_alone(migrated: asyncpg.Connection) -> None:
    first, ana, _ = await _session(migrated)
    second, bea, _ = await _session(migrated)
    await _add(migrated, first, ana, PEN)
    await _add(migrated, first, ana, CLEAR)
    await _add(migrated, second, bea, PEN)

    await repo.prune_before_latest_clear(migrated, first)

    assert await _count(migrated, first) == 0
    assert await _count(migrated, second) == 1


@pytest.mark.parametrize(
    ("kind", "color", "points"),
    [
        ("clear", None, "[1, 2]"),  # clear with points
        ("pen", None, "[1, 2]"),  # pen without colour
        ("box", None, "[0, 0, 1, 1]"),  # box without colour
        ("erase", "red", "[1, 2]"),  # erase with a colour
        ("clear", "ink", None),  # clear with a colour
        ("pen", "red", None),  # pen without points
        ("pen", "teal", "[1, 2]"),  # colour outside the palette
        ("scribble", None, "[1, 2]"),  # unknown kind
    ],
)
async def test_table_constraints_reject_malformed_rows(
    migrated: asyncpg.Connection, kind: str, color: str | None, points: str | None
) -> None:
    session_id, ana, _ = await _session(migrated)

    with pytest.raises(asyncpg.CheckViolationError):
        await migrated.execute(
            """insert into sketch_action (session_id, author_id, kind, color, points,
                                          client_id, bytes)
               values ($1, $2, $3, $4, $5::jsonb, 'c', 40)""",
            session_id,
            ana,
            kind,
            color,
            points,
        )
