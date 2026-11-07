"""Spec 017 `GET /api/home` assembly (plan.md "Contracts", "Data model"). FR-1, FR-3, FR-8,
FR-10.

Nothing is stored: the snapshot is derived per request from the viewer's own participant rows
and the in-memory hubs. A session is visible to an account only if the account has a
(non-hidden) participant in it, the same membership that lets it open the session from its
sessions list; a session with no such row never reaches the response, its participants
included (FR-8).
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

from app.auth.deps import User
from app.games.chess import rules as chess_rules
from app.home import preview

IDLE_CAP = 8
AVATAR_CAP = 4

# One row per visible session. The host is the presentation's host, else the earliest joiner.
_VISIBLE = """
select 'coding' as kind, s.id, s.invite_id, pr.title, s.last_activity_at,
       h.id as host_id, h.display_name as host_name
  from participant p
  join session s on s.id = p.session_id
  join problem pr on pr.id = s.current_problem_id
  left join lateral (select id, display_name from participant
                      where session_id = s.id order by joined_at, id limit 1) h on true
 where (p.account_sub = $1 or p.id = $2) and p.hidden_at is null
union all
select 'learning', ls.id, ls.invite_id, lv.content->>'title', ls.last_activity_at,
       h.id, h.display_name
  from learning_participant p
  join learning_session ls on ls.id = p.session_id
  join lesson_version lv on lv.id = ls.lesson_version_id
  left join lateral (select id, display_name from learning_participant
                      where session_id = ls.id order by joined_at, id limit 1) h on true
 where (p.account_sub = $1 or p.id = $2) and p.hidden_at is null
union all
select 'presentation', ps.id, ps.invite_id, pres.title, ps.last_activity_at,
       h.id, h.display_name
  from presentation_participant p
  join presentation_session ps on ps.id = p.session_id
  join presentation_version pv on pv.id = ps.version_id
  join presentation pres on pres.id = pv.presentation_id
  left join lateral (select id, display_name from presentation_participant
                      where session_id = ps.id
                      order by (id = ps.host_participant_id) desc, joined_at, id
                      limit 1) h on true
 where (p.account_sub = $1 or p.id = $2) and p.hidden_at is null
"""

# The person behind each connected participant, to count distinct people.
_PEOPLE = """
select id, account_sub from participant where id = any($1)
union all select id, account_sub from learning_participant where id = any($1)
union all select id, account_sub from presentation_participant where id = any($1)
"""


# The viewer's chess sessions that are waiting (no game yet) or in progress. Stale, deleted and
# finished ones are left out.
_GAMES = """
select cs.id, cs.invite_id, cs.current_game_id, me.id as me_id, cs.white_participant_id as white_id,
       cs.black_participant_id as black_id
  from chess_participant me
  join chess_session cs on cs.id = me.session_id
  left join chess_game g on g.id = cs.current_game_id
 where (me.account_sub = $1 or me.id = $2) and me.hidden_at is null
   and cs.deleted_at is null and cs.stale_at is null
   and (cs.current_game_id is null or g.ended_at is null)
 order by cs.last_activity_at desc, cs.id
"""


async def _games(
    conn: asyncpg.Connection, sub: str | None, participant_id: Any = None
) -> list[dict[str, Any]]:
    """FR-6: chess games involving the viewer, in progress or waiting. A viewer who only
    watches (not seated) has no opponent and no turn."""
    tiles = []
    for row in await conn.fetch(_GAMES, sub, participant_id):
        ucis = (
            [
                m["uci"]
                for m in await conn.fetch(
                    "select uci from chess_move where game_id = $1 order by ply",
                    row["current_game_id"],
                )
            ]
            if row["current_game_id"]
            else []
        )
        board = chess_rules.replay(ucis)
        mine = row["me_id"]
        seated = mine in (row["white_id"], row["black_id"])
        other_id = row["black_id"] if mine == row["white_id"] else row["white_id"]
        other = (
            await conn.fetchrow(
                "select id, display_name from chess_participant where id = $1", other_id
            )
            if seated and other_id
            else None
        )
        in_progress = row["current_game_id"] is not None
        color = "white" if mine == row["white_id"] else "black"
        turn_color = "white" if board.turn else "black"
        tiles.append(
            {
                "id": str(row["id"]),
                "invite_id": row["invite_id"],
                "title": "Chess",
                "opponent": None
                if other is None
                else {"id": str(other["id"]), "name": other["display_name"]},
                "status": "in_progress" if in_progress else "waiting",
                "turn": ("you" if turn_color == color else "opponent")
                if in_progress and seated
                else "none",
                "fen": board.fen(),
            }
        )
    return tiles


@dataclass(frozen=True)
class Connected:
    """A connected participant of a live session, as the hubs report it."""

    participant_id: Any
    name: str


async def build_home(
    conn: asyncpg.Connection, user: User, live: dict[Any, list[Connected]]
) -> dict[str, Any]:
    """The snapshot for an account. `live` maps a session id to its connected participants
    (sessions with none are absent)."""
    rows = await conn.fetch(_VISIBLE, user.sub, None)
    visible_live = [r for r in rows if live.get(r["id"])]
    idle = [r for r in rows if not live.get(r["id"])]
    visible_live.sort(key=lambda r: (r["last_activity_at"], r["invite_id"]), reverse=True)
    idle.sort(key=lambda r: (r["last_activity_at"], r["invite_id"]), reverse=True)

    connected_ids = [c.participant_id for r in visible_live for c in live[r["id"]]]
    people = (
        {
            f["id"]: f["account_sub"] or str(f["id"])
            for f in await conn.fetch(_PEOPLE, connected_ids)
        }
        if connected_ids
        else {}
    )
    distinct = {people.get(pid, str(pid)) for pid in connected_ids}

    with_code = {
        r["id"]
        for r in visible_live
        if r["kind"] == "coding" and await preview.has_code(conn, r["id"])
    }

    return {
        "user": {"first_name": None, "display_name": None, "username": user.name},
        "live_participant_count": len(distinct),
        "sessions": [_tile(r, live[r["id"]], r["id"] in with_code) for r in visible_live]
        + [_tile(r, None) for r in idle[:IDLE_CAP]],
        "idle_total": len(idle),
        "games": await _games(conn, user.sub),
    }


def _tile(
    row: asyncpg.Record, connected: list[Connected] | None, has_preview: bool = False
) -> dict[str, Any]:
    last: datetime = row["last_activity_at"]
    return {
        "id": str(row["id"]),
        "invite_id": row["invite_id"],
        "kind": row["kind"],
        "title": row["title"],
        "host": {"id": str(row["host_id"]), "name": row["host_name"]},
        "live": connected is not None,
        "participant_count": len(connected) if connected else 0,
        "participants": [
            {"id": str(c.participant_id), "name": c.name, "avatar_url": None}
            for c in (connected or [])[:AVATAR_CAP]
        ],
        "last_active_at": None if connected else last.isoformat(),
        "has_preview": has_preview,
    }


@dataclass(frozen=True)
class Guest:
    """An anonymous guest or chess invitee: no account, identified by the rejoin token the
    server issued for the one session or game they joined (the token is never stored, only
    its SHA-256, as the sockets check it)."""

    participant_id: Any
    name: str


_GUEST = """
select id, display_name from presentation_participant
 where rejoin_token_hash = $1 and hidden_at is null
union all
select id, display_name from chess_participant
 where rejoin_token_hash = $1 and hidden_at is null
"""


async def resolve_guest(conn: asyncpg.Connection, token: str) -> Guest | None:
    row = await conn.fetchrow(_GUEST, hashlib.sha256(token.encode()).hexdigest())
    return None if row is None else Guest(row["id"], row["display_name"])


async def build_guest_home(
    conn: asyncpg.Connection, guest: Guest, live: dict[Any, list[Connected]]
) -> dict[str, Any]:
    """FR-11: only the session or game this guest joined; no count, no idle list."""
    rows = await conn.fetch(_VISIBLE, None, guest.participant_id)
    return {
        "user": {"first_name": None, "display_name": None, "username": guest.name},
        "live_participant_count": None,
        "sessions": [_tile(r, live.get(r["id"]) or None) for r in rows],
        "idle_total": 0,
        "games": await _games(conn, None, guest.participant_id),
    }
