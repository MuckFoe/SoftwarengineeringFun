"""Account reads and writes (spec 012 plan.md "Python signatures"): the recent-sessions
list across the four session kinds, hiding a session, and account preferences. FR-2, FR-4,
FR-12, FR-13, FR-15, FR-16, NFR-1, NFR-4. Spec 019: the host rule and `can_delete` (FR-0–FR-3).

Every query is keyed by the caller's `account_sub` and driven by each participant table's
`(account_sub, session_id)` index.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import asyncpg

Kind = Literal["coding", "learning", "presentation", "chess"]
Appearance = Literal["light", "dark", "system"]


@dataclass(frozen=True)
class RecentSession:
    kind: Kind
    invite_id: str
    title: str
    last_activity_at: datetime
    stale: bool
    hosted_by_me: bool
    can_delete: bool


# Spec 019 FR-0, the host rule: each kind's host account, an expression over its session row.
# Coding, learning: the recorded starter, else the first signed-in participant to join.
# Chess: the recorded starter, else the starter participant's account, else the first signed-in
# participant. Presentation: the presenter (`host_participant_id`). Null: no host.
HOST_SUB: dict[str, str] = {
    "coding": """coalesce(s.started_by_sub,
                 (select fp.account_sub from participant fp
                   where fp.session_id = s.id and fp.account_sub is not null
                   order by fp.joined_at, fp.id limit 1))""",
    "learning": """coalesce(ls.started_by_sub,
                   (select fp.account_sub from learning_participant fp
                     where fp.session_id = ls.id and fp.account_sub is not null
                     order by fp.joined_at, fp.id limit 1))""",
    "presentation": """(select hp.account_sub from presentation_participant hp
                         where hp.id = ps.host_participant_id)""",
    "chess": """coalesce(cs.started_by_sub,
                (select sp.account_sub from chess_participant sp
                  where sp.id = cs.starter_participant_id),
                (select fp.account_sub from chess_participant fp
                  where fp.session_id = cs.id and fp.account_sub is not null
                  order by fp.joined_at, fp.id limit 1))""",
}

# Titles: coding — the current problem's (deleted problems keep theirs); learning — the
# session's lesson version; presentation — the presentation of the session's version.
# Stale is each kind's `stale_at` rule. Hidden participants are left out (FR-13).
# `hosted_by_me`: the kind's HOST_SUB is the caller (spec 019 FR-0).
_RECENT_SESSIONS = f"""
select 'coding' as kind, s.invite_id, pr.title, s.last_activity_at,
       s.stale_at is not null as stale, coalesce({HOST_SUB["coding"]} = $1, false) as hosted_by_me
  from participant p
  join session s on s.id = p.session_id
  join problem pr on pr.id = s.current_problem_id
 where p.account_sub = $1 and p.hidden_at is null
union all
select 'learning', ls.invite_id, lv.content->>'title', ls.last_activity_at,
       ls.stale_at is not null, coalesce({HOST_SUB["learning"]} = $1, false)
  from learning_participant p
  join learning_session ls on ls.id = p.session_id
  join lesson_version lv on lv.id = ls.lesson_version_id
 where p.account_sub = $1 and p.hidden_at is null
union all
select 'presentation', ps.invite_id, pres.title, ps.last_activity_at,
       ps.stale_at is not null, coalesce(ps.host_participant_id = p.id, false)
  from presentation_participant p
  join presentation_session ps on ps.id = p.session_id
  join presentation_version pv on pv.id = ps.version_id
  join presentation pres on pres.id = pv.presentation_id
 where p.account_sub = $1 and p.hidden_at is null
union all
select 'chess', cs.invite_id, 'Chess', cs.last_activity_at,
       cs.stale_at is not null, coalesce({HOST_SUB["chess"]} = $1, false)
  from chess_participant p
  join chess_session cs on cs.id = p.session_id
 where p.account_sub = $1 and p.hidden_at is null and cs.deleted_at is null
order by last_activity_at desc, invite_id
"""  # noqa: S608  (HOST_SUB is fixed SQL, not input)


async def recent_sessions(
    conn: asyncpg.Connection, account_sub: str, *, is_admin: bool = False
) -> list[RecentSession]:
    """Every non-hidden session the account has a participant in, most recent first. Spec 019
    FR-1–FR-3: `can_delete` is true for the session's host, and for every row of an admin."""
    rows = await conn.fetch(_RECENT_SESSIONS, account_sub)
    return [RecentSession(**dict(row), can_delete=is_admin or row["hosted_by_me"]) for row in rows]


# Each kind's (participant table, session table). Fixed names, never caller input.
_TABLES: dict[str, tuple[str, str]] = {
    "coding": ("participant", "session"),
    "learning": ("learning_participant", "learning_session"),
    "presentation": ("presentation_participant", "presentation_session"),
    "chess": ("chess_participant", "chess_session"),
}


async def hide(conn: asyncpg.Connection, account_sub: str, kind: str, invite_id: str) -> bool:
    """FR-13: hide the session from the account's list. Only the caller's participant row
    changes. False (→ 404) alike for an unknown kind, an unknown session and a session the
    account isn't in (NFR-1). Idempotent."""
    tables = _TABLES.get(kind)
    if tables is None:
        return False
    participant, session = tables
    hidden = await conn.fetchval(
        f"""update {participant} p set hidden_at = now()
              from {session} s
             where s.id = p.session_id and s.invite_id = $2 and p.account_sub = $1
         returning p.id""",  # noqa: S608  (table names from _TABLES, not input)
        account_sub,
        invite_id,
    )
    return hidden is not None


@dataclass(frozen=True)
class Preferences:
    appearance: Appearance
    chat_visible: bool


async def get_preferences(conn: asyncpg.Connection, account_sub: str) -> Preferences | None:
    """FR-15, FR-16: the account's stored preferences, or None before the first write."""
    row = await conn.fetchrow(
        "select appearance, chat_visible from account_preference where account_sub = $1",
        account_sub,
    )
    return None if row is None else Preferences(**dict(row))


async def put_preferences(
    conn: asyncpg.Connection,
    account_sub: str,
    appearance: str | None,
    chat_visible: bool | None,
) -> Preferences:
    """FR-15, FR-16, FR-18: upsert. A missing field keeps its stored value, or on the first
    write takes its default (`system`, `true`)."""
    row = await conn.fetchrow(
        """insert into account_preference (account_sub, appearance, chat_visible)
           values ($1, coalesce($2::text, 'system'), coalesce($3::boolean, true))
           on conflict (account_sub) do update
              set appearance = coalesce($2::text, account_preference.appearance),
                  chat_visible = coalesce($3::boolean, account_preference.chat_visible),
                  updated_at = now()
           returning appearance, chat_visible""",
        account_sub,
        appearance,
        chat_visible,
    )
    return Preferences(**dict(row))
