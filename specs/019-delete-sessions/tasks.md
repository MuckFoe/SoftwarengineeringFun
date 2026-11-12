# 019 — Delete sessions from the profile: tasks

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3 — all `[P]` | The migration, the per-kind close hooks and the frontend API types depend on nothing. |
| 2 | 4, 5, 6, 7, 8 — all `[P]` | 4–6 need the migration's columns and tombstone table (1). 7–8 need the frontend types (3). No two touch the same file. |
| 3 | 9, 10, 11, 12 — all `[P]` | 9 joins authorisation (5), purge (6) and close hooks (2). 10–12 need `is_tombstoned` (6). Disjoint files. |
| 4 | 13 | E2E and the look matrix run against the whole feature. |
| 4 | 14 — `[P]` with 13 | Follow-up found while implementing 9 (added 2026-11-12 at the human's request). Disjoint from 13's files. |

## Checklist

- [x] **1** — `[P]` Migration: starter column and deleted-session tombstone
- [x] **2** — `[P]` Close hooks: tell and disconnect a deleted coding, learning or presentation session
- [x] **3** — `[P]` Frontend API: deleteMySession, can_delete, session_deleted error
- [x] **4** — `[P]` Record who started a coding, learning or chess session
- [x] **5** — `[P]` Host rule and can_delete in the profile sessions list
- [x] **6** — `[P]` Deletion repo: host, purge per kind, tombstone
- [x] **7** — `[P]` Profile: Delete button, confirmation and announcement
- [x] **8** — `[P]` Session windows: the deleted state
- [x] **9** — `[P]` Deletion service and DELETE /api/me/sessions/{kind}/{invite}
- [x] **10** — `[P]` REST: a deleted invite answers 410 session_deleted
- [x] **11** — `[P]` WebSocket: a deleted invite closes 4411
- [x] **12** — `[P]` Chess: a tombstoned invite counts as deleted
- [x] **13** — End to end: delete from the profile, and the look matrix
- [x] **14** — Cancel in-flight coding and scratch runs when a session is deleted

## Tasks

### 1. `[P]` Migration: starter column and deleted-session tombstone

- **Plan:** Data model (migration `0011_session_host_and_deletion.sql`). **Spec:** FR-0, FR-8.
- **Files:** `backend/app/migrations/0011_session_host_and_deletion.sql`, `backend/tests/integration/test_migration_0011.py`
- **Depends on:** nothing
- **Do:** Add `started_by_sub text null` to `session`, `learning_session` and `chess_session`. Create `deleted_session (kind, invite_id, deleted_at, deleted_by)`, primary key `(kind, invite_id)`, with the `kind` and `deleted_by` checks exactly as in plan.md.
- **Acceptance:**
  - *FR-0, FR-8:* after migrating, the three columns exist and are nullable. `deleted_session` accepts `('coding', 'x', 'host')`, rejects an unknown kind or `deleted_by`, and rejects a duplicate `(kind, invite_id)`.

### 2. `[P]` Close hooks: tell and disconnect a deleted coding, learning or presentation session

- **Plan:** Architecture (`close_deleted` in each kind's ws module), Contracts. **Spec:** FR-7.
- **Files:** `backend/app/sessions/ws.py`, `backend/app/learn/ws.py`, `backend/app/present/ws.py` (tests in `backend/tests/unit/test_close_deleted.py`)
- **Depends on:** nothing
- **Do:** Add `CLOSE_DELETED = 4411` and `async def close_deleted(session_id, by)` to each module. It broadcasts `{"type": "session_deleted", "by": by}` to every connection of the hub, closes each socket with 4411, and drops the hub (and, for presentations, cancels its timers). With no hub it is a no-op.
- **Acceptance:**
  - *AC-6 (hook part): Given a hub with two connected sockets, When `close_deleted(id, "host")` runs, Then both receive `session_deleted` with `by: "host"`, both are closed with 4411, and the hub is gone.* Checked for each of the three kinds. A call with no hub raises nothing.

### 3. `[P]` Frontend API: deleteMySession, can_delete, session_deleted error

- **Plan:** Contracts → Frontend. **Spec:** FR-1, FR-11.
- **Files:** `frontend/src/api/client.ts`, `frontend/src/api/types.ts`, `frontend/src/api/client.test.ts`
- **Depends on:** nothing
- **Do:** Add `can_delete: boolean` to `RecentSession`. Add `deleteMySession(kind, invite)` (DELETE `/me/sessions/{kind}/{invite}`). Map a 410 `{"error": "session_deleted"}` to an `ApiError` of kind `session_deleted`, and a 403 `not_host` to kind `not_host`.
- **Acceptance:**
  - *FR-1:* `deleteMySession("coding", "a b")` sends DELETE to `/api/me/sessions/coding/a%20b`.
  - *FR-11:* a 410 `session_deleted` response rejects with `ApiError` kind `session_deleted`; a 403 `not_host` rejects with kind `not_host`.

### 4. `[P]` Record who started a coding, learning or chess session

- **Plan:** Touched modules (start endpoints record `started_by_sub`). **Spec:** FR-0.
- **Files:** `backend/app/sessions/api.py`, `backend/app/learn/api.py`, `backend/app/games/chess/api.py` (tests in `backend/tests/integration/test_session_host.py`)
- **Depends on:** 1
- **Do:** Each start endpoint stores `current_user(request).sub` as `started_by_sub`, or null when signed out.
- **Acceptance:**
  - *AC-0 (start part): Given a signed-in user who starts a coding, a learning and a chess session, Then each session row's `started_by_sub` is their account. Given a signed-out start, Then it is null.*

### 5. `[P]` Host rule and can_delete in the profile sessions list

- **Plan:** Data model (host rule), Contracts (`GET /api/me/sessions` gains `can_delete`). **Spec:** FR-0, FR-1, FR-2, FR-3.
- **Files:** `backend/app/accounts/repo.py`, `backend/app/accounts/api.py` (tests in `backend/tests/integration/test_session_host.py`)
- **Depends on:** 1
- **Do:** In `_RECENT_SESSIONS`, compute each kind's host account by the plan's host rule: `started_by_sub`, else the chess starter's account, else the first signed-in participant; presentations keep their current host. Set `hosted_by_me` from it. Return `can_delete = hosted_by_me or the caller is admin`.
- **Acceptance:**
  - *AC-0: Given a signed-in user who starts a coding, a learning and a chess session, and another signed-in user who joins each, When each opens their profile, Then the starter sees "Hosted by you" on all three and the joiner sees it on none; And Given a coding session created before this feature whose first signed-in participant was user A, Then A's profile marks it "Hosted by you".* The test inserts rows with `started_by_sub` null for the second case. A session with no signed-in participant has no host.
  - *AC-1: Given … a coding, a learning, a presentation and a chess session they host, Then each row has `can_delete: true`.*
  - *AC-2: Given a signed-in admin whose list has a session someone else hosts, Then `can_delete: true`.*
  - *AC-3: Given a non-admin who joined but does not host, Then `can_delete: false`.*

### 6. `[P]` Deletion repo: host, purge per kind, tombstone

- **Plan:** Architecture (`deletion/repo.py`), Data model (purge order, tombstone). **Spec:** FR-6, FR-8.
- **Files:** `backend/app/deletion/__init__.py`, `backend/app/deletion/repo.py`, `backend/tests/integration/test_deletion_repo.py`
- **Depends on:** 1
- **Do:** Implement `host_sub`, `purge`, `tombstone` and `is_tombstoned` as in Contracts, with the per-kind purge order from Data model. Table names come from a fixed map, never from input.
- **Acceptance:**
  - *AC-5 (data part): Given a session of each kind with content in every table of its purge list (code, runs and results, events, scratch run, chat; steps and attempts; participants and chat; games, moves and chat), When `purge` runs, Then every row of that session is gone from every table in the list, and another session's rows and the shared problem, lesson and presentation rows are untouched.*
  - *FR-8:* after `tombstone(conn, "coding", "x", "host")`, `is_tombstoned(conn, "coding", "x")` is true and `is_tombstoned(conn, "learning", "x")` is false.
  - *FR-0:* `host_sub` follows the same host rule as task 5, for each kind.

### 7. `[P]` Profile: Delete button, confirmation and announcement

- **Plan:** Contracts → Frontend (ProfileSessions). **Spec:** FR-1, FR-3, FR-4, FR-5, FR-10, FR-11.
- **Files:** `frontend/src/pages/ProfileSessions.tsx`, `frontend/src/pages/ProfileSessions.module.css`, `frontend/src/pages/ProfileSessions.test.tsx`
- **Depends on:** 3
- **Do:** For rows with `can_delete`, add a `danger` xs Button named "Delete <title>" after Hide. It opens the `ui/Dialog` confirmation with the plan's wording; Cancel, Escape and Delete behave as the plan's Contracts describe. Add an `aria-live="polite"` status line.
- **Acceptance:**
  - *AC-1/AC-3 (UI): a row with `can_delete` shows a button named "Delete <title>"; a row without shows none.*
  - *AC-4: When the user activates Delete, Then a confirmation names the session and says it is deleted for everyone and cannot be undone; And When they cancel (button or Escape), Then no request is sent, the row is still listed, and focus is back on the Delete action.*
  - *AC-5 (UI): When they confirm and the server answers 204, Then the row leaves the list and the status says "Deleted <title>".*
  - *AC-9 (UI): a 410 removes the row and the status says "<title> was already deleted"; a 500 keeps the row and shows the error message.*

### 8. `[P]` Session windows: the deleted state

- **Plan:** Contracts → Session windows. **Spec:** FR-7, FR-8.
- **Files:** `frontend/src/pages/SessionWindow.tsx`, `frontend/src/learn/LearningSessionWindow.tsx`, `frontend/src/present/PresentSessionWindow.tsx` (their existing `*.test.tsx`)
- **Depends on:** 3
- **Do:** Add page state `deleted`, entered from an `ApiError` of kind `session_deleted` on load, or from a socket close 4411 / a `session_deleted` message. It renders `EmptyState` "This session was deleted" ("The host deleted it." / "An admin deleted it.") with a link home.
- **Acceptance:**
  - *AC-7 (UI): Given the session GET answers 410 session_deleted, Then the window shows "This session was deleted" and a link to the home screen.* Checked for each of the three windows.
  - *AC-6 (UI): Given a connected window, When the socket receives `session_deleted` with `by: "host"` and closes 4411, Then it shows the deleted state with "The host deleted it."*

### 9. `[P]` Deletion service and DELETE /api/me/sessions/{kind}/{invite}

- **Plan:** Architecture (`deletion/service.py`, `accounts.api`), Contracts (DELETE table). **Spec:** FR-2, FR-6, FR-7, FR-9, FR-11, FR-12, FR-14.
- **Files:** `backend/app/deletion/service.py`, `backend/app/accounts/api.py`, `backend/tests/integration/test_delete_session.py`
- **Depends on:** 2, 5, 6
- **Do:** `delete_session` locks the session row, authorises (host or admin; non-admins only for sessions in their list), and purges and tombstones in one transaction. After commit it calls the kind's close hook: `close_deleted`, or for chess `close_session(Closed(None, "starter" | "admin"))`. Route the DELETE endpoint with the status and error table from plan.md.
- **Acceptance:**
  - *AC-5: Given a hosted coding session with code and chat messages, When the host confirms deletion, Then … neither its code nor its chat can be retrieved by anyone afterwards.* (204; rows gone; tombstone written)
  - *AC-6: Given a hosted presentation session with a second participant connected, When the host deletes it, Then within 2 seconds the participant receives `session_deleted` and the connection closes 4411.* The same for coding and learning.
  - *AC-8: Given a session in another participant's list and home screen, When the host deletes it, Then that participant's `/api/me/sessions` and `/api/home` no longer contain it.*
  - *AC-9: a second DELETE of the same session answers 410 `session_deleted`.*
  - *AC-10: Given a signed-in non-admin who joined but does not host, and an anonymous guest, When either sends DELETE, Then 403 `not_host` and 401 respectively, and the session is unchanged; a non-participant non-admin gets 404.*
  - *AC-2 (server): an admin deleting a session someone else hosts gets 204, and the tombstone says `admin`.*
  - *AC-12: Given a chess game with both players connected, When its host deletes it from the profile, Then both receive `session_closed` with reason `starter` (admin: `admin`) and close 4411.*
  - *AC-11: Hide still removes the session only from the caller's list; another participant still sees it.*

### 10. `[P]` REST: a deleted invite answers 410 session_deleted

- **Plan:** Touched modules (GET session by invite). **Spec:** FR-8.
- **Files:** `backend/app/sessions/api.py`, `backend/app/learn/api.py`, `backend/app/present/api.py` (tests in `backend/tests/integration/test_deleted_invite.py`)
- **Depends on:** 6
- **Do:** Where each kind's invite lookup finds no session, check `is_tombstoned`. If it is tombstoned, answer `410 {"error": "session_deleted", "by": …}`; otherwise answer 404 as today.
- **Acceptance:**
  - *AC-7 (REST): Given a deleted session, When anyone (signed in, guest or invitee) requests it by invite, Then 410 session_deleted*, for coding, learning and presentation. An invite that never existed still gets 404.

### 11. `[P]` WebSocket: a deleted invite closes 4411

- **Plan:** Touched modules (WS invite lookups). **Spec:** FR-8.
- **Files:** `backend/app/sessions/ws.py`, `backend/app/learn/ws.py`, `backend/app/present/ws.py` (tests in `backend/tests/integration/test_deleted_invite.py`)
- **Depends on:** 6
- **Do:** Where each WebSocket's invite lookup finds no session, close with 4411 if it is tombstoned, else 4404 as today.
- **Acceptance:**
  - *AC-7 (WS): connecting to a deleted invite closes 4411; to a never-existing invite, 4404.* Checked per kind.

### 12. `[P]` Chess: a tombstoned invite counts as deleted

- **Plan:** Touched modules (`games/chess/repo.py`). **Spec:** FR-8, FR-14.
- **Files:** `backend/app/games/chess/repo.py`, `backend/tests/integration/test_deleted_invite.py`
- **Depends on:** 6
- **Do:** `is_deleted_invite` is also true when the chess invite is tombstoned. Chess's existing 410 and 4411 paths then cover purged games.
- **Acceptance:**
  - *AC-12 (link part): after a profile deletion purges a chess game, the REST check answers 410 and a socket connect closes 4411, as for a soft-deleted game.*

### 13. End to end: delete from the profile, and the look matrix

- **Plan:** Test strategy (E2E `profile-delete.spec.ts`, look matrix). **Spec:** FR-1, FR-4, FR-7, FR-8.
- **Files:** `e2e/profile-delete.spec.ts`, `e2e/audi/matrix.ts`
- **Depends on:** 4, 7, 8, 9, 10, 11, 12
- **Do:** Write the browser flow and add a "profile with delete dialog" screen to the look matrix (light and dark, narrow).
- **Acceptance:**
  - *AC-4 (E2E): cancelling the confirmation leaves the session's invite link working.*
  - *AC-6 (E2E): a presentation host deletes from the profile while a second browser context is in the session; within 2 s that context shows "This session was deleted".*
  - *AC-7 (E2E): reopening the invite link shows the deleted page with a link home.*
  - Keyboard only: Tab to Delete, Enter opens the dialog, Escape cancels, and focus returns to Delete.

### 14. `[P]` Cancel in-flight coding and scratch runs when a session is deleted

- **Plan:** Architecture (`deletion/service.py` after-commit close hooks). **Spec:** FR-6, FR-7.
- **Files:** `backend/app/sessions/ws.py`, `backend/app/scratch/manager.py`, `backend/app/deletion/service.py` (tests in `backend/tests/unit/test_cancel_runs_on_delete.py`)
- **Depends on:** 2, 9
- **Do:** Track each session's graded-run task so it can be cancelled. On deletion of a coding session, after commit, cancel its graded run (and drop its `_RUNNING` entry) and its scratch run (`RunManager` drops its `_live` entry without a final save or broadcast). Neither may write to the database or recreate a hub afterwards.
- **Acceptance:**
  - *FR-6: Given a coding session with a graded run in flight, When it is deleted, Then the run task is cancelled, the session is no longer in `_RUNNING`, and nothing is written for it afterwards.*
  - *FR-6: Given a coding session with a scratch run in flight, When it is deleted, Then `RunManager` holds nothing for it, no final save happens, and no hub exists for it afterwards.*
  - Cancelling for a session with no run in flight is a no-op.
