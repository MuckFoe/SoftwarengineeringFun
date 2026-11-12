"""Spec 019 task 14: deleting a coding session cancels its in-flight graded and scratch runs
(FR-6, FR-7). The runner is never reached: the run coroutines are fakes blocked on an Event."""

import asyncio
import contextlib
import json
import uuid
from types import SimpleNamespace

from app.scratch import manager as scratch_manager
from app.sessions import hub as hub_module
from app.sessions import ws as sessions_ws


class FakePool:
    def __init__(self) -> None:
        self.acquired = 0

    @contextlib.asynccontextmanager
    async def acquire(self):
        self.acquired += 1
        yield object()


class FakeSocket:
    def __init__(self, app: object) -> None:
        self.app = app
        self.sent: list[object] = []

    async def send_json(self, data: object) -> None:
        self.sent.append(data)


def _app(pool: FakePool, manager: object | None = None) -> SimpleNamespace:
    state = SimpleNamespace(pool=pool)
    if manager is not None:
        state.scratch_manager = manager
    return SimpleNamespace(state=state)


async def _start_graded_run(monkeypatch, app, session_id: uuid.UUID) -> dict:
    """Starts a graded run through `_handle_text`, whose problem run blocks until released
    and then records that it would have written its result."""
    seen = {"started": asyncio.Event(), "release": asyncio.Event(), "wrote": False}

    async def fake_run_current_problem(*_args) -> None:
        seen["started"].set()
        await seen["release"].wait()
        seen["wrote"] = True

    monkeypatch.setattr(sessions_ws, "_run_current_problem", fake_run_current_problem)
    session = SimpleNamespace(id=session_id, invite_id="inv")
    await sessions_ws._handle_text(  # noqa: SLF001
        FakeSocket(app), None, session, None, None, "http://runner", "A", uuid.uuid4(),
        json.dumps({"type": "run"}),
    )  # fmt: skip
    await asyncio.wait_for(seen["started"].wait(), 1)
    return seen


async def test_fr6_graded_run_in_flight_is_cancelled_and_writes_nothing(monkeypatch) -> None:
    session_id = uuid.uuid4()
    app = _app(FakePool())
    seen = await _start_graded_run(monkeypatch, app, session_id)
    assert session_id in sessions_ws._RUNNING  # noqa: SLF001

    await sessions_ws.cancel_runs(app, session_id)

    assert session_id not in sessions_ws._RUNNING  # noqa: SLF001
    seen["release"].set()
    await asyncio.sleep(0)
    assert seen["wrote"] is False
    assert not any(t for t in sessions_ws._RUN_TASKS if not t.done())  # noqa: SLF001


async def test_cancel_runs_with_nothing_in_flight_is_a_noop() -> None:
    manager = scratch_manager.RunManager(FakePool(), "http://runner", _never, _never)
    await sessions_ws.cancel_runs(_app(FakePool(), manager), uuid.uuid4())
    await sessions_ws.cancel_runs(_app(FakePool()), uuid.uuid4())  # no manager built yet


async def _never(*_args):
    raise AssertionError("must not be called")


async def test_fr6_scratch_run_in_flight_is_discarded_without_save_or_broadcast(
    monkeypatch,
) -> None:
    session_id = uuid.uuid4()
    writes: list[str] = []
    streaming = asyncio.Event()
    release = asyncio.Event()

    async def claim(_conn, *_args) -> bool:
        return True

    async def record(name: str):
        writes.append(name)

    monkeypatch.setattr(scratch_manager.repo, "claim", claim)
    monkeypatch.setattr(scratch_manager.repo, "save_progress", lambda *_a: record("save"))
    monkeypatch.setattr(scratch_manager.repo, "finish", lambda *_a: record("finish"))

    async def fake_sandbox_run(_url, _code, _input):
        yield ("out", "hello\n")
        streaming.set()
        await release.wait()
        yield scratch_manager.scratch_sandbox.Exited(0)

    monkeypatch.setattr(scratch_manager.scratch_sandbox, "run", fake_sandbox_run)

    broadcasts: list[dict] = []

    async def broadcast(sid: uuid.UUID, message: dict) -> None:
        broadcasts.append(message)
        hub_module.get_hub(sid)  # what the real callback does: it would recreate a hub

    async def code_for(_sid: uuid.UUID) -> str:
        return "print('hello')"

    manager = scratch_manager.RunManager(FakePool(), "http://runner", broadcast, code_for)
    started = await manager.start(session_id, "A", "")
    assert isinstance(started, scratch_manager.Started)
    await asyncio.wait_for(streaming.wait(), 1)
    task = manager._live[session_id].task  # noqa: SLF001
    hub_module._hubs.pop(session_id, None)  # noqa: SLF001  (as close_deleted leaves it)
    sent_before = len(broadcasts)

    await sessions_ws.cancel_runs(_app(FakePool(), manager), session_id)

    assert task is not None and task.done()
    release.set()
    await asyncio.sleep(0.2)  # past a flush interval
    assert session_id not in manager._live  # noqa: SLF001
    assert writes == []
    assert len(broadcasts) == sent_before
    assert hub_module.peek_hub(session_id) is None


async def test_scratch_discard_with_nothing_in_flight_is_a_noop() -> None:
    manager = scratch_manager.RunManager(FakePool(), "http://runner", _never, _never)
    await manager.discard(uuid.uuid4())
