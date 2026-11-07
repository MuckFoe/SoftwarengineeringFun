"""Account REST (spec 012 plan.md "Contracts"): `/api/me/*`. FR-2, FR-4, FR-12, FR-13,
FR-15, FR-16, NFR-1.

Every route is `401` when signed out and reads only the caller's own rows: the account is
the cookie's `sub`, never a parameter.
"""

from dataclasses import asdict
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, StrictBool, model_validator

from app.accounts import repo
from app.auth.deps import User, current_user
from app.present import hub as present_hub
from app.sessions import hub as session_hub
from app.sessions.api import get_conn

router = APIRouter(prefix="/api/me")

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]


def signed_in(request: Request) -> User:
    """A dependency: the signed-in user, or `401`."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


Account = Annotated[User, Depends(signed_in)]


def live_session_ids(
    coding_learning: dict[Any, Any], presentation: dict[Any, Any], chess: dict[Any, Any]
) -> dict[str, set[Any]]:
    """Spec 016 FR-2, FR-5: per kind, the ids of sessions whose in-memory hub has at least one
    connected participant. Coding and learning share one hub registry (ids are unique)."""

    def connected(hubs: dict[Any, Any]) -> set[Any]:
        return {sid for sid, h in hubs.items() if h.connections}

    both = connected(coding_learning)
    return {
        "coding": both,
        "learning": both,
        "presentation": connected(presentation),
        "chess": connected(chess),
    }


def mark_live(
    rows: list[dict[str, Any]], ids: dict[tuple[str, str], Any], live: dict[str, set[Any]]
) -> list[dict[str, Any]]:
    """Adds the additive boolean `live` to each row; `ids` maps (kind, invite_id) to the id."""
    return [
        {**r, "live": ids.get((r["kind"], r["invite_id"])) in live.get(r["kind"], set())}
        for r in rows
    ]


_INVITE_IDS = """
select 'coding' as kind, invite_id, id from session where invite_id = any($1)
union all select 'learning', invite_id, id from learning_session where invite_id = any($1)
union all select 'presentation', invite_id, id from presentation_session where invite_id = any($1)
union all select 'chess', invite_id, id from chess_session where invite_id = any($1)
"""


@router.get("/sessions")
async def my_sessions(request: Request, user: Account, conn: Conn) -> list[dict[str, Any]]:
    """FR-2, FR-4, FR-12: the account's non-hidden sessions, most recently active first.
    Spec 016: each row carries `live`, true while its hub has a connected participant."""
    rows = [
        {**asdict(s), "last_activity_at": s.last_activity_at.isoformat()}
        for s in await repo.recent_sessions(conn, user.sub)
    ]
    live = live_session_ids(
        session_hub._hubs,  # noqa: SLF001
        present_hub._hubs,  # noqa: SLF001
        getattr(request.app.state, "chess_hubs", {}),
    )
    ids: dict[tuple[str, str], Any] = {}
    if rows and any(live.values()):
        found = await conn.fetch(_INVITE_IDS, [r["invite_id"] for r in rows])
        ids = {(f["kind"], f["invite_id"]): f["id"] for f in found}
    return mark_live(rows, ids, live)


@router.post("/sessions/{kind}/{invite}/hide", status_code=status.HTTP_204_NO_CONTENT)
async def hide_session(kind: str, invite: str, user: Account, conn: Conn) -> Response:
    """FR-13: hide a session from the caller's own list only. Unknown kind, unknown session
    and a session the caller isn't in are the same `404` (NFR-1). Idempotent."""
    if not await repo.hide(conn, user.sub, kind, invite):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class PreferencesIn(BaseModel):
    appearance: repo.Appearance | None = None
    chat_visible: StrictBool | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "PreferencesIn":
        if self.appearance is None and self.chat_visible is None:
            raise ValueError("give appearance, chat_visible or both")
        return self


@router.put("/preferences")
async def put_preferences(body: PreferencesIn, user: Account, conn: Conn) -> dict[str, Any]:
    """FR-15, FR-16, FR-18: store the caller's preferences; returns the stored pair."""
    stored = await repo.put_preferences(conn, user.sub, body.appearance, body.chat_visible)
    return asdict(stored)
