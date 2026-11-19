# 021 — Rock Paper Siege: tasks

Source: `plan.md` (architecture, contracts, test strategy) and `spec.md` (FR/NFR/AC). Every task is test-first: write the listed tests from the acceptance lines, see them fail, then implement. Backend unit tests live in `backend/tests/unit/`, integration tests in `backend/tests/integration/`, frontend tests next to the component.

AC-3 (no original name, characters, artwork or sounds) has no task of its own: per the plan it is a human review at `/sdd-validate`, and no denylist test is written. Task 4 keeps the artwork original.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5 — all `[P]` | Foundations with no prerequisites: schema, pure setup rules, tokens, artwork, frontend wire types. |
| 2 | 6, 7, 8, 9, 10, 11, 12, 13 — all `[P]` | Play rules need the setup rules (2); repo needs the schema (1) and piece types (2); frontend pieces need only the wire types (5). |
| 3 | 14, 15, 16, 17, 18, 19 — all `[P]` | The secrecy filter needs the full rules (6); service lifecycle needs rules and repo (6, 7); board and setup bar need the reducer, tokens and artwork (3, 4, 9). |
| 4 | 20, 21, 22 — all `[P]` | Play actions and REST build on the service lifecycle (15); the session window composes every frontend piece (8–11, 16, 17). Different files. |
| 5 | 23, 24, 25, 26 — all `[P]` | The socket, home, profile and stale sweep all need the routers and `rps_hubs` from 21. Each touches its own files. |
| 6 | 27 | Game frames go on top of the socket join (23) and the play service (20). Alone because it owns `ws.py`. |
| 7 | 28, 29 — all `[P]` | Deletion needs `close_session` and the frame dispatch from 23/27 and edits `ws.py`; the restart test only adds a test file. |
| 8 | 30 | Chat edits `ws.py` and `api.py` after 28 has finished with them. |
| 9 | 31, 32, 33, 34 — all `[P]` | End-to-end and look checks need the whole stack. Run them against one kept stack in one batched gate, with Playwright locked. |
| 10 | 35, 36 — all `[P]` | 2026-11-19 revision (FR-27, FR-28). Foundations: field tokens and the figure art with its component. Different files. The old SVGs stay until their users have moved. |
| 11 | 37, 38, 39 — all `[P]` | Board, home preview and duel picker each switch to `PieceFigure` (36); board and preview also need the field tokens (35). Each owns its own files. |
| 12 | 40 | The six `.svg` files and `paths.ts` can go only once 37–39 no longer import them. |
| 13 | 41 | Look matrix and the human look need the finished board on a kept stack. |

## Checklist

- [x] **1** — `[P]` Migration `0016_rps.sql`
- [x] **2** — `[P]` Rules: board, deal, re-deal, place, first mover
- [x] **3** — `[P]` Tokens for sides and trap notice
- [x] **4** — `[P]` Original piece artwork
- [x] **5** — `[P]` Frontend wire types and REST client
- [x] **6** — `[P]` Rules: legal moves, fights, duels, traps, flag
- [x] **7** — `[P]` Repo on the `rps_*` tables
- [x] **8** — `[P]` `rpsSocket`
- [x] **9** — `[P]` `rpsState` reducer and selectors
- [x] **10** — `[P]` `DuelPicker`
- [x] **11** — `[P]` `RpsSeatsPanel` and `RpsResult`
- [x] **12** — `[P]` `GamesWindow` starts any catalogue game
- [x] **13** — `[P]` Profile list and jump bar know kind `rps`
- [x] **14** — `[P]` Views: the secrecy filter
- [x] **15** — `[P]` Service: sessions, seats, start, setup, snapshot
- [x] **16** — `[P]` `RpsBoard`
- [x] **17** — `[P]` `SetupBar`
- [x] **18** — `[P]` Home `GameTile` rps variant and `RpsBoardPreview`
- [x] **19** — `[P]` Home opens tiles by game; rejoin tokens for rps
- [x] **20** — `[P]` Service: move, duel, draw, resign, claim
- [x] **21** — `[P]` REST API, catalogue entry, app wiring
- [x] **22** — `[P]` `RpsSessionWindow` and route
- [x] **23** — `[P]` WebSocket: join, seats, setup frames, per-recipient sends
- [x] **24** — `[P]` Home feed rps tiles
- [x] **25** — `[P]` Profile sessions kind `rps`
- [x] **26** — `[P]` Stale sweep for rps sessions
- [x] **27** — WebSocket game frames
- [x] **28** — `[P]` Session deletion for kind `rps`
- [x] **29** — `[P]` Restart durability test
- [x] **30** — Chat for rps sessions
- [x] **31** — `[P]` E2E: play, home tile, jump bar, dock
- [x] **32** — `[P]` E2E: fight latency
- [x] **33** — `[P]` E2E: narrow, dark, reduced motion, keyboard, screen reader
- [x] **34** — `[P]` Look matrix entries
- [x] **35** — `[P]` Field tokens and contrast for figures on the field
- [x] **36** — `[P]` Figure parts and `PieceFigure`
- [x] **37** — `[P]` `RpsBoard` as a playing field with figures
- [x] **38** — `[P]` `RpsBoardPreview` with figures and field look
- [x] **39** — `[P]` `DuelPicker` weapon glyphs
- [x] **40** — Remove the old piece SVGs and `paths.ts`
- [x] **41** — Look matrix and human look for figures and field

## Tasks

### 1. `[P]` Migration `0016_rps.sql`

- **Plan:** Data model (`0016_rps.sql`). **Spec:** FR-2, NFR-3.
- **Files:** `backend/app/migrations/0016_rps.sql`, `backend/tests/integration/test_rps_schema.py`
- **Depends on:** nothing
- **Do:** Create `rps_session`, `rps_participant`, `rps_chat_message` with the same lifecycle columns, checks and indexes as their chess counterparts (seats `a`/`b`), plus `rps_game`, `rps_piece`, `rps_duel` exactly as in the plan. Drop and re-add the `deleted_session.kind` check to include `'rps'`.
- **Acceptance:**
  - *FR-2 — sessions are stored durably like chess sessions:* schema test asserts the six tables exist, the account unique index and first-signed-in index on `rps_participant`, and that `deleted_session` accepts `kind = 'rps'`.
  - *NFR-3 — a game in progress, a setup not yet confirmed and a duel waiting for picks survive a restart:* schema test inserts a game in setup, 28 pieces and a duel with one pick, and reads them back; the `rps_game` result/reason/ended check rejects a half-ended row; `rps_piece.square` rejects 42.

### 2. `[P]` Rules: board, deal, re-deal, place, first mover

- **Plan:** `rules.py` (pure) — `home_squares`, `deal`, `redeal`, `place`, `first_side`, `Piece`, `Board`. **Spec:** FR-4, FR-5, FR-8, NFR-1.
- **Files:** `backend/app/games/rps/__init__.py`, `backend/app/games/rps/rules.py`, `backend/tests/unit/test_rps_rules.py`
- **Depends on:** nothing
- **Do:** Types, coordinates (`square = row*7 + col`, side `a` rows 0–1, side `b` rows 4–5), `deal`, `redeal` (fighters only), `place` (swap with what stood there; `Illegal` outside own home rows), `first_side` per the plan's rule. No I/O; randomness only through the passed `random.Random`.
- **Acceptance:**
  - *AC-4 (FR-4) — Given a game just started, when a player looks at their home rows, then they hold 4 rock, 4 paper and 4 scissors fighters plus a flag and a trap, and the player can put the flag and the trap on any two of the 14 home-row squares:* `deal` for both sides over many seeds gives exactly that on `home_squares(side)`; `place` succeeds for every pair of the 14 squares and raises outside them.
  - *AC-5 (FR-5) — Given a player who has not pressed Ready, when they press re-deal three times, then each time their 12 fighters are redealt at random onto the non-flag, non-trap squares, still 4 of each weapon, and the flag and trap stay where they put them:* three successive `redeal`s keep flag and trap squares, keep 4/4/4, stay on the other 12 squares, and differ from each other for a seeded rng.
  - *AC-8 (FR-8, NFR-1) — each player moves first in about half of first games; in game 2 the player who did not move first moves first:* `first_side(None, …)` over 2,000 `SystemRandom` draws lands within 45–55 % per side; with a previous game, the previous non-first-mover goes first, including after the two players swap seats.

### 3. `[P]` Tokens for sides and trap notice

- **Plan:** UI notes — sides, new tokens. **Spec:** NFR-5.
- **Files:** `frontend/src/styles/tokens.css`, the Keycloak theme token copy, the existing tokens/guard/contrast tests
- **Depends on:** nothing
- **Do:** Add `--rps-side-a` (alias of `--accent`), `--rps-side-a-edge` (alias of `--on-accent`), `--rps-side-b` (alias of `--text`), `--rps-side-b-fill` (alias of `--bg`) and `--rps-trap-flash` (alias of `--danger`) in light and dark, mirrored in the Keycloak theme. After deploying the theme, clear the Keycloak gzip theme cache, not just restart.
- **Acceptance:**
  - *NFR-5 — tokens only, one accent, light and dark:* the tokens test finds the five tokens in light, dark and the Keycloak copy; the guard test still passes (aliases only, no raw colours); the contrast test covers both sides against `--board-light` and `--board-dark` in both themes, passing at 3:1 when either the side's fill or its edge does (the chess rule).

### 4. `[P]` Original piece artwork

- **Plan:** Frontend `pieces/*.svg`; UI notes — original assets. **Spec:** FR-3, NFR-6.
- **Files:** `frontend/src/games/rps/pieces/{rock,paper,scissors,flag,trap,hidden}.svg`, one vitest asset test
- **Depends on:** nothing
- **Do:** Draw six new single-path SVGs using `currentColor`, made for this repo. Nothing from the original messenger game.
- **Acceptance:**
  - *FR-3/NFR-6 — the game has its own artwork:* the asset test asserts each file exists, is one `<path>`, uses `currentColor` and holds no raster image or external reference; `check-no-apple-assets.sh` still passes. (Human review of originality is AC-3 at `/sdd-validate`.)

### 5. `[P]` Frontend wire types and REST client

- **Plan:** Contracts — `RpsState`, `RpsEvent`, `GameTile` union, REST; Frontend `rpsTypes.ts`, touched `gamesApi.ts`, `api/types.ts`. **Spec:** FR-1, FR-21, FR-25.
- **Files:** `frontend/src/games/rps/rpsTypes.ts`, `frontend/src/api/types.ts`, `frontend/src/games/gamesApi.ts` (+ `gamesApi.test.ts`)
- **Depends on:** nothing
- **Do:** Strict TS types for `RpsState`, `RpsEvent` and the frames from the plan; widen `GameTile` to the `game: "chess" | "rps"` union and `RecentSession.kind` to include `"rps"`; add `createRpsSession`, `getRpsSession`.
- **Acceptance:**
  - *FR-1 — anyone can start a session:* `gamesApi.test.ts` asserts `createRpsSession` posts to `/api/games/rps/sessions` and returns `invite_id`; `getRpsSession` reads `full` and `stale`.
  - *FR-21/FR-25 — opponent kinds may be absent:* `tsc` passes with `kind: Kind | null` on pieces and tile cells; existing chess tile consumers still type-check against the union.

### 6. `[P]` Rules: legal moves, fights, duels, traps, flag

- **Plan:** `rules.py` — `beats`, `legal_moves`, `resolve_move`, `resolve_duel`, `apply`. **Spec:** FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19.
- **Files:** `backend/app/games/rps/rules.py`, `backend/tests/unit/test_rps_rules.py`
- **Depends on:** 2
- **Do:** Implement the listed functions and `MoveOutcome` (`Moved | Fought | DuelStarted | Trapped | FlagTaken | Illegal(code)`). `apply` marks fight survivors revealed, removes losers, leaves traps, never reveals flag/trap.
- **Acceptance:**
  - *AC-9 (FR-9) — Given it is A's turn and a fighter of A's has an empty square to its right, a square of A's own below it, and an enemy piece above it, when A tries each move, then moving right and moving up are allowed, moving down is refused, and moving diagonally or two squares is refused:* `legal_moves` on that fixed board; off-board moves absent at edges and corners.
  - *AC-10 (FR-10) — when A tries to move their flag or trap to any square, then the move is refused:* flag and trap squares never appear as keys of `legal_moves`; `resolve_move` from them returns `Illegal`.
  - *AC-11 (FR-11) — a hidden fighter stays hidden when it moves:* `apply(Moved)` keeps `revealed=False`.
  - *AC-12 (FR-12) — Given A's rock attacks B's scissors, then B's scissors are removed, and A's rock is on the square, revealed. Given A's rock attacks B's paper, then A's rock is removed, and B's paper stays on its square, revealed:* `resolve_move` + `apply` for all six winning pairs both ways.
  - *AC-13 (FR-13) — same weapons start a duel; ties repeat; the winning pick wins:* `resolve_move` returns `DuelStarted` for equal weapons; `resolve_duel` returns `None` on equal picks and attacker/defender by weapon order otherwise.
  - *AC-14 (FR-14) — Given A's paper won a duel with a rock pick, then the surviving fighter is shown as paper:* `apply(Fought)` after a duel keeps the survivor's original kind.
  - *AC-15 (FR-15) — when A's scissors attacks B's trap, A's scissors are removed and the trap stays; a second attacker is removed too:* `Trapped` for every weapon; trap remains, `revealed=False`; repeat on the resulting board.
  - *AC-16 (FR-16) — attacking the flag ends the game with A as winner, whatever the fighter's weapon:* `FlagTaken` for rock, paper and scissors.
  - *AC-17 (FR-17) — the attacking player's turn ends after a fight or duel:* covered in the service (task 20); here `apply` returns a board only, no turn state.
  - *AC-18 (FR-18) — every remaining fighter boxed in by own pieces, edge or nothing, or no fighters left, means the side has no legal move:* `legal_moves` is empty for a boxed-in position and for a flag-and-trap-only side.
  - *AC-19 (FR-19) — a game with no fight for 500 moves is not ended:* 500 alternating quiet `Moved` outcomes on a fixed board never produce an ending outcome and leave legal moves.

### 7. `[P]` Repo on the `rps_*` tables

- **Plan:** `repo.py`; Data model. **Spec:** FR-2, FR-24, NFR-3.
- **Files:** `backend/app/games/rps/repo.py`, `backend/tests/integration/test_rps_repo.py`, a fixed-board test helper in `backend/tests/fixtures/`
- **Depends on:** 1, 2
- **Do:** SQL for sessions, participants, seats, games, pieces (rewrite a side's 14 rows, move/delete by square), duel (insert, pick, round advance, delete), game end. Add the helper that writes a fixed board through `repo` for later integration tests (no stubbed randomness).
- **Acceptance:**
  - *FR-24/NFR-3 — board, setup and pending duel pick restore exactly as they were:* round-trip tests: write a setup, pieces after a fight, and a duel with `a_pick` set; reload yields identical rows.
  - *FR-2 — participants and seats as chess:* participant account uniqueness and seat assignment mirror `test_chess_repo`.

### 8. `[P]` `rpsSocket`

- **Plan:** Frontend `rpsSocket.ts`. **Spec:** FR-2, FR-24.
- **Files:** `frontend/src/games/rps/rpsSocket.ts`, `frontend/src/games/rps/rpsSocket.test.ts`
- **Depends on:** 5
- **Do:** Adapt `chessSocket.ts`: URL `/api/games/rps/sessions/{invite}/ws`, the same close codes, rejoin key `rps-rejoin:<invite>`.
- **Acceptance:**
  - *FR-24 — a player who reloads or rejoins gets their seat back:* test asserts the rejoin token from `welcome` is stored under `rps-rejoin:<invite>` and sent as `rejoin=` on reconnect.
  - *FR-2 — close codes as chess:* 4403 (full), 4404, 4409, 4411, 4422 map to the same outcomes as in `chessSocket.test.ts`.

### 9. `[P]` `rpsState` reducer and selectors

- **Plan:** Frontend `rpsState.ts`; UI notes — screen reader announcements. **Spec:** FR-21, FR-24, NFR-5.
- **Files:** `frontend/src/games/rps/rpsState.ts`, `frontend/src/games/rps/rpsState.test.ts`
- **Depends on:** 5
- **Do:** Reducer over `welcome`/`state`/`error` frames; selectors for role, bottom side (own side; viewers `a`), selected square, targets from `legal`, and an announcement string per new event.
- **Acceptance:**
  - *FR-21 — players see their own side at the bottom, viewers side a:* selector test for `you: "a"`, `"b"`, `"viewer"`.
  - *NFR-5 — fight results and duel outcomes are announced politely, only when a new event arrives:* each `RpsEvent` kind yields one announcement; a `state` without `event` yields none; a repeated state does not re-announce.
  - *FR-24 — restored state replaces local state exactly:* a `welcome` with a pending duel and `your_pick` set restores selection-free state with the pick shown.

### 10. `[P]` `DuelPicker`

- **Plan:** Frontend `DuelPicker.tsx/.css`; UI notes — keyboard. **Spec:** FR-13, FR-21, NFR-5.
- **Files:** `frontend/src/games/rps/DuelPicker.tsx`, `DuelPicker.module.css`, `DuelPicker.test.tsx`
- **Depends on:** 5
- **Do:** Three buttons (rock, paper, scissors) built from `Button`; waiting state after own pick; last tied round shown; focus moves in when a duel starts.
- **Acceptance:**
  - *AC-13 (FR-13) — both players are asked to pick; when both pick the same, both are asked again:* test: duel with `your_pick: null` shows enabled buttons; after a pick, buttons disabled and "waiting" shown; `last_round` with equal picks shows the tie and enabled buttons for the new round.
  - *FR-21 — viewers see each pick once both are in:* for `you: "viewer"` no buttons, only `picked` flags and `last_round`.
  - *NFR-5 — playable by keyboard:* focus lands on the first button when the duel appears.

### 11. `[P]` `RpsSeatsPanel` and `RpsResult`

- **Plan:** Frontend `RpsSeatsPanel.tsx`, `RpsResult.tsx`. **Spec:** FR-2, FR-20.
- **Files:** `frontend/src/games/rps/RpsSeatsPanel.tsx`, `frontend/src/games/rps/RpsResult.tsx`, their tests
- **Depends on:** 5
- **Do:** Seats panel as chess `SeatsPanel` with sides instead of colours (take/leave seat). Result banner text per `reason`; reuse chess `ClosedSheet` if its `result` type widens cleanly, else copy it.
- **Acceptance:**
  - *AC-2 (FR-2) — before Start, the viewer can switch to player only if a player switches to viewer:* take-seat offered to a viewer only when a seat is empty; leave-seat offered to players before the game.
  - *AC-20 (FR-20) — everyone sees how it ended:* banner text for `flag`, `no_moves`, `resignation`, `agreement`, `abandonment` (win by claim), each from the reader's perspective (won / lost / draw / viewer wording).

### 12. `[P]` `GamesWindow` starts any catalogue game

- **Plan:** Touched `games/GamesWindow.tsx`. **Spec:** FR-1, FR-26.
- **Files:** `frontend/src/games/GamesWindow.tsx`, `frontend/src/games/GamesWindow.test.tsx`
- **Depends on:** 5
- **Do:** Start each listed game through its `start_path` and route by `id` (`/games/chess/s/…`, `/games/rps/s/…`).
- **Acceptance:**
  - *AC-1 (FR-1) — Given an anonymous visitor in the Games section, then this game is listed beside chess and they can start a session of it:* test renders both catalogue entries; starting Rock Paper Siege posts to its `start_path` and navigates to `/games/rps/s/<invite>`; chess still routes as before.

### 13. `[P]` Profile list and jump bar know kind `rps`

- **Plan:** Touched `pages/ProfileSessions.tsx`, `shell/useJumpIndex.ts`. **Spec:** FR-2 (spec 012 listing), FR-26.
- **Files:** `frontend/src/pages/ProfileSessions.tsx`, `frontend/src/shell/useJumpIndex.ts`, their tests
- **Depends on:** 5
- **Do:** Label "Rock Paper Siege", icon and route `/games/rps/s/<invite>` for kind `"rps"`.
- **Acceptance:**
  - *AC-25 (FR-26) — when a user types its name in "Jump to anything", then it is listed and opens the session:* `useJumpIndex` test: an `rps` recent session yields an item matching "Rock Paper Siege" with route `/games/rps/s/<invite>`.
  - *FR-2 — sessions listed on profiles as in spec 012:* `ProfileSessions` test renders an `rps` row with its label and link.

### 14. `[P]` Views: the secrecy filter

- **Plan:** Decision 2; `views.py` — `state_for`, `event_for`, `tile_board`. **Spec:** FR-7, FR-13, FR-15, FR-20, FR-21, FR-22, FR-23, NFR-1.
- **Files:** `backend/app/games/rps/views.py`, `backend/tests/unit/test_rps_views.py`
- **Depends on:** 6
- **Do:** Pure functions from `FullState` + recipient to the plan's `state` / event dicts and the 42-cell tile board, applying every rule in the plan's views paragraph. No other module builds board JSON.
- **Acceptance (every recipient × phase: setup, play, duel, ended):**
  - *AC-7 (FR-7, FR-22) — during setup, A's payload contains no kind or position of B's flag, trap or fighters, only 14 hidden pieces in B's home rows:* `state_for(full, "a")` in setup has 14 side-b entries, all `kind: null`, and no field distinguishing flag/trap/fighters.
  - *AC-11 — B still sees A's moved hidden fighter as hidden:* `kind: null` for that square to B.
  - *AC-12 — revealed fighters show to both:* `revealed: true` pieces carry `kind` to the opponent.
  - *AC-13 (FR-22) — before B picks, A's payload has nothing about B's pick:* only `your_pick` and `picked` booleans; `last_round` to all.
  - *AC-15 — after the trap catches A's fighter, the trap shows to A as an ordinary hidden piece:* trap and flag of the opponent always `kind: null`; `event_for(trapped)` goes to both players and viewers.
  - *AC-20 (FR-20) — after the game ends, every piece of both sides is shown with its kind:* ended state carries all kinds to a, b and viewer.
  - *AC-21 (FR-21) — a viewer sees every kind; while a duel waits for B, the viewer has not received A's pick:* viewer state has all kinds and no current-round pick.
  - *FR-9 — legal moves go only to the side to move:* `legal` empty for the other player and viewers.
  - *AC-24 (FR-25, NFR-1) — the tile preview shows hidden pieces as hidden:* `tile_board` contains kinds only for revealed fighters, `None` for empty squares.

### 15. `[P]` Service: sessions, seats, start, setup, snapshot

- **Plan:** `service.py` — lock + transaction; Service flow `start`, `place`/`redeal`/`ready`, `snapshot`; Decision 1 (lifecycle copied from chess). **Spec:** FR-2, FR-4, FR-5, FR-6, FR-8, FR-18, NFR-1.
- **Files:** `backend/app/games/rps/service.py`, `backend/tests/integration/test_rps_setup.py`
- **Depends on:** 6, 7
- **Do:** Create session, join/participants, take/leave seat, `start` (game row, `first_side`, deal both sides with a random flag and trap square, module-level `secrets.SystemRandom()`), `place`, `redeal`, `ready` (on the second ready set `turn = first_side` then the FR-18 check), `snapshot` → `FullState`.
- **Acceptance:**
  - *AC-4 — a started game holds 4/4/4 + flag + trap per side on home rows:* after `start`, `snapshot` shows that for both sides.
  - *AC-6 (FR-6) — Given one player has pressed Ready and the other has not, when the ready player tries to change their setup, then they cannot, and no move can be made. When the second player presses Ready, play begins:* `place`/`redeal` after `ready` refused; second `ready` sets `turn` to `first_side`.
  - *AC-8 (FR-8) — Given game 1 in which A moved first, when game 2 starts, then B moves first:* two consecutive `start`s in one session alternate.
  - *FR-2 — Start only for players, shown again after each game:* `start` refused for a viewer and during a running game; allowed after an ended game.

### 16. `[P]` `RpsBoard`

- **Plan:** Frontend `RpsBoard.tsx/.css`; UI notes — narrow, keyboard, screen reader, reduced motion, sides. **Spec:** FR-9, FR-21, NFR-5.
- **Files:** `frontend/src/games/rps/RpsBoard.tsx`, `RpsBoard.module.css`, `RpsBoard.test.tsx`
- **Depends on:** 3, 4, 9
- **Do:** 7×6 `role="grid"` named "Rock Paper Siege board", own side at the bottom, roving tabindex, arrows move focus, Enter/Space selects a fighter then a target, Escape cancels; side a filled `--rps-side-a` with a `--rps-side-a-edge` stroke, side b filled `--rps-side-b-fill` with a `--rps-side-b` stroke (plan: Sides); `repeat(7, minmax(0, 1fr))`, `aspect-ratio: 7 / 6`, size capped as in the plan; fight/trap effects only via motion tokens.
- **Acceptance:**
  - *NFR-5 / AC-27 — a screen reader names each piece with side, kind or "hidden", and position:* cells named e.g. "Your rock, C2", "Opponent hidden piece, D5", "Empty, E3", columns A–G and rows 1–6 from the reader's side (viewers from side a).
  - *AC-9 — only legal targets can be chosen:* selecting a fighter marks exactly `legal[from]`; Enter on a non-target sends nothing; Enter on a target emits `move {from, to}`.
  - *NFR-5 — playable by keyboard:* arrows move focus within bounds, Escape clears the selection.
  - *FR-21 — viewers see kinds, players see opponent pieces hidden:* renders `hidden.svg` for `kind: null`.

### 17. `[P]` `SetupBar`

- **Plan:** Frontend `SetupBar.tsx/.css`; UI notes — keyboard in setup. **Spec:** FR-4, FR-5, FR-6.
- **Files:** `frontend/src/games/rps/SetupBar.tsx`, `SetupBar.module.css`, `SetupBar.test.tsx`
- **Depends on:** 9
- **Do:** `SegmentedControl` choosing flag or trap for the next home-square Enter, *Re-deal* and *Ready* buttons; disabled once ready; shows the opponent's ready state.
- **Acceptance:**
  - *AC-4/AC-5 — the player can place flag and trap and re-deal:* choosing "trap" then activating a home square emits `place {what: "trap", square}`; *Re-deal* emits `redeal`.
  - *AC-6 — after Ready the setup cannot change:* with `ready.a` true for `you: "a"`, all controls disabled; *Ready* emits `ready` once.

### 18. `[P]` Home `GameTile` rps variant and `RpsBoardPreview`

- **Plan:** Touched `home/GameTile.tsx`, new `home/RpsBoardPreview.tsx`; UI C — preview `aria-hidden`, first paint does not wait on the board. **Spec:** FR-25.
- **Files:** `frontend/src/home/GameTile.tsx`, `frontend/src/home/RpsBoardPreview.tsx`, `frontend/src/home/GameTile.test.tsx`
- **Depends on:** 4, 5
- **Do:** Render the `game: "rps"` tile: name, starter, Live state with participant count and avatars, and a 7×6 `aria-hidden` preview from `board` (hidden cells as `hidden.svg`).
- **Acceptance:**
  - *AC-24 (FR-25) — a game tile shows the name, starter, Live state, participant count, avatars and a board preview, and the preview shows hidden pieces as hidden:* test renders those fields; cells with `kind: null` render hidden; the preview is `aria-hidden`; chess tiles unchanged.

### 19. `[P]` Home opens tiles by game; rejoin tokens for rps

- **Plan:** Touched `home/HomeLanding.tsx`, `home/rejoinToken.ts`. **Spec:** FR-24, FR-25.
- **Files:** `frontend/src/home/HomeLanding.tsx`, `frontend/src/home/rejoinToken.ts`, their tests
- **Depends on:** 5
- **Do:** Open the route by tile `game`; `rejoinToken` also reads `rps-rejoin:*`.
- **Acceptance:**
  - *AC-24 — when the tile is activated, the session opens:* activating an rps tile navigates to `/games/rps/s/<invite>`.
  - *FR-24 — a rejoining guest is recognised:* `rejoinToken` returns the stored token for an rps invite.

### 20. `[P]` Service: move, duel, draw, resign, claim

- **Plan:** Service flow `move`, `duel_pick`; `offer_draw`/`answer_draw`, resign, claim as chess. **Spec:** FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, FR-2, NFR-4.
- **Files:** `backend/app/games/rps/service.py`, `backend/tests/integration/test_rps_play.py`
- **Depends on:** 15
- **Do:** `move` (refuse out of turn, during a duel, or `to` not legal; apply outcome, `ply += 1`, clear draw offer, pass turn, FR-18 check; `DuelStarted` reveals both and inserts `rps_duel` with `turn = null`; `FlagTaken` ends with `flag`), `duel_pick` (store; on both: tie → next round with `last_*`; decided → apply as `Fought`, delete duel, continue as `move`), draw offer/answer, resign and claim as chess. Each returns raw state + raw event. No timers besides the away claim.
- **Acceptance (fixed boards via the task 7 helper):**
  - *AC-9 — when it is B's turn and A tries to move, the move is refused.*
  - *AC-13 — paper on paper asks both to pick; both scissors asks again; A rock vs B scissors makes A's fighter win:* duel row created, round advances on tie with `last_*` set, decisive round removes B's fighter.
  - *AC-14 — the duel winner keeps its weapon.*
  - *AC-16 — attacking the flag ends the game at once with A as winner, reason `flag`.*
  - *AC-17 (FR-17) — Given A attacks and the fight (including any duel) ends, then it is B's turn:* after a fight, after a trap, and after a duel.
  - *AC-18 — Given it is B's turn and every remaining fighter is boxed in or none are left, when B's turn begins, then the game ends with B as the loser:* ended with `no_moves`, result `a`.
  - *AC-19 (FR-19) — Given A offers a draw, when B accepts, then the game ends as a draw; when B declines or makes a move instead, the offer is gone and play continues:* reason `agreement`; decline and a move both clear `draw_offer_by`.
  - *FR-2 — resignation and the away-player claim end the game as chess:* reasons `resignation` and `abandonment`.

### 21. `[P]` REST API, catalogue entry, app wiring

- **Plan:** `api.py` (start, check, reactivate); touched `games/catalog.py`, `main.py`. **Spec:** FR-1, FR-2, FR-3.
- **Files:** `backend/app/games/rps/api.py`, `backend/app/games/catalog.py`, `backend/app/main.py`, `backend/tests/integration/test_rps_api.py` (+ extend `test_games_api.py`)
- **Depends on:** 15
- **Do:** `POST /api/games/rps/sessions` → 201 `{invite_id}`, `GET …/{invite}` as chess `CheckOut`, `POST …/reactivate`; catalogue entry `Game(id="rps", name="Rock Paper Siege", …)`; include routers and set `app.state.rps_hubs = {}`. Chat and delete endpoints come in tasks 30 and 28.
- **Acceptance:**
  - *AC-1 (FR-1, FR-3) — this game is listed beside chess and anyone can start a session:* `GET /api/games` lists `chess` and `rps` named "Rock Paper Siege"; an anonymous `POST` returns 201 with an invite id.
  - *FR-2 — check and reactivate as chess:* `GET` reports `full` and `stale`; `reactivate` clears stale.

### 22. `[P]` `RpsSessionWindow` and route

- **Plan:** Frontend `RpsSessionWindow.tsx`; touched `App.tsx`. **Spec:** FR-2, FR-6, FR-13, FR-19, FR-20, FR-23.
- **Files:** `frontend/src/games/rps/RpsSessionWindow.tsx` (+ `.module.css`, `.test.tsx`), `frontend/src/App.tsx`
- **Depends on:** 8, 9, 10, 11, 16, 17
- **Do:** Compose `Window`, `AppHeader`, `InviteLink`, `ChatPane`/`useChat`, seats, board, setup bar during setup, duel picker during a duel, result, and a controls row (Start, Offer draw, Accept/Decline, Resign, Claim, Delete) built from existing primitives. Route `/games/rps/s/:invite`.
- **Acceptance:**
  - *FR-2 — Start always shown and shown again after each game; resign, claim, delete as chess:* controls test per phase.
  - *AC-19 — Accept/Decline appear only to the player offered a draw.*
  - *AC-22 (FR-23) — a viewer who takes a seat sees only the player view:* switching `you` from `"viewer"` to `"a"` swaps to the player layout with no viewer-only content.

### 23. `[P]` WebSocket: join, seats, setup frames, per-recipient sends

- **Plan:** `ws.py`; WebSocket contract; Decision 2 (encode per recipient via `views`). **Spec:** FR-2, FR-7, FR-22, FR-23, FR-24, NFR-1.
- **Files:** `backend/app/games/rps/ws.py`, `backend/tests/integration/test_rps_ws.py`
- **Depends on:** 14, 15, 21
- **Do:** Join/leave, cap, rejoin token, close codes and stale guard as chess on a `ChessHub` in `app.state.rps_hubs`; frames `take_seat`, `leave_seat`, `start`, `place`, `redeal`, `ready`; errors to sender only; after every committed change send each connection `views.state_for` for its recipient. Expose `close_session`.
- **Acceptance:**
  - *AC-2 (FR-2) — Given a new session, when three people join by its invite link, then the first two are players and the third is a viewer. A sixth person is refused because the session is full. Before Start, the viewer can switch to player only if a player switches to viewer:* 3 joins → 2 seats + viewer; 6th closed 4403; `take_seat` refused while seats are full, allowed after `leave_seat`.
  - *AC-7 (FR-7, FR-22) — when the messages reaching A's device during setup are inspected, they contain no kind or position of B's flag, trap or fighters:* record every frame to A while B places and re-deals; assert no side-b `kind` and nothing that changes with B's placements.
  - *AC-22 (FR-23) — a viewer of game 1 who takes a seat for game 2 receives only the player view.*
  - *FR-24 — a reload restores setup as it was:* reconnect with the rejoin token mid-setup returns the same pieces and ready flags.

### 24. `[P]` Home feed rps tiles

- **Plan:** Home (`/api/home`) contract; touched `home/service.py`, `home/api.py`. **Spec:** FR-25, NFR-1.
- **Files:** `backend/app/home/service.py`, `backend/app/home/api.py`, `backend/tests/integration/test_home.py`
- **Depends on:** 7, 14, 21
- **Do:** Add rps tiles to `games` with the plan's fields; visibility by participant-row membership on `rps_*`, active and not stale or deleted; `board` from `views.tile_board`; live and avatars from `rps_hubs`; `_GUEST` gains `rps_participant`. No new trigger.
- **Acceptance:**
  - *AC-24 (FR-25, NFR-1) — a user who may open the session gets a tile with name, starter, Live state, participant count, avatars and a board preview showing hidden pieces as hidden even to a viewer of that session; a user who may not open it gets nothing:* tile fields asserted for a participant; `board` has no kind of an unrevealed piece for a session viewer; no tile, title, avatar or code for a non-member and for a guest of another session.

### 25. `[P]` Profile sessions kind `rps`

- **Plan:** Touched `accounts/repo.py`, `accounts/api.py`. **Spec:** FR-2 (spec 012), FR-26.
- **Files:** `backend/app/accounts/repo.py`, `backend/app/accounts/api.py`, `backend/tests/integration/test_me_sessions.py`
- **Depends on:** 7, 21
- **Do:** `GET /api/me/sessions` includes kind `"rps"`, title "Rock Paper Siege", host rule as chess, connected from `rps_hubs`.
- **Acceptance:**
  - *FR-2/FR-26 — sessions listed on profiles and available to the jump bar:* a signed-in participant's rps session is listed with kind `rps`, its title and host flag; a non-participant's list does not include it.

### 26. `[P]` Stale sweep for rps sessions

- **Plan:** `stale.py`; `main.py` starts `rps.stale.run_periodically`. **Spec:** FR-2.
- **Files:** `backend/app/games/rps/stale.py`, `backend/app/main.py`, `backend/tests/integration/test_rps_stale.py`
- **Depends on:** 7, 21
- **Do:** Adapt `chess/stale.py` to `rps_session` and start it with the app.
- **Acceptance:**
  - *FR-2 — stale after 30 days, as chess:* a session with `last_activity_at` 31 days ago is marked stale by one sweep; a 29-day-old one is not.

### 27. WebSocket game frames

- **Plan:** WebSocket contract — `move`, `duel_pick`, `offer_draw`, `answer_draw`, `resign`, `claim_win`; events via `views.event_for`. **Spec:** FR-11, FR-12, FR-13, FR-15, FR-16, FR-19, FR-20, FR-21, FR-22, NFR-2.
- **Files:** `backend/app/games/rps/ws.py`, `backend/tests/integration/test_rps_ws_game.py`
- **Depends on:** 20, 23
- **Do:** Dispatch the game frames to the service; send each connection its own state + event after every commit; errors to the sender only.
- **Acceptance:**
  - *AC-11 — after A's hidden fighter moves onto an empty square, the turn passes to B and B's frame shows the square with `kind: null`.*
  - *AC-12 — both players see both weapons; the winner is revealed on its square:* `fight` event to A, B and viewer with both weapons; following state has `revealed: true`.
  - *AC-13 (FR-22) — before B picks, A's frames contain nothing about B's pick:* inspect every frame to A between A's and B's picks.
  - *AC-15 — A's fighter falls into B's trap: both players get `trapped`; afterwards A sees the trap as hidden; a second attacker is removed.*
  - *AC-16 — flag capture ends the game for everyone with reason `flag`.*
  - *AC-19 — draw offer, accept, decline over the socket.*
  - *AC-20 (FR-20) — when a game ends by any ending, everyone sees how it ended and every piece's kind:* for `flag`, `no_moves`, `resignation`, `agreement`, `abandonment`, A, B and the viewer all get `result`, `reason` and every kind.
  - *AC-21 — while a duel waits for B, the viewer has not received A's pick; once both are in, the viewer sees both.*

### 28. `[P]` Session deletion for kind `rps`

- **Plan:** Touched `deletion/repo.py`, `deletion/service.py`; `api.py` `DELETE …/{invite}`; `delete_session` frame. **Spec:** FR-2 (spec 014 deletion, spec 019).
- **Files:** `backend/app/deletion/repo.py`, `backend/app/deletion/service.py`, `backend/app/games/rps/api.py` + `ws.py` (delete route and frame only), `backend/tests/integration/test_rps_delete.py`
- **Depends on:** 23, 27
- **Do:** Kind `"rps"` purge order and lock as chess; call `rps.ws.close_session`; REST `DELETE /api/games/rps/sessions/{invite}` and the `delete_session` frame.
- **Acceptance:**
  - *FR-2 — the session starter and admins can delete a session, as for chess:* starter and admin deletes succeed, close every socket with `closed`, purge the `rps_*` rows and write `deleted_session` with kind `rps`; a non-starter player is refused.

### 29. `[P]` Restart durability test

- **Plan:** Test strategy AC-23 (`test_rps_restart`, marked `slow`). **Spec:** FR-24, NFR-3.
- **Files:** `backend/tests/integration/test_rps_restart.py`
- **Depends on:** 27
- **Do:** Test only. If it fails, the fix belongs to the service or repo task that owns the cause.
- **Acceptance:**
  - *AC-23 (FR-24, NFR-3) — Given A has placed their flag but not pressed Ready, B is mid-game waiting on a duel pick in another session, and the app restarts, when both reload, then A's flag position and dealt fighters are as before and still unconfirmed, and B is still asked for the same duel pick:* marked `slow`, restarts the app between the two halves.

### 30. Chat for rps sessions

- **Plan:** `chat.py`; `api.py` chat history and remove; chat frames in `ws.py`. **Spec:** FR-2 (specs 002/007).
- **Files:** `backend/app/games/rps/chat.py`, `backend/app/games/rps/api.py` + `ws.py` (chat parts only), `backend/tests/integration/test_rps_chat.py`
- **Depends on:** 28
- **Do:** Adapt `chess/chat.py` to `rps_chat_message`/`rps_participant`, reusing `app.chat.rules`, `message_dict` and `app.gifs`; `GET …/chat`, `DELETE …/chat/{id}`; chat and GIF frames as chess.
- **Acceptance:**
  - *FR-2 — chat as in specs 002/007:* players and viewers send and receive messages and GIFs; history returns them in order; removal follows the chess permissions; a deleted session's chat is gone.

### 31. `[P]` E2E: play, home tile, jump bar, dock

- **Plan:** Test strategy AC-24, AC-25 (E2E). **Spec:** FR-1, FR-25, FR-26.
- **Files:** `e2e/rps.spec.ts`
- **Depends on:** 12, 13, 18, 19, 22, 24, 25, 27
- **Do:** Two guests and a viewer start, set up and play to a flag capture; a signed-in participant opens it from the home tile and from the jump bar; the dock *Games* entry reaches the catalogue.
- **Acceptance:**
  - *AC-1 — an anonymous visitor sees the game beside chess and starts a session.*
  - *AC-24 — when the tile is activated, the session opens.*
  - *AC-25 (FR-26) — when a user types its name in "Jump to anything", then it is listed and opens the session. The Games dock entry leads to the game.*

### 32. `[P]` E2E: fight latency

- **Plan:** Test strategy AC-26 (`rps-latency.spec.ts` as `chess-latency`). **Spec:** NFR-2.
- **Files:** `e2e/rps-latency.spec.ts`
- **Depends on:** 22, 27
- **Acceptance:**
  - *AC-26 (NFR-2) — Given two players and a viewer connected on the hub, when a player makes a move that causes a fight, then the result shows on all three screens within 1 second.*

### 33. `[P]` E2E: narrow, dark, reduced motion, keyboard, screen reader

- **Plan:** Test strategy AC-27 (`rps-a11y.spec.ts`); UI notes. **Spec:** NFR-5.
- **Files:** `e2e/rps-a11y.spec.ts`
- **Depends on:** 22, 27
- **Acceptance:**
  - *AC-27 (NFR-5) — Given a 390 px wide screen in dark mode with reduced motion, when a game is played, then the whole board is visible without horizontal scrolling, nothing animates, and the game can be set up and played with the keyboard alone. A screen reader names each piece with side, kind or "hidden", and position, and announces fight results:* keyboard-only setup, move and duel; board fits the viewport; no running animations besides `LiveBadge`; accessible names checked; the polite live region carries the fight result.

### 34. `[P]` Look matrix entries

- **Plan:** Test strategy AC-27 look matrix; UI D.19–22. **Spec:** NFR-5.
- **Files:** `e2e/audi/matrix.ts` (+ `matrix-specs.ts` if entries are declared there)
- **Depends on:** 22, 27
- **Do:** Add "rps session (guest)" in setup and in play to the look matrix, light and dark, wide and narrow.
- **Acceptance:**
  - *NFR-5 — UI rules hold in light, dark and narrow:* both entries render and pass the matrix checks; this fulfils the spec's open UI checklist item "Look matrix entry and E2E tasks present".

---

Tasks 35–41 implement the 2026-11-19 revision (plan: *Figures and playing field*). Frontend only: no backend, data model or wire contract change.

### 35. `[P]` Field tokens and contrast for figures on the field

- **Plan:** Figures and playing field — Playing field (zone tokens, midline); Touched files `styles/tokens.css`, Keycloak theme copy, `tokens`/`contrast` tests; Test strategy AC-28, AC-29 (`contrast.test.ts` parts). **Spec:** FR-28, NFR-5.
- **Files:** `frontend/src/styles/tokens.css`, `keycloak-theme/collab/login/resources/css/collab.css`, `frontend/src/styles/tokens.test.ts` + `keycloakTheme.test.ts` + `contrast.test.ts`
- **Depends on:** nothing
- **Do:** Add, in light and dark and mirrored in the Keycloak copy, the aliases `--rps-field` (`--surface-3`), `--rps-field-line` (`--ui-stroke`), `--rps-zone-home` (`--surface-1`), `--rps-zone-middle` (`--surface-2`), `--rps-zone-home-rule` (`--accent`). Aliases only, no raw colours, no new hue. After deploying the theme, clear the Keycloak gzip theme cache, not just restart. Do not remove `--board-light`/`--board-dark` (chess uses them).
- **Acceptance:**
  - *NFR-5 / UI B.7 — tokens only, one accent, light and dark:* tokens and Keycloak tests find all five in light, dark and the Keycloak copy; the guard test still passes.
  - *AC-28 (FR-27, NFR-5) — … in light and in dark mode … a piece of side A can be told from a piece of side B:* `contrast.test.ts` asserts each side's fill or edge reaches 3:1 against `--rps-zone-home` and `--rps-zone-middle`, in light and dark.
  - *AC-29 (FR-28) — … the line between the halves is visible, each square can be told apart from its neighbours … a selected fighter, its legal targets and the last move are shown on the field … in light and in dark mode:* `contrast.test.ts` asserts `--rps-field-line` (midline and tile outline) reaches 3:1 against both zone tones, `--focus` reaches 3:1 against `--bg` (two-tone ring), and `--accent` (target dot) and `--highlight` stay readable on both zones, in light and dark; `--rps-field` is not held to 3:1 (decided 2026-11-19, see plan). If a pair fails, stop and report: the fix is a token choice for the human, not a raw colour.

### 36. `[P]` Figure parts and `PieceFigure`

- **Plan:** Decision 5; Figures and playing field — Figure construction, Contract, Side marks; Frontend `pieces/figureParts.ts`, `pieces/PieceFigure.tsx`; Test strategy AC-28 (`pieces.test.ts`). **Spec:** FR-27, FR-21, FR-3, NFR-5, NFR-6.
- **Files:** `frontend/src/games/rps/pieces/figureParts.ts`, `frontend/src/games/rps/pieces/PieceFigure.tsx` (+ its CSS module), `frontend/src/games/rps/pieces/pieces.test.ts` (rewritten)
- **Depends on:** nothing (uses existing `--rps-side-*` tokens)
- **Do:** Draw original art as data on a `0 0 48 48` grid: `BODY` (one shared chunky silhouette, round helmet, big head, short wide body, stubby legs, base at y=45), `HIDDEN_ARMS` (arms behind the back), `KIND_PARTS` for rock (boulder in both hands), paper (sheet, folded corner, two lines), scissors (open blades, two round handles), flag (soldier with pole and pennant above the helmet), trap (toothed jaw trap on a plate, no soldier), plus a side-`a` round boss and side-`b` bar helmet emblem as `detail` parts. Stroke 3 units, round joins and caps, no detail thinner than 2 units; weapon about 40 % of figure width. `PieceFigure({kind, side, title?, weaponOnly?})` renders `<svg viewBox="0 0 48 48" data-side aria-hidden={!title}>`, colouring `fill`/`edge`/`detail` roles through CSS classes on `--rps-side-*` tokens, never literals. Hidden output depends on `side` only. Keep the old `.svg` files and `paths.ts` for now (task 40 removes them); rewrite `pieces.test.ts` for the new module only.
- **Acceptance:**
  - *AC-28 (FR-27) — each rock, paper and scissors figure is recognisable by the weapon it holds, the flag and trap are recognisable:* each of rock/paper/scissors/flag/trap renders its own `KIND_PARTS` paths and no other kind's; `weaponOnly` renders only that kind's parts and no `BODY`.
  - *AC-28 / FR-21 — every opponent hidden piece looks identical:* two hidden figures of the same side serialise to identical markup, containing `HIDDEN_ARMS` and no `KIND_PARTS` path.
  - *AC-28 / NFR-5 — side A told from side B without relying on colour alone:* side `a` and `b` figures differ by their emblem path, not only by class or `data-side`; hidden figures carry the emblem too.
  - *FR-3 / NFR-6 — own artwork:* every `d` in the output comes from `figureParts` (no inline art); no raster, `<image>` or external reference; no colour literal in markup or CSS module; `check-no-apple-assets.sh` passes. Recognisability itself is a human look at `/run`.

### 37. `[P]` `RpsBoard` as a playing field with figures

- **Plan:** Decision 6; Figures and playing field — Playing field (zones, squares, midline, highlights, motion, size); Touched `games/rps/RpsBoard.tsx`, `RpsBoard.module.css`; Test strategy AC-29 (vitest `RpsBoard`). **Spec:** FR-28, FR-27, FR-21, NFR-5.
- **Files:** `frontend/src/games/rps/RpsBoard.tsx`, `RpsBoard.module.css`, `RpsBoard.test.tsx`
- **Depends on:** 35, 36
- **Do:** Draw every piece with `<PieceFigure kind side />` (no `title`; the cell carries the name), replacing `PIECE_PATHS` in the component and its test. Give each cell `data-zone="home-bottom" | "middle" | "home-top"` from its row and the side drawn at the bottom. Cells become tiles (`--radius-sm`, 1 px `--rps-field-line` outline) on a `--rps-field` background with a `--space-2` gap; zone tones `--rps-zone-home`/`--rps-zone-middle`; a `--rps-zone-home-rule` inner rule on each home zone's outer edge; a 3-unit midline as the board's `::after` across the row 2/3 boundary in `--rps-field-line`; no checker tones. Selection becomes a two-tone ring (outer `--focus`, thin inner `--bg`), target dot (`--accent`) and last move (`--highlight`). Figure `inline-size: 82%`. Narrow sizing, keyboard and motion unchanged; no new animation.
- **Acceptance:**
  - *AC-29 (FR-28) — both sides' home rows, the empty middle rows and the line between the halves are visible:* cells carry the right `data-zone` for a player at side a, a player at side b and a viewer (two home rows each end, two middle rows); the board renders the midline element/class.
  - *AC-29 — a selected fighter, its legal targets and the last move are shown on the field:* selecting a fighter still marks it selected and exactly `legal[from]` as targets, the last move's two squares are marked, all with their existing accessible names and states.
  - *AC-28 / FR-21 — opponent hidden pieces identical:* two opponent hidden cells render identical figure markup.
  - *AC-27 / NFR-5 — names, keyboard, reduced motion still hold:* the existing `RpsBoard` name and key tests pass unchanged.

### 38. `[P]` `RpsBoardPreview` with figures and field look

- **Plan:** Decision 5 (one `PieceFigure` for board, preview, picker); Touched `home/RpsBoardPreview.tsx`. **Spec:** FR-27, FR-28, FR-25.
- **Files:** `frontend/src/home/RpsBoardPreview.tsx`, `frontend/src/home/RpsBoardPreview.module.css`, `frontend/src/home/GameTile.test.tsx`
- **Depends on:** 35, 36
- **Do:** Replace the `?raw` SVG imports and duplicated paths with `PieceFigure`; draw the preview with the field look (zone tones, tiles, midline) at preview size. Preview stays `aria-hidden` and does not delay first paint.
- **Acceptance:**
  - *AC-24 (FR-25) — the preview shows hidden pieces as hidden:* cells with `kind: null` render the hidden figure; the preview is `aria-hidden`; chess tiles unchanged.
  - *AC-28 / FR-21 — every hidden piece looks the same:* two hidden cells of a side render identical markup.
  - *AC-29 (FR-28) — home rows and middle rows visibly marked:* preview cells carry zone classes or `data-zone` for home and middle rows.

### 39. `[P]` `DuelPicker` weapon glyphs

- **Plan:** Decision 5; Contract `weaponOnly`; Touched `games/rps/DuelPicker.tsx`; Frontend unit (DuelPicker tests switch to `PieceFigure`, same queries). **Spec:** FR-27, NFR-5.
- **Files:** `frontend/src/games/rps/DuelPicker.tsx`, `DuelPicker.module.css`, `DuelPicker.test.tsx`
- **Depends on:** 36
- **Do:** Each of the three pick buttons shows `<PieceFigure kind={weapon} side={own side} weaponOnly />` beside its text label; the button keeps its accessible name.
- **Acceptance:**
  - *AC-28 (FR-27) — each kind recognisable by its weapon:* each button renders exactly its own weapon's `KIND_PARTS`, no body.
  - *NFR-5 / AC-27 — playable by keyboard and screen reader:* the existing role/name queries, waiting state and disabled-after-pick tests pass unchanged; the glyph is `aria-hidden`.

### 40. Remove the old piece SVGs and `paths.ts`

- **Plan:** Touched files — the six `.svg` files and `paths.ts` are deleted, along with whatever imports them. **Spec:** FR-27, FR-3.
- **Files:** delete `frontend/src/games/rps/pieces/{rock,paper,scissors,flag,trap,hidden}.svg` and `pieces/paths.ts`
- **Depends on:** 37, 38, 39
- **Do:** Delete them; fix any import that still names them (there should be none after 37–39).
- **Acceptance:**
  - *FR-27 — every piece is drawn as a soldier figure:* no source file under `frontend/src` imports `pieces/paths` or `pieces/*.svg`; typecheck, lint and the frontend unit suite pass; `check-no-apple-assets.sh` passes.

### 41. Look matrix and human look for figures and field

- **Plan:** Test strategy AC-28, AC-29 (look matrix "rps session (guest)" in setup and play, 390 px, light and dark); UI D.19–22. **Spec:** FR-27, FR-28, NFR-5.
- **Files:** `e2e/audi/matrix.ts` (only if the play entry does not yet show own figures and at least one revealed opponent fighter)
- **Depends on:** 40
- **Do:** Run the two "rps session (guest)" matrix entries at 390 px in light and dark on a kept stack (Playwright locked). If the play entry shows no revealed fighter, extend its fixture so it does. Then `/run` and look at setup and play in both themes for the human check.
- **Acceptance:**
  - *AC-28 (FR-27, NFR-5) — Given a board at 390 px wide, in light and in dark mode, when a player looks at their own pieces and the opponent's revealed fighters, then each rock, paper and scissors figure is recognisable by the weapon it holds, the flag and trap are recognisable, every opponent hidden piece looks identical, and a piece of side A can be told from a piece of side B without relying on colour alone:* matrix entries pass; human confirms at `/run`.
  - *AC-29 (FR-28) — both sides' home rows, the empty middle rows and the line between the halves are visible, each square can be told apart from its neighbours, and a selected fighter, its legal targets and the last move are shown on the field … in light and in dark mode:* matrix entries pass; human confirms at `/run`.
  - *AC-27 — whole board visible at 390 px without horizontal scrolling:* `rps-a11y.spec.ts` still passes.
