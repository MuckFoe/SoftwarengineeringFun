"""The session WebSocket: join, presence, the cap of 5, name validation, Yjs sync and
awareness relay (plan.md "Presence and the cap of 5", "Live editing").
FR-12, FR-12a, FR-13, FR-14, FR-15, FR-16, FR-18, FR-19, FR-20, FR-30.

Server-level WebSocket ping/pong (uvicorn `--ws-ping-interval 2 --ws-ping-timeout 3`,
task 37's compose) detects a silently dropped connection within ~5 s for FR-15; a clean
disconnect is detected immediately below.
"""

import asyncio
import json
import uuid
from datetime import timedelta

import anyio
import asyncpg
import pycrdt
from fastapi import APIRouter, WebSocket

from app import clock
from app.problems import repo as problems_repo
from app.runs import repo as runs_repo
from app.runs.repo import Run, RunInProgress
from app.runs.service import RunResult
from app.sessions import collab, service
from app.sessions import hub as hub_module
from app.sessions import repo as sessions_repo
from app.sessions.collab import SessionDoc
from app.sessions.hub import SessionHub
from app.sessions.repo import Session

router = APIRouter()

CLOSE_NOT_FOUND = 4404
CLOSE_FULL = 4403
CLOSE_STALE = 4410
CLOSE_INVALID_NAME = 4422

ACTIVITY_TOUCH_INTERVAL = timedelta(minutes=1)

# One run at a time per session (FR-26), guarded in-memory: same single-process invariant
# as the hub. The check-and-add in `_handle_text` has no `await` between them, so it is
# atomic with respect to the event loop, and is what keeps "run_started" from ever being
# broadcast twice for one race. The DB's partial unique index is the authoritative backstop.
_RUNNING: set[uuid.UUID] = set()
# Runs execute as tasks so the participant who started one keeps editing meanwhile (FR-18).
_RUN_TASKS: set[asyncio.Task] = set()


async def drain_runs() -> None:
    """Waits for in-flight runs; called on shutdown before the pool closes."""
    await asyncio.gather(*_RUN_TASKS, return_exceptions=True)


def _valid_name(raw: str) -> str | None:
    name = raw.strip()
    return name if 1 <= len(name) <= 30 else None


async def _touch_activity_throttled(
    conn: asyncpg.Connection, session_id: uuid.UUID, hub: SessionHub
) -> None:
    now = clock.now()
    if hub.last_activity_touch is None or now - hub.last_activity_touch >= ACTIVITY_TOUCH_INTERVAL:
        hub.last_activity_touch = now
        await sessions_repo.touch_activity(conn, session_id)


def _problem_dict(problem: problems_repo.ProblemPublic) -> dict:
    return {
        "id": str(problem.id),
        "title": problem.title,
        "description": problem.description,
        "signature": problem.signature,
        "deleted": problem.deleted,
    }


def _run_result_dict(last_run: Run | None, accepted: bool) -> dict | None:
    if last_run is None:
        return None
    return {
        "run_id": str(last_run.id),
        "problem_id": str(last_run.problem_id),
        "accepted": accepted,
        "results": [
            {
                "position": r.position,
                "outcome": r.outcome,
                "error_message": r.error_message,
                "traceback": r.traceback,
            }
            for r in last_run.results
        ],
    }


async def _problems_progress(
    conn: asyncpg.Connection, session_id: uuid.UUID, current_problem_id: uuid.UUID
) -> dict:
    """FR-28: accepted status and last run for every problem this session has used."""
    rows = await conn.fetch(
        "select problem_id, accepted from session_problem where session_id = $1", session_id
    )
    accepted = {row["problem_id"]: row["accepted"] for row in rows}
    accepted.setdefault(current_problem_id, False)
    progress = {}
    for problem_id, is_accepted in accepted.items():
        last_run = await runs_repo.last_run(conn, session_id, problem_id)
        entry: dict = {"accepted": is_accepted}
        if last_run is not None:
            entry["last_run"] = _run_result_dict(last_run, is_accepted)
        progress[str(problem_id)] = entry
    return progress


def _run_finished_dict(problem_id: uuid.UUID, result: RunResult) -> dict:
    return {
        "run_id": str(result.run_id),
        "problem_id": str(problem_id),
        "accepted": result.accepted,
        "results": [
            {
                "position": r.position,
                "outcome": r.outcome,
                "error_message": r.error_message,
                "traceback": r.traceback,
            }
            for r in result.results
        ],
    }


async def _handle_switch_problem(
    websocket: WebSocket,
    conn: asyncpg.Connection,
    session: Session,
    session_doc: SessionDoc,
    hub: SessionHub,
    actor: str,
    problem_id: uuid.UUID,
) -> None:
    """FR-17: switches the session's current problem and tells every participant."""
    try:
        problem, progress = await service.switch_problem(conn, session.id, problem_id, actor)
    except problems_repo.NotFound:
        await websocket.send_json({"type": "error", "code": "problem_not_found"})
        return

    # If this problem's text doesn't exist yet in this session, ensure_problem_text
    # writes it; everyone already connected needs that update too, not just new joiners.
    before_state = session_doc.doc.get_state()
    await session_doc.ensure_problem_text(conn, str(problem.id), problem.signature)
    diff = session_doc.doc.get_update(before_state)

    await hub_module.broadcast(
        hub,
        {
            "type": "problem_switched",
            "problem": _problem_dict(problem),
            "by": actor,
            "state": {
                "accepted": progress.accepted,
                "last_run": _run_result_dict(progress.last_run, progress.accepted),
            },
        },
    )
    if diff != b"\x00\x00":
        await hub_module.broadcast_bytes(hub, pycrdt.create_update_message(diff))


async def _handle_run(
    websocket: WebSocket,
    pool: asyncpg.Pool,
    session: Session,
    session_doc: SessionDoc,
    hub: SessionHub,
    runner_url: str,
    actor: str,
    participant_id: uuid.UUID,
) -> None:
    """FR-10, FR-21, FR-22, FR-23, FR-24, FR-26: runs the session's current problem.

    Runs as a task (see `_handle_text`), which has reserved `_RUNNING` for this session, on
    a connection of its own: the participant's connection keeps serving their edits.
    """
    try:
        async with pool.acquire() as conn:
            await _run_current_problem(
                websocket, conn, session, session_doc, hub, runner_url, actor, participant_id
            )
    finally:
        _RUNNING.discard(session.id)


async def _run_current_problem(
    websocket: WebSocket,
    conn: asyncpg.Connection,
    session: Session,
    session_doc: SessionDoc,
    hub: SessionHub,
    runner_url: str,
    actor: str,
    participant_id: uuid.UUID,
) -> None:
    current = await sessions_repo.get_by_invite(conn, session.invite_id)
    problem = await problems_repo.get_public(conn, current.current_problem_id)
    if problem.deleted:
        await websocket.send_json({"type": "error", "code": "problem_deleted"})
        return
    code = session_doc.get_code(str(problem.id))

    async def _announce_started(run_id: uuid.UUID) -> None:
        await hub_module.broadcast(hub, {"type": "run_started", "run_id": str(run_id), "by": actor})

    try:
        result = await service.run(
            conn,
            runner_url,
            session.id,
            problem.id,
            code,
            participant_id,
            actor,
            _announce_started,
        )
    except RunInProgress:
        await websocket.send_json({"type": "error", "code": "run_in_progress"})
        return
    if result.status == "infra_error":
        # Everyone saw run_started, so everyone needs to know it ended (FR-26).
        await hub_module.broadcast(
            hub,
            {"type": "run_failed", "run_id": str(result.run_id), "reason": "infra_error"},
        )
        return
    await hub_module.broadcast(
        hub, {"type": "run_finished", "run": _run_finished_dict(problem.id, result)}
    )


async def _handle_text(
    websocket: WebSocket,
    conn: asyncpg.Connection,
    session: Session,
    session_doc: SessionDoc,
    hub: SessionHub,
    runner_url: str,
    actor: str,
    participant_id: uuid.UUID,
    text: str,
) -> None:
    try:
        payload = json.loads(text)
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    msg_type = payload.get("type")
    if msg_type == "switch_problem":
        try:
            problem_id = uuid.UUID(str(payload.get("problem_id")))
        except ValueError:
            return
        await _handle_switch_problem(websocket, conn, session, session_doc, hub, actor, problem_id)
    elif msg_type == "run":
        if session.id in _RUNNING:
            await websocket.send_json({"type": "error", "code": "run_in_progress"})
            return
        _RUNNING.add(session.id)
        task = asyncio.create_task(
            _handle_run(
                websocket,
                websocket.app.state.pool,
                session,
                session_doc,
                hub,
                runner_url,
                actor,
                participant_id,
            )
        )
        _RUN_TASKS.add(task)
        task.add_done_callback(_RUN_TASKS.discard)


async def _handle_binary(
    websocket: WebSocket,
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    session_doc: SessionDoc,
    hub: SessionHub,
    participant_id: uuid.UUID,
    data: bytes,
) -> None:
    msg_type, rest = data[0], data[1:]
    if msg_type == pycrdt.YMessageType.AWARENESS:
        # Relayed, never persisted (plan.md "Live editing").
        await hub_module.broadcast_bytes(hub, data, exclude=participant_id)
        return
    if msg_type != pycrdt.YMessageType.SYNC:
        return

    sync_type = rest[0]
    if sync_type == pycrdt.YSyncMessageType.SYNC_STEP1:
        reply = pycrdt.handle_sync_message(rest, session_doc.doc)
        if reply is not None:
            await websocket.send_bytes(reply)
        return

    # SYNC_STEP2 or SYNC_UPDATE: an incoming document change to apply, persist and relay.
    update = pycrdt.read_message(rest[1:])
    if update == b"\x00\x00":  # an empty update carries nothing to apply
        return
    await session_doc.apply_update(conn, update)
    await _touch_activity_throttled(conn, session_id, hub)
    await hub_module.broadcast_bytes(
        hub, pycrdt.create_update_message(update), exclude=participant_id
    )


@router.websocket("/api/sessions/{invite}/ws")
async def session_ws(websocket: WebSocket, invite: str, name: str = "") -> None:
    await websocket.accept()
    pool = websocket.app.state.pool
    runner_url = websocket.app.state.settings.runner_url
    async with pool.acquire() as conn:
        session = await sessions_repo.get_by_invite(conn, invite)
        if session is None:
            await websocket.close(code=CLOSE_NOT_FOUND)
            return
        if session.stale_at is not None:
            await websocket.close(code=CLOSE_STALE)
            return
        valid_name = _valid_name(name)
        if valid_name is None:
            await websocket.close(code=CLOSE_INVALID_NAME)
            return
        session_hub = hub_module.get_hub(session.id)
        # Reserved before the awaits below, so concurrent joins can't all pass the cap.
        if not session_hub.try_reserve():
            await websocket.close(code=CLOSE_FULL)
            return

        try:
            participant = await sessions_repo.add_participant(conn, session.id, valid_name)
            await sessions_repo.append_event(conn, session.id, "joined", valid_name)
            await sessions_repo.touch_activity(conn, session.id)
        except BaseException:
            session_hub.release_reservation()
            raise
        session_hub.add(hub_module.Connection(websocket, participant.id, valid_name))

        problem = await problems_repo.get_public(conn, session.current_problem_id)
        session_doc = await collab.get_or_load(conn, session.id)
        await session_doc.ensure_problem_text(conn, str(problem.id), problem.signature)

        await websocket.send_json(
            {
                "type": "welcome",
                "participant_id": str(participant.id),
                "current_problem": _problem_dict(problem),
                "problems": await _problems_progress(conn, session.id, problem.id),
                "presence": session_hub.presence(),
                "run_in_progress": session.id in _RUNNING,
            }
        )
        # `welcome` already carries the current presence list, so the new participant
        # doesn't need this broadcast too.
        await hub_module.broadcast(
            session_hub,
            {"type": "presence", "participants": session_hub.presence()},
            exclude=participant.id,
        )

        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                data = message.get("bytes")
                if data is not None:
                    await _handle_binary(
                        websocket, conn, session.id, session_doc, session_hub, participant.id, data
                    )
                    continue
                text = message.get("text")
                if text is not None:
                    await _handle_text(
                        websocket,
                        conn,
                        session,
                        session_doc,
                        session_hub,
                        runner_url,
                        valid_name,
                        participant.id,
                        text,
                    )
        finally:
            # Shielded: a cancelled scope (e.g. the test client tearing down the connection)
            # must not cut this off before presence is updated and the leave is recorded.
            with anyio.CancelScope(shield=True):
                session_hub.remove(participant.id)
                await sessions_repo.leave_participant(conn, participant.id)
                await sessions_repo.append_event(conn, session.id, "left", valid_name)
                await hub_module.broadcast(
                    session_hub, {"type": "presence", "participants": session_hub.presence()}
                )
