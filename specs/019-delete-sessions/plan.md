# 019 — Delete sessions from the profile: plan

Spec: `spec.md` (approved, no open questions). HOW only.

## Architecture

```
frontend ProfileSessions ──DELETE /api/me/sessions/{kind}/{invite}──▶ accounts.api
                                                                         │
                                                         deletion.service.delete_session
                                                          │ authorise (host or admin)
                                                          │ purge rows + write tombstone   (one transaction)
                                                          ▼ after commit: close live hub
            sessions.ws / learn.ws / present.ws / games.chess.ws  ──▶ "session_deleted", close 4411
each kind's REST + WS invite lookup ── tombstone? ──▶ 410 session_deleted / close 4411
```

New package `backend/app/deletion/`:

| Module | Role |
|---|---|
| `deletion/repo.py` | Tombstone table access; `host_sub(conn, kind, invite)`; one `purge_<kind>(conn, session_id)` per kind, deleting every row of the session in foreign-key order. |
| `deletion/service.py` | `delete_session(conn, app, user, kind, invite)`: lock, authorise, purge, tombstone, commit, then close the live hub. |

Touched modules:

| Module | Change | Spec |
|---|---|---|
| `migrations/0011_session_host_and_deletion.sql` | `started_by_sub` on `session`, `learning_session`, `chess_session`; `deleted_session` tombstone table | FR-0, FR-8 |
| `sessions/api.py`, `learn/api.py`, `games/chess/api.py` (start endpoints) | Record `current_user(request).sub` (or null) as `started_by_sub` | FR-0 |
| `accounts/repo.py` | `_RECENT_SESSIONS` computes `hosted_by_me` for every kind from the host rule; adds `can_delete` | FR-0–FR-3 |
| `accounts/api.py` | `DELETE /api/me/sessions/{kind}/{invite}`; `can_delete` in the list response | FR-1–FR-3, FR-12 |
| `sessions/ws.py`, `learn/ws.py`, `present/ws.py` | `close_deleted(session_id, by)`: broadcast, close sockets 4411, drop the hub. Invite lookups answer a tombstoned invite with close 4411 (WS) | FR-7, FR-8 |
| `sessions/api.py`, `learn/api.py`, `present/api.py` (GET session by invite) | A tombstoned invite answers `410 {"error": "session_deleted"}` | FR-8 |
| `games/chess/repo.py` | `is_deleted_invite` also true for a tombstoned chess invite | FR-8, FR-14 |
| `frontend/src/api/client.ts`, `api/types.ts` | `deleteMySession(kind, invite)`; `RecentSession.can_delete`; `ApiError` kind `session_deleted` | FR-1, FR-11 |
| `frontend/src/pages/ProfileSessions.tsx` (+ css) | Delete button (`danger`, xs), confirmation `Dialog`, polite status line, error handling | FR-1–FR-5, FR-10, FR-11 |
| `frontend/src/pages/SessionWindow.tsx`, `learn/LearningSessionWindow.tsx`, `present/PresentSessionWindow.tsx` | New page state `deleted` from the 410 and from close 4411 / `session_deleted`: "This session was deleted" with a link home | FR-7, FR-8 |

Dependency direction: `accounts.api → deletion.service → deletion.repo` and `→ <kind>.ws.close_deleted`. No kind module imports `deletion`, except that each kind's invite lookup calls `deletion.repo.is_tombstoned` (a leaf with no imports from the kinds).

Chess (FR-14): reuse `games.chess.ws.close_session` with `Closed(result=None, reason="starter" | "admin")`. The players get the existing `session_closed` message, close code 4411 and deleted page, unchanged. The rows are then purged as for the other kinds, instead of chess's soft delete. Chess's own in-game deletions (resignation, abandonment, starter, admin REST) keep their soft-delete behaviour. Only the profile path purges.

The home screen needs no change. It is built from the session tables and polled every 5 s (spec 017), so a purged session's tile drops out on the next poll (FR-9). The profile list is built from the same tables, and Jump to anything reads those lists.

Presentation drawings and pointer state live only in the hub's memory and go when the hub is dropped. Learning terminals hold no per-session server state to clean up.

## Data model

Migration `0011_session_host_and_deletion.sql`:

```sql
alter table session          add column started_by_sub text null;
alter table learning_session add column started_by_sub text null;
alter table chess_session    add column started_by_sub text null;

-- FR-8: a deleted session leaves only this. Everything else of it is gone (FR-6).
create table deleted_session (
    kind           text not null check (kind in ('coding', 'learning', 'presentation', 'chess')),
    invite_id      text not null,
    deleted_at     timestamptz not null default now(),
    deleted_by     text not null check (deleted_by in ('host', 'admin')),
    primary key (kind, invite_id)
);
```

The tombstone keeps no account id, title or count (NFR privacy). `deleted_by` only picks the wording of the message.

**Host rule (FR-0)**, one SQL expression per kind, used by `host_sub` and by the profile list:

- coding: `coalesce(s.started_by_sub, first signed-in participant's account_sub by joined_at, id)`
- learning: the same over `learning_participant`
- chess: `coalesce(cs.started_by_sub, account_sub of cs.starter_participant_id, first signed-in chess_participant)`
- presentation: `account_sub` of `ps.host_participant_id` (today's rule)

A null result means no host: only admins may delete.

**Purge order (FR-6)**, per kind, inside the transaction. Every statement filters by `session_id` (or by the session's run, game or participant ids):

- coding: `run_result` → `run` → `chat_message` → `yjs_update` → `session_event` → `session_scratch_run` → `session_problem` → `participant` → `session`
- learning: `learning_attempt` → `learning_chat_message` → `learning_step` → `learning_participant` → `learning_session`
- presentation: null `presentation_session.host_participant_id` → `presentation_chat_message` → `presentation_participant` → `presentation_session`
- chess: null `chess_session` participant and game references → `chess_move` → `chess_game` → `chess_chat_message` → `chess_participant` → `chess_session`

Problems, lessons, presentations and their versions are shared catalogue rows and are never touched.

## Contracts

**`GET /api/me/sessions`**: each item gains `can_delete: boolean`. It is true when the caller is the session's host or has the `admin` role. `hosted_by_me` now follows FR-0 for every kind.

**`DELETE /api/me/sessions/{kind}/{invite}`** (signed-in account required; a guest gets 401):

| Outcome | Status | Body |
|---|---|---|
| Deleted | 204 | — |
| Unknown kind, unknown invite, or a session not in the caller's list (non-admin) | 404 | `{"error": "not_found"}` |
| Already deleted (tombstoned) | 410 | `{"error": "session_deleted"}` |
| In the caller's list, but the caller is neither host nor admin | 403 | `{"error": "not_host"}` |

```python
# deletion/service.py
class Refused(Exception):  # .code in {"not_found", "session_deleted", "not_host"}
    ...

async def delete_session(
    conn: asyncpg.Connection, app: FastAPI, user: User, kind: str, invite_id: str
) -> None:
    """Locks the session row (for update), authorises (host_sub == user.sub or admin), purges
    it and writes the tombstone in one transaction; after commit closes its live hub."""

# deletion/repo.py
async def host_sub(conn, kind: str, session_id: uuid.UUID) -> str | None: ...
async def purge(conn, kind: str, session_id: uuid.UUID) -> None: ...
async def tombstone(conn, kind: str, invite_id: str, deleted_by: Literal["host", "admin"]) -> None: ...
async def is_tombstoned(conn, kind: str, invite_id: str) -> bool: ...

# sessions/ws.py, learn/ws.py, present/ws.py
async def close_deleted(session_id: uuid.UUID, by: Literal["host", "admin"]) -> None:
    """Broadcast {"type": "session_deleted", "by": by}, close every socket 4411, drop the hub."""
CLOSE_DELETED = 4411  # same code chess uses
```

Within one session's lock, deletion is serialised with that kind's other writes: they lock the same row, or fail once it's gone. A concurrent second delete finds the tombstone and gets 410 (FR-11).

**Frontend**

```ts
export const deleteMySession = (kind: RecentSession["kind"], invite: string) =>
  request<void>("DELETE", `/me/sessions/${enc(kind)}/${enc(invite)}`);
// RecentSession gains `can_delete: boolean`
```

ProfileSessions:
- A row with `can_delete` gets `<Button variant="danger" size="xs" label={`Delete ${title}`}>Delete</Button>` after Hide.
- It opens `ui/Dialog`: title "Delete <title>?", text "This deletes the session for everyone. It can't be undone.", and the actions Cancel and Delete (`danger`). Escape and Cancel close it and return focus to the row's Delete button.
- On 204 the row is removed and an `aria-live="polite"` status says "Deleted <title>". On 410 the row is removed and the status says "<title> was already deleted". Any other error leaves the row and shows the existing `InlineMessage`.

Session windows: a 410 `session_deleted` from the GET, or socket close 4411 / a `session_deleted` message, sets the page state `deleted`. It renders an `EmptyState` ("This session was deleted", "The host deleted it." or "An admin deleted it.") with a link home.

## Test strategy

Backend tests are integration tests against the real Postgres (constitution rule 4). Frontend tests are component tests with role and name queries. E2E uses the real stack.

| AC | Test |
|---|---|
| AC-0 | Integration `test_session_host.py`: a signed-in start of coding, learning and chess records `started_by_sub`; `/api/me/sessions` shows `hosted_by_me` for the starter only. A pre-existing row with null `started_by_sub` falls back to the first signed-in participant. A guest-started session has no host. |
| AC-1, AC-2, AC-3 | Integration: `can_delete` per role and kind. Component `ProfileSessions.test.tsx`: Delete is shown only when `can_delete`, named "Delete <title>". |
| AC-4 | Component: the dialog's text, Cancel and Escape send no request, focus returns. E2E `profile-delete.spec.ts`: after cancelling, the invite link still opens. |
| AC-5 | Integration `test_delete_session.py`, per kind: after DELETE every row in the purge list for that session is gone (counted per table), the tombstone exists, and shared catalogue rows are untouched. Component: row removed, polite status text. |
| AC-6 | Integration per kind: two WS clients connected; after DELETE both receive `session_deleted` (chess: `session_closed`) and close 4411 within 2 s. E2E: a presentation with a second browser context shows the deleted page. |
| AC-7 | Integration: the GET by invite answers 410 for each kind, and a WS connect closes 4411. Component per session window: a 410 renders the deleted state with a home link. |
| AC-8 | Integration: a second account's `/api/me/sessions` and `/api/home` no longer contain the session. |
| AC-9 | Integration: a second DELETE answers 410. Component: 410 removes the row with "already deleted"; 500 keeps it and shows the error. |
| AC-10 | Integration: a non-host participant gets 403 and nothing is purged; an anonymous client gets 401; a non-participant non-admin gets 404. |
| AC-11 | The existing hide tests stay green; a new integration test checks that hide still leaves the session for others. |
| AC-12 | Integration: deleting a chess session via the profile gives both players `session_closed` with reason `starter` (host) or `admin`, close 4411, and REST 410. |

Look matrix (constitution-ui 20): add a "profile with delete dialog" screen to `e2e/audi/matrix.ts`.

## Constitution compliance

| Rule | How |
|---|---|
| 1 Test-first | Each task writes the AC tests above first and shows them failing. |
| 2 Green before done | Per-task `scripts/check.sh` on the kept stack; `--full` once all tasks are done. |
| 3 Traceable tests | The AC → test table above; tasks will name their ACs. |
| 4 Real dependencies | Real Postgres, real WebSockets; no mocks. |
| 5 Fixed stack | FastAPI, Postgres, React/TS, Vite; nothing new. |
| 6 Dependencies | None added. |
| 7 No secrets | None involved. |
| 8 Lint clean | ruff, biome, tsc per task. |
| 9 Layout | Stated above (new `deletion` package, dependency direction). |
| 10 UI rules | Tokens only; `danger` Button; `Dialog`, `EmptyState` and `InlineMessage` primitives; keyboard and focus return; polite announcement; narrow and dark covered by the look matrix entry. No home tile change; the existing 5 s poll handles FR-9. |

**Conflict to resolve at this gate:** earlier specs state "nothing is ever deleted": spec 001 NFR-9 (coding), the "no cascades, nothing dropped" notes in migrations 0007/0008, and chess's soft delete. Spec 019 FR-6 (deletion is permanent, everything goes) deliberately overrides that for sessions deleted from the profile. The plan keeps those rules everywhere else: stale marking, chess's own deletions and hide still delete nothing. **Approving this plan accepts that override.** `/sdd-validate` should note it in spec 001's `notes.md`.
