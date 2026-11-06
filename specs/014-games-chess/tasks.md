# 014 — Games section, starting with chess: tasks

Approved 2026-11-06.

Paths are relative to the repo root. Frontend tests are colocated (`X.test.tsx` next to `X.tsx`); a component's `.module.css` goes with it and isn't listed separately. Backend tests live under `backend/tests/{unit,integration}/`.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6, 7 — all `[P]` | Nothing depends on anything yet: schema, pure rules, catalogue, frontend types/state, artwork, Games page, profile kind. No two touch the same file. |
| 2 | 8, 9, 10, 11, 12, 13, 14, 15, 16 — all `[P]` | Each needs only a wave-1 piece: outcome extends `rules.py` (2), repo needs the schema (1), hub needs `rules` (2), every frontend component needs `chessTypes`/`chessState` (4), Board needs the pieces (5). |
| 3 | 17, 18, 19 — all `[P]` | Service core needs rules, repo, hub. The profile union needs the repo. The session window assembles every frontend component from wave 2. |
| 4 | 20 | REST create/pre-join calls `service.create_session` (17) and registers the router in `main.py`. |
| 5 | 21 | WS join and seat frames need the REST create (20) and both share `main.py`. |
| 6 | 22 | *Start* is the first game frame; it touches `service.py` and `ws.py`, like everything after it. |
| 7 | 23 | Moves need a started game (22) and outcome detection (8). |
| 8 | 24 | Draw offers need moves (23), since a move clears the offer. |
| 9 | 25 | Resign and delete close the session; claim (26) reuses `delete_session`. |
| 10 | 26 | Claim needs `delete_session` (25) and the hub's away timer (10). |
| 11 | 27 | Chat adds frames to `ws.py` and routes to `api.py`. It goes after the game frames so the edits to those files don't conflict, and after deletion (25) so chat history can be checked to return 410. |
| 12 | 28 | Stale has to refuse every changing frame, so it comes after all of them exist (22–27). |
| 13 | 29 | The restart test covers moves and chat together, so it needs 23 and 27. |
| 14 | 30, 31, 32, 33 — all `[P]` | E2E needs the whole stack. Separate spec files; Playwright runs are batched under the shared lock. |

## Checklist

- [x] **1** — `[P]` Migration 0008: chess tables
- [x] **2** — `[P]` Rules: legal moves, apply, SAN, board view (python-chess)
- [x] **3** — `[P]` Games catalogue and `GET /api/games`
- [x] **4** — `[P]` Frontend chess types, FEN parsing, state reducer
- [x] **5** — `[P]` Piece artwork: 12 in-repo SVGs
- [x] **6** — `[P]` Games window and *Games* in the main navigation
- [x] **7** — `[P]` Profile sessions: chess kind (frontend)
- [x] **8** — `[P]` Rules: game outcome (checkmate and the four draw rules)
- [x] **9** — `[P]` Chess repository
- [x] **10** — `[P]` Chess hub: connections, away tracking, board cache, abandon setting
- [x] **11** — `[P]` Chess WebSocket client
- [x] **12** — `[P]` Board component: rendering, orientation, pointer and keyboard input
- [x] **13** — `[P]` Promotion picker
- [x] **14** — `[P]` Seats panel
- [x] **15** — `[P]` Game controls
- [x] **16** — `[P]` Move list and result banner
- [x] **17** — `[P]` Service core: lock, create, join, seats, snapshot
- [x] **18** — `[P]` Profile sessions: chess kind (backend union)
- [x] **19** — `[P]` Chess session window and routes
- [x] **20** — REST: create session and pre-join check
- [x] **21** — WebSocket: join, welcome, seat frames, away, participant cap
- [x] **22** — Start a game
- [x] **23** — Moves and automatic game end
- [x] **24** — Draw offers
- [x] **25** — Resign and delete session (starter and admin)
- [x] **26** — Claim the win after abandonment
- [x] **27** — Session chat
- [x] **28** — Stale sessions and admin reactivation
- [x] **29** — Restart durability (slow)
- [x] **30** — `[P]` E2E: chess session flows
- [x] **31** — `[P]` E2E: move latency
- [x] **32** — `[P]` E2E: keyboard play, accessibility and appearance
- [x] **33** — `[P]` E2E: restart in the hub harness (slow)

## Tasks

### 1. `[P]` Migration 0008: chess tables

- **Plan:** Data model. **Spec:** FR-27, NFR-3, NFR-4.
- **Files:** `backend/app/migrations/0008_chess.sql`; test `backend/tests/integration/test_chess_schema.py`
- **Depends on:** nothing
- **Do:** Create `chess_session`, `chess_participant`, `chess_game`, `chess_move`, `chess_chat_message` (column-for-column `presentation_chat_message`, FKs to the chess tables) and the index and late FKs exactly as in plan.md *Data model*. No cascades, nothing dropped.
- **Acceptance:**
  - *NFR-3/NFR-4* — inserting a second `chess_move` with the same `(game_id, ply)` fails.
  - The `check` constraints refuse: `deleted_at` without `deleted_reason`; white = black participant; an ended game without `result`/`reason`; a `draw_offer_by` on an ended game; a `uci` not matching the pattern; `hidden_at` without `account_sub`.
  - A second `chess_participant` with the same `(account_sub, session_id)` fails.
  - Migration applies on a fresh test DB alongside 0001–0007 (as `test_present_schema.py`).

### 2. `[P]` Rules: legal moves, apply, SAN, board view (python-chess)

- **Plan:** Rules (`rules.replay`, `rules.apply`, `rules.view`); Constitution item 6. **Spec:** FR-15, FR-16, FR-17, FR-18, FR-19.
- **Files:** `backend/app/games/chess/rules.py` (+ empty `backend/app/games/__init__.py`, `backend/app/games/chess/__init__.py`), `backend/pyproject.toml` + `backend/uv.lock` (add `chess`); test `backend/tests/unit/test_chess_rules.py`
- **Depends on:** nothing
- **Do:** Add python-chess. Implement `replay(ucis)`, `apply(board, from_sq, to_sq, promotion) -> Applied | Illegal` (with `promotion_required` and refusal of an unnecessary promotion), and `view(board) -> BoardView` (`fen`, `turn`, `check_square`, `legal` for the side to move with promotions collapsed, `promotions`). `Applied.outcome` stays `None` until task 8. `rules` imports nothing from `app`. Positions in tests are built by playing moves.
- **Acceptance:**
  - *AC-13 (FR-15) — Given White to move from the starting position, when White's player picks the knight on g1, then f3 and h3 are marked as its legal destinations and no other square is:* `view(start).legal["g1"] == ["f3", "h3"]` (as a set); `legal` holds only white pieces.
  - *AC-14 (FR-16) — kingside and queenside castling when allowed; castling through check, out of check, or after the king or rook has moved; an en passant capture immediately after the opposing pawn's two-square advance and one move later; a move that leaves their own king in check — each legal one is accepted and each illegal one is refused with the board unchanged:* one test case per situation; on `Illegal` the board's FEN is unchanged.
  - *AC-15 (FR-17) — a white pawn on the seventh rank, moved forward, is promoted to the chosen piece (each of queen, rook, bishop, knight):* four cases; without `promotion` → `Illegal("promotion_required")`; the from-square appears in `view.promotions`; `legal` lists the destination once.
  - *AC-16 (FR-18) — the move list shows standard algebraic notation (`e4`, `exd5`, `Bb5+`, `O-O`, `e8=Q`):* `Applied.san` equals each of those.
  - *AC-17 (FR-19) — when a move gives check, the checked king is marked; the mark disappears once the check is resolved:* `view.check_square` set to the king's square, then `None` after the reply.

### 3. `[P]` Games catalogue and `GET /api/games`

- **Plan:** `games/catalog.py`, `games/api.py`; Contracts REST `GET /api/games`. **Spec:** FR-1, FR-2.
- **Files:** `backend/app/games/catalog.py`, `backend/app/games/api.py`, `backend/app/main.py` (register router); test `backend/tests/integration/test_games_api.py`
- **Depends on:** nothing (creates `backend/app/games/__init__.py` too if task 2 hasn't landed; both create it empty)
- **Do:** A static list of games; chess `{id: "chess", name, description, start_path: "/api/games/chess/sessions"}`. Route returns it to anyone.
- **Acceptance:**
  - *AC-1 (FR-1, FR-2) — they see a list containing chess with its name and a short description:* `GET /api/games` without auth → 200, one entry `id == "chess"` with non-empty `name` and `description`.

### 4. `[P]` Frontend chess types, FEN parsing, state reducer

- **Plan:** `chessTypes.ts`, `fen.ts`, `chessState.ts`; Frontend behaviour → orientation. **Spec:** FR-20, FR-21.
- **Files:** `frontend/src/games/chess/chessTypes.ts`, `fen.ts`, `chessState.ts`; tests `fen.test.ts`, `chessState.test.ts`
- **Depends on:** nothing
- **Do:** Types mirror the plan's `Snapshot`/`Game`/`Seat`/`Person`/`You`/frames and `ErrorCode` exactly. `fen.ts` turns a FEN's placement into 64 squares (display only, no rules). `chessState.ts`: reducer over `welcome`/`state`/`session_closed`/`error` plus local UI state (selected square, flip); derived `role(you, state)` (white/black/viewer) and `bottom = flip ? opposite(base) : base` with `base` = own colour if seated else White.
- **Acceptance:**
  - *AC-18 (FR-20) — White's player sees White at the bottom, Black's player sees Black at the bottom, the viewer sees White at the bottom; when the viewer flips their view, only their own view changes:* reducer tests for the three roles and a flip; flip is local state, never in an outgoing frame.
  - *AC-19 (FR-21) — on join/reload they see the current position, full move list, whose turn and their own role immediately:* reducing a single `welcome` yields position, moves, turn and role with no further message.
  - `fen.ts`: start position maps to the 32 expected pieces; an empty board maps to 64 empty squares.

### 5. `[P]` Piece artwork: 12 in-repo SVGs

- **Plan:** `pieces/*.svg`; Frontend behaviour → styling. **Spec:** NFR-7, NFR-5.
- **Files:** `frontend/src/games/chess/pieces/{w,b}{K,Q,R,B,N,P}.svg` (one asset set, one concern)
- **Depends on:** nothing
- **Do:** Draw 12 pieces for this app (not traced or copied from any chess site/product), each with an outline so it reads on both light and dark squares in both appearances.
- **Acceptance:**
  - *NFR-7 — artwork made for this app:* a commit note states they were drawn in-repo; no external source or licence header.
  - Each file is valid SVG with a `viewBox`, no embedded raster, no scripts; biome/lint passes on the import.

### 6. `[P]` Games window and *Games* in the main navigation

- **Plan:** `GamesWindow.tsx`, `gamesApi.ts`, `AreaNav.tsx`. **Spec:** FR-1, FR-2, FR-3.
- **Files:** `frontend/src/games/gamesApi.ts`, `frontend/src/games/GamesWindow.tsx`, `frontend/src/components/AreaNav.tsx`; tests alongside
- **Depends on:** nothing (the route is added in task 19)
- **Do:** `gamesApi`: `listGames()`, `createChessSession()`, `getChessSession(invite)` (pre-join check, 404/410 mapped), using `api/client`. `GamesWindow` lists games with name, description and a *Start* button; *Start* on chess posts and navigates to `/games/chess/s/:invite`. `AreaNav` gets *Games* → `/games`.
- **Acceptance:**
  - *AC-1 (FR-1, FR-2) — when they choose Games in the main navigation, they see a list containing chess with its name and a short description:* vitest `AreaNav` has a *Games* link to `/games`; `GamesWindow` renders chess's name and description from a mocked `listGames`.
  - *AC-2 (FR-3) — a visitor not signed in starts a chess game and a session with an invite link is created:* vitest: *Start* calls `createChessSession` and navigates to `/games/chess/s/<invite>`, with no sign-in required.

### 7. `[P]` Profile sessions: chess kind (frontend)

- **Plan:** `ProfileSessions.tsx` (+ chess in `KIND_LABEL` / `KIND_ROUTE`). **Spec:** FR-31.
- **Files:** `frontend/src/pages/ProfileSessions.tsx`; its test
- **Depends on:** nothing
- **Do:** Add `"chess"` with label "Chess" and route `/games/chess/s/:invite`.
- **Acceptance:**
  - *AC-28 (FR-31) — both appear in their list of sessions as chess sessions, and reopening one opens it:* vitest with two `kind: "chess"` entries → both labelled as chess, each links to its `/games/chess/s/<invite>`.

### 8. `[P]` Rules: game outcome (checkmate and the four draw rules)

- **Plan:** Rules (`rules.outcome`). **Spec:** FR-22, FR-23, FR-26.
- **Files:** `backend/app/games/chess/rules.py`; `backend/tests/unit/test_chess_rules.py`
- **Depends on:** 2
- **Do:** `outcome(board)` returns the first of checkmate (win for mover), stalemate, insufficient material, threefold (`can_claim_threefold_repetition`), fifty moves (`can_claim_fifty_moves`); `apply` fills `Applied.outcome`. Draws apply automatically, without a claim.
- **Acceptance:**
  - *AC-20 (FR-22) — `1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#` ends the game as a win for White by checkmate:* outcome `(white, checkmate)` after the fourth white move, `None` before.
  - *AC-21 (FR-23) — games played into a stalemate, king against king, the same position for the third time with the same side to move, and 50 moves by each side without capture or pawn move each end as a draw with that reason:* four positions reached by play; reasons `stalemate`, `insufficient_material`, `threefold_repetition`, `fifty_moves`; the threefold case is not a draw on the second occurrence, and the fifty-move case not at 99 half-moves.
  - `replay` of a game's UCI list detects threefold repetition reached before the replay point.

### 9. `[P]` Chess repository

- **Plan:** `chess/repo.py`; Data model. **Spec:** FR-27, FR-34, NFR-4.
- **Files:** `backend/app/games/chess/repo.py`; test `backend/tests/integration/test_chess_repo.py`
- **Depends on:** 1
- **Do:** SQL on `chess_*` tables only: create session; lookup by invite (`deleted_at is null`, and a separate lookup that reports deleted for 410); lock row `for update`; insert/find participant (by rejoin-token hash, by account); set starter/seats/current game; insert game; insert/list moves; set draw offer; end game; soft-delete session; touch activity; stale/unstale.
- **Acceptance:**
  - *FR-27/NFR-4 — the session, participants, seats, position (move list) and result are kept:* round-trip each through a real DB; moves come back in `ply` order.
  - *FR-34 — its invite link no longer opens it:* after `soft_delete`, the normal invite lookup returns nothing and the deleted lookup reports it as deleted.

### 10. `[P]` Chess hub: connections, away tracking, board cache, abandon setting

- **Plan:** `chess/hub.py`; Away tracking and the claim; Participant cap; `config.py` `chess_abandon_seconds`. **Spec:** FR-28, FR-32, FR-33, NFR-6.
- **Files:** `backend/app/games/chess/hub.py`, `backend/app/config.py`, `.env.example` (`CHESS_ABANDON_SECONDS=120`); test `backend/tests/unit/test_chess_hub.py`
- **Depends on:** 2 (board cache holds a `chess.Board`)
- **Do:** Per-session hub: sockets per participant (newer replaces older → 4409), `away_since[participant_id]` set when a seated player's last socket closes and cleared on reconnect, one `asyncio` timer per away seated player during a game (cancelled on reconnect) calling a supplied callback, `board` cache, cap reservation (`sessions.hub.MAX_PARTICIPANTS`, counting connected non-seated + all seated), `mark_all_seated_away(now)` used when a hub is first loaded. `away_since` uses `app.clock`.
- **Acceptance:**
  - *FR-28 — a player who disconnects is away; when they return, they are no longer away:* `away_since` set on last-socket close, cleared on reconnect.
  - *FR-33 — an opponent who comes back resets the 2 minutes:* with a short `chess_abandon_seconds`, the timer fires after the interval; reconnecting before it cancels it, and the next disconnect starts a fresh interval.
  - *FR-32 — 5 participants at most; a seated player keeps their seat while away:* cap admits up to 5 counting away seated players, refuses the sixth, always admits a rejoining seated player.
  - *NFR-6 — nothing runs while nobody is acting:* no timer exists unless a seated player is away during a game.
  - `Settings().chess_abandon_seconds == 120` by default, overridable by env.

### 11. `[P]` Chess WebSocket client

- **Plan:** `chessSocket.ts` (pattern of `presentSocket.ts`); Contracts WebSocket. **Spec:** FR-21, FR-28, NFR-1.
- **Files:** `frontend/src/games/chess/chessSocket.ts`; its test
- **Depends on:** 4
- **Do:** Connect to `/api/games/chess/sessions/{invite}/ws?name=&rejoin=`, store the rejoin token per invite, reconnect with it, typed send helpers for every client frame, dispatch server frames to the reducer. Map close codes 4404/4403/4422/4409/4411 to distinct terminal states (no reconnect on 4403, 4404, 4411, 4422, 4409).
- **Acceptance:**
  - *AC-25 (FR-28) — when they reopen the session, they are Black again:* after a drop the client reconnects with the stored `rejoin` token.
  - *AC-32, AC-34* — close 4403 → `full`, 4411 → `deleted`, 4404 → `not_found`; none of them reconnects.
  - Each send helper emits exactly the frame shape in plan.md (`move` carries `ply`).

### 12. `[P]` Board component: rendering, orientation, pointer and keyboard input

- **Plan:** Frontend behaviour → Board. **Spec:** FR-14, FR-15, FR-18, FR-19, FR-20, NFR-5.
- **Files:** `frontend/src/games/chess/Board.tsx`; its test
- **Depends on:** 4, 5
- **Do:** 8×8 `<button>` grid in `role="grid"`, oriented by `bottom`; accessible names ("e4, white pawn", "e4, empty" + "legal move"/"last move"/"in check"); highlights for selection, legal destinations, last move, check. Only the player to move can select, and only their pieces. Click-click and pointer-event drag share one path. Roving tabindex, arrows, Enter/Space select/confirm, Escape cancels. `aria-live="polite"` announcement of the last move and the result. Calls `onMove(from, to)`; promotion is handled by the parent via task 13.
- **Acceptance:**
  - *AC-13 (FR-15) — when White's player picks g1, f3 and h3 are marked and no other square:* vitest from a start-position snapshot.
  - *AC-12 (FR-14) — Black's player or a viewer cannot move; White cannot pick a black piece:* clicking does not select and `onMove` is never called.
  - *AC-16 (FR-18) — the move e2–e4 is highlighted:* `last_move` squares carry the "last move" mark.
  - *AC-17 (FR-19) — the checked king is marked as in check, and the mark disappears once resolved:* mark follows `check_square`.
  - *AC-18 (FR-20)* — white/black/viewer/flipped orientations render the expected bottom rank.
  - *AC-31 (NFR-5) — keyboard only: select a piece, choose a destination, complete a move; a screen reader announces each square's piece and the last move:* vitest keyboard flow calls `onMove`; accessible names and live-region text asserted.

### 13. `[P]` Promotion picker

- **Plan:** `PromotionPicker.tsx`. **Spec:** FR-17, NFR-5.
- **Files:** `frontend/src/games/chess/PromotionPicker.tsx`; its test
- **Depends on:** 4
- **Do:** Four buttons (queen, rook, bishop, knight) with text names, focus on open, keyboard reachable, Escape cancels. Returns `"q" | "r" | "b" | "n"` or cancel.
- **Acceptance:**
  - *AC-15 (FR-17) — they are asked to choose queen, rook, bishop or knight, and the chosen piece is used (each choice, including a knight):* vitest: each button returns its letter.
  - *AC-31 — including a promotion choice by keyboard only:* Tab/arrow + Enter selects; Escape cancels and nothing is sent.

### 14. `[P]` Seats panel

- **Plan:** Frontend behaviour → SeatsPanel. **Spec:** FR-7, FR-8, FR-9, FR-28.
- **Files:** `frontend/src/games/chess/SeatsPanel.tsx`; its test
- **Depends on:** 4
- **Do:** White and Black seat cards (name, signed-in mark, "away" mark, or "free"), viewer list. With no game in progress: *Take seat* on a free seat, *Leave seat* and *Switch to …* for your own seat (when the other is free). Hidden during a game.
- **Acceptance:**
  - *AC-8 (FR-9) — they see both players' names with their colours and both viewers' names.*
  - *AC-6 (FR-7)* — viewer sees *Take seat* on free Black → sends `take_seat black`; White's player sees *Leave seat* → `leave_seat`; Black's player with White free sees *Switch to White* → `take_seat white`.
  - *AC-7 (FR-8)* — during a game, no seat buttons are rendered.
  - *AC-25 (FR-28) — others are told Black's player is away:* `away: true` shows the away mark.

### 15. `[P]` Game controls

- **Plan:** Frontend behaviour → GameControls. **Spec:** FR-10, FR-12, FR-24, FR-25, FR-33, FR-35.
- **Files:** `frontend/src/games/chess/GameControls.tsx`; its test
- **Depends on:** 4
- **Do:** *Start* always shown with no game in progress, disabled with "Waiting for a second player" or "Only players can start". During a game for players: *Resign* (confirm), *Offer draw*; the opponent of an offer sees *Accept*/*Decline*. *Claim win* visible, disabled until `claim_available_to` is your colour, then enabled with confirm. *Delete session* only for the starter or an admin, with confirm. Uses the app's confirm dialog from `ui/`.
- **Acceptance:**
  - *AC-9 (FR-10, FR-12) — only White seated → Start unavailable with "waiting for a second player"; both seated and a viewer looks → unavailable with "only players can start".*
  - *AC-22 (FR-24) — when a player chooses resign but does not confirm, the game continues:* cancel sends nothing; confirm sends `resign`.
  - *AC-23 (FR-25)* — offer sends `offer_draw`; opponent's Accept/Decline send `answer_draw` true/false; the offerer sees no Accept/Decline.
  - *AC-33 (FR-33)* — *Claim win* disabled while `claim_available_to` is null or the other colour; enabled for your colour; confirm sends `claim_win`.
  - *AC-35 (FR-35) — another participant cannot delete; the starter choosing delete without confirming changes nothing:* button absent for non-starter non-admin; cancel sends nothing; confirm sends `delete_session` (starter). For admins the parent's handler is called (REST, task 19).

### 16. `[P]` Move list and result banner

- **Plan:** `MoveList.tsx`, `ResultBanner.tsx`. **Spec:** FR-18, FR-26, FR-34, FR-35.
- **Files:** `frontend/src/games/chess/MoveList.tsx`, `frontend/src/games/chess/ResultBanner.tsx`; their tests
- **Depends on:** 4
- **Do:** Numbered SAN pairs. Banner text from `result`/`reason`: "White wins — checkmate", "Black wins — resignation", "Draw — agreement", "Draw — stalemate" / "insufficient material" / "threefold repetition" / "fifty-move rule", "… — abandonment". A "session closed" sheet for `session_closed` (with result if any, or deleted by starter/admin) and a link back to Games.
- **Acceptance:**
  - *AC-16 (FR-18) — after e2–e4 the move list shows `1. e4`;* black's reply appears on the same numbered line.
  - *AC-20/AC-21 (FR-26)* — banner text per result and each reason.
  - *AC-22 (FR-34) — everyone connected sees "White wins — resignation" and that the session is closed;* *AC-35* — closed by starter/admin shows that it was deleted.

### 17. `[P]` Service core: lock, create, join, seats, snapshot

- **Plan:** Authority and flow; Service signatures (`create_session`, `join`, `take_seat`, `leave_seat`, `snapshot`, `Refused`). **Spec:** FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, NFR-2, NFR-3.
- **Files:** `backend/app/games/chess/service.py`; test `backend/tests/integration/test_chess_service.py`
- **Depends on:** 2, 9, 10
- **Do:** `lock(session_id)` per-session `asyncio.Lock`; every changing call: lock → transaction → `for update` → check → write → commit → return `Snapshot`. A shared precondition helper refuses with `session_stale` when `stale_at` is set (used by every changing call from here on). `join`: name rules from `present.service.valid_name`, `join_as_account` for signed-in, rejoin token reuse; the first participant becomes starter and White; then Black; then viewers; viewer if a game is in progress. `take_seat` (also switch) / `leave_seat` refused with `game_in_progress` during a game, `seat_taken` if taken. `snapshot` assembles seats (with `away` from hub), connected viewers and `game` (null until first start) using `rules.view`.
- **Acceptance:**
  - *AC-4 (FR-5) — the starter sits at White and the second person at Black.*
  - *AC-5 (FR-6) — both seats taken, a third person is a viewer; a game in progress, someone new is a viewer* (game row inserted directly via repo for this test).
  - *AC-6 (FR-7)* — viewer takes free Black → Black; White leaves → viewer, White free; Black moves to free White → White, Black free.
  - *AC-7 (FR-8, NFR-2)* — with a game in progress, `take_seat`/`leave_seat`/switch → `Refused("game_in_progress")`, seats unchanged.
  - *AC-8 (FR-9)* — snapshot lists White, Black and two viewers by name.
  - *AC-30 (NFR-3) — two viewers take one free seat at the same moment: exactly one becomes the player and both see the same result:* `asyncio.gather` of two `take_seat` → one snapshot, one `seat_taken`; a following `snapshot` equals the successful one.
  - *FR-3* — `create_session` creates a session with an invite id and no participants.

### 18. `[P]` Profile sessions: chess kind (backend union)

- **Plan:** `accounts/repo.py` (+ `'chess'` kind in the profile union and `_TABLES`); Contracts `GET /api/me/sessions`. **Spec:** FR-31, FR-34.
- **Files:** `backend/app/accounts/repo.py`; test `backend/tests/integration/test_me_sessions.py` (extend)
- **Depends on:** 9
- **Do:** Add chess to the union with kind `"chess"`, title `"Chess"`, excluding `deleted_at is not null` sessions and hidden participants, and to `_TABLES` for hide prefs.
- **Acceptance:**
  - *AC-28 (FR-31) — a signed-in user starts one chess session and joins another; both appear in their list of sessions as chess sessions:* two chess participants for one `account_sub` → two entries `kind == "chess"`.
  - *AC-34 (FR-34) — it is gone from the profile of every signed-in participant:* after soft delete, the entry is absent for each account.

### 19. `[P]` Chess session window and routes

- **Plan:** `ChessSessionWindow.tsx`, `App.tsx` routes; Frontend behaviour. **Spec:** FR-3, FR-4, FR-17, FR-21, FR-29, FR-30, FR-32, FR-34, FR-35.
- **Files:** `frontend/src/games/chess/ChessSessionWindow.tsx`, `frontend/src/App.tsx` (`/games`, `/games/chess/s/:invite`); tests alongside
- **Depends on:** 6, 11, 12, 13, 14, 15, 16
- **Do:** Pre-join check via `getChessSession`: name prompt (not for signed-in users), "This session is full", "This session no longer exists" (404/410/4411, link to Games), stale banner with *Reactivate* for admins. Layout: Board + PromotionPicker (opened when the from-square is in `promotions` and the destination is on the last rank), SeatsPanel, GameControls, MoveList, ResultBanner, flip toggle, shared `components/ChatPane` beside the board. Admin delete via REST `DELETE /api/games/chess/sessions/{invite}`. Errors from the server shown as non-blocking messages.
- **Acceptance:**
  - *AC-3 (FR-4) — without an account: name prompt, valid name joins; signed in: no name prompt:* vitest with mocked `useMe`.
  - *AC-15 (FR-17)* — a move from a `promotions` square to the last rank opens the picker; the chosen letter is sent with the `move` frame; cancel sends nothing.
  - *AC-26 (FR-29)* — stale snapshot shows the banner, disables board/seats/Start/chat input; admin sees *Reactivate*.
  - *AC-27 (FR-30)* — the chat pane is rendered beside the board for players and viewers.
  - *AC-32 (FR-32)* — pre-join `full: true` or close 4403 → "This session is full".
  - *AC-34 (FR-34)* — 410 or close 4411 → "This session no longer exists" with a link to `/games`.
  - Routes `/games` and `/games/chess/s/:invite` render their windows (`App.test.tsx`).

### 20. REST: create session and pre-join check

- **Plan:** `chess/api.py`; Contracts REST `POST /api/games/chess/sessions`, `GET /api/games/chess/sessions/{invite}`. **Spec:** FR-3, FR-32, FR-34.
- **Files:** `backend/app/games/chess/api.py`, `backend/app/main.py` (register router); test `backend/tests/integration/test_chess_api.py`
- **Depends on:** 17
- **Do:** `POST` (anyone) → `201 {invite_id}`. `GET` → `200 {invite_id, stale, full}`; `404` unknown; `410 {error: "session_deleted"}` deleted.
- **Acceptance:**
  - *AC-2 (FR-3) — a visitor who is not signed in starts a chess game and a session with an invite link is created:* `POST` without auth → 201 with an invite id; `GET` on it → `stale: false, full: false`.
  - Unknown invite → 404; soft-deleted (via repo) → 410 `session_deleted`.

### 21. WebSocket: join, welcome, seat frames, away, participant cap

- **Plan:** `chess/ws.py`; Contracts WebSocket (join, close codes, `welcome`, `state`, `take_seat`, `leave_seat`); Participant cap. **Spec:** FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-21, FR-28, FR-31, FR-32, NFR-2.
- **Files:** `backend/app/games/chess/ws.py`, `backend/app/main.py` (register ws route); test `backend/tests/integration/test_chess_ws.py`
- **Depends on:** 20
- **Do:** Join as `present.ws` does (account, name, rejoin); close codes 4404, 4403, 4422, 4409. Send `welcome {you, rejoin_token, state}`; broadcast `state` after every committed change; map `Refused` to `error {code}`. On last socket close of a seated player, mark away and broadcast. Load a hub on first access with `mark_all_seated_away`. Cap check with hub reservation.
- **Acceptance:**
  - *AC-2 (FR-3) — the creator is in it and the board shows the starting position in the not started state:* first join → starter, White, `game: null`.
  - *AC-3 (FR-4) — without an account, a valid name joins, an invalid name is refused (4422); a signed-in user joins under their username with no name* (Keycloak fixtures as `test_present_ws_accounts.py`).
  - *AC-4, AC-5, AC-6, AC-8* over real sockets: join order → white, black, viewer; seat frames broadcast the same snapshot to every socket.
  - *AC-7 (NFR-2)* — raw `take_seat`/`leave_seat` frames during a game → `error game_in_progress`, seats unchanged.
  - *AC-25 (FR-28) — Black's player closes their browser: the others are told Black is away, the seat stays theirs and nobody else can take it; when they reopen, they are Black again:* snapshot `away: true`; viewer `take_seat black` → `seat_taken`; rejoin token → Black, `away: false`.
  - *AC-28 (FR-31) — reopening makes them the same participant (same seat or role):* a signed-in user reconnecting without a token gets the same participant and seat.
  - *AC-32 (FR-32) — a sixth person is refused with a message that the session is full:* 5 joined (2 seated + 3 viewers) → sixth closes 4403; an away seated player rejoins while full → admitted.

### 22. Start a game

- **Plan:** Service `start`; WS `start` frame; Authority and flow (races). **Spec:** FR-10, FR-11, FR-12, NFR-3.
- **Files:** `backend/app/games/chess/service.py`, `backend/app/games/chess/ws.py`; test `backend/tests/integration/test_chess_ws_game.py`
- **Depends on:** 21
- **Do:** `start` creates a `chess_game` for the seated pair, repoints `current_game_id`, clears the hub board cache; refused with `seats_incomplete`, `not_a_player`, `game_in_progress`. Snapshot `game` shows the start position, `turn: "white"`, `ply: 0`.
- **Acceptance:**
  - *AC-9 (FR-12)* — `start` with one seat free → `seats_incomplete`; from a viewer → `not_a_player`.
  - *AC-10 (FR-11) — when either player presses Start, every participant sees the standard starting position with White to move:* all three sockets receive that snapshot.
  - *AC-30 (NFR-3) — both players press Start at the same moment: exactly one game starts:* two concurrent `start` frames → one game row; the other gets `game_in_progress`; every socket's last snapshot is identical.

### 23. Moves and automatic game end

- **Plan:** Service `move` (validation order); Rules; hub board cache; Data model (`(game_id, ply)`). **Spec:** FR-13, FR-14, FR-16, FR-17, FR-18, FR-19, FR-21, FR-22, FR-23, FR-26, NFR-2, NFR-3.
- **Files:** `backend/app/games/chess/service.py`, `backend/app/games/chess/ws.py`; test `backend/tests/integration/test_chess_ws_game.py` (extend)
- **Depends on:** 8, 22
- **Do:** `move` checks: not stale → game in progress (`no_game`) → sender is the current game's player for `turn` (`not_a_player` / `not_your_turn`) → `ply` matches (`out_of_date`) → `rules.apply` (`illegal_move`, `promotion_required`). Insert `chess_move`, clear `draw_offer_by`, on an outcome set `ended_at`/`result`/`reason`, all in one transaction. Board rebuilt from `chess_move` on cache miss. After a game ends, seat frames and `start` work again.
- **Acceptance:**
  - *AC-12 (FR-14, NFR-2) — Black's player, or a viewer, tries to move any piece — through raw frames — refused, board unchanged; White moving a black piece is refused:* `ply` unchanged after each.
  - *AC-14 (FR-16)* — one illegal move over WS → `illegal_move`, snapshot unchanged; a stale `ply` → `out_of_date`.
  - *AC-15 (FR-17)* — an under-promotion to knight is accepted and the snapshot shows a knight on the eighth rank; without a choice → `promotion_required`.
  - *AC-16 (FR-18) — e2–e4: every participant's board shows the pawn on e4, the move highlighted, and the move list `1. e4`:* every socket gets `last_move {e2,e4}`, `moves[0].san == "e4"`.
  - *AC-19 (FR-21) — after ten moves, a reloading viewer or a new participant sees position, full move list, turn and own role without waiting for a move:* a new socket's `welcome` holds all ten moves.
  - *AC-20 (FR-22, FR-26) — the four-move mate ends the game and everyone sees White wins by checkmate:* every socket gets `status: "ended"`, `result: "white"`, `reason: "checkmate"`.
  - *AC-21 (FR-23)* — one draw rule end-to-end (e.g. threefold) → `result: "draw"` with its reason.
  - *AC-11 (FR-13) — after the game ends the final position, move list and result are shown, seats can be changed, and Start is available again; Start begins a new game with an empty move list:* after the mate, `leave_seat`/`take_seat` succeed, `start` → `ply: 0`, `moves: []`; the session still exists (part of *AC-34*).

### 24. Draw offers

- **Plan:** Service `offer_draw`, `answer_draw`; Data model (draw offer column). **Spec:** FR-25, FR-26.
- **Files:** `backend/app/games/chess/service.py`, `backend/app/games/chess/ws.py`; test `backend/tests/integration/test_chess_ws_draw.py`
- **Depends on:** 23
- **Do:** `offer_draw` sets `draw_offer_by` (refused `own_draw_offer` if already yours, `not_a_player` for viewers, `no_game`). `answer_draw` by the opponent only (`no_draw_offer`, `own_draw_offer`): accept ends the game `draw`/`agreement`; decline clears the offer. A move already clears it (task 23).
- **Acceptance:**
  - *AC-23 (FR-25) — White offers and Black accepts: "Draw — agreement"; White offers and Black declines: the game continues and the offer is gone; White offers and then either player moves: the offer is gone.*
  - White answering their own offer → `own_draw_offer`; a viewer offering → `not_a_player`; answering with no offer → `no_draw_offer`.

### 25. Resign and delete session (starter and admin)

- **Plan:** Closing and deleting a session; Service `resign`, `delete_session`; WS `resign`, `delete_session` frames; REST admin `DELETE`; deletion filtering. **Spec:** FR-24, FR-34, FR-35, NFR-2.
- **Files:** `backend/app/games/chess/service.py`, `backend/app/games/chess/ws.py`, `backend/app/games/chess/api.py`; test `backend/tests/integration/test_chess_delete.py`
- **Depends on:** 24
- **Do:** `delete_session(reason, by_participant, by_sub)` ends an in-progress game when resigning, sets the soft-delete columns, commits, then broadcasts `session_closed {result, reason}`, closes every socket 4411 and drops the hub. `resign` → win for the opponent then delete with `resignation`. `delete_session` frame only from the starter (`not_starter`). Admin `DELETE` with the `Admin` dependency → `reason="admin"`. WS join to a deleted session → 4411.
- **Acceptance:**
  - *AC-22 (FR-24, FR-34) — Black resigns: the game ends, everyone connected sees "White wins — resignation" and that the session is closed, and the invite link no longer opens it:* every socket gets `session_closed {result: "white", reason: "resignation"}` then close 4411; `GET` → 410.
  - *AC-34 (FR-34) — anyone opening the invite link is told the session no longer exists:* `GET` → 410, new WS → 4411.
  - *AC-35 (FR-35) — the starter deletes: deleted as in AC-34 and everyone connected is told; an admin does the same: likewise; another participant, or anyone through a manipulated browser, is refused and the session is unchanged:* starter frame → closed with `starter`; admin REST → 204, closed with `admin`; non-starter frame → `not_starter`; non-admin REST → 403; anonymous REST → 401/403; session still opens afterwards.

### 26. Claim the win after abandonment

- **Plan:** Away tracking and the claim; Service `claim_win`; hub timer → snapshot `claim_available_to`. **Spec:** FR-28, FR-33, FR-34, NFR-2.
- **Files:** `backend/app/games/chess/service.py`, `backend/app/games/chess/ws.py`, `backend/app/games/chess/hub.py`; test `backend/tests/integration/test_chess_claim.py`
- **Depends on:** 10, 25
- **Do:** Start the hub timer when a seated player goes away during a game (and for all seated players on hub load); on fire, broadcast a snapshot with `claim_available_to` = the present player's colour. `claim_win` re-checks: game in progress, claimer is the present seated player, opponent still away, `clock.now() - away_since >= chess_abandon_seconds`; else `claim_not_available`. Success → win by `abandonment`, then `delete_session(reason="abandonment")`.
- **Acceptance:**
  - *AC-33 (FR-33, FR-34) — Black away 1:59 → White cannot claim; away 2:00 → White can claim, and after confirming everyone connected sees "White wins — abandonment" and that the session is closed; Black away 90 s, came back and left again, then 60 more s → no claim yet:* with `app.clock.frozen`: 119 s → `claim_not_available`; 120 s → snapshot `claim_available_to: "white"`, claim → `session_closed {white, abandonment}`, close 4411; the 90 s + 60 s sequence → `claim_not_available`.
  - Black (the away side's opponent is not away) or a viewer sending `claim_win` → `claim_not_available`.
  - *AC-25 (FR-28) — when they reopen, they can make their move:* after rejoining within the interval, `claim_available_to` is null and Black's move is accepted.

### 27. Session chat

- **Plan:** `chess/chat.py`; WS chat frames; REST chat history and admin remove. **Spec:** FR-30, FR-34.
- **Files:** `backend/app/games/chess/chat.py`, `backend/app/games/chess/ws.py`, `backend/app/games/chess/api.py`; test `backend/tests/integration/test_chess_chat.py`
- **Depends on:** 25
- **Do:** Copy `present/chat.py`'s shape onto `chess_chat_message`, using `app.chat.rules`/`service`; wire `chat_send`, `gif_search`, `chat_send_gif` unchanged from `present.ws` (fake GIPHY in tests); `GET .../chat` (404/410) and admin `DELETE .../chat/{message_id}` → 204 broadcasting `chat_removed`. Chat sends touch activity.
- **Acceptance:**
  - *AC-27 (FR-30) — a player and a viewer each send a chat message; both appear for every participant, following the chat rules of 002/007:* both `chat_message` frames reach all sockets; an over-length message is refused as in `test_present_ws_chat.py`; GIF send works with the fake.
  - Admin removes a message → `chat_removed` to every socket; non-admin → 403.
  - *AC-34 (FR-34) — its chat can no longer be seen by anyone:* chat history of a deleted session → 410.

### 28. Stale sessions and admin reactivation

- **Plan:** Stale; `chess/stale.py`; `main.lifespan`; REST `reactivate`. **Spec:** FR-29.
- **Files:** `backend/app/games/chess/stale.py`, `backend/app/main.py` (lifespan task), `backend/app/games/chess/api.py` (`POST .../reactivate`); test `backend/tests/integration/test_chess_stale.py`
- **Depends on:** 27
- **Do:** Mirror `present/stale.py` on `chess_session`, skipping deleted rows, hourly from lifespan. Reactivate (admin) clears `stale_at` → `200 {invite_id, stale: false}`, `409 not_stale`. Confirm activity is touched (≤ once a minute) by join, seat change, start, move, draw actions and chat.
- **Acceptance:**
  - *AC-26 (FR-29) — no activity for 30 days: marked stale; board, move list, result and chat visible, but no move, seat change, Start or chat message; an admin reactivates and all of those work again:* `clock.frozen` +30 days → stale; each of `take_seat`, `leave_seat`, `start`, `move`, `offer_draw`, `answer_draw`, `resign`, `claim_win`, `delete_session`, `chat_send` → `session_stale`; `welcome` and chat history still served; admin reactivate → a move is accepted; non-admin → 403; reactivating a fresh session → 409.
  - A session with activity 29 days ago is not marked; a deleted session is never marked.

### 29. Restart durability (slow)

- **Plan:** Test strategy row AC-24; hub load after restart (board rebuilt from `chess_move`, seated players start away). **Spec:** FR-27, NFR-4.
- **Files:** test `backend/tests/integration/test_chess_restart.py` (marked `slow`); fixes only in `backend/app/games/chess/hub.py` / `service.py` if the test exposes a gap
- **Depends on:** 23, 27
- **Do:** Play moves and send chat, restart the app against the same DB (as `test_accounts_slow.py` / `test_learn_persistence.py`), rejoin with tokens.
- **Acceptance:**
  - *AC-24 (FR-27, NFR-4) — after an app restart the session, seats, position, move list and chat are all as they were and play continues:* rejoined `welcome` equals the pre-restart snapshot (apart from `away`), chat history unchanged, the next move is accepted.
  - A game that reached a repeated position before the restart ends by threefold repetition on the third occurrence after it.
  - After restart both seated players start away and `claim_available_to` stays null for the full `chess_abandon_seconds`.

### 30. `[P]` E2E: chess session flows

- **Plan:** Test strategy → E2E. **Spec:** FR-1, FR-3, FR-5, FR-11, FR-18, FR-20, FR-21, FR-24, FR-28, FR-34.
- **Files:** `e2e/chess.spec.ts`
- **Depends on:** 19, 29
- **Do:** Multi-context Playwright flow against the running stack.
- **Acceptance:**
  - *AC-1* — navigate via *Games* in the main navigation → chess listed with description.
  - *AC-2* — anonymous *Start* lands on a board in the not-started state.
  - *AC-4, AC-10, AC-16* — second context joins as Black; *Start*; White plays e4 → all contexts show the pawn on e4, the highlight and `1. e4`.
  - *AC-18* — White's, Black's and a viewer's boards are oriented correctly; the viewer's flip changes only their own.
  - *AC-19* — viewer reloads after ten moves and sees the full state at once.
  - *AC-25* — Black closes their page; others see "away"; Black reopens and moves.
  - *AC-22, AC-34* — Black resigns and confirms; every context sees "White wins — resignation" and the closed sheet; reopening the invite link shows "This session no longer exists".

### 31. `[P]` E2E: move latency

- **Plan:** Test strategy → AC-29 (pattern of `latency.spec.ts`). **Spec:** NFR-1.
- **Files:** `e2e/chess-latency.spec.ts`
- **Depends on:** 19, 29
- **Acceptance:**
  - *AC-29 (NFR-1) — three participants connected; a player makes a move; the other two see it within 1 second.*

### 32. `[P]` E2E: keyboard play, accessibility and appearance

- **Plan:** Test strategy → AC-31; NFR-5 via existing appearance/a11y suites extended to `/games`. **Spec:** NFR-5.
- **Files:** `e2e/chess-a11y.spec.ts`, `e2e/a11y.spec.ts` (+ `/games` and a chess session), `e2e/appearance.spec.ts` (+ `/games` and a chess session, light/dark)
- **Depends on:** 19, 29
- **Acceptance:**
  - *AC-31 (NFR-5) — White's player using only the keyboard can select a piece, choose a destination and complete a move including a promotion choice; a screen reader announces each square's piece and the last move:* keyboard-only game reaching a promotion; accessible names and live-region text asserted.
  - axe scan of `/games` and a chess session finds no WCAG AA violations in light and dark appearance.

### 33. `[P]` E2E: restart in the hub harness (slow)

- **Plan:** Test strategy → AC-24 e2e (as `hub-lifecycle.spec.ts`, `slow`). **Spec:** FR-27, NFR-4.
- **Files:** `e2e/chess-restart.spec.ts`
- **Depends on:** 19, 29
- **Acceptance:**
  - *AC-24 — a game in progress with moves and chat; the app is restarted; session, seats, position, move list and chat are as they were and play continues:* both players' pages recover after the `api` restart and the next move is seen by both.
