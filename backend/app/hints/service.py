"""The hint request pipeline (spec 020 plan: "The request pipeline"; FR-2, FR-3, FR-5, FR-6,
FR-7, FR-8, FR-10, FR-14, FR-14a, FR-15).

One hint at a time per session, guarded in memory (`_HINTING`), with the same single-process
invariant as the session hub and `_RUNNING`. The check and the add in `request` have no
`await` between them, so two requests can never both be reserved. Each hint is produced by
its own task on its own pool connections, so the socket's receive loop returns at once and
editing, runs and chat are untouched while the model answers.

Questions (FR-17 to FR-22) share that one slot and pipeline. An answer that would give the
solution away is not shown: the session's one pending confirmation (`_AWAITING`) is set and
broadcast, and only the asker (by participant id) may confirm or decline it. Confirming asks
the model again in reveal mode. A pending confirmation never holds the slot (FR-21).
"""

import asyncio
import dataclasses
import functools
import uuid

import asyncpg
from fastapi import FastAPI, WebSocket

from app.hints import guard
from app.hints import repo as hints_repo
from app.hints.llm import ANSWER_MAX_TOKENS, REVEALED_MAX_TOKENS, LlmClient, LlmUnavailable
from app.hints.prompt import HintContext, RunOutcome, build_messages, build_question_messages
from app.problems import repo as problems_repo
from app.runs import repo as runs_repo
from app.runs.runner_client import RunnerUnavailable
from app.sessions import collab
from app.sessions import hub as hub_module
from app.sessions import repo as sessions_repo
from app.sessions.hub import SessionHub
from app.sessions.repo import Session

NOTE_MAX_CHARS = 200
QUESTION_MAX_CHARS = 500


@dataclasses.dataclass
class Pending:
    """A hint or answer being prepared: who asked, their note or question and the problem.

    `participant_id` is the asker's, so a revealing answer can be offered to them alone.
    """

    by: str
    note: str | None
    problem_id: uuid.UUID
    warming: bool = False
    kind: str = "hint"
    question: str | None = None
    reveal: bool = False
    participant_id: uuid.UUID | None = None


@dataclasses.dataclass(frozen=True)
class Awaiting:
    """A question whose answer would give the solution away, waiting for its asker (FR-20)."""

    participant_id: uuid.UUID
    by: str
    question: str
    problem_id: uuid.UUID


_HINTING: dict[uuid.UUID, Pending] = {}
_AWAITING: dict[uuid.UUID, Awaiting] = {}
_HINT_TASKS: set[asyncio.Task] = set()
_HINT_TASK_BY_SESSION: dict[uuid.UUID, asyncio.Task] = {}


def normalize_note(raw: object) -> str | None:
    """AC-4: the first line, stripped and cut to 200 characters; empty (or not text) is None."""
    if not isinstance(raw, str):
        return None
    lines = raw.splitlines()
    note = lines[0].strip()[:NOTE_MAX_CHARS] if lines else ""
    return note or None


def normalize_question(raw: object) -> str | None:
    """FR-17: one line (line breaks become spaces), stripped, cut to 500; empty is None."""
    if not isinstance(raw, str):
        return None
    question = " ".join(raw.split())[:QUESTION_MAX_CHARS].strip()
    return question or None


def _pending_dict(pending: Pending) -> dict:
    return {
        "problem_id": str(pending.problem_id),
        "by": pending.by,
        "note": pending.note,
        "warming": pending.warming,
        "kind": pending.kind,
        "question": pending.question,
        "reveal": pending.reveal,
    }


def _awaiting_dict(awaiting: Awaiting) -> dict:
    return {
        "problem_id": str(awaiting.problem_id),
        "participant_id": str(awaiting.participant_id),
        "by": awaiting.by,
        "question": awaiting.question,
    }


def pending(session_id: uuid.UUID) -> dict | None:
    """The hint being prepared for the session, for `welcome.hint_pending` (late joiners)."""
    current = _HINTING.get(session_id)
    return None if current is None else _pending_dict(current)


def awaiting(session_id: uuid.UUID) -> dict | None:
    """The question waiting for its asker's confirmation, for `welcome.question_awaiting`."""
    current = _AWAITING.get(session_id)
    return None if current is None else _awaiting_dict(current)


async def _refuse(websocket: WebSocket, reason: str, **extra: str) -> None:
    await websocket.send_json({"type": "hint_refused", "reason": reason, **extra})


async def _open_problem_id(
    app: FastAPI, websocket: WebSocket, session: Session, problem_id: uuid.UUID | None = None
) -> uuid.UUID | None:
    """The problem to ask about (the current one unless given), or None after refusing the
    sender: no model, a stale session or a deleted problem (FR-2, FR-3)."""
    if app.state.hint_llm is None:
        await _refuse(websocket, "disabled")
        return None
    async with app.state.pool.acquire() as conn:
        current = await sessions_repo.get_by_invite(conn, session.invite_id)
        if current is None or current.stale_at is not None:
            await _refuse(websocket, "stale")
            return None
        problem = await problems_repo.get_public(
            conn, problem_id if problem_id is not None else current.current_problem_id
        )
    if problem.deleted:
        await _refuse(websocket, "problem_deleted")
        return None
    return problem.id


async def request(
    app: FastAPI,
    websocket: WebSocket,
    session: Session,
    hub: SessionHub,
    actor: str,
    note: object,
) -> None:
    """Handles one `hint_request`: refuses it to the sender, or reserves the session's one
    hint, tells everyone `hint_started` and spawns the task that produces it.

    The UI sends no note any more (FR-5); one from an older client is still normalized."""
    problem_id = await _open_problem_id(app, websocket, session)
    if problem_id is not None:
        await _start(app, websocket, session, hub, Pending(actor, normalize_note(note), problem_id))


async def ask_question(
    app: FastAPI,
    websocket: WebSocket,
    session: Session,
    hub: SessionHub,
    actor: str,
    participant_id: uuid.UUID,
    question: object,
) -> None:
    """Handles one `question_request` (FR-17): like a hint, with the question."""
    text = normalize_question(question)
    if text is None:
        await _refuse(websocket, "empty")
        return
    problem_id = await _open_problem_id(app, websocket, session)
    if problem_id is not None:
        reserved = Pending(
            actor,
            None,
            problem_id,
            kind="question",
            question=text,
            participant_id=participant_id,
        )
        await _start(app, websocket, session, hub, reserved)


async def reveal(
    app: FastAPI,
    websocket: WebSocket,
    session: Session,
    hub: SessionHub,
    participant_id: uuid.UUID,
) -> None:
    """Handles `question_reveal` (FR-20): the asker confirms, so the model is asked again,
    allowed to give the solution. Anyone else, or nothing pending, is refused."""
    current = _AWAITING.get(session.id)
    if current is None or current.participant_id != participant_id:
        await _refuse(websocket, "no_question")
        return
    problem_id = await _open_problem_id(app, websocket, session, current.problem_id)
    if problem_id is None:
        return
    reserved = Pending(
        current.by,
        None,
        problem_id,
        kind="question",
        question=current.question,
        reveal=True,
        participant_id=participant_id,
    )
    await _start(app, websocket, session, hub, reserved, confirming=current)


async def decline(
    websocket: WebSocket, session: Session, hub: SessionHub, participant_id: uuid.UUID
) -> None:
    """Handles `question_decline` (FR-20): the question is dropped, nothing is stored."""
    current = _AWAITING.get(session.id)
    if current is None or current.participant_id != participant_id:
        await _refuse(websocket, "no_question")
        return
    del _AWAITING[session.id]
    await hub_module.broadcast(hub, {"type": "question_confirm_ended", "outcome": "declined"})


async def _start(
    app: FastAPI,
    websocket: WebSocket,
    session: Session,
    hub: SessionHub,
    reserved: Pending,
    confirming: Awaiting | None = None,
) -> None:
    """Reserves the session's one slot for `reserved`, tells everyone `hint_started` and
    spawns the task that produces it; refuses the sender while the slot is taken (FR-8)."""
    llm: LlmClient = app.state.hint_llm
    # From here to the add, no `await`: the check and the reservation are one step.
    existing = _HINTING.get(session.id)
    if existing is not None:
        await _refuse(websocket, "in_progress", by=existing.by)
        return
    _HINTING[session.id] = reserved
    if confirming is not None and _AWAITING.get(session.id) is confirming:
        del _AWAITING[session.id]
        await hub_module.broadcast(hub, {"type": "question_confirm_ended", "outcome": "confirmed"})

    await hub_module.broadcast(hub, {"type": "hint_started", "pending": _pending_dict(reserved)})
    if _HINTING.get(session.id) is not reserved:  # cancelled while announcing
        return
    task = asyncio.create_task(_produce(app, llm, hub, session.id, reserved))
    _HINT_TASKS.add(task)
    _HINT_TASK_BY_SESSION[session.id] = task
    task.add_done_callback(functools.partial(_forget_task, session.id))


def _forget_task(session_id: uuid.UUID, task: asyncio.Task) -> None:
    _HINT_TASKS.discard(task)
    if _HINT_TASK_BY_SESSION.get(session_id) is task:
        del _HINT_TASK_BY_SESSION[session_id]


def _release(session_id: uuid.UUID, reserved: Pending) -> None:
    if _HINTING.get(session_id) is reserved:
        del _HINTING[session_id]


async def _produce(
    app: FastAPI, llm: LlmClient, hub: SessionHub, session_id: uuid.UUID, reserved: Pending
) -> None:
    """Checks whether the model is loaded, gathers the context, asks the model, guards the
    answer, then stores and announces it, or announces why not. The reservation is released
    before the outcome goes out, so Hint can be asked again the moment it arrives (AC-6).

    The whole pipeline up to the guard's verdict runs under one deadline, counted from the
    start (cold check included): `hint_deadline_seconds` when the model is loaded or `/api/ps`
    fails, `hint_cold_deadline_seconds` when it is cold (FR-14, FR-14a). Running out before
    the model answered is "unavailable"; during the solution check it fails closed as
    "withheld". Nothing warms the model ahead of time.
    """
    settings = app.state.settings
    pool = app.state.pool
    problem_id = reserved.problem_id
    reason: str | None = None
    body: str | None = None
    needs_confirmation = False
    guarding = False
    try:
        try:
            async with asyncio.timeout(None) as deadline:
                started = asyncio.get_running_loop().time()
                if await llm.is_loaded():
                    llm_timeout = settings.hint_llm_timeout_seconds
                    deadline.reschedule(started + settings.hint_deadline_seconds)
                else:
                    llm_timeout = settings.hint_llm_cold_timeout_seconds
                    deadline.reschedule(started + settings.hint_cold_deadline_seconds)
                    reserved.warming = True
                    await hub_module.broadcast(
                        hub, {"type": "hint_warming", "problem_id": str(problem_id)}
                    )
                async with pool.acquire() as conn:
                    problem = await problems_repo.get_with_tests(conn, problem_id)
                    session_doc = await collab.get_or_load(conn, session_id)
                    code = session_doc.get_code(str(problem_id))
                    latest_run = await _latest_run(conn, session_id, problem_id)
                    earlier = await hints_repo.list_for_problem(conn, session_id, problem_id)
                # FR-12, FR-22: only this session's problem, code, latest run, earlier hints
                # (and, for a question, earlier answers) on the problem and the note or
                # question. No tests, no chat, no names (the asker's name stays in `reserved`
                # for the broadcast).
                context = HintContext(
                    title=problem.title,
                    description=problem.description,
                    signature=problem.signature,
                    code=code,
                    latest_run=latest_run,
                    earlier_hints=[row.body for row in earlier if row.kind == "hint"],
                    note=reserved.note,
                    earlier_questions=tuple(
                        (row.question or "", row.body) for row in earlier if row.kind == "question"
                    ),
                )
                if reserved.kind == "hint":
                    raw = await llm.complete(build_messages(context), llm_timeout)
                    guarding = True
                    try:
                        body = await guard.check(settings.runner_url, problem, raw)
                    except RunnerUnavailable:
                        body = None  # the solution check fails closed
                elif reserved.reveal:
                    messages = build_question_messages(
                        context, reserved.question or "", reveal=True
                    )
                    raw = await llm.complete(messages, llm_timeout, REVEALED_MAX_TOKENS)
                    body = guard.normalize_revealed(raw)
                else:
                    messages = build_question_messages(context, reserved.question or "")
                    raw = await llm.complete(messages, llm_timeout, ANSWER_MAX_TOKENS)
                    guarding = True
                    try:
                        verdict, body = await guard.check_answer(settings.runner_url, problem, raw)
                    except RunnerUnavailable:
                        verdict, body = "withheld", None  # fails closed
                    needs_confirmation = verdict == "reveal"
                if body is None and not needs_confirmation:
                    reason = "withheld"
        except LlmUnavailable:
            reason = "unavailable"
        except TimeoutError:
            reason = "withheld" if guarding else "unavailable"
        if reason is not None:
            await _fail(hub, session_id, reserved, reason)
            return
        if needs_confirmation or body is None:
            await _ask_to_confirm(hub, session_id, reserved)
            return
        async with pool.acquire() as conn:
            row = await hints_repo.insert_next(
                conn,
                session_id,
                problem_id,
                reserved.by,
                reserved.note,
                body,
                question=reserved.question,
                reveals_solution=reserved.reveal,
            )
        _release(session_id, reserved)
        await hub_module.broadcast(hub, {"type": "hint_ready", "hint": hints_repo.hint_dict(row)})
    finally:
        _release(session_id, reserved)


async def _latest_run(
    conn: asyncpg.Connection, session_id: uuid.UUID, problem_id: uuid.UUID
) -> list[RunOutcome] | None:
    """The latest run's per-test outcomes and error messages, without tracebacks (FR-11,
    FR-12); None ("never run") when there is none or it did not finish."""
    run = await runs_repo.last_run(conn, session_id, problem_id)
    if run is None or run.status != "done":
        return None
    return [RunOutcome(r.position, r.outcome, r.error_message) for r in run.results]


async def _fail(hub: SessionHub, session_id: uuid.UUID, reserved: Pending, reason: str) -> None:
    """Everyone saw `hint_started`, so everyone is told; no row, no number used."""
    _release(session_id, reserved)
    await hub_module.broadcast(
        hub,
        {
            "type": "hint_failed",
            "problem_id": str(reserved.problem_id),
            "reason": reason,
            "kind": reserved.kind,
        },
    )


async def _ask_to_confirm(hub: SessionHub, session_id: uuid.UUID, reserved: Pending) -> None:
    """FR-20: the answer would give the solution away. Nothing is stored; the session's one
    pending confirmation becomes this question (a newer one replaces it, FR-21) and everyone
    is told, so the asker's client offers the choice and the others show who is deciding."""
    _release(session_id, reserved)
    if reserved.participant_id is None or reserved.question is None:
        return
    current = Awaiting(reserved.participant_id, reserved.by, reserved.question, reserved.problem_id)
    _AWAITING[session_id] = current
    await hub_module.broadcast(
        hub, {"type": "question_confirm", "awaiting": _awaiting_dict(current)}
    )


async def cancel(session_id: uuid.UUID) -> None:
    """Cancels the session's hint in flight: nothing is written or broadcast afterwards.
    Nothing in flight is a no-op."""
    _HINTING.pop(session_id, None)
    _AWAITING.pop(session_id, None)
    task = _HINT_TASK_BY_SESSION.pop(session_id, None)
    if task is not None:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def drain() -> None:
    """Waits for hints in flight; called on shutdown before the model client and pool close."""
    await asyncio.gather(*_HINT_TASKS, return_exceptions=True)
