"""Spec 019: who hosts a session (FR-0), purging a deleted session (FR-6) and its tombstone (FR-8).

A leaf module: it imports nothing from the session kinds, so their invite lookups may call
`is_tombstoned`. Every SQL statement here is a fixed string chosen by `kind` from the maps
below; no table name ever comes from input.
"""

import uuid
from typing import Literal

import asyncpg

# FR-0, plan.md "Host rule": one expression per kind. Null = no host (only admins may delete).
_HOST_SQL: dict[str, str] = {
    "coding": """
        select coalesce(
            s.started_by_sub,
            (select p.account_sub from participant p
              where p.session_id = s.id and p.account_sub is not null
              order by p.joined_at, p.id limit 1))
          from session s where s.id = $1""",
    "learning": """
        select coalesce(
            s.started_by_sub,
            (select p.account_sub from learning_participant p
              where p.session_id = s.id and p.account_sub is not null
              order by p.joined_at, p.id limit 1))
          from learning_session s where s.id = $1""",
    "chess": """
        select coalesce(
            cs.started_by_sub,
            (select p.account_sub from chess_participant p
              where p.id = cs.starter_participant_id),
            (select p.account_sub from chess_participant p
              where p.session_id = cs.id and p.account_sub is not null
              order by p.joined_at, p.id limit 1))
          from chess_session cs where cs.id = $1""",
    "presentation": """
        select p.account_sub
          from presentation_session ps
          join presentation_participant p on p.id = ps.host_participant_id
         where ps.id = $1""",
}

# FR-6, plan.md "Purge order": foreign-key order, every statement filtered by the session.
_PURGE_SQL: dict[str, tuple[str, ...]] = {
    "coding": (
        "delete from run_result where run_id in (select id from run where session_id = $1)",
        "delete from run where session_id = $1",
        "delete from chat_message where session_id = $1",
        "delete from yjs_update where session_id = $1",
        "delete from session_event where session_id = $1",
        "delete from session_scratch_run where session_id = $1",
        "delete from session_hint where session_id = $1",
        "delete from session_problem where session_id = $1",
        "delete from participant where session_id = $1",
        "delete from session where id = $1",
    ),
    "learning": (
        "delete from learning_attempt where session_id = $1",
        "delete from learning_chat_message where session_id = $1",
        "delete from learning_step where session_id = $1",
        "delete from learning_participant where session_id = $1",
        "delete from learning_session where id = $1",
    ),
    "presentation": (
        "update presentation_session set host_participant_id = null where id = $1",
        "delete from presentation_chat_message where session_id = $1",
        "delete from presentation_participant where session_id = $1",
        "delete from presentation_session where id = $1",
    ),
    "chess": (
        """update chess_session set starter_participant_id = null, white_participant_id = null,
               black_participant_id = null, current_game_id = null
            where id = $1""",
        "delete from chess_move where game_id in (select id from chess_game where session_id = $1)",
        "delete from chess_game where session_id = $1",
        "delete from chess_chat_message where session_id = $1",
        "delete from chess_participant where session_id = $1",
        "delete from chess_session where id = $1",
    ),
}


def _known(kind: str) -> str:
    if kind not in _PURGE_SQL:
        raise ValueError(f"unknown session kind: {kind!r}")
    return kind


async def host_sub(conn: asyncpg.Connection, kind: str, session_id: uuid.UUID) -> str | None:
    """The account sub hosting this session (FR-0), or None when it has none or doesn't exist."""
    return await conn.fetchval(_HOST_SQL[_known(kind)], session_id)


async def purge(conn: asyncpg.Connection, kind: str, session_id: uuid.UUID) -> None:
    """Delete every row of the session (FR-6). Shared catalogue rows are never touched.
    The caller holds the transaction (and the session row's lock)."""
    for sql in _PURGE_SQL[_known(kind)]:
        await conn.execute(sql, session_id)


async def tombstone(
    conn: asyncpg.Connection, kind: str, invite_id: str, deleted_by: Literal["host", "admin"]
) -> None:
    """Record that this invite was deleted (FR-8); nothing else of the session is kept."""
    await conn.execute(
        "insert into deleted_session (kind, invite_id, deleted_by) values ($1, $2, $3)",
        _known(kind),
        invite_id,
        deleted_by,
    )


async def is_tombstoned(conn: asyncpg.Connection, kind: str, invite_id: str) -> bool:
    return await conn.fetchval(
        "select exists (select 1 from deleted_session where kind = $1 and invite_id = $2)",
        kind,
        invite_id,
    )
