"""Hint repository (spec 020 plan, Data model: `session_hint`).

FR-6 (asker's display name and note shown with the hint), FR-13 (numbered per problem within
the session; switching back continues the sequence), FR-15 (stored durably with the session).
No account id is stored.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

_COLUMNS = "id, session_id, problem_id, number, asked_by, note, body, created_at"


@dataclass(frozen=True)
class HintRow:
    id: uuid.UUID
    session_id: uuid.UUID
    problem_id: uuid.UUID
    number: int
    asked_by: str
    note: str | None
    body: str
    created_at: datetime


def _row(record: asyncpg.Record) -> HintRow:
    return HintRow(**{k: record[k] for k in _COLUMNS.split(", ")})


async def list_for_session(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[HintRow]:
    """Every hint of the session, all problems, ordered by (problem, number)."""
    rows = await conn.fetch(
        f"""select {_COLUMNS} from session_hint
            where session_id = $1
            order by problem_id, number""",  # noqa: S608  (constant column list)
        session_id,
    )
    return [_row(r) for r in rows]


async def list_for_problem(
    conn: asyncpg.Connection, session_id: uuid.UUID, problem_id: uuid.UUID
) -> list[HintRow]:
    """One problem's hints in this session, in number order."""
    rows = await conn.fetch(
        f"""select {_COLUMNS} from session_hint
            where session_id = $1 and problem_id = $2
            order by number""",  # noqa: S608  (constant column list)
        session_id,
        problem_id,
    )
    return [_row(r) for r in rows]


async def insert_next(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    problem_id: uuid.UUID,
    asked_by: str,
    note: str | None,
    body: str,
) -> HintRow:
    """Store a hint as the problem's next number, assigned in this one statement (FR-13).

    Callers serialize per session; the unique (session, problem, number) is the backstop.
    """
    row = await conn.fetchrow(
        f"""insert into session_hint (session_id, problem_id, number, asked_by, note, body)
            select $1, $2, coalesce(max(number), 0) + 1, $3, $4, $5
              from session_hint
             where session_id = $1 and problem_id = $2
            returning {_COLUMNS}""",  # noqa: S608  (constant column list)
        session_id,
        problem_id,
        asked_by,
        note,
        body,
    )
    return _row(row)


def hint_dict(row: HintRow) -> dict[str, Any]:
    """The `Hint` contract shape sent to clients (plan, Contracts)."""
    return {
        "id": str(row.id),
        "problem_id": str(row.problem_id),
        "number": row.number,
        "asked_by": row.asked_by,
        "note": row.note,
        "body": row.body,
        "created_at": row.created_at.isoformat(),
    }
