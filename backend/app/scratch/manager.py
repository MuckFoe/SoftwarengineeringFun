"""Spec 011: `RunManager`, the lifecycle of the one scratch run a session may have.

FR-1, FR-2, FR-4, FR-7..FR-10, NFR-3, NFR-5. Claiming is one conditional statement in
`scratch.repo`; this module streams the sandbox into an `OutputBuffer`, broadcasts batched
output, persists progress and writes the final row.
"""

import asyncio
import inspect
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import asyncpg

from app import clock
from app.runs.runner_client import RunnerUnavailable
from app.scratch import repo
from app.scratch import sandbox as scratch_sandbox
from app.scratch.output import OutputBuffer
from app.scratch.repo import Run, Segment

FLUSH_INTERVAL_S = 0.1
SAVE_INTERVAL_S = 1.0

Broadcast = Callable[[uuid.UUID, dict[str, Any]], Awaitable[None]]
CodeFor = Callable[[uuid.UUID], str | Awaitable[str]]


@dataclass(frozen=True)
class Started:
    pass


@dataclass(frozen=True)
class Refused:
    by: str


def run_payload(run: Run) -> dict[str, Any]:
    """The `Run` object of the plan's Contracts, JSON-ready."""
    return {
        "status": run.status,
        "started_by": run.started_by,
        "started_at": run.started_at.isoformat(),
        "input": run.input,
        "output": [dict(s) for s in run.output],
        "seq": run.seq,
        "exit_code": run.exit_code,
    }


class _Live:
    """In-memory state of a run in progress."""

    def __init__(self, user: str, input_text: str) -> None:
        self.user = user
        self.input = input_text
        self.started_at = clock.now()
        self.buffer = OutputBuffer()
        self.pending: list[tuple[str, str]] = []
        self.sent: list[Segment] = []  # what has been broadcast (snapshot = this)
        self.sent_seq = 0
        self.last_flush = float("-inf")
        self.wake = asyncio.Event()
        self.lock = asyncio.Lock()
        self.task: asyncio.Task[None] | None = None

    def run(self) -> Run:
        return Run(
            "running",
            self.user,
            self.started_at,
            None,
            self.input,
            [dict(s) for s in self.sent],
            self.sent_seq,
            None,
        )


class RunManager:
    def __init__(
        self,
        pool: asyncpg.Pool,
        runner_url: str,
        broadcast: Broadcast,
        code_for: CodeFor,
    ) -> None:
        self._pool = pool
        self._runner_url = runner_url
        self._broadcast = broadcast
        self._code_for = code_for
        self._live: dict[uuid.UUID, _Live] = {}

    async def start(self, session_id: uuid.UUID, user: str, input_text: str) -> Started | Refused:
        async with self._pool.acquire() as conn:
            if not await repo.claim(conn, session_id, user, input_text):
                current = await repo.get(conn, session_id)
                return Refused(by=current.started_by if current else "")
        live = _Live(user, input_text)
        self._live[session_id] = live
        try:
            code = self._code_for(session_id)
            if inspect.isawaitable(code):
                code = await code
        except BaseException:
            self._live.pop(session_id, None)
            async with self._pool.acquire() as conn:
                await repo.finish(conn, session_id, "error", None, [])
            raise
        await self._broadcast(
            session_id, {"type": "scratch_run_started", "run": run_payload(live.run())}
        )
        live.task = asyncio.create_task(self._drive(session_id, live, code, input_text))
        return Started()

    async def join(self, session_id: uuid.UUID) -> None:
        """Wait until the run in progress (if any) has ended."""
        live = self._live.get(session_id)
        if live and live.task:
            await asyncio.shield(live.task)

    async def snapshot(self, session_id: uuid.UUID) -> Run | None:
        live = self._live.get(session_id)
        if live is not None:
            return live.run()
        async with self._pool.acquire() as conn:
            return await repo.get(conn, session_id)

    async def reconcile_after_restart(self) -> None:
        async with self._pool.acquire() as conn:
            await repo.interrupt_running(conn)

    async def _flush(self, session_id: uuid.UUID, live: _Live) -> None:
        async with live.lock:
            pending, live.pending = live.pending, []
            live.last_flush = time.monotonic()
            messages: list[dict[str, Any]] = []
            for stream, text in pending:
                if messages and messages[-1]["s"] == stream:
                    messages[-1]["t"] += text
                else:
                    messages.append({"type": "scratch_run_output", "s": stream, "t": text})
            for message in messages:
                message["seq"] = live.sent_seq
                size = len(message["t"].encode())
                live.sent_seq += size
                if live.sent and live.sent[-1]["s"] == message["s"]:
                    live.sent[-1] = {"s": message["s"], "t": live.sent[-1]["t"] + message["t"]}
                else:
                    live.sent.append({"s": message["s"], "t": message["t"]})
                await self._broadcast(session_id, message)

    async def _flusher(self, session_id: uuid.UUID, live: _Live) -> None:
        while True:
            await live.wake.wait()
            live.wake.clear()
            wait = live.last_flush + FLUSH_INTERVAL_S - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            if live.pending:
                await self._flush(session_id, live)

    async def _save(self, session_id: uuid.UUID, live: _Live) -> None:
        segments = [{"s": s, "t": t} for s, t in live.buffer.segments]
        async with self._pool.acquire() as conn:
            await repo.save_progress(conn, session_id, segments)

    async def _drive(self, session_id: uuid.UUID, live: _Live, code: str, input_text: str) -> None:
        status, exit_code = "error", None
        flusher = asyncio.create_task(self._flusher(session_id, live))
        last_save = time.monotonic()
        stream = scratch_sandbox.run(self._runner_url, code, input_text)
        try:
            async for item in stream:
                if isinstance(item, scratch_sandbox.Exited):
                    status = "finished" if item.code == 0 else "error"
                    exit_code = item.code
                elif isinstance(item, scratch_sandbox.TimeLimit):
                    status = "time_limit"
                else:
                    accepted = live.buffer.append(*item)
                    if accepted:
                        live.pending.append((item[0], accepted))
                        live.wake.set()
                    if live.buffer.truncated:
                        status = "output_limit"
                        break
                    if time.monotonic() - last_save >= SAVE_INTERVAL_S:
                        last_save = time.monotonic()
                        await self._save(session_id, live)
        except RunnerUnavailable as exc:
            message = f"could not run: {exc}\n"
            accepted = live.buffer.append("err", message)
            if accepted:
                live.pending.append(("err", accepted))
            status, exit_code = "error", None
        finally:
            await stream.aclose()
            flusher.cancel()
            await asyncio.gather(flusher, return_exceptions=True)
            try:
                if live.pending:
                    await asyncio.sleep(
                        max(0.0, live.last_flush + FLUSH_INTERVAL_S - time.monotonic())
                    )
                    await self._flush(session_id, live)
                segments = [{"s": s, "t": t} for s, t in live.buffer.segments]
                async with self._pool.acquire() as conn:
                    await repo.finish(conn, session_id, status, exit_code, segments)
            finally:
                self._live.pop(session_id, None)
        await self._broadcast(
            session_id, {"type": "scratch_run_end", "status": status, "exit_code": exit_code}
        )
