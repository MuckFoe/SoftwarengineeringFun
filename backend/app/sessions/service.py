"""Sessions service (plan.md "HTTP contracts": `/api/sessions...`, "Live editing").

FR-8, FR-10, FR-11, FR-14, FR-17, FR-30, FR-31, FR-32.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import asyncpg

from app.problems import repo as problems_repo
from app.runs import repo as runs_repo
from app.runs import service as runs_service
from app.sessions import hub as hub_module
from app.sessions import repo as sessions_repo
from app.sessions.repo import Session


class ProblemNotAvailable(LookupError):
    """The problem is missing or deleted (FR-8)."""


class SessionNotFound(LookupError):
    pass


class SessionNotStale(RuntimeError):
    """Reactivating a session that isn't stale (409)."""


@dataclass(frozen=True)
class ProblemProgress:
    accepted: bool
    last_run: runs_repo.Run | None


async def create_session(conn: asyncpg.Connection, problem_id: uuid.UUID) -> Session:
    """FR-8 / FR-11: 404s (via `ProblemNotAvailable`) for a missing or deleted problem."""
    try:
        problem = await problems_repo.get_public(conn, problem_id)
    except problems_repo.NotFound as exc:
        raise ProblemNotAvailable(f"no problem {problem_id}") from exc
    if problem.deleted:
        raise ProblemNotAvailable(f"problem {problem_id} is deleted")
    return await sessions_repo.create(conn, problem_id)


async def get_status(
    conn: asyncpg.Connection, invite_id: str, *, is_admin: bool
) -> tuple[Session, bool]:
    """FR-14 / FR-30 / FR-31: the session and whether it can be reactivated by this caller."""
    session = await sessions_repo.get_by_invite(conn, invite_id)
    if session is None:
        raise SessionNotFound(invite_id)
    can_reactivate = is_admin and session.stale_at is not None
    return session, can_reactivate


async def reactivate(conn: asyncpg.Connection, invite_id: str) -> Session:
    """FR-32: clears `stale_at`, touches activity, and logs a `reactivated` event."""
    session = await sessions_repo.get_by_invite(conn, invite_id)
    if session is None:
        raise SessionNotFound(invite_id)
    if session.stale_at is None:
        raise SessionNotStale(invite_id)
    await sessions_repo.clear_stale(conn, session.id)
    await sessions_repo.touch_activity(conn, session.id)
    await sessions_repo.append_event(conn, session.id, "reactivated", "admin")
    reactivated = await sessions_repo.get_by_invite(conn, invite_id)
    if reactivated is None:
        raise SessionNotFound(invite_id)
    return reactivated


async def switch_problem(
    conn: asyncpg.Connection, session_id: uuid.UUID, problem_id: uuid.UUID, actor: str
) -> tuple[problems_repo.ProblemPublic, ProblemProgress]:
    """FR-17: sets the current problem, ensures a `session_problem` row, logs `switched`
    and touches activity. Returns the problem and this session's progress on it so far.
    """
    problem = await problems_repo.get_public(conn, problem_id)
    await sessions_repo.set_current_problem(conn, session_id, problem_id)
    row = await conn.fetchrow(
        """insert into session_problem (session_id, problem_id)
           values ($1, $2)
           on conflict (session_id, problem_id) do update set accepted = session_problem.accepted
           returning accepted""",
        session_id,
        problem_id,
    )
    await sessions_repo.append_event(conn, session_id, "switched", actor)
    await sessions_repo.touch_activity(conn, session_id)
    last_run = await runs_repo.last_run(conn, session_id, problem_id)
    return problem, ProblemProgress(accepted=row["accepted"], last_run=last_run)


async def run(
    conn: asyncpg.Connection,
    runner_url: str,
    session_id: uuid.UUID,
    problem_id: uuid.UUID,
    code: str,
    participant_id: uuid.UUID,
    actor: str,
    on_started: Callable[[uuid.UUID], Awaitable[None]],
) -> runs_service.RunResult:
    """FR-21, FR-22, FR-23, FR-24, FR-26: reserves the run (raising `RunInProgress` before
    anything is broadcast), calls `on_started` with its id, then runs it via
    `runs.service`. Logs a `run` event and touches activity.
    """
    run_id = await runs_service.start(conn, session_id, problem_id, code, participant_id)
    await on_started(run_id)
    result = await runs_service.finish(conn, runner_url, run_id, session_id, problem_id, code)
    await sessions_repo.append_event(conn, session_id, "run", actor)
    await sessions_repo.touch_activity(conn, session_id)
    return result


async def on_problem_deleted(conn: asyncpg.Connection, problem_id: uuid.UUID) -> None:
    """FR-10: broadcasts `problem_deleted` to every live session currently on it."""
    rows = await conn.fetch("select id from session where current_problem_id = $1", problem_id)
    message = {"type": "problem_deleted", "problem_id": str(problem_id)}
    for row in rows:
        hub = hub_module.peek_hub(row["id"])
        if hub is not None:
            await hub_module.broadcast(hub, message)
