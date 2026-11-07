"""Scratch-run repository (spec 011 plan.md "Data model": `session_scratch_run`).

FR-8 (a new run replaces the last), FR-9 (one run at a time), FR-10 (last run survives).
"""

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

from app import clock

Segment = dict[str, str]


@dataclass(frozen=True)
class Run:
    status: str
    started_by: str
    started_at: datetime
    ended_at: datetime | None
    input: str
    output: list[Segment]
    seq: int  # UTF-8 bytes of output so far
    exit_code: int | None


def _seq(segments: list[Segment]) -> int:
    return sum(len(s["t"].encode()) for s in segments)


async def claim(
    conn: asyncpg.Connection, session_id: uuid.UUID, started_by: str, input: str
) -> bool:
    """Start a run unless one is `running`; replaces the previous row. True if claimed."""
    status = await conn.execute(
        """insert into session_scratch_run (session_id, status, started_by, started_at, input)
           values ($1, 'running', $2, $3, $4)
           on conflict (session_id) do update
             set status = 'running', started_by = excluded.started_by,
                 started_at = excluded.started_at, ended_at = null, input = excluded.input,
                 output = '[]'::jsonb, exit_code = null
             where session_scratch_run.status <> 'running'""",
        session_id,
        started_by,
        clock.now(),
        input,
    )
    return status.endswith(" 1")


async def save_progress(
    conn: asyncpg.Connection, session_id: uuid.UUID, segments: list[Segment]
) -> None:
    await conn.execute(
        "update session_scratch_run set output = $2::jsonb where session_id = $1 "
        "and status = 'running'",
        session_id,
        json.dumps(segments),
    )


async def finish(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    status: str,
    exit_code: int | None,
    segments: list[Segment],
) -> None:
    await conn.execute(
        """update session_scratch_run
           set status = $2, exit_code = $3, output = $4::jsonb, ended_at = $5
           where session_id = $1""",
        session_id,
        status,
        exit_code,
        json.dumps(segments),
        clock.now(),
    )


async def get(conn: asyncpg.Connection, session_id: uuid.UUID) -> Run | None:
    row = await conn.fetchrow(
        """select status, started_by, started_at, ended_at, input, output, exit_code
           from session_scratch_run where session_id = $1""",
        session_id,
    )
    if row is None:
        return None
    output: Any = row["output"]
    segments: list[Segment] = json.loads(output) if isinstance(output, str) else output
    return Run(
        status=row["status"],
        started_by=row["started_by"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        input=row["input"],
        output=segments,
        seq=_seq(segments),
        exit_code=row["exit_code"],
    )


async def interrupt_running(conn: asyncpg.Connection) -> int:
    """Startup reconcile: runs left `running` by a restart become `interrupted`."""
    status = await conn.execute(
        "update session_scratch_run set status = 'interrupted', ended_at = $1 "
        "where status = 'running'",
        clock.now(),
    )
    return int(status.split()[-1])
