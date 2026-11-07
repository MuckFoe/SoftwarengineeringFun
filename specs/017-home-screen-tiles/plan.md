# 017 — Plan: Home screen with live session tiles

Inputs: `spec.md`, `memory/constitution.md` only. Per the sdd-plan skill, no code was read. Existing names below (marked ⟨existing⟩) come from the spec's wording ("start action", "join action", "my sessions" view, chess games) and **must be confirmed against the code by `/sdd-tasks` / `/sdd-implement`** before a task relies on them. Where a name is unknown the plan fixes the *shape*, not the identifier.

## Architecture

Frontend-led feature with one new backend read endpoint and a live-update channel. No change to how sessions, chat, editor or chess behave (spec out-of-scope).

```
HomeScreen (new, replaces the landing/"my sessions" list)
 ├─ Greeting            FR-1, FR-7
 ├─ TileGrid            FR-9 (CSS grid, auto-fit columns)
 │   ├─ StartTile       FR-2   → existing start action
 │   ├─ SessionTile*    FR-3,4,5 → existing join action
 │   ├─ GameTile*       FR-6   → existing open-game action
 │   └─ ShowMoreTile    FR-3 (>8 idle)
 ├─ EmptyState          FR-8
 └─ useHomeFeed (hook)  fetch snapshot + subscribe + lazy previews
Backend
 └─ home module (new): GET /api/home → snapshot of visible tiles (no code)
                       GET /api/home/preview/{session_id} → code excerpt
                       live updates via the existing presence/session websocket ⟨existing⟩
```

### Module layout and dependency direction (constitution 9)

- Backend `backend/app/home/` (new): `api.py` (routes) → `service.py` (assembly, visibility) → existing `sessions`, `accounts`, `games/chess` services ⟨existing⟩. `home` depends on them; none depend on `home`.
- Frontend `frontend/src/home/` (new): `HomeScreen.tsx`, `Greeting.tsx`, `SessionTile.tsx`, `GameTile.tsx`, `StartTile.tsx`, `CodePreview.tsx`, `BoardPreview.tsx`, `useHomeFeed.ts`, `greeting.ts` (pure), `home.module.css`. Depends on `api/` and the existing start/join/open-game helpers and the 016 design tokens. `App.tsx` routes the signed-in landing to `HomeScreen`.
- The old "my sessions" list (`ProfileSessions` ⟨existing⟩) stays reachable (FR-10): its content is now rendered as tiles by `HomeScreen`; the profile view keeps working and may reuse `SessionTile`. No behaviour of the underlying API it uses is removed.

### Guest / invitee variant (FR-11)

`HomeScreen` receives the principal type. For anonymous guests and chess invitees it renders a single tile for the session or game they joined, derived from the principal's existing membership (the server returns only that item for such principals — enforced server-side, not by hiding in the UI). No greeting count, no Start tile semantics beyond what a guest may already do, no previews of other sessions.

## Data model

No new tables, no migrations, no new user data (spec: "Any new data about users beyond what the app already has" is out of scope). Everything is derived from existing sessions, participants/presence, accounts (first name, display name, username) and chess games ⟨existing⟩.

Derived, per request:

- *Visible session*: a session the viewing principal may open, using the **same authorization predicate the existing join action uses** (reused, not re-implemented), so private/invite-only rules stay in one place.
- *Live*: session has ≥1 connected participant (the existing presence notion ⟨existing⟩).
- *Own idle*: not live, owned/hosted by the user.

## Contracts

All shapes JSON; names snake_case on the wire to match the existing API style ⟨confirm⟩.

### `GET /api/home` (authenticated principal: account, guest or invitee)

```
200 {
  "user": { "first_name": str|null, "display_name": str|null, "username": str },
  "live_participant_count": int,          // distinct people incl. the viewer, across visible live sessions
  "sessions": [ SessionTile ],            // ordering below; length = live_visible + min(8, own_idle)
  "idle_total": int,                      // own idle sessions in total, for the Show-more tile
  "games": [ GameTile ]                   // chess games involving the viewer, in progress or waiting
}
SessionTile {
  "id": str, "kind": "coding"|"learning"|"presentation", "title": str,
  "host": { "id": str, "name": str },
  "live": bool, "participant_count": int,          // count only meaningful when live
  "participants": [ { "id": str, "name": str, "avatar_url": str|null } ],  // capped at 4 for rendering; participant_count is the true total
  "last_active_at": str(ISO 8601)|null,            // set when idle
  "has_preview": bool                              // coding && live && non-empty code
}
GameTile {
  "id": str, "title": str, "opponent": { "id": str, "name": str },
  "status": "in_progress"|"waiting", "turn": "you"|"opponent"|"none",
  "fen": str                                         // for the board preview
}
```

Ordering: live sessions first (stable by most recent activity), then own idle sessions newest-first by `last_active_at`, truncated to 8. `idle_total > 8` ⇒ client shows "Show more", which navigates to the existing full sessions list view (FR-10) rather than loading more in place.

Guests/invitees: `sessions`/`games` contain at most the one item they joined; `live_participant_count` is omitted (null) and the client renders no greeting count.

### `GET /api/home/preview/{session_id}`

```
200 { "session_id": str, "language": str|null, "excerpt": str }   // first 8 lines, each truncated to 80 chars
404 when the session does not exist OR the principal may not open it (indistinguishable)
204 when the session has no code
```

Previews are fetched separately and lazily so the first tiles render without them (Performance NFR). The client requests previews only for tiles with `has_preview`, in parallel, and fills each in on arrival. Excerpt is produced server-side from the session's current document state ⟨existing⟩, authorized with the same join predicate.

### Live updates (FR-7)

The home screen reuses the existing authenticated websocket/event channel ⟨existing: `sessions/ws.py`⟩ to learn that *something visible changed* (participant joined/left, session went live/idle, game state changed). On any such event the client **re-fetches `GET /api/home`** (debounced 1 s, trailing) instead of patching state from event payloads. This keeps visibility logic server-side only (no leakage via event payloads) and meets "within a few seconds". If the channel is unavailable the client falls back to polling `GET /api/home` every 5 s while the tab is visible. Previews are re-fetched for a tile only when its `has_preview` flips true or on a coarse 15 s timer while the tile is live.

The server must publish a lightweight "home changed" notification to principals who could see the affected session. The recipient set is computed with the same visibility predicate. If the existing channel cannot carry this without altering session behaviour, the polling fallback alone satisfies FR-7 and the notification is dropped. `/sdd-tasks` must confirm which applies.

### Frontend pure functions

- `greeting.ts`: `greetingFor(now: Date, name: string, liveCount: number|null): { salutation: string, summary: string }`.
  - Salutation by local hour: 05–11 morning, 12–17 afternoon, 18–04 evening… (night 22–04 reads "Good evening" to avoid a fourth variant; revisit only if the spec asks).
  - Name: `first_name` ?? `display_name` ?? `username`.
  - Summary: `liveCount ≥ 1` → "{n} people are coding right now" (singular "1 person is coding" when n=1, which is the viewer alone); `0` or `null` → "Nobody is live right now" (never "0 people coding"). Count includes the viewer when they are among them (server-computed).
- Accessibility: the summary sits in an `aria-live="polite"` region whose text updates only when the *count value* changes (memoised on count), not on every refetch.

### Tile behaviour

- `SessionTile` and `GameTile` render as a single `<button>`/link-role element (one tab stop) with accessible name `"{title}, hosted by {host}, {Live, N people|idle}"` (games: `"{title}, against {opponent}, {your turn|opponent's turn|waiting}"`). Enter/Space/click call the existing join / open-game action (FR-5, FR-6).
- `CodePreview`: `<pre aria-hidden="true" tabindex="-1">` inside the tile, `pointer-events: none`, `user-select: none`, bottom fade via CSS mask; hidden entirely (no empty box) when no excerpt (FR-4). Plain text, no editor instance, no syntax highlighter (see Dependencies).
- `BoardPreview`: small static SVG/CSS-grid board drawn from `fen`, `aria-hidden`; reuses the existing chess piece assets/components if exported ⟨confirm⟩, else a minimal new one.
- Grid: `grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr))`; Start tile is first in DOM order so it stays first at every width; `min-width: 0` on tiles and `overflow-x: hidden` guard on the container (FR-9).
- Look: 016 tokens only; hover/enter/update transitions suppressed under `prefers-reduced-motion`.
- Empty state (FR-8): shown when `sessions` and `games` are empty; Start tile remains.

## Implementation deltas (recorded 2026-11-07, after `/sdd-implement`)

Where the code departs from or fixes a name in the sections above, this section wins.

1. **Live updates: polling only (tasks 13 and 14 dropped by the human).** Every websocket is scoped to one session, and the home screen holds none. A `home.changed` push would need a new per-account socket plus publish hooks in four session ws files. `useHomeFeed` polls `GET /api/home` every 5 s while the tab is visible, with a 1 s trailing debounce. FR-7 is met by polling. The E2E asserts the update within 8 s, not 5 s by push. The "Live updates" section above is superseded.
2. **"Visible session" = the viewer has a non-hidden participant row.** No join-authorization predicate or private/invite-only concept exists in the code, so the "same predicate as join" reading could not be used. Other people's public live sessions are not listed. A wider reading needs a spec change.
3. **`invite_id` on `SessionTile` and `GameTile`.** Routes use the invite id, not the internal session id. Not in the contract above; the tests cover it.
4. **`GameTile.opponent` is nullable** (waiting game, or the viewer is a watcher). The tile shows "Waiting for an opponent".
5. **Guest / invitee principal.** Only presentation guests and chess invitees get the reduced snapshot, authenticated by an `X-Rejoin-Token` header (SHA-256 matched against `presentation_participant` / `chess_participant`). Coding and learning guests have no stored token: `/api/home` returns 401 and the frontend falls back to the problems library (`ProblemsWindow`). This narrows FR-11 for those two guest kinds.
6. **Routes.** `/` is `HomeLanding` → `HomeScreen`. Start session goes to the new `/problems` route (the problems library moved there). Show more goes to `/profile` (`ProfileSessions`, unchanged). NotFound's "Back to problems" still points at `/`.
7. **Smaller data limits.** `user` is `{first_name: null, display_name: null, username}` because the session cookie holds only `sub`, `name` and `roles`. The host is the earliest joiner (the presentation host for presentations). `avatar_url` is always null. Preview `language` is always `"python"`, and learning and presentation sessions have `has_preview` false.
8. **Test note.** jsdom cannot turn Enter/Space into clicks and `user-event` is not installed, so unit tests do not cover them. Tiles are native `<button>`s and `e2e/home/home.spec.ts` covers the real key presses.

## Dependencies

No new third-party dependencies (constitution 6). Code preview is plain text from the server; board preview is hand-rendered; no highlighter or chart library added.

## Test strategy

Real dependencies throughout (constitution 4): backend integration tests use the real Postgres and real app through the existing harness; nothing is mocked (no third-party network services involved). Frontend tests follow existing Vitest/Testing-Library conventions with the real `useHomeFeed` against a stubbed `fetch` boundary only for component-level tests; end-to-end checks use the existing Playwright (`e2e/`) stack against the real backend.

| Level | What |
|---|---|
| Unit (frontend) | `greeting.ts` (time bands, name fallback, count wording, zero case); ordering/truncation helper if any lives client-side; accessible-name builder |
| Component (frontend) | `HomeScreen`, tiles, `CodePreview`, `BoardPreview`, empty state, guest variant, Show-more tile |
| Integration (backend) | `/api/home` and `/api/home/preview/*` against real DB and app: visibility, ordering, cap, guest scoping, live counts, 404 parity |
| E2E (Playwright) | live update with two browser contexts; keyboard tabbing; narrow viewport; invitee flow; reduced motion |

### Acceptance criteria → tests

| Spec criterion | Test |
|---|---|
| FR-1 evening, two live, user named | unit `greeting.test.ts` (19:00 fixed clock, count 2, first name) + component `HomeScreen` renders it; integration asserts `live_participant_count` includes the viewer |
| FR-1 nobody live | unit `greeting.test.ts` (count 0/null → no "0 people") |
| FR-2 Start session | component: Start tile click calls the existing start action; e2e: new session opens as before |
| FR-3 2 live + 2 idle ordering/fields | integration: order, `live`, counts, `last_active_at` null/set; component: Live tag and avatars on live tiles only, last-active on idle |
| FR-3 cap 8 + Show more | integration: 10 own idle ⇒ 8 returned, `idle_total` 10; component: Show-more tile appears and links to the full list |
| FR-4 preview shown, inert | integration: excerpt for live coding session; component: `aria-hidden`, `tabindex=-1`, not focusable in tab order; e2e: tab skips preview |
| FR-4 no code ⇒ no preview | integration: `has_preview=false`, preview 204; component: no preview element rendered |
| FR-5 click/Enter opens | component: click, Enter and Space call join; e2e: Enter opens the session |
| FR-6 game tile and none | integration: `games` content incl. `turn`; component: opponent, turn text, board; no Games tile when `games` is empty |
| FR-7 live update | e2e: second context joins/leaves, first context's tile count, avatars and greeting update within 5 s, no reload; component: `useHomeFeed` refetch on event and on polling fallback |
| FR-8 private session hidden | integration: user B's `/api/home` and preview for A's private session ⇒ absent / 404; e2e: no tile, avatar or code |
| FR-8 empty state | component: empty state text plus Start tile present |
| FR-9 narrow viewport | e2e (Playwright at 375 px): Start first in order, `scrollWidth <= clientWidth`, fewer columns |
| FR-10 earlier sessions reachable | integration: own idle sessions appear; component/e2e: tile activation runs the same join action as the old list; the old route still reachable |
| FR-11 / Privacy guest & invitee | integration: guest and invitee `/api/home` returns only their own session/game, null count, preview of others 404; e2e: invitee sees only game tile + board |
| Accessibility keyboard | e2e: tab order = reading order, visible focus, accessible name string (title, host, live state) via role/name queries; component: polite live-region updates only on count change |
| Performance | component: tiles render before preview promises resolve (preview fetch deferred/held) |
| Look / reduced motion | extend the existing 016 look checks (`e2e/audi` ⟨existing⟩) to cover the home screen, including reduced-motion |

Each task in `tasks.md` must name the criterion it covers; tests precede implementation (constitution 1).

## Constitution compliance

1. Test-first: tasks derive failing tests from the table above first. ✔
2. Green before done / per-task gate (`scripts/check.sh`, `HUB_KEEP_STACK=1`): no new slow tests planned; the two-context live-update e2e is the heaviest and must fit the existing per-task budget. ✔ (flag at tasks time if it doesn't)
3. Traceable tests: table above maps every criterion. ✔
4. Real dependencies: no mocks of owned components; only a `fetch` stub at the component level in the browser unit layer, which is the existing convention ⟨confirm⟩; backend and e2e use the real stack. ✔
5. Fixed stack: FastAPI/Python 3.12, PostgreSQL (no schema change), React+TS strict+Vite, docker compose. No departure. ✔
6. Dependencies: none added. ✔
7. No secrets: none involved; test fixtures use generated users. ✔
8. Lint/format: `ruff check`, `ruff format --check`, `biome ci`, `tsc --noEmit` are part of each task's gate. ✔
9. Architecture: module layout and dependency direction stated above. ✔

## Risks / items to confirm at `/sdd-tasks`

1. Names of existing start/join/open-game actions, the join authorization predicate, presence source, and websocket channel ⟨all marked existing⟩ — confirm; if the websocket can't carry a "home changed" event without touching session behaviour, ship polling only.
2. Whether `ProfileSessions` is replaced by or reuses the home tiles (FR-10 requires only that its content and functions remain reachable).
3. Night-time greeting: spec says "matches the time of day" without defining bands; plan uses morning/afternoon/evening only. Raise with the human at the plan gate if a "night" variant is wanted.
