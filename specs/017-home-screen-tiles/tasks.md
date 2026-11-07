# 017 — Home screen with live session tiles: tasks

Names marked ⟨existing⟩ in plan.md (start/join/open-game actions, join authorization predicate, presence source, websocket channel) are confirmed by the first task that touches them; if one differs, adapt the identifier, not the design. Every task is test-first (constitution 1) and ends on the per-task gate (constitution 2, 8).

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 6 — all `[P]` | Backend snapshot core and four independent frontend leaves (pure greeting, code preview, board preview, feed hook); none share files |
| 2 | 5, 9 — all `[P]` | Games in the snapshot (backend) and the tiles (frontend), which need only wave 1 |
| 3 | 8 | Preview endpoint; shares `api.py` with 5 and 7, so it runs alone |
| 4 | 7, 10 — all `[P]` | Guest scoping (backend) and lazy preview loading (frontend, needs 8) |
| 5 | 11, 13 — all `[P]` | Home screen assembly (frontend) and the change notification (backend) |
| 6 | 12, 14 — all `[P]` | Routing/FR-10/guest wiring (needs 7, 11) and live subscription in the feed hook (needs 13) |
| 7 | 15, 16, 17 — all `[P]` | Browser-level checks in separate spec files, once the screen is wired |

## Checklist

- [x] **1** — `[P]` Backend: `GET /api/home` snapshot for accounts (visible sessions, order, cap, live count)
- [x] **2** — `[P]` Greeting pure function
- [x] **3** — `[P]` `CodePreview` component
- [x] **4** — `[P]` `BoardPreview` component
- [x] **5** — `[P]` Backend: chess games in the snapshot
- [x] **6** — `[P]` Frontend: types and `useHomeFeed` (fetch, refetch, polling fallback)
- [x] **7** — `[P]` Backend: guest and invitee scoping
- [x] **8** — Backend: `GET /api/home/preview/{session_id}`
- [x] **9** — `[P]` `SessionTile` and `GameTile`
- [x] **10** — `[P]` Lazy preview loading in tiles
- [x] **11** — `[P]` `HomeScreen`: grid, Start tile, empty state, Show more, greeting
- [x] **12** — `[P]` Route landing to `HomeScreen`; FR-10 and guest variant
- [~] **13** — dropped by the human 2026-11-07: no existing websocket reaches the home screen; polling satisfies FR-7 `[P]` Backend: "home changed" notification
- [~] **14** — dropped with 13 (polling only) `[P]` Live subscription in `useHomeFeed`
- [x] **15** — `[P]` E2E: keyboard, accessibility, narrow viewport, privacy, invitee
- [x] **16** — `[P]` E2E: live update across two users
- [x] **17** — `[P]` Look checks for the home screen

## Tasks

### 1. Backend: `GET /api/home` snapshot for accounts `[P]`

- **Plan:** Backend `home` module (`api.py`, `service.py`), Contracts `GET /api/home`, Data model (visible, live, own idle). **Spec:** FR-1, FR-3, FR-8, FR-10, Privacy.
- **Files:** `backend/app/home/service.py`, `backend/app/home/api.py` (and its registration in the app router), `backend/tests/integration/test_home.py`
- **Depends on:** nothing
- **Do:** Add the `home` module. Assemble `user`, `live_participant_count` (distinct people, viewer included, across visible live sessions), `sessions` (live visible first, then own idle newest-first, capped at 8) and `idle_total`. Visibility reuses the existing join authorization predicate. Return `games: []` for now. Confirm the existing predicate and presence source names.
- **Acceptance:**
  - *FR-3 — Given two live sessions and two idle ones, when shown, then the live ones come first, each with "Live", a participant count and avatars, and the idle ones show last-active time and no Live tag.* Integration: response order, `live`, `participant_count`, `participants`, `last_active_at` set only when idle.
  - *FR-3 — up to 8 idle with "Show more" when more.* Integration: 10 own idle sessions ⇒ 8 returned, `idle_total` 10.
  - *FR-8 — Given a private session the user may not open, when the home screen is shown, then no tile, avatar or code of it appears.* Integration: user B's response excludes A's private session and its participants.
  - *FR-1 — two people in live sessions, user counted if one of them.* Integration: `live_participant_count` is 2 with the viewer among them, and counts distinct people once.
  - *FR-10 — Given an account with earlier sessions, then those sessions are reachable as tiles.* Integration: the user's earlier idle sessions appear.

### 2. Greeting pure function `[P]`

- **Plan:** Frontend pure functions, `greeting.ts`. **Spec:** FR-1.
- **Files:** `frontend/src/home/greeting.ts`, `frontend/src/home/greeting.test.ts`
- **Depends on:** nothing
- **Do:** `greetingFor(now, name, liveCount)` as specified in plan.md, plus a `displayName(user)` helper (first name, else display name, else username).
- **Acceptance:**
  - *FR-1 — Given it is 19:00 and two people are in live sessions the user can see, when the home screen opens, then the greeting names the user, says good evening and that two people are coding.* Unit with a fixed clock, count 2, first name.
  - *FR-1 — Given nobody is live, when it opens, then the greeting says so without a count of zero people "coding".* Unit: count 0 and null never produce "0 people".
  - *FR-1 — name falls back to display name, then username.* Unit.

### 3. `CodePreview` component `[P]`

- **Plan:** Tile behaviour, `CodePreview`. **Spec:** FR-4, Accessibility.
- **Files:** `frontend/src/home/CodePreview.tsx`, `frontend/src/home/CodePreview.module.css`, `frontend/src/home/CodePreview.test.tsx`
- **Depends on:** nothing
- **Do:** Render the excerpt in a `<pre>` with `aria-hidden="true"`, `tabindex="-1"`, no pointer events or text selection, bottom fade via CSS mask. Render nothing (no wrapper) when the excerpt is empty or absent. Respect 016 tokens.
- **Acceptance:**
  - *FR-4 — Given a live session with code, when its tile is shown, then a few lines of the current code appear faded at the bottom and cannot be focused or edited.* Component: excerpt rendered, `aria-hidden`, not in the tab order, no editable element.
  - *FR-4 — Given a live session with no code yet, then the tile shows no preview and no empty box.* Component: no element rendered for empty or null excerpt.

### 4. `BoardPreview` component `[P]`

- **Plan:** Tile behaviour, `BoardPreview`. **Spec:** FR-6, FR-11.
- **Files:** `frontend/src/home/BoardPreview.tsx`, `frontend/src/home/BoardPreview.module.css`, `frontend/src/home/BoardPreview.test.tsx`
- **Depends on:** nothing
- **Do:** Draw a static 8×8 board from a FEN string, `aria-hidden`; reuse existing piece assets if exported, else minimal glyphs. Handle the start position and a mid-game FEN.
- **Acceptance:**
  - *FR-6 — a Games tile shows … a small board preview.* Component: the right piece on the right square for a known FEN; the element is `aria-hidden` and not focusable.

### 5. Backend: chess games in the snapshot `[P]`

- **Plan:** Contracts `GameTile`; `home/service.py` depends on the chess service. **Spec:** FR-6.
- **Files:** `backend/app/home/service.py`, `backend/app/home/api.py`, `backend/tests/integration/test_home.py`
- **Depends on:** 1
- **Do:** Fill `games` with chess games involving the viewer that are in progress or waiting: `id`, `title`, `opponent`, `status`, `turn` (`you`/`opponent`/`none`), `fen`. Finished games are excluded.
- **Acceptance:**
  - *FR-6 — Given the user is in a chess game, when the home screen is shown, then a Games tile shows the opponent, whose move it is, and a board preview.* Integration: `games` holds the game with the right `opponent`, `turn` and `fen`.
  - *FR-6 — Given no such game, then no Games tile is shown.* Integration: `games` empty with no game, and with only a finished game.

### 6. Frontend: types and `useHomeFeed` (fetch, refetch, polling fallback) `[P]`

- **Plan:** `useHomeFeed`, Live updates (polling fallback). **Spec:** FR-7, Performance.
- **Files:** `frontend/src/api/types.ts` (home types), `frontend/src/home/useHomeFeed.ts`, `frontend/src/home/useHomeFeed.test.tsx`
- **Depends on:** nothing (the contract is fixed in plan.md)
- **Do:** Add the `HomeSnapshot`, `SessionTile`, `GameTile` types. The hook fetches `/api/home` on mount, exposes `{ snapshot, loading, error, refresh }`, and while the document is visible falls back to polling every 5 s. Refetches are debounced 1 s, trailing. The websocket trigger comes in task 14.
- **Acceptance:**
  - *FR-7 — Given the home screen is open, when another user joins or leaves a session, then the tile's count and avatars and the greeting count update within a few seconds without reload.* Component test with fake timers: a changed response is picked up by polling within 5 s and `snapshot` updates with no remount.
  - *Performance — the home screen shows its first tiles without waiting for code previews.* The hook never waits on preview requests, and `loading` ends when `/api/home` resolves.

### 7. Backend: guest and invitee scoping `[P]`

- **Plan:** Guest / invitee variant (server-side). **Spec:** FR-11, Privacy.
- **Files:** `backend/app/home/service.py`, `backend/app/home/api.py`, `backend/tests/integration/test_home.py`
- **Depends on:** 1, 5
- **Do:** For anonymous guest and chess invitee principals, return only the session or game they joined, `live_participant_count: null`, and no idle sessions or other games.
- **Acceptance:**
  - *FR-11 — Given a chess invitee, when the app opens, then they see only the game tile and its board preview.* Integration: invitee response has exactly one game and no sessions.
  - *Privacy — Given an anonymous guest, when the app opens, then only the tile of the session or game they joined appears, with no other session's title, avatars or code.* Integration: guest response has only the joined session, `live_participant_count` null, and no other session's data anywhere in the body.

### 8. Backend: `GET /api/home/preview/{session_id}`

- **Plan:** Contracts preview endpoint. **Spec:** FR-4, Privacy, Performance.
- **Files:** `backend/app/home/preview.py`, `backend/app/home/api.py`, `backend/tests/integration/test_home_preview.py`
- **Depends on:** 1
- **Do:** Return the first 8 lines (each cut to 80 characters) of the session's current code from existing document state, with `language`. 404 when the session is missing or the principal may not open it (same body for both), 204 when there is no code. Set `has_preview` consistently in the snapshot from the same source.
- **Acceptance:**
  - *FR-4 — Given a live session with code, then a few lines of the current code appear.* Integration: excerpt is the first 8 lines, truncated.
  - *FR-4 — a live session with no code yet shows no preview.* Integration: 204, and `has_preview` false in `/api/home`.
  - *FR-8 — private session the user may not open.* Integration: 404 identical to a nonexistent id.
  - *Privacy — guest.* Integration: a guest requesting another session's preview gets 404.

### 9. `SessionTile` and `GameTile` `[P]`

- **Plan:** Tile behaviour (`SessionTile`, `GameTile`), accessible names. **Spec:** FR-3, FR-5, FR-6, Accessibility.
- **Files:** `frontend/src/home/SessionTile.tsx`, `frontend/src/home/GameTile.tsx`, `frontend/src/home/tiles.test.tsx` (shared CSS in `frontend/src/home/home.module.css`)
- **Depends on:** 3, 4, 6
- **Do:** Each tile is one focusable control, accessible name `"{title}, hosted by {host}, {Live, N people|idle}"` for sessions and `"{title}, against {opponent}, {your turn|opponent's turn|waiting}"` for games. Sessions show kind, title, host, a Live tag and count when live, up to 4 avatars, and last-active time when idle, with `CodePreview` slotted in for coding sessions. Games show opponent, turn text and `BoardPreview`. Activation calls the existing join / open-game action passed in as a prop.
- **Acceptance:**
  - *FR-3 — live tiles show "Live", a participant count and avatars; idle tiles show last-active time and no Live tag.* Component.
  - *FR-5 — Given a tile, when activated by click or by Enter, then the session opens.* Component: click, Enter and Space call the join action once.
  - *FR-6 — a Games tile shows the opponent, whose move it is, and opens the game when activated.* Component.
  - *Accessibility — every tile announces its title, host and live state.* Component: role/name queries match the specified strings.

### 10. Lazy preview loading in tiles `[P]`

- **Plan:** Contracts preview endpoint (client side), Performance. **Spec:** FR-4, Performance.
- **Files:** `frontend/src/home/usePreview.ts`, `frontend/src/home/SessionTile.tsx`, `frontend/src/home/usePreview.test.tsx`
- **Depends on:** 6, 8, 9
- **Do:** For tiles with `has_preview`, fetch the preview after the tile has rendered, in parallel, and fill it in on arrival. Treat 204 and 404 as "no preview". Refresh when `has_preview` flips to true, and every 15 s while the tile is live.
- **Acceptance:**
  - *Performance — first tiles shown without waiting for previews; previews fill in as they arrive.* Component: with preview requests held pending, tiles render; resolving them adds the preview afterwards.
  - *FR-4 — live session with no code yet shows no preview and no empty box.* Component: 204 ⇒ no preview element.

### 11. `HomeScreen`: grid, Start tile, empty state, Show more, greeting `[P]`

- **Plan:** `HomeScreen`, `Greeting`, `StartTile`, `ShowMoreTile`, `EmptyState`, TileGrid. **Spec:** FR-1, FR-2, FR-3, FR-8, FR-9, Accessibility, Look.
- **Files:** `frontend/src/home/HomeScreen.tsx`, `frontend/src/home/home.module.css`, `frontend/src/home/HomeScreen.test.tsx`
- **Depends on:** 2, 9, 10
- **Do:** Compose greeting (summary in an `aria-live="polite"` region that changes only when the count value changes), the grid with Start first in DOM order, session and game tiles, a Show more tile when `idle_total > 8` that links to the existing full sessions list, and the empty state. Grid uses `repeat(auto-fill, minmax(min(100%, 16rem), 1fr))` with no horizontal overflow. Reduced-motion suppresses transitions. The start action is passed in as a prop.
- **Acceptance:**
  - *FR-1 — greeting names the user, says good evening and that two people are coding.* Component with a fixed clock.
  - *FR-2 — Given the home screen, when Start session is activated, then a new session starts as before.* Component: the Start tile calls the start action.
  - *FR-3 — more than 8 idle sessions shows a "Show more" tile.* Component.
  - *FR-6 — Given no such game, then no Games tile is shown.* Component.
  - *FR-8 — Given a user with no sessions or games, when the home screen opens, then an empty state tells them to start a session and the Start session tile is present.* Component.
  - *Accessibility — the greeting's count is announced politely when it changes, not on every change.* Component: re-render with the same count leaves the live region's text node untouched.

### 12. Route landing to `HomeScreen`; FR-10 and guest variant `[P]`

- **Plan:** Architecture (`App.tsx` routing), Guest / invitee variant, `ProfileSessions` reuse. **Spec:** FR-10, FR-11, FR-2, FR-5.
- **Files:** `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, `frontend/src/pages/ProfileSessions.tsx` (only if it must reuse the tiles)
- **Depends on:** 7, 11
- **Do:** Render `HomeScreen` as the signed-in landing and wire it to the existing start, join and open-game actions and to the full sessions list route. Guests and invitees get the same component fed by their reduced snapshot. The profile sessions view keeps working.
- **Acceptance:**
  - *FR-10 — Given an account with earlier sessions, when the home screen is shown, then those sessions are reachable as tiles with the same actions as before.* App test: an idle session tile runs the same join action as the old list, and the old list route is still reachable.
  - *FR-11 — Given a chess invitee, when the app opens, then they see only the game tile and its board preview.* App test with an invitee principal.
  - *FR-2 — Start session starts a new session as before.* App test through the real wiring.

### 13. Backend: "home changed" notification `[P]`

- **Plan:** Live updates (server publish). **Spec:** FR-7, Privacy.
- **Files:** `backend/app/sessions/ws.py` (or the existing event hub), `backend/app/home/service.py`, `backend/tests/integration/test_home_events.py`
- **Depends on:** 1, 5
- **Do:** On participant join/leave, a session going live or idle, and a game state change, send a payload-free `home.changed` event to each principal who may see the affected item (same visibility predicate). The payload carries no session data. If the existing channel cannot carry this without changing session behaviour, stop and report: polling alone satisfies FR-7, and this task and 14 are dropped by the human.
- **Acceptance:**
  - *FR-7 — when another user joins or leaves a session, the tile's count and avatars … update within a few seconds without reload.* Integration with a real websocket client: user B joining a session user A can see gives A a `home.changed` event within 2 s.
  - *FR-8 — private session the user may not open.* Integration: a user who may not open the session receives no event.

### 14. Live subscription in `useHomeFeed` `[P]`

- **Plan:** Live updates (client side). **Spec:** FR-7.
- **Files:** `frontend/src/home/useHomeFeed.ts`, `frontend/src/home/useHomeFeed.test.tsx`
- **Depends on:** 6, 13
- **Do:** Listen for `home.changed` on the existing channel and trigger the debounced refetch. Polling continues only while the channel is not connected.
- **Acceptance:**
  - *FR-7 — the tile's count and avatars and the greeting count update within a few seconds without reload.* Component: a `home.changed` event causes one refetch within the 1 s debounce even when many arrive; polling is suspended while connected and resumes when the channel drops.

### 15. E2E: keyboard, accessibility, narrow viewport, privacy, invitee `[P]`

- **Plan:** Test strategy (E2E rows). **Spec:** FR-4, FR-5, FR-8, FR-9, FR-11, Accessibility, Privacy.
- **Files:** `e2e/home/home.spec.ts` (the existing `e2e/` fixtures are reused)
- **Depends on:** 12
- **Do:** Browser tests against the real stack.
- **Acceptance:**
  - *FR-5 — Given a tile, when activated by click or by Enter, then the session opens.* Both paths.
  - *Accessibility — Given keyboard only, when tabbing, then every tile is reachable in reading order, shows focus, and announces its title, host and live state.* Tab order, visible focus outline, role/name match.
  - *FR-4 — the preview cannot be focused or edited.* Tab skips it.
  - *FR-9 — Given a narrow viewport, when shown, then tiles stack in fewer columns, Start session is first, and nothing scrolls horizontally.* At 375 px: Start is first, `scrollWidth <= clientWidth`.
  - *FR-8 — private session the user may not open.* No tile, avatar or code for it.
  - *FR-11 — chess invitee.* Only the game tile and board preview.

### 16. E2E: live update across two users `[P]`

- **Plan:** Test strategy (live update). **Spec:** FR-7, FR-3.
- **Files:** `e2e/home/live.spec.ts`
- **Depends on:** 12, 14
- **Do:** Two browser contexts against the real stack; keep it inside the per-task time budget.
- **Acceptance:**
  - *FR-7 — Given the home screen is open, when another user joins or leaves a session, then the tile's count and avatars and the greeting count update within a few seconds without reload.* Within 5 s, with no navigation event.

### 17. Look checks for the home screen `[P]`

- **Plan:** Test strategy (Look / reduced motion), constitution 8. **Spec:** Look (spec 016), Accessibility.
- **Files:** `e2e/audi/matrix.ts`, `e2e/audi/checks.ts` (extend the existing 016 look checks with the home screen entry)
- **Depends on:** 12
- **Do:** Add the home screen to the existing look matrix, including reduced-motion.
- **Acceptance:**
  - *Look — follows spec 016, including reduced-motion behaviour.* The existing checks pass for the home screen in each themed variant, and no transition runs under `prefers-reduced-motion`.
