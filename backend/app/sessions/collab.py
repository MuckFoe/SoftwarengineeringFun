"""Server-side collaborative document (plan.md "Live editing"). FR-16, FR-19, FR-27.

One pycrdt `Doc` per active session, loaded by replaying `yjs_update` and kept current by
persisting every applied update. One `Y.Text` per problem, keyed `code:{problem_id}`.
"""

import uuid

import asyncpg
import pycrdt

from app.problems.signature import parse_signature, starter_code
from app.sessions import repo as sessions_repo


class SessionDoc:
    """Wraps one session's pycrdt `Doc`, persisting every update it is given."""

    def __init__(self, session_id: uuid.UUID) -> None:
        self.session_id = session_id
        self.doc = pycrdt.Doc()
        self._pending: list[bytes] = []
        self.doc.observe(self._on_transaction)

    def _on_transaction(self, event: pycrdt.TransactionEvent) -> None:
        self._pending.append(bytes(event.update))

    def code_text(self, problem_id: str) -> pycrdt.Text:
        return self.doc.get(f"code:{problem_id}", type=pycrdt.Text)

    def get_code(self, problem_id: str) -> str:
        return str(self.code_text(problem_id))

    async def _flush(self, conn: asyncpg.Connection) -> None:
        pending, self._pending = self._pending, []
        for update in pending:
            await sessions_repo.append_update(conn, self.session_id, update)

    async def apply_update(self, conn: asyncpg.Connection, update: bytes) -> None:
        self.doc.apply_update(update)
        await self._flush(conn)

    async def ensure_problem_text(
        self, conn: asyncpg.Connection, problem_id: str, signature: str
    ) -> None:
        """Writes the starter code if `code:{problem_id}` is empty (FR-16)."""
        ytext = self.code_text(problem_id)
        if len(str(ytext)) == 0:
            ytext += starter_code(parse_signature(signature))
            await self._flush(conn)


async def load(conn: asyncpg.Connection, session_id: uuid.UUID) -> SessionDoc:
    """Builds a `SessionDoc` by replaying every stored update, without re-persisting them."""
    session_doc = SessionDoc(session_id)
    for update in await sessions_repo.load_updates(conn, session_id):
        session_doc.doc.apply_update(update)
    session_doc._pending.clear()  # replay, not a new change to persist
    return session_doc


_active: dict[uuid.UUID, SessionDoc] = {}


async def get_or_load(conn: asyncpg.Connection, session_id: uuid.UUID) -> SessionDoc:
    """One in-memory doc per active session: loads once, then returns the cached instance."""
    session_doc = _active.get(session_id)
    if session_doc is None:
        session_doc = await load(conn, session_id)
        _active[session_id] = session_doc
    return session_doc
