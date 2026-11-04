# 012 — Profile, recent sessions and no name prompt for signed-in users: tasks

Test users referred to below: `newuser` and `other` (no app role) and an editor, from the test realm (task 4). "Signed-in socket" means a WebSocket opened with the app's session cookie for that user. Every task writes its tests first, from the acceptance lines, then the code (constitution 1). Per-task gate: `scripts/check.sh` (non-slow); `--full` once after wave 6.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6 — all `[P]` | Foundations with no dependencies: schema, identity rule, hub rule, test realm, frontend API types, the mark icon. Each touches its own files. |
| 2 | 7, 8, 9, 10, 16, 17, 18 — all `[P]` | The three join paths need 1–3; the recent-sessions API needs 1 and 4; the frontend preference store, chat pane and profile shell need only 5 (and 6). No two touch the same file. |
| 3 | 11, 12, 13, 14, 19, 20, 21 — all `[P]` | Wire-shape changes (chat, learning record, presentation host) need the account joins from 7–9; hide/preferences extend task 10's module and `main.py` (register, 15, also edits `main.py`, so it waits for wave 4); the three frontend join flows need only 5 but are held here to keep wave 2 at seven agents; 19–21 touch none of wave 3's files. |
| 4 | 15, 22, 23, 24 — all `[P]` | Register touches `main.py` after 11 has; the profile's preferences section needs the shell (18) and the store (16), the sessions table (its own component) needs 18; attribution marks need 6, 13, 14 and edit `PresentSessionWindow.tsx` after 21. |
| 5 | 25, 26, 27, 28 — all `[P]` | End-to-end and slow checks need the whole backend and frontend in place. Separate spec files, so they run side by side. |

## Checklist

- [x] **1** — `[P]` Migration `0007_accounts.sql`
- [x] **2** — `[P]` `accounts/identity.py`: one identity rule for all sockets
- [x] **3** — `[P]` `SessionHub`: one connection per participant, newest wins
- [x] **4** — `[P]` Test realm: `newuser`, `other`, editor, registration allowed
- [x] **5** — `[P]` Frontend API types and client calls
- [x] **6** — `[P]` *Signed in* mark icon and presence list mark
- [x] **7** — `[P]` Coding socket: account join, `4409`, `signed_in` on the wire
- [x] **8** — `[P]` Learning socket: account join, `4409`, `signed_in` on the wire
- [x] **9** — `[P]` Presentation socket: account join, token rotation, join touches activity
- [x] **10** — `[P]` `GET /api/me/sessions`: recent sessions
- [x] **11** — `[P]` Hide, preferences, and `/api/me` with preferences
- [x] **12** — `[P]` Chat messages carry `participant_id` and `signed_in` (all three kinds)
- [x] **13** — `[P]` Learning record attributions carry `signed_in`
- [x] **14** — `[P]` Presentation host carries `signed_in`
- [x] **15** — `[P]` `GET /api/auth/register` with `prompt=create`
- [x] **16** — `[P]` `prefs/accountPrefs.ts` and one preference store
- [x] **17** — `[P]` Chat pane: own messages by `participant_id`, *signed in* mark
- [x] **18** — `[P]` Profile route, signed-out view, account section, toolbar entry
- [x] **19** — `[P]` Coding: no name sheet when signed in, "opened in another tab"
- [x] **20** — `[P]` Learning: no name sheet when signed in, "opened in another tab"
- [x] **21** — `[P]` Presentation: no name sheet when signed in
- [x] **22** — `[P]` Profile: preferences section
- [x] **23** — `[P]` Profile: sessions table with hide
- [x] **24** — `[P]` *Signed in* mark on learning attributions and presentation host label
- [x] **25** — `[P]` e2e: joining as an account
- [x] **26** — `[P]` e2e: profile, sessions list, sign-up
- [x] **27** — `[P]` e2e: preferences across browsers, profile accessibility
- [x] **28** — `[P]` Slow integration: restart durability and 200-session timing

## Tasks

### 1. `[P]` Migration `0007_accounts.sql`

- **Plan:** Data model. **Spec:** FR-1, FR-5, FR-7, FR-13, FR-15, NFR-3.
- **Files:** `backend/app/migrations/0007_accounts.sql` (new), `backend/tests/integration/test_accounts_schema.py` (new)
- **Depends on:** nothing
- **Do:** Add `account_sub` and `hidden_at` to `participant`, `learning_participant`, `presentation_participant`; the three partial unique indexes on `(account_sub, session_id) where account_sub is not null`; the three `hidden_at is null or account_sub is not null` checks; table `account_preference` exactly as in plan.md. No cascades, nothing dropped.
- **Acceptance:**
  - *FR-5/FR-7 — one participant per account per session:* inserting a second row with the same `(account_sub, session_id)` fails, in each of the three tables; two rows with `account_sub = null` in one session succeed (anonymous unchanged, FR-6).
  - *FR-13 — hiding is only for an account's own participant:* setting `hidden_at` on a row with `account_sub = null` fails the check.
  - *FR-15/NFR-3 — preferences kept with the account:* `account_preference` rejects an `appearance` outside `light|dark|system`; one row per `account_sub`.
  - Existing schema tests (`test_schema.py`, `test_learn_schema.py`, `test_present_schema.py`) still pass.

### 2. `[P]` `accounts/identity.py`: one identity rule for all sockets

- **Plan:** Architecture — `accounts/identity.py`. **Spec:** FR-1, FR-6, NFR-2.
- **Files:** `backend/app/accounts/__init__.py` (new), `backend/app/accounts/identity.py` (new), `backend/tests/unit/test_identity.py` (new)
- **Depends on:** nothing
- **Do:** `Identity(account_sub, name)` and `identity_for(session, raw_name)` as in plan.md Contracts. Signed in = the cookie session has a `sub` and an unexpired `exp` (same test as `auth.deps.current_user`): returns the cookie's `sub` and `name`, ignoring `raw_name`. Otherwise the existing 1–30-char name rule on `raw_name` (reuse the current check from the sockets, don't copy it), `None` if invalid.
- **Acceptance:**
  - *FR-1 — Given signed-in `newuser`, when a socket joins, then their participant name is `newuser`:* session `{sub, name: "newuser", exp: future}` with `raw_name=""` → `Identity(sub, "newuser")`.
  - *NFR-2 — the browser cannot set the name:* same session with `raw_name="admin"` → name `newuser`.
  - *FR-6 — not signed in, asked for a name as today:* empty session with `raw_name="Ann"` → `Identity(None, "Ann")`; with `""` or 31 chars → `None`; expired `exp` → treated as signed out.

### 3. `[P]` `SessionHub`: one connection per participant, newest wins

- **Plan:** Changes to existing modules — "One connection per participant, newest wins". **Spec:** FR-5, FR-7.
- **Files:** `backend/app/sessions/hub.py`, `backend/tests/unit/test_session_hub.py` (new)
- **Depends on:** nothing
- **Do:** Give `SessionHub` the `PresentHub` rule: `try_reserve(participant_id=None)` takes no seat when that participant is already connected; `replace(participant_id, websocket)` swaps the socket and returns the old `Connection`; `remove(participant_id, websocket=None)` removes only when `websocket` is the current one. `Connection` gains `signed_in: bool` (default `False`) and presence entries carry it. Callers keep working unchanged until tasks 7–8 use the new arguments.
- **Acceptance:**
  - *FR-7 — Given 4 participants including `newuser` and a limit of 5, when `newuser` rejoins from a second device, then still 4, and a fifth can join:* with 4 connected, `try_reserve(newuser_pid)` succeeds without using a seat; then `try_reserve()` for a new participant still succeeds; at 5 a sixth is refused.
  - *FR-5 — one `newuser` in the list:* after `replace(pid, ws2)` presence has one entry for `pid`; `replace` returns the `ws1` connection; `remove(pid, ws1)` afterwards leaves `ws2` connected.
  - Presence entries are `{id, name, signed_in}`.

### 4. `[P]` Test realm: `newuser`, `other`, editor, registration allowed

- **Plan:** Test strategy (test users, `registrationAllowed`). **Spec:** FR-10, FR-11 (test fixtures for every criterion naming these users).
- **Files:** `backend/tests/keycloak/realm.json`, `backend/tests/integration/keycloak_fixtures.py`, `backend/tests/integration/test_keycloak_fixtures.py`
- **Depends on:** nothing
- **Do:** Add users `newuser` and `other` without app roles and an editor user, if missing, the way existing test users are defined (test-only passwords, no real secrets — constitution 7). Set `registrationAllowed: true`. Add a fixture that yields a signed-in cookie jar for a given test user (reuse the existing sign-in helper if there is one; two jars for the same user must be possible for multi-device tests).
- **Acceptance:**
  - Signing in as `newuser` and `other` yields `/api/me` with `roles: []`; the editor yields `roles: ["editor"]`.
  - Two cookie jars for `newuser` are both signed in at once.
  - The realm's registration endpoint is enabled (realm representation has `registrationAllowed: true`).

### 5. `[P]` Frontend API types and client calls

- **Plan:** Contracts — TypeScript. **Spec:** FR-2, FR-10, FR-13, FR-15.
- **Files:** `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts`
- **Depends on:** nothing
- **Do:** `Preferences`, `Me` with `preferences`, `RecentSession`; `getMySessions()`, `hideMySession(kind, invite)`, `putPreferences(p)`, `registerUrl(next)` (builds `/api/auth/register?next=…&appearance=…` like the existing login URL helper, base path aware). Add `signed_in` to the participant/presence and `welcome.you` types and `participant_id`, `signed_in` to the chat message type.
- **Acceptance:**
  - `getMySessions` GETs `/api/me/sessions` and returns the parsed list; `hideMySession("coding", "abc")` POSTs `/api/me/sessions/coding/abc/hide`; `putPreferences({appearance: "dark"})` PUTs that body to `/api/me/preferences`.
  - `registerUrl("/profile")` → `<base>/api/auth/register?next=%2Fprofile&appearance=<current>`.
  - `tsc` strict passes with the new `Me` union.

### 6. `[P]` *Signed in* mark icon and presence list mark

- **Plan:** Frontend — `PresenceList.tsx` row; mark drawn in-house. **Spec:** FR-8, NFR-2.
- **Files:** `frontend/src/ui/Icon.tsx`, `frontend/src/components/PresenceList.tsx`, `frontend/src/components/PresenceList.test.tsx` (new)
- **Depends on:** nothing
- **Do:** Add a person-with-checkmark glyph to `Icon` (own drawing, no Apple asset, 003), and a small reusable `SignedInMark` (icon + visually hidden "signed in" text) exported for tasks 17 and 24. `PresenceList` shows it beside a participant whose `signed_in` is true.
- **Acceptance:**
  - *FR-8 — Given signed-in `newuser` and anonymous "newuser" in S1, then both are listed and only the signed-in one has the mark:* rendering two entries named `newuser`, one `signed_in: true`, yields exactly one element with accessible name "signed in", next to that entry.
  - The mark meets the icon contrast tests in light and dark (existing `Icon.test.tsx` pattern).

### 7. `[P]` Coding socket: account join, `4409`, `signed_in` on the wire

- **Plan:** Join, all three kinds; One connection per participant; Signed-in mark on the wire (presence, `welcome.you`). **Spec:** FR-1, FR-3, FR-5, FR-6, FR-7, FR-14, NFR-2.
- **Files:** `backend/app/sessions/repo.py`, `backend/app/sessions/ws.py`, `backend/tests/integration/test_ws_accounts.py` (new)
- **Depends on:** 1, 2, 3 (and 4 for the test users)
- **Do:** `ws.py` calls `identity_for(websocket.session, name)` in place of its own name check. With `account_sub`: `repo.join_as_account` (upsert per plan.md, clearing `left_at` and `hidden_at`), `hub.try_reserve(pid)`, and if already connected `hub.replace` + close the old socket `4409`; `remove(pid, websocket)` on disconnect. Anonymous: unchanged. `welcome.you` becomes `{participant_id, name, signed_in}`; presence entries carry `signed_in`. Update existing presence assertions in `test_ws_presence.py` for the new field.
- **Acceptance:**
  - *FR-1 — signed-in user starts or joins without a prompt:* signed-in socket without `name` joins; `welcome.you == {participant_id, name: "newuser", signed_in: true}`; presence shows `newuser` with `signed_in: true`.
  - *NFR-2:* signed-in socket with `name=admin` → name `newuser`; a cookie with a bad signature → treated as signed out (`4422` without `name`).
  - *FR-3 — Given `newuser` was in S1 and closed the tab, when they come back, then same participant:* disconnect and reconnect → same `participant_id`.
  - *FR-5 — Given `newuser` in S1 on a laptop, when they open it on a phone, then one `newuser`:* two cookie jars for `newuser` connect → presence has one `newuser`; the first socket is closed `4409`.
  - *FR-14 — Given `newuser` hid S1, when they open its link, then same participant and back in the list:* set `hidden_at` on their row, reconnect → same `participant_id`, `hidden_at` is null.
  - *FR-6 — not signed in:* no `name` → `4422`; `name=Ann` → joins with `signed_in: false`, a new participant per join as today.

### 8. `[P]` Learning socket: account join, `4409`, `signed_in` on the wire

- **Plan:** Join, all three kinds; One connection per participant; Signed-in mark on the wire (presence, `welcome.you`). **Spec:** FR-1, FR-3, FR-5, FR-6, FR-7, FR-14, NFR-2.
- **Files:** `backend/app/learn/repo.py`, `backend/app/learn/ws.py`, `backend/tests/integration/test_learn_ws_accounts.py` (new)
- **Depends on:** 1, 2, 3 (and 4 for the test users)
- **Do:** Same as task 7 for the learning socket and `learning_participant`. Update existing presence assertions in `test_learn_ws.py`.
- **Acceptance:**
  - *FR-1:* signed-in learning socket without `name` → `welcome.you.name == "newuser"`, `signed_in: true`.
  - *FR-7 — Given L1 with 4 participants including `newuser`, and a limit of 5, when `newuser` rejoins from a second device, then L1 still counts 4, and a fifth person can still join:* exactly this, with a second cookie jar and then an anonymous fifth socket.
  - *FR-5:* second device → one `newuser` in presence; first socket closed `4409`.
  - *FR-3 / FR-14:* reconnect after disconnect, and after `hidden_at` was set → same participant, `hidden_at` cleared.
  - *NFR-2 / FR-6:* as in task 7, for the learning socket.

### 9. `[P]` Presentation socket: account join, token rotation, join touches activity

- **Plan:** Join, all three kinds; Presentation tokens for accounts; Presentation join touches activity; Signed-in mark on the wire (presence, `welcome.you`). **Spec:** FR-1, FR-3, FR-5, FR-6, FR-7, FR-14, NFR-2.
- **Files:** `backend/app/present/repo.py`, `backend/app/present/ws.py`, `backend/tests/integration/test_present_ws_accounts.py` (new); `backend/app/present/hub.py` only to add `signed_in` to `Connection`/presence
- **Depends on:** 1, 2 (and 4 for the test users)
- **Do:** `identity_for` in the socket; account match comes before the rejoin-token check. `join_as_account` reuses or inserts the participant, rotates `rejoin_token_hash` on reuse and the new token goes in `welcome`. Every join (account or anonymous) updates the session's `last_activity_at`. `welcome.you` gains `signed_in`; presence entries gain `signed_in`. Existing `4409` replacement stays. Update presence assertions in `test_present_ws.py`.
- **Acceptance:**
  - *FR-1:* signed-in socket without `name` joins P1 as `newuser`, `signed_in: true`.
  - *FR-5 / FR-7:* second cookie jar → same `participant_id`, one presence entry, first socket `4409`; a new `rejoin_token` is sent and the old one no longer rejoins.
  - *FR-14:* after `hidden_at` was set, rejoin clears it.
  - *FR-6:* anonymous join and anonymous token rejoin behave as before (existing tests green).
  - *FR-2 ordering input:* a join moves `presentation_session.last_activity_at` to now (controlled clock).
  - *NFR-2:* `name=admin` while signed in → `newuser`.

### 10. `[P]` `GET /api/me/sessions`: recent sessions

- **Plan:** `accounts/repo.py` (`recent_sessions`), `accounts/api.py`; Contracts — `GET /api/me/sessions`. **Spec:** FR-2, FR-4, FR-12, NFR-1.
- **Files:** `backend/app/accounts/repo.py` (new), `backend/app/accounts/api.py` (new), `backend/app/main.py` (router include), test `backend/tests/integration/test_me_sessions.py` (new)
- **Depends on:** 1, 4
- **Do:** `RecentSession` and `recent_sessions(conn, account_sub)`: one `union all` of the three kinds, each joined from the participant's `(account_sub, session_id)` index, excluding `hidden_at is not null`, ordered `last_activity_at desc, invite_id`. Titles and `hosted_by_me` per plan.md; `stale` from each kind's existing stale rule. Route returns `401` when signed out. Tests seed participant rows with `account_sub` directly (no dependency on 7–9).
- **Acceptance:**
  - *FR-2 — Given `newuser` started S1 yesterday, joined L1 an hour ago and P1 now, and another user's S2 exists, when they open their profile, then P1, L1, S1 in that order with kind, title, last activity and stale status, and S2 is not:* exactly this with a controlled clock.
  - *FR-4 — Given S1 has become stale, then S1 is listed as stale:* mark S1 stale → `stale: true`.
  - *FR-12 — Given `newuser` hosts P1 and is a regular participant of P2, then P1 is marked and P2 is not; when hosting passes to someone else, P1 is no longer marked:* `hosted_by_me` true/false, then false after changing `host_participant_id`.
  - *NFR-1:* `other`'s cookie lists only `other`'s sessions; signed out → `401`; the route takes no account parameter.

### 11. `[P]` Hide, preferences, and `/api/me` with preferences

- **Plan:** `accounts/repo.py` (`hide`, `get_preferences`, `put_preferences`), `accounts/api.py`; `/api/me` gains `preferences`; Contracts — hide, `PUT /api/me/preferences`, `GET /api/me`. **Spec:** FR-13, FR-15, FR-16, NFR-1, NFR-2.
- **Files:** `backend/app/accounts/repo.py`, `backend/app/accounts/api.py`, `backend/app/main.py` (`/api/me`); tests `backend/tests/integration/test_me_hide_prefs.py` (new)
- **Depends on:** 10
- **Do:** `POST /api/me/sessions/{kind}/{invite}/hide` → `204`, idempotent, `404 {"error": "not_found"}` alike for unknown kind/session and a session the caller isn't in. `PUT /api/me/preferences` upsert with defaults (`system`, `true`) for a missing field on first write, `422` on an empty body, returns the stored pair. `/api/me` signed in adds `preferences` (object or `null`), never `sub`.
- **Acceptance:**
  - *FR-13 — Given `newuser` and `other` both in S1, when `newuser` hides S1, then gone from `newuser`'s list, still in `other`'s, and S1 and `newuser`'s chat messages unchanged:* exactly this, checked through `GET /api/me/sessions` for both and the session's participants and chat history.
  - *NFR-1:* hiding a session `newuser` isn't in and an unknown invite both give the same `404` body; `other` cannot read `newuser`'s preferences (only their own come back); a route-table check finds no `/api/me*` route with an account parameter.
  - *FR-15:* `PUT {appearance: "dark", chat_visible: false}` with jar A, then `GET /api/me` with jar B (same user) returns them.
  - *FR-16 input:* before any write, `/api/me.preferences` is `null`; `PUT {appearance: "dark"}` stores `{dark, true}`.
  - *NFR-2:* a role-less user's `/api/me.roles` is `[]` regardless of request content.

### 12. `[P]` Chat messages carry `participant_id` and `signed_in` (all three kinds)

- **Plan:** Signed-in mark on the wire — chat messages; Own messages. **Spec:** FR-3, FR-8, NFR-2.
- **Files:** `backend/app/chat/service.py` (+ `chat/repo.py` if the history query lives there), `backend/app/learn/chat.py`, `backend/app/present/chat.py`; tests extend `test_ws_chat.py`, `test_learn_chat.py`, `test_present_ws_chat.py`
- **Depends on:** 7, 8, 9
- **Do:** Every chat message dict, socket and REST history, gains `participant_id` and `signed_in` computed by joining the participant table (`account_sub is not null`). Nothing from the client feeds `signed_in`.
- **Acceptance:**
  - *FR-8 — Given signed-in `newuser` in S1, when an anonymous visitor joins as `newuser`, then only the signed-in one has the mark on each of their chat messages:* both send a message; socket frames and REST history give `signed_in: true` for one and `false` for the other — for coding, learning and presentation chat.
  - *FR-3 — earlier message shown as their own:* after reconnect, the history message's `participant_id` equals the new `welcome.you.participant_id`.
  - *NFR-2:* a client message with an extra `signed_in: true` field from an anonymous participant still comes back `false`.

### 13. `[P]` Learning record attributions carry `signed_in`

- **Plan:** Signed-in mark on the wire — learning record. **Spec:** FR-8, NFR-2.
- **Files:** `backend/app/learn/views.py`, `backend/app/learn/repo.py` (attribution query), test extends `backend/tests/integration/test_learn_service.py` (or `test_learn_ws.py`)
- **Depends on:** 8
- **Do:** Add `passed_by_signed_in: bool | null` beside `passed_by` and `by_signed_in` beside each attempt's `by`, from the participant's `account_sub`.
- **Acceptance:**
  - *FR-8 — anything attributed to them carries the mark:* a step passed by signed-in `newuser` → `passed_by_signed_in: true`; an attempt by an anonymous "newuser" → `by_signed_in: false`; an unpassed step → `passed_by_signed_in: null`.

### 14. `[P]` Presentation host carries `signed_in`

- **Plan:** Signed-in mark on the wire — presentation host. **Spec:** FR-8, NFR-2.
- **Files:** `backend/app/present/hosting.py`, `backend/app/present/api.py` (`GET /api/present/sessions/{invite}`), `backend/app/present/ws.py` (`welcome`/`host` frames); tests extend `test_present_hosting.py`, `test_present_session_api.py`
- **Depends on:** 9
- **Do:** `host.signed_in` in `welcome` and `host` frames; `host_signed_in` in the session GET.
- **Acceptance:**
  - *FR-8:* a session hosted by signed-in `newuser` → `host.signed_in: true` in `welcome`, `host` frames and `host_signed_in: true` in the GET; after hosting passes to an anonymous participant → `false`.

### 15. `[P]` `GET /api/auth/register` with `prompt=create`

- **Plan:** Register; Contracts — `GET /api/auth/register`. **Spec:** FR-10.
- **Files:** `backend/app/main.py`, `backend/app/auth/oidc.py` (if the authorize call lives there), test extends `backend/tests/integration/test_auth.py`
- **Depends on:** 4, 11 (both edit `main.py`)
- **Do:** Same handler as `/api/auth/login`, sharing its `next` sanitising and `appearance` passing, plus `prompt=create` on the authorization request.
- **Acceptance:**
  - *FR-10 — When they choose register, then they reach the hub's sign-up:* `GET /api/auth/register?next=/profile` → `302` to Keycloak's authorization endpoint with `prompt=create`; following it against the test Keycloak returns the registration form.
  - An off-site `next` is sanitised exactly as for login.

### 16. `[P]` `prefs/accountPrefs.ts` and one preference store

- **Plan:** Frontend — `prefs/accountPrefs.ts`; `theme/useAppearance.ts`, `components/chatVisibility.ts`. **Spec:** FR-15, FR-16, FR-17, FR-18.
- **Files:** `frontend/src/prefs/accountPrefs.ts` (new) + `accountPrefs.test.ts` (new), `frontend/src/theme/useAppearance.ts`, `frontend/src/components/chatVisibility.ts`, `frontend/src/auth/useMe.ts` (one call)
- **Depends on:** 5
- **Do:** One in-memory store over `localStorage` for `appearance` and `chatVisible`, subscribed to by `useAppearance` and the chat-visibility hook. `savePreference(key, value)`: always `localStorage` and the store; also `putPreferences` when signed in. `syncOnLoad(me)`: signed in with `preferences: null` → PUT this browser's values; signed in with preferences → write them to `localStorage`, store, and apply. Call `syncOnLoad` from `auth/useMe.ts` when `/api/me` resolves (not `App.tsx`, which task 18 edits in the same wave).
- **Acceptance:**
  - *FR-16 — Given a browser set to dark and `newuser` signing in for the first time, then their account keeps dark:* `syncOnLoad({signed_in: true, preferences: null})` with `localStorage` dark → `putPreferences({appearance: "dark", chat_visible: <browser value>})`.
  - *FR-15:* `syncOnLoad` with `{appearance: "dark", chat_visible: false}` sets `localStorage`, `data-appearance="dark"` and chat hidden.
  - *FR-17 — nobody signed in, kept in the browser; signing out stays dark:* signed out, `savePreference` writes `localStorage` and makes no request; after a signed-in sync to dark and then `me` signed out, `localStorage` still says dark.
  - *FR-18 — changed in one place, applies at once:* `savePreference("appearance", "light")` updates `data-appearance` immediately and every subscribed hook re-renders.
  - Existing `appearance.test.ts`, `chatVisibility.test.ts`, `AppearanceControl.test.tsx` stay green.

### 17. `[P]` Chat pane: own messages by `participant_id`, *signed in* mark

- **Plan:** Own messages; Frontend — `ChatPane.tsx`. **Spec:** FR-3, FR-8.
- **Files:** `frontend/src/components/ChatPane.tsx`, `frontend/src/components/ChatPane.test.tsx`, `frontend/src/chat/useChat.ts`
- **Depends on:** 5, 6
- **Do:** A message is "own" when its `participant_id` equals `welcome.you.participant_id` (own styling, accessible sender "You"). Show `SignedInMark` beside the sender of any message with `signed_in: true`.
- **Acceptance:**
  - *FR-3 — earlier message shown as their own:* history with a message whose `participant_id` matches `you.participant_id` renders with own styling and sender label "You"; one from another participant with the same name does not.
  - *FR-8 — only the signed-in one has the mark on each chat message:* two messages from "newuser", one `signed_in`, → one mark.

### 18. `[P]` Profile route, signed-out view, account section, toolbar entry

- **Plan:** Frontend — `pages/ProfileWindow.tsx` (signed-out and account parts), route `/profile`, `AccountControl.tsx`. **Spec:** FR-9, FR-10, FR-11, NFR-5.
- **Files:** `frontend/src/pages/ProfileWindow.tsx` (new) + `ProfileWindow.test.tsx` (new), `frontend/src/App.tsx` (route), `frontend/src/components/AccountControl.tsx` (+ its test)
- **Depends on:** 5
- **Do:** `AccountControl` becomes a toolbar button (*Profile*, or the username when signed in) to `/profile?from=<current path>`. `ProfileWindow`: back button to `from`; signed out → only *Sign in* and *Register* (`registerUrl`); signed in → username and roles read-only, *Sign out*. Mount an empty `ProfileSessions` component (new file `pages/ProfileSessions.tsx`, renders nothing yet) when signed in, so task 23 never edits `ProfileWindow.tsx`; the preferences section (22) is added in `ProfileWindow.tsx` itself. macOS window components from 003.
- **Acceptance:**
  - *FR-9 — Given any screen, signed in or not, the profile can be opened from it:* render each window (Problems, Session, Learn, LearningSession, Present, PresentSession, NotFound) signed in and signed out; each has the profile entry linking to `/profile?from=…`.
  - *FR-10 — not signed in: sign in and register options and no sessions or preferences:* signed-out render shows exactly those two actions; Register's href is `registerUrl`; no sessions or preferences regions.
  - *FR-11 — shows `newuser` and *editor*, neither editable; signing out leaves them signed out:* editor `me` → username and "editor" as text, no inputs; Sign out triggers the existing sign-out call. Role-less user → "none".

### 19. `[P]` Coding: no name sheet when signed in, "opened in another tab"

- **Plan:** Frontend — join screens and start flows; `4409` handling. **Spec:** FR-1, FR-3, FR-5, FR-6, FR-14.
- **Files:** `frontend/src/pages/SessionWindow.tsx`, `frontend/src/pages/ProblemsWindow.tsx`, `frontend/src/collab/provider.ts` (+ their tests)
- **Depends on:** 5
- **Do:** When `me.signed_in`, start/join connects without `name` and never shows the name sheet. On close `4409`, stop reconnecting and show "This session was opened in another tab or window." with *Use here* (reconnects). Anonymous: unchanged.
- **Acceptance:**
  - *FR-1 — signed in, starts a coding session, no name prompt:* starting from ProblemsWindow and opening `/s/:invite` signed in renders no name sheet and opens the socket without `name`.
  - *FR-6 — not signed in, asked for a name:* signed out → name sheet as today.
  - *FR-5:* a `4409` close shows the message, makes no automatic reconnect, and *Use here* reconnects.

### 20. `[P]` Learning: no name sheet when signed in, "opened in another tab"

- **Plan:** Frontend — join screens and start flows; `4409` handling. **Spec:** FR-1, FR-3, FR-5, FR-6, FR-14.
- **Files:** `frontend/src/learn/LearningSessionWindow.tsx`, `frontend/src/learn/LearnWindow.tsx`, `frontend/src/learn/learnSocket.ts` (+ their tests)
- **Depends on:** 5
- **Do:** As task 19 for learning sessions.
- **Acceptance:**
  - *FR-1 — opens a learning invite link signed in, joins without a prompt:* no name sheet; socket opened without `name`.
  - *FR-6:* signed out → name sheet.
  - *FR-5:* `4409` → message, no auto-reconnect, *Use here* reconnects.

### 21. `[P]` Presentation: no name sheet when signed in

- **Plan:** Frontend — join screens and start flows. **Spec:** FR-1, FR-3, FR-5, FR-6, FR-14.
- **Files:** `frontend/src/present/PresentSessionWindow.tsx`, `frontend/src/present/PresentWindow.tsx`, `frontend/src/present/presentSocket.ts` (+ their tests)
- **Depends on:** 5
- **Do:** When `me.signed_in`, start/join connects without `name` and no name sheet; the rejoin token from `welcome` is stored as today. Existing `4409` handling stays.
- **Acceptance:**
  - *FR-1 — opens a presentation invite link signed in, joins as `newuser` without a prompt:* no name sheet; socket opened without `name`.
  - *FR-6:* signed out → name sheet and token rejoin unchanged.

### 22. `[P]` Profile: preferences section

- **Plan:** Frontend — `ProfileWindow` *Preferences* section. **Spec:** FR-18, FR-10, NFR-5.
- **Files:** `frontend/src/pages/ProfileWindow.tsx`, `frontend/src/pages/ProfileWindow.test.tsx`
- **Depends on:** 16, 18
- **Do:** Signed in only: appearance segmented control (Light/Dark/System) and a *Show chat beside the description* checkbox, both through `savePreference`.
- **Acceptance:**
  - *FR-18 — Given `newuser` changes appearance to light in their profile, then the app turns light at once:* choosing Light sets `data-appearance="light"` immediately and calls `putPreferences({appearance: "light"})`; toggling chat does the same for `chat_visible`.
  - *FR-10:* signed out → no preferences section.
  - Controls reachable by Tab in order (NFR-5, unit level).

### 23. `[P]` Profile: sessions table with hide

- **Plan:** Frontend — `ProfileWindow` *Sessions* table. **Spec:** FR-2, FR-4, FR-12, FR-13, NFR-5.
- **Files:** `frontend/src/pages/ProfileSessions.tsx` (stub from 18), `ProfileSessions.test.tsx` (new), `ProfileSessions.module.css` (new)
- **Depends on:** 5, 18
- **Do:** Fill in `ProfileSessions` (already mounted by `ProfileWindow` when signed in): table from `getMySessions()` in the given order — kind, title (link to `/s/`, `/learn/s/`, `/present/s/` + invite), relative last activity, *Stale* badge, *Hosted by you* badge; a *Hide* action per row calling `hideMySession` and removing the row. Empty state when none.
- **Acceptance:**
  - *FR-2 — P1, L1, S1 listed in that order with kind, title, last activity and stale status:* given that response, rows render in order with those four columns.
  - *FR-4 — S1 listed as stale:* `stale: true` row shows the badge; its link goes to the kind's normal route (stale path handled by the window).
  - *FR-12 — P1 marked as hosted by them, P2 not:* badge only on `hosted_by_me` rows.
  - *FR-13 — hides S1, gone from their list:* Hide calls `hideMySession("coding", S1)` and the row disappears.
  - *FR-10:* signed out → no sessions section.

### 24. `[P]` *Signed in* mark on learning attributions and presentation host label

- **Plan:** Frontend — learning `StepView`/`Terminal` attributions, presentation host label. **Spec:** FR-8.
- **Files:** `frontend/src/learn/StepView.tsx`, `frontend/src/learn/Terminal.tsx`, `frontend/src/present/PresentSessionWindow.tsx` (host label) (+ their tests); `learnTypes.ts`/`presentTypes.ts` for the new fields
- **Depends on:** 6, 13, 14, 21 (same file as 21)
- **Do:** Show `SignedInMark` beside `passed_by` when `passed_by_signed_in`, beside an attempt's `by` when `by_signed_in`, and beside the host name when `host.signed_in`.
- **Acceptance:**
  - *FR-8 — the mark on anything attributed to a signed-in participant, never on an anonymous one:* each of the three renders the mark exactly when the flag is true.

### 25. `[P]` e2e: joining as an account

- **Plan:** Test strategy rows FR-1, FR-3, FR-5, FR-6, FR-7, FR-8. **Spec:** FR-1, FR-3, FR-5, FR-6, FR-7, FR-8.
- **Files:** `e2e/accounts-join.spec.ts` (new), `e2e/fixtures.ts` (signed-in context helper for a named user, two contexts per user)
- **Depends on:** 7, 8, 9, 12, 17, 19, 20, 21, 24
- **Do:** Playwright against the full stack with real Keycloak.
- **Acceptance:**
  - *FR-1 — Given `newuser` signed in, when they start a coding session, then no name prompt and they appear as `newuser`; when they open a learning or presentation invite link, they join as `newuser` without a prompt.*
  - *FR-3 — Given `newuser` sent a chat message in S1 and closed the tab, when they open S1 again, then no prompt and the earlier message is their own.* (Opened from the profile in task 26; here by URL.)
  - *FR-5 — Given `newuser` in S1 on their laptop, when they open S1's link on their phone, then the participant list still has one `newuser`;* the laptop context shows "opened in another tab or window".
  - *FR-6 — Given a visitor not signed in, when they open S1's link, then they are asked for a name and join with it, without being asked to sign in.*
  - *FR-7 — Given L1 with 4 participants including `newuser`, and a limit of 5, when `newuser` rejoins from a second device, then L1 still counts 4, and a fifth can join.*
  - *FR-8 — Given signed-in `newuser` in S1, when an anonymous visitor joins as `newuser`, then both are listed and only the signed-in one has the mark, in the list and on each of their chat messages.*

### 26. `[P]` e2e: profile, sessions list, sign-up

- **Plan:** Test strategy rows FR-2, FR-3, FR-4, FR-9, FR-10, FR-11, FR-13. **Spec:** FR-2, FR-3, FR-4, FR-9, FR-10, FR-11, FR-13.
- **Files:** `e2e/profile.spec.ts` (new)
- **Depends on:** 10, 11, 15, 18, 19, 23 (and 25's fixture helper)
- **Acceptance:**
  - *FR-9 — from library, coding, learning and presentation screens, signed in or not, the profile can be opened.*
  - *FR-10 — signed-out visitor sees sign in and register and no sessions or preferences; Register reaches the hub's sign-up form.*
  - *FR-11 — editor user sees their name and *editor*, not editable; Sign out leaves them signed out (`/api/me` signed out).*
  - *FR-2 — sessions they joined appear in the profile, most recent first, with kind, title, last activity and stale status; another user's session does not.*
  - *FR-3 — reopening S1 from the profile: no prompt, earlier message shown as own.*
  - *FR-4 — a stale S1 is listed as stale and opens read-only.*
  - *FR-13 — hiding S1 from the profile removes it from `newuser`'s list and not from `other`'s.*

### 27. `[P]` e2e: preferences across browsers, profile accessibility

- **Plan:** Test strategy rows FR-15–FR-18, NFR-5. **Spec:** FR-15, FR-16, FR-17, FR-18, NFR-5.
- **Files:** `e2e/profile-prefs.spec.ts` (new), `e2e/a11y.spec.ts` (add the profile page)
- **Depends on:** 11, 16, 18, 22, 23
- **Acceptance:**
  - *FR-15 — Given `newuser` on their laptop sets dark and hides chat, when they sign in on another browser, then it is dark and chat is hidden there.*
  - *FR-16 — Given a browser set to dark and `newuser` signing in for the first time, then a second browser they sign into is dark too.*
  - *FR-17 — signed out, a visitor's light appearance is kept in that browser; `newuser` with dark signs out → that browser stays dark after reload.*
  - *FR-18 — switching to light in the profile turns the app light at once, and an opened session shows light.*
  - *NFR-5 — the profile in light and dark: every control reachable by keyboard; axe-core WCAG AA passes.*

### 28. `[P]` Slow integration: restart durability and 200-session timing

- **Plan:** Test strategy rows NFR-3, NFR-4. **Spec:** NFR-3, NFR-4.
- **Files:** `backend/tests/integration/test_accounts_slow.py` (new)
- **Depends on:** 10, 11
- **Do:** Both tests marked `slow`.
- **Acceptance:**
  - *NFR-3 — Given `newuser`'s list shows S1 and L1, S2 is hidden and appearance is dark, when the hub restarts, then the list still shows S1 and L1 without S2, and appearance is still dark:* restart the api container in the test stack, then `GET /api/me/sessions` and `/api/me`.
  - *NFR-4 — Given `newuser` with 200 sessions, the profile list returns within 1 s:* seed 200 across the three kinds; `GET /api/me/sessions` under 1 s on the test stack; `EXPLAIN` of each branch uses the `(account_sub, session_id)` index.
  - *NFR-1 (route table):* already covered in task 11; not repeated.
