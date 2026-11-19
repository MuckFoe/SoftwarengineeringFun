"""Sketch board repository (spec 022 plan, Data model: `sketch_action`).

FR-1 (a new session's board is empty), FR-11/NFR-4 (actions are durable, read back in
`seq` order), FR-12 (visible actions are the rows after the latest `clear`), FR-13
(undo deletes only the author's own row), FR-16 (nothing is stored once the session is
stale). Every query is scoped by session id.
"""

import json
import uuid
from dataclasses import dataclass

import asyncpg

from app.sketch.rules import Action


@dataclass(frozen=True)
class StoredAction:
    seq: int
    author_id: uuid.UUID  # never sent to clients (plan, Contracts)
    client_id: str
    kind: str
    color: str | None
    points: list[int] | None

    @property
    def action(self) -> Action:
        return Action(self.kind, self.color, self.points)


_COLUMNS = "seq, author_id, client_id, kind, color, points"

# The seq of the latest `clear` of session $1, or 0 when there is none.
_LATEST_CLEAR = """coalesce((select max(seq) from sketch_action
                             where session_id = $1 and kind = 'clear'), 0)"""


def _stored(row: asyncpg.Record) -> StoredAction:
    points = row["points"]
    return StoredAction(
        seq=row["seq"],
        author_id=row["author_id"],
        client_id=row["client_id"],
        kind=row["kind"],
        color=row["color"],
        points=None if points is None else json.loads(points),
    )


async def list_actions(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[StoredAction]:
    rows = await conn.fetch(
        f"select {_COLUMNS} from sketch_action where session_id = $1 order by seq",  # noqa: S608  (constant column list)
        session_id,
    )
    return [_stored(row) for row in rows]


async def visible_bytes(conn: asyncpg.Connection, session_id: uuid.UUID) -> int:
    return await conn.fetchval(
        f"""select coalesce(sum(bytes), 0) from sketch_action
            where session_id = $1 and seq > {_LATEST_CLEAR}""",  # noqa: S608  (constant subquery)
        session_id,
    )


async def insert(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    author_id: uuid.UUID,
    client_id: str,
    action: Action,
    bytes_: int,
) -> StoredAction | None:
    """Store `action` unless the session is missing or stale; then return None."""
    points = None if action.points is None else json.dumps(action.points, separators=(",", ":"))
    row = await conn.fetchrow(
        f"""insert into sketch_action (session_id, author_id, kind, color, points,
                                       client_id, bytes)
            select id, $2, $3, $4, $5::jsonb, $6, $7 from session
            where id = $1 and stale_at is null
            returning {_COLUMNS}""",  # noqa: S608  (constant column list)
        session_id,
        author_id,
        action.kind,
        action.color,
        points,
        client_id,
        bytes_,
    )
    return None if row is None else _stored(row)


async def prune_before_latest_clear(conn: asyncpg.Connection, session_id: uuid.UUID) -> None:
    """Delete the latest `clear` and every row before it (what it hid)."""
    await conn.execute(
        f"delete from sketch_action where session_id = $1 and seq <= {_LATEST_CLEAR}",  # noqa: S608  (constant subquery)
        session_id,
    )


async def delete_own(
    conn: asyncpg.Connection, session_id: uuid.UUID, author_id: uuid.UUID, seq: int
) -> bool:
    """Delete row `seq` only if `author_id` drew it in this session and the session is not
    stale; True if deleted."""
    status = await conn.execute(
        "delete from sketch_action where session_id = $1 and author_id = $2 and seq = $3"
        " and exists (select 1 from session where id = $1 and stale_at is null)",
        session_id,
        author_id,
        seq,
    )
    return status == "DELETE 1"
