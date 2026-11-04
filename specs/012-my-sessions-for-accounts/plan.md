# 012 — Plan: profile, recent sessions and no name prompt for signed-in users

Spec: [spec.md](spec.md). HOW only; every decision names the requirement it serves.

## Starting point (what exists today)

Read from the code, because this feature changes it in place:

- Sign-in is the app's own session cookie (Starlette `SessionMiddleware`, scoped to the app's base path), holding `sub`, `name` (Keycloak `preferred_username`), `roles` (this app's client roles only) and `exp`. `app.auth.deps.current_user(request)` reads it. The middleware also runs for WebSocket scopes, so `websocket.session` carries the same cookie.
- Three session kinds, each with its own tables and socket: coding (`session`, `participant`, `/api/sessions/{invite}/ws`), learning (`learning_session`, `learning_participant`, `/api/learn/sessions/{invite}/ws`), presentation (`presentation_session`, `presentation_participant`, `/api/present/sessions/{invite}/ws`). Every socket takes `?name=`; coding and learning create a new participant row on every join. Presentation reuses a participant through a `rejoin` token and closes an older socket of the same participant with `4409` (`replaced`).
- Coding and learning share `app.sessions.hub.SessionHub` (connections keyed by participant id, cap of 5 counted in connections + reservations). Presentation has `PresentHub` with `try_reserve(participant_id)` / `replace` / `remove(participant_id, websocket)`.
- Preferences: `appearance` and `chatVisible` in `localStorage` (`theme/appearance.ts`, `components/chatVisibility.ts`); the pre-paint script in `index.html` applies appearance.
- `AccountControl` (Sign in link, or name + Sign out popover) sits in the toolbar of every screen, `NotFound` included.
- Chat wire messages carry `sender_name` only; nothing marks a message as one's own.

## Architecture

New backend module `app/accounts/` (depends on `auth`, `sessions`, `learn`, `present` repos for reads; nothing depends on it except `main` and the three sockets' join paths):

| File | Role |
|---|---|
| `accounts/identity.py` | `Identity` = `account_sub: str \| None`, `name: str`. `identity_for(scope_session, raw_name) -> Identity \| None`: signed in → the cookie's `sub` and `name`, `raw_name` ignored; signed out → the existing 1–30-char name rule on `raw_name`, `None` if invalid. One function used by all three sockets (FR-1, FR-6, NFR-2). |
| `accounts/repo.py` | Recent-sessions query, hide, preferences read/write. |
| `accounts/api.py` | `/api/me/sessions`, `/api/me/sessions/{kind}/{invite}/hide`, `/api/me/preferences`. |

Changes to existing modules:

- **Join, all three kinds** (FR-1, FR-3, FR-5, FR-6, FR-7, FR-14, NFR-2). Each socket calls `identity_for(websocket.session, name)` instead of its own name check. With an `account_sub`, the kind's repo does `join_as_account(session_id, account_sub, name)`: an upsert on `(account_sub, session_id)` that returns the existing participant (clearing `left_at` and `hidden_at`) or inserts one. Anonymous joins are unchanged: a new participant per join (coding, learning) or the rejoin-token rule (presentation).
- **One connection per participant, newest wins** (FR-5, FR-7). The presentation rule moves into `app.sessions.hub.SessionHub` too: `try_reserve(participant_id)` takes no seat when that participant is already connected, `replace(participant_id, websocket)` swaps the socket and returns the old one, which is closed with `4409`; `remove(participant_id, websocket)` only removes the current socket. A participant is therefore counted once for the cap of 5, and appears once in presence, however many devices they open. The coding and learning sockets close the older socket with `4409`, as presentation does; their clients show "This session was opened in another tab or window." and do not reconnect by themselves (offering "Use here", which reconnects). Without this the two tabs would take the session from each other in a loop.
- **Presentation tokens for accounts.** A signed-in join that reuses its participant rotates the stored `rejoin_token_hash` and sends the new token in `welcome`, so `rejoin_token_hash` stays `not null unique` and an anonymous token rule still works for everyone else. Account match comes before the token check.
- **Presentation join touches activity.** Coding and learning joins already update `last_activity_at`; presentation joins now do too, so "most recently active" in the list reflects a join (FR-2's ordering in its acceptance criterion).
- **Signed-in mark on the wire** (FR-8, NFR-2). Every wire object that names a participant gets a sibling boolean computed server-side from `account_sub is not null`; nothing from the client sets it:
  - presence entries (both hubs): `{id, name, signed_in}` (+ `color` for presentation); the hubs' `Connection` gains `signed_in: bool`.
  - chat messages (`chat/service.py`, `learn/chat.py`, `present/chat.py` `message_dict`, socket and REST history): add `participant_id` and `signed_in` (read by joining the participant table).
  - learning record: `passed_by_signed_in` beside `passed_by`, `by_signed_in` beside each attempt's `by`.
  - presentation host: `host.signed_in` in `welcome` / `host` frames and `host_signed_in` in `GET /api/present/sessions/{invite}`.
  - every socket's `welcome.you`: `{participant_id, name, signed_in}` (coding and learning gain `name` and `signed_in`; presentation gains `signed_in`).
- **Own messages** (FR-3). With `participant_id` on chat messages and `welcome.you.participant_id`, the chat pane shows a returning signed-in user's earlier messages as their own (own-message styling, "You" as the accessible sender label).
- **Register** (FR-10). `GET /api/auth/register?next=&appearance=` in `main.py`: same as `/api/auth/login` but passes `prompt=create` to Keycloak's authorization request, which opens the hub realm's sign-up page (Keycloak 26 supports `prompt=create` when the realm allows registration; 009's hub realm does). After registration and approval the normal callback signs them in.
- **`/api/me`** gains `preferences` (see Contracts; never the `sub`), so one request at load gives identity, roles and account preferences.

Frontend:

| Piece | Change |
|---|---|
| `pages/ProfileWindow.tsx` (new), route `/profile` | Signed out: only *Sign in* and *Register* (FR-10). Signed in: username, roles read-only, *Sign out* (FR-11); *Preferences* section — appearance (Light/Dark/System) and *Show chat beside the description* (FR-18); *Sessions* table (FR-2, FR-4, FR-12, FR-13). macOS window/table/segmented-control components from 003 (NFR-5). |
| `components/AccountControl.tsx` | Becomes the profile entry on every screen (FR-9): a toolbar button (*Profile*, or the username when signed in) that navigates to `/profile?from=<current path>`; ProfileWindow's back button returns there. Since every screen already renders it, no screen is missed. |
| `auth/useMe.ts` | Unchanged hook; `Me` type gains `preferences`. |
| `prefs/accountPrefs.ts` (new) | `syncOnLoad(me)`: signed in with `preferences: null` → `PUT` this browser's current values (FR-16); signed in with preferences → write them into `localStorage` and apply (FR-15), so the pre-paint script and the signed-out state keep them (FR-17). `savePreference(key, value)`: always `localStorage`, plus `PUT` when signed in (FR-15, FR-18). |
| `theme/useAppearance.ts`, `components/chatVisibility.ts` | Their setters go through `savePreference`; both read from one in-memory store so a change in the profile applies at once everywhere (FR-18). |
| Join screens (`SessionWindow`, `LearningSessionWindow`, `PresentSessionWindow`) and start flows (`ProblemsWindow`, `LearnWindow`, `PresentWindow`) | When `me.signed_in`, skip the name sheet and connect without `name` (FR-1, FR-3, FR-5, FR-14). Anonymous: unchanged (FR-6). Each socket client handles `4409` as above. |
| `components/PresenceList.tsx`, `components/ChatPane.tsx`, learning `StepView`/`Terminal` attributions, presentation host label | Show the *signed in* mark when the wire says `signed_in` (FR-8): a small person-with-checkmark icon drawn in-house (003 forbids Apple-owned assets), with accessible text "signed in". |

Dependency direction: `accounts` → (`auth`, `sessions.repo`, `learn.repo`, `present.repo`); the three sockets → `accounts.identity`. Frontend: pages → `prefs`, `auth`; `prefs` → `api/client`.

## Data model

Migration `00NN_accounts.sql` (next free number; `0007` at the time of writing). No cascades, nothing deleted, matching earlier migrations.

```sql
-- FR-1, FR-3, FR-5, FR-7, FR-14: a participant belongs to at most one account per session.
alter table participant              add column account_sub text null, add column hidden_at timestamptz null;
alter table learning_participant     add column account_sub text null, add column hidden_at timestamptz null;
alter table presentation_participant add column account_sub text null, add column hidden_at timestamptz null;

-- One participant per (account, session); account first so it also serves the profile list (NFR-4).
create unique index participant_account              on participant              (account_sub, session_id) where account_sub is not null;
create unique index learning_participant_account     on learning_participant     (account_sub, session_id) where account_sub is not null;
create unique index presentation_participant_account on presentation_participant (account_sub, session_id) where account_sub is not null;

-- hidden_at is only ever set on an account's participant (FR-13).
alter table participant              add check (hidden_at is null or account_sub is not null);
alter table learning_participant     add check (hidden_at is null or account_sub is not null);
alter table presentation_participant add check (hidden_at is null or account_sub is not null);

-- FR-15, FR-16, NFR-3. A row exists once the account has preferences.
create table account_preference (
    account_sub  text primary key,
    appearance   text not null check (appearance in ('light', 'dark', 'system')),
    chat_visible boolean not null,
    updated_at   timestamptz not null default now()
);
```

Why these choices:

- **`account_sub`, not the username,** is the key (NFR-2): `sub` is what the cookie proves; the username is copied to `display_name` at first join, as an anonymous name is today. 009 has no username changes.
- **Hiding is a column on the user's own participant row** (FR-13): it touches nothing anyone else sees, and rejoining clears it in the same upsert (FR-14). No separate table to keep in step.
- **Anonymous participants keep `account_sub = null`** forever, so anonymous sessions are never added to an account (out of scope) and never carry the mark (FR-8).
- **Lists keep sessions as long as they exist** (NFR-3): sessions and participants are never deleted, and the list is derived from them.

## Contracts

### HTTP

All `/api/me/*` routes: `401 {"detail": ...}` when signed out. They read only rows whose `account_sub` is the caller's `sub` (NFR-1); there is no parameter naming another account.

**`GET /api/me`** (extended)
```json
{"signed_in": false, "roles": []}
{"signed_in": true, "name": "newuser", "roles": ["editor"],
 "preferences": {"appearance": "dark", "chat_visible": false}}
{"signed_in": true, "name": "newuser", "roles": [], "preferences": null}
```

**`GET /api/me/sessions`** → `200`, every non-hidden session the account has a participant in, ordered by `last_activity_at desc, invite_id` (FR-2, FR-4, FR-12):
```json
[{"kind": "presentation", "invite_id": "…", "title": "Intro to Git",
  "last_activity_at": "2026-11-04T09:00:00+00:00", "stale": false, "hosted_by_me": true},
 {"kind": "learning", "invite_id": "…", "title": "Lists", "last_activity_at": "…", "stale": false, "hosted_by_me": false},
 {"kind": "coding", "invite_id": "…", "title": "Two Sum", "last_activity_at": "…", "stale": true, "hosted_by_me": false}]
```
- Title: coding — the session's current problem's `title` (deleted problems still have one); learning — `lesson_version.content->>'title'`; presentation — the session version's `presentation.title`.
- `hosted_by_me`: `presentation_session.host_participant_id = ` the caller's participant id; always `false` for other kinds.
- One `union all` of three joins, each driven by the `(account_sub, session_id)` index (NFR-4). No pagination: 200 rows is small; the window renders them all.
- Links are built client-side: `/s/{invite}`, `/learn/s/{invite}`, `/present/s/{invite}`. Opening a stale one goes through each window's existing stale path (FR-4).

**`POST /api/me/sessions/{kind}/{invite}/hide`** → `204`. `kind` ∈ `coding|learning|presentation`, else `404`. Sets `hidden_at = now()` on the caller's participant in that session. `404 {"error": "not_found"}` alike for an unknown session and one the caller isn't in (NFR-1: no way to tell them apart). Idempotent.

**`PUT /api/me/preferences`** — body `{"appearance"?: "light"|"dark"|"system", "chat_visible"?: bool}`; at least one field, else `422`. Upsert; a first write with one field fills the other with its default (`system`, `true`). → `200` with the stored `{"appearance", "chat_visible"}` (FR-15, FR-16, FR-18).

**`GET /api/auth/register?next=/profile&appearance=dark`** → `302` to Keycloak's authorization endpoint with `prompt=create` (FR-10). Same `next` sanitising as `/api/auth/login`.

### WebSocket (all three kinds)

- Query: `name` is optional. Signed in (`websocket.session` has a live `sub`): `name` is ignored (NFR-2), identity is the account. Signed out: as today, invalid/missing name closes `4422` (FR-6).
- New close code on the coding and learning sockets: `4409` replaced (already used by presentation).
- `welcome.you`: `{"participant_id": "…", "name": "newuser", "signed_in": true}` (+ `rejoin_token` for presentation, as today).
- `presence.participants[]`: `{"id", "name", "signed_in"}` (+ `color` for presentation).
- Chat message (all kinds, socket and REST): adds `"participant_id": "…", "signed_in": bool`.
- Learning record: `passed_by_signed_in: bool | null`, attempts' `by_signed_in: bool`.
- Presentation `host`: adds `"signed_in": bool`.

### Python signatures

```python
# app/accounts/identity.py
@dataclass(frozen=True)
class Identity:
    account_sub: str | None
    name: str

def identity_for(session: Mapping[str, Any], raw_name: str) -> Identity | None: ...

# per kind (sessions/repo.py, learn/repo.py, present/repo.py)
async def join_as_account(conn, session_id: uuid.UUID, account_sub: str, name: str) -> Participant: ...
#   insert ... on conflict (account_sub, session_id) where account_sub is not null
#   do update set left_at = null, hidden_at = null  returning ...

# app/accounts/repo.py
@dataclass(frozen=True)
class RecentSession:
    kind: Literal["coding", "learning", "presentation"]
    invite_id: str
    title: str
    last_activity_at: datetime
    stale: bool
    hosted_by_me: bool

async def recent_sessions(conn, account_sub: str) -> list[RecentSession]: ...
async def hide(conn, account_sub: str, kind: str, invite_id: str) -> bool: ...   # False → 404
async def get_preferences(conn, account_sub: str) -> Preferences | None: ...
async def put_preferences(conn, account_sub: str, appearance: str | None, chat_visible: bool | None) -> Preferences: ...

# app/sessions/hub.py (SessionHub), matching PresentHub
def try_reserve(self, participant_id: uuid.UUID | None = None) -> bool: ...
def replace(self, participant_id: uuid.UUID, websocket: SocketLike) -> Connection: ...
def remove(self, participant_id: uuid.UUID, websocket: SocketLike | None = None) -> bool: ...
```

### TypeScript

```ts
// api/types.ts
interface Preferences { appearance: "light" | "dark" | "system"; chat_visible: boolean }
type Me =
  | { signed_in: false; roles: [] }
  | { signed_in: true; name: string; roles: string[]; preferences: Preferences | null };
interface RecentSession {
  kind: "coding" | "learning" | "presentation"; invite_id: string; title: string;
  last_activity_at: string; stale: boolean; hosted_by_me: boolean;
}
// api/client.ts
getMySessions(): Promise<RecentSession[]>;
hideMySession(kind: RecentSession["kind"], invite: string): Promise<void>;
putPreferences(p: Partial<Preferences>): Promise<Preferences>;
registerUrl(next: string): string;
```

## Test strategy

Levels, per the existing harness: backend **unit** (`backend/tests/unit`, pure functions), backend **integration** (`backend/tests/integration`, real Postgres and real Keycloak via the test compose stack), frontend **unit** (Vitest + Testing Library), **e2e** (Playwright in `e2e/`, the whole stack incl. Keycloak). Nothing is mocked; Keycloak, Postgres and the runner are all project-run (constitution 4). Test users `newuser` and `other` (no app role) and an editor are added to `backend/tests/keycloak/realm.json` if missing; the test realm sets `registrationAllowed: true` for FR-10's sign-up check. Multi-device cases use two browser contexts (e2e) or two cookie jars (integration) for one account.

| Criterion | Test |
|---|---|
| FR-1 | integration: signed-in coding/learning/presentation socket with no `name` joins; `welcome.you.name == "newuser"`, presence and chat sender `newuser`. e2e: start a coding session signed in — no name sheet; open learning and presentation invite links — no prompt. |
| FR-2 | integration: `newuser` joins S1, L1, P1 with controlled clock (S1 yesterday, L1 −1 h, P1 now); `other` has S2; `GET /api/me/sessions` returns P1, L1, S1 with kind/title/last_activity/stale; S2 absent. unit (frontend): ProfileWindow renders the rows in that order with kind, title, relative time, stale badge. |
| FR-3 | integration: `newuser` sends a chat message, disconnects, reconnects signed in → same `participant_id`, history message carries it. e2e: reopen S1 from the profile — no prompt, earlier message shown as own. |
| FR-4 | integration: mark S1 stale → listed `stale: true`. e2e: open it from the profile → read-only stale view. |
| FR-5 | integration: two cookie jars, one account, both connect to S1 → presence has one `newuser`; first socket closed `4409`. e2e: laptop+phone contexts; first shows "opened in another tab or window". |
| FR-6 | integration: signed-out socket without `name` → `4422`; with `name` → joins, `signed_in: false`. e2e: signed-out visitor opens invite link → name prompt, no sign-in demand. |
| FR-7 | unit (backend): `SessionHub.try_reserve(pid)` for a connected participant takes no seat. integration: L1 with 4 incl. `newuser`, second device rejoins → still 4; a fifth anonymous joins. |
| FR-8 | integration: signed-in `newuser` and anonymous "newuser" in S1 → two presence entries, only one `signed_in: true`; same on their chat messages (socket + REST), learning attributions and presentation host. frontend unit: PresenceList/ChatPane render the mark only when `signed_in`. e2e: mark visible next to the signed-in one only. |
| FR-9 | frontend unit: every window (Problems, Session, Learn, LearningSession, Present, PresentSession, NotFound) renders the profile entry, signed in and out. e2e: open the profile from library, coding, learning and presentation screens. |
| FR-10 | frontend unit: signed-out ProfileWindow shows only Sign in / Register. integration: `/api/auth/register` redirects to Keycloak with `prompt=create`. e2e: Register reaches Keycloak's sign-up form. |
| FR-11 | frontend unit: username and *editor* shown, not editable. e2e: editor user's profile; Sign out → `/api/me` signed out. |
| FR-12 | integration: `newuser` hosts P1, plain participant in P2 → `hosted_by_me` true/false; hand over P1 → false. |
| FR-13 | integration: hide S1 → absent from `newuser`'s list, present in `other`'s; S1's participants and chat unchanged; hiding someone else's / unknown session → 404. e2e: hide from the profile. |
| FR-14 | integration: after hide, reconnect via socket → same participant, `hidden_at` cleared, back in list. |
| FR-15 | integration: `PUT /api/me/preferences` then `GET /api/me` from a second cookie jar returns them. e2e: dark + chat hidden on context A; sign in on context B → dark, chat hidden. |
| FR-16 | frontend unit: `syncOnLoad` with `preferences: null` PUTs the browser's values. e2e: dark browser, first sign-in → second browser dark. |
| FR-17 | frontend unit: signed out, choices go to `localStorage` only; after sign-out the stored values remain. e2e: sign out from dark → still dark after reload. |
| FR-18 | frontend unit: changing appearance in ProfileWindow updates `data-appearance` at once and PUTs. e2e: switch to light in the profile, open a session → light. |
| NFR-1 | integration: `other`'s cookie gets only its own list/preferences; hide on `newuser`'s session → 404; no endpoint takes an account parameter (route table check). |
| NFR-2 | integration: signed-in socket with `name=admin`/`name=x` → name `newuser`; forged cookie (bad signature) → treated as signed out; `/api/me` roles come only from the cookie (no role-less user shows a role). |
| NFR-3 | integration (`slow`): list with S1, L1, hidden S2, dark appearance → restart the api container → same list, still dark. |
| NFR-4 | integration (`slow`): seed 200 sessions across kinds for one account; `GET /api/me/sessions` under 1 s against the test stack (generous margin for the hub). Explain plan uses the account index (unit-of-SQL check). |
| NFR-5 | e2e: profile in light and dark — keyboard tab order reaches every control; axe-core WCAG AA check (the existing 003 harness). |

Existing tests that change: the `SessionHub` unit tests gain the `try_reserve(pid)` / `replace` / `remove(pid, ws)` cases already covered for `PresentHub`; presence and chat wire-shape assertions in the coding, learning and presentation tests gain `signed_in` and `participant_id`.

## Constitution compliance

1. **Test-first** — every criterion above has a named test; tasks will write it before the code.
2. **Green before done** — per-task gate via `scripts/check.sh`; the restart test (NFR-3) and the 200-session timing (NFR-4) are marked `slow` so the per-task run stays under 5 min; `--full` once at the end.
3. **Traceable tests** — the table maps every FR/NFR criterion; `tasks.md` will cite them.
4. **Real dependencies** — Postgres, Keycloak and the runner run in the test stack; no mocks. No third-party service is involved.
5. **Fixed stack** — FastAPI, Postgres, React/TS strict, Vite, compose. No departure.
6. **Dependency justification** — no new dependency. `prompt=create` is an OIDC parameter passed through Authlib, already used; axe-core is already in the e2e harness (003).
7. **No secrets** — none added. New test users go into the test-only realm fixture the same way the existing ones are.
8. **Lint/format** — ruff, biome, tsc gates per task.
9. **Module layout and dependency direction** — stated in Architecture.

## Decisions for the reviewer

- **Newest connection wins** for a signed-in user who opens the same session twice (FR-5, FR-7): the older tab is told it was opened elsewhere and stops, with *Use here* to take it back. The alternative, several live connections per participant, would rework presence, cap and the presentation host rules in all three hubs for no requirement. Presentation already behaves this way.
- **"Last active" is the session's activity**, so the list is ordered by when anything happened in the session, not only by the user's own visits. A join counts as activity in all three kinds (presentation joins start counting).
- **Profile is a route (`/profile`)**, not a popover, so a 200-row list has room; the toolbar entry on every screen replaces today's account popover.
