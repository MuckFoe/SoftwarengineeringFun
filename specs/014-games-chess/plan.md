# 014 — Games section, starting with chess: plan

HOW for [spec.md](spec.md). Chess becomes a fourth session kind next to coding, learning and presentation. It is built the way presentations (013) were: its own tables, repository, service, in-memory hub and WebSocket. Chat and accounts plug in the same way they do for presentations. The server owns all game state. The browser renders snapshots and sends intents.

## Architecture

### Module layout and dependency direction

```
backend/app/games/
  catalog.py            # FR-1, FR-2: static list of games (id, name, description, route)
  api.py                # GET /api/games
  chess/
    rules.py            # pure: wraps python-chess; no DB, no I/O
    repo.py             # SQL on chess_* tables only
    service.py          # every state change: seats, start, move, end, claim, delete; per-session lock
    hub.py              # in-memory: connections, away-since per participant, claim timer handles
    chat.py             # chat on chess_chat_message (a copy of present/chat.py's shape)
    stale.py            # 30-day stale marking, hourly
    ws.py               # /api/games/chess/sessions/{invite}/ws
    api.py              # REST: create, read, admin delete, admin reactivate, chat history/remove
backend/app/migrations/0008_chess.sql
backend/app/accounts/repo.py      # + 'chess' kind in the profile union and _TABLES
backend/app/main.py               # + routers, + chess stale task in lifespan
backend/app/config.py             # + chess_abandon_seconds (default 120)

frontend/src/games/
  GamesWindow.tsx                 # /games: the catalogue (FR-2), "Start" per game
  gamesApi.ts
  chess/
    ChessSessionWindow.tsx        # /games/chess/s/:invite: join, layout, banners, chat pane
    Board.tsx                     # 8×8 grid, orientation, highlights, pointer + keyboard input
    PromotionPicker.tsx           # FR-17
    SeatsPanel.tsx                # FR-7, FR-9: seats, viewers, away marks, take/leave/swap
    GameControls.tsx              # Start, Resign, Offer/answer draw, Claim win, Delete session
    MoveList.tsx                  # FR-18, numbered SAN pairs
    ResultBanner.tsx              # FR-26, and the "session closed" sheet (FR-34, FR-35)
    chessSocket.ts                # WS client, reconnect, rejoin token (pattern of presentSocket.ts)
    chessState.ts                 # reducer: snapshot + local UI state (selection, flip)
    fen.ts                        # parse a FEN's piece placement into 64 squares (display only)
    chessTypes.ts
    pieces/*.svg                  # 12 piece drawings made for this app (NFR-7)
frontend/src/components/AreaNav.tsx   # + "Games" → /games (FR-1)
frontend/src/App.tsx                  # + the two routes
frontend/src/pages/ProfileSessions.tsx # + chess in KIND_LABEL / KIND_ROUTE (FR-31)
```

Dependencies point one way. `ws`/`api` → `service` → `rules`, `repo`, `hub`. `chat` → `app.chat.rules`/`service`, `repo`, `hub`. `rules` imports nothing from the app. Nothing outside `app.games` imports `app.games.chess`, except `main.py` (routers, lifespan) and `accounts/repo.py`, which only reads chess tables in SQL. On the frontend, `games/chess/*` uses the shared `components/ChatPane`, `ui/*` and `api/client`. Nothing shared imports from `games/`.

### Authority and flow (NFR-2, NFR-3)

Every frame that changes state goes through `service`. A service call:

1. takes `service.lock(session_id)`, an `asyncio.Lock` per session, the same pattern as `present.service.lock`. That works because there is one `api` process.
2. opens a transaction and reads `chess_session ... for update`.
3. checks permission and preconditions against the DB rows and the hub's view of who is connected.
4. writes and commits.
5. returns a `Snapshot`. `ws` broadcasts it to the hub only after the commit.

Races (AC-30) are therefore serialised. The second *Start* finds a game already in progress and gets `error game_in_progress`. The second seat-taker finds the seat taken and gets `error seat_taken`. Everyone receives the same snapshot. Every `move` frame carries `ply`, the number of moves the sender has seen. A move whose `ply` does not match the game's is refused with `out_of_date`, so a move made against an old position can never apply.

### Rules (FR-14–FR-17, FR-22, FR-23)

`rules.py` wraps **python-chess**. No other chess code runs anywhere. The browser gets the legal destinations in each snapshot, so it needs no chess library.

- `rules.replay(ucis: list[str]) -> chess.Board` rebuilds a position from the start position. Replaying the full move stack is what makes threefold repetition detectable after a restart.
- `rules.apply(board, from_sq, to_sq, promotion | None) -> Applied | Illegal`. `Applied` holds `uci`, `san`, `outcome: Outcome | None`. A pawn move to the last rank without a `promotion` is `Illegal("promotion_required")`. A `promotion` on a move that doesn't need one is `Illegal`.
- `rules.outcome(board)` returns the first match of: checkmate → win for the mover; `is_stalemate`; `is_insufficient_material`; `can_claim_threefold_repetition()`; `can_claim_fifty_moves()`. All four draw rules end the game automatically, as FR-23 requires. python-chess calls them "claims", but the plan applies them without anyone claiming. So the 50-move rule triggers at 100 half-moves and repetition on the third occurrence. The 75-move and fivefold rules are never reached.
- `rules.view(board) -> BoardView` holds `fen`, `turn`, `check_square | None` and `legal: dict[str, list[str]]` (from-square → to-squares, side to move only, promotion moves collapsed to one destination). It also holds `promotions: list[str]`, the from-squares whose moves to the last rank need a choice.

The board for the current game is cached in `hub` (`hub.board`), so a move doesn't replay the whole game. On a cache miss (first access after a restart) the board is rebuilt from `chess_move`.

### Away tracking and the claim (FR-28, FR-33)

The hub records `away_since[participant_id]` when a seated player's last socket closes, and clears it on reconnect. While a game is in progress and a seated player is away, the hub runs one `asyncio` timer per away player, of `settings.chess_abandon_seconds` (120; env `CHESS_ABANDON_SECONDS`). When the timer fires it broadcasts a fresh snapshot in which `claim_available_to` is set. If the player reconnects, the timer is cancelled and `away_since` is cleared, so the 2 minutes start again next time.

`service.claim_win` re-checks the condition itself: `clock.now() - away_since >= abandon_seconds`, the opponent is still away, the claimer is the present seated player and a game is in progress. Neither the timer nor the client is trusted for this. Tests drive `app.clock.frozen` for the 1:59 / 2:00 boundary (AC-33).

After an app restart, every seated player starts out away, with `away_since` set when the session's hub is first loaded. A restart therefore gives an absent player the full 2 minutes again, never less. `away_since` is not persisted. This is the conservative reading of "for 2 minutes without interruption".

### Closing and deleting a session (FR-34, FR-35)

All three paths call `service.delete_session(session_id, reason, by)` inside the session lock: resignation (`resign`), a successful claim (`claim_win`), and an explicit delete (`delete_session` frame from the starter, or the admin REST call). The call:

1. ends the game first if one is in progress (resign / claim), writing `result` and `reason`;
2. sets `chess_session.deleted_at`, `deleted_reason`, `deleted_by_sub`;
3. after commit, broadcasts `session_closed {result | null, reason, by}`, then closes every socket with code **4411** (`CLOSE_DELETED`) and drops the hub.

Deletion is a soft delete, the same "nothing dropped, no cascades" rule every earlier migration follows. Every read is filtered by `deleted_at is null`: invite lookup, REST, WS join, chat history, the profile union, the stale job. To every user, a deleted session no longer exists. REST answers `410 {"error": "session_deleted"}`, and the WS closes 4411 at join. The frontend shows "This session no longer exists" with a link back to Games. **Flag for review:** the spec says "delete". If you want the rows physically removed instead, say so; it changes the migration (cascades) and `delete_session` only.

Who may delete: the starter is `chess_session.starter_participant_id`. Over the WS, the server checks that the connection's participant is that one. Admins delete over REST with the existing `Admin` dependency. An admin doesn't need to be a participant. Resignation, a claim and a starter delete need a confirmation, and that confirmation lives in the UI. The server acts on the frame.

### Participant cap (FR-32)

The cap is 5, reusing `sessions.hub.MAX_PARTICIPANTS`. A seated player keeps their seat while away (FR-28), so the count is *connected non-seated participants + seated participants, connected or not*. A rejoining seated player is always admitted, so a full room can't lock a player out of their own game. Everyone else hits the cap check with a reservation in the hub, as in `present.ws`. The socket closes **4403** and the page shows "This session is full".

### Stale (FR-29)

`chess/stale.py` mirrors `present/stale.py` on `chess_session`, skipping deleted rows. It starts as a task in `main.lifespan`. A stale session refuses every changing frame with `error session_stale`: seat, start, move, resign, draw, claim, chat. The starter's delete is refused too, because stale means read-only. Snapshots and chat history still go out. An admin reactivates through REST, which also clears `stale_at`. The window shows the stale banner and, for admins, a *Reactivate* button, as the presentation window does. Activity is touched, at most once a minute, by: join, seat change, start, move, draw actions and chat.

### Frontend behaviour

- **Board** (FR-15, FR-18–FR-20, NFR-5) is an 8×8 grid of `<button>`s inside a `role="grid"`. Each square's accessible name is e.g. "e4, white pawn" or "e4, empty", plus "legal move", "last move" or "in check" when they apply.
  - Orientation is a pure function: `bottom = flip ? opposite(base) : base`, where `base` is the viewer's own colour if seated, otherwise White. Flipping is local state and never sent.
  - Moving: click a piece, then a destination; or drag with pointer events (`pointerdown` on own piece → `pointerup` over a square). Pointer events are used instead of HTML5 DnD so the same code path handles click and drag.
  - Keyboard: roving tabindex, arrows move focus, Enter/Space selects then confirms, Escape cancels.
  - An `aria-live="polite"` region announces the last move ("White: e4") and the result.
- **PromotionPicker**: shown when the chosen from-square is in `promotions` and the destination is on the last rank. Four buttons (queen, rook, bishop, knight), keyboard reachable, Escape cancels the move.
- **SeatsPanel** shows the White and Black seat cards (name, signed-in mark, "away" mark) and the viewer list. Before a game it offers *Take seat* on a free seat, and *Leave seat* / *Switch to …* for your own seat. Those buttons are hidden in progress, and the server refuses them anyway.
- **GameControls**:
  - *Start* is always shown when no game is in progress. Its disabled reason comes from the snapshot: "Waiting for a second player" or "Only players can start" (FR-12).
  - During a game: *Resign* (with confirm), *Offer draw*. The opponent sees *Accept* / *Decline*.
  - *Claim win* is visible and disabled until `claim_available_to` is your colour, then enabled, with confirm.
  - *Delete session* is shown only to the starter (`you.is_starter`) and to admins (`useMe`), with confirm.
- Styling uses the app's existing `ui/` components and theme tokens (003), with light/dark board colours from tokens checked to AA contrast. The pieces are 12 hand-drawn SVGs committed under `pieces/`, each with an outline so they read on both square colours (NFR-7).

## Data model

`backend/app/migrations/0008_chess.sql`. No cascades, nothing dropped.

```sql
create table chess_session (
    id                     uuid primary key default gen_random_uuid(),
    invite_id              text not null unique,
    starter_participant_id uuid null,           -- FK below; set right after the starter's insert
    white_participant_id   uuid null,           -- FK below
    black_participant_id   uuid null,           -- FK below
    current_game_id        uuid null,           -- FK below; the in-progress or last finished game
    created_at             timestamptz not null default now(),
    last_activity_at       timestamptz not null default now(),
    stale_at               timestamptz null,
    deleted_at             timestamptz null,
    deleted_reason         text null check (deleted_reason in ('resignation', 'abandonment', 'starter', 'admin')),
    deleted_by_sub         text null,           -- the admin's sub, else null
    check ((deleted_at is null) = (deleted_reason is null)),
    check (white_participant_id is distinct from black_participant_id or white_participant_id is null)
);

create table chess_participant (              -- same shape as presentation_participant after 0007
    id                uuid primary key default gen_random_uuid(),
    session_id        uuid not null references chess_session (id),
    display_name      text not null,
    rejoin_token_hash text not null unique,
    joined_at         timestamptz not null default now(),
    left_at           timestamptz null,
    account_sub       text null,
    hidden_at         timestamptz null,
    check (hidden_at is null or account_sub is not null)
);
create unique index chess_participant_account on chess_participant (account_sub, session_id)
    where account_sub is not null;

create table chess_game (
    id                   uuid primary key default gen_random_uuid(),
    session_id           uuid not null references chess_session (id),
    white_participant_id uuid not null references chess_participant (id),
    black_participant_id uuid not null references chess_participant (id),
    started_at           timestamptz not null,
    draw_offer_by        text null check (draw_offer_by in ('white', 'black')),
    ended_at             timestamptz null,
    result               text null check (result in ('white', 'black', 'draw')),
    reason               text null check (reason in ('checkmate', 'resignation', 'abandonment',
                             'agreement', 'stalemate', 'insufficient_material',
                             'threefold_repetition', 'fifty_moves')),
    check ((ended_at is null) = (result is null) and (result is null) = (reason is null)),
    check (draw_offer_by is null or ended_at is null)
);

create table chess_move (
    game_id         uuid not null references chess_game (id),
    ply             int  not null check (ply >= 1),
    uci             text not null check (uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
    san             text not null,
    participant_id  uuid not null references chess_participant (id),
    made_at         timestamptz not null,
    primary key (game_id, ply)
);

alter table chess_session
    add foreign key (starter_participant_id) references chess_participant (id),
    add foreign key (white_participant_id)   references chess_participant (id),
    add foreign key (black_participant_id)   references chess_participant (id),
    add foreign key (current_game_id)        references chess_game (id);

create table chess_chat_message ( ... );      -- column-for-column presentation_chat_message,
                                              -- FKs to chess_session / chess_participant
create index chess_chat_message_session on chess_chat_message (session_id, id);
```

- A game in progress is `current_game_id` with `ended_at is null`. Starting a new game creates a `chess_game` row with the seated pair and repoints `current_game_id`. Older games stay as rows but are never read; the spec keeps only the last one visible.
- Seats are frozen during a game by `service` (FR-8). Each game row records its own pair, so moves are authorised against the game, not the current seats.
- `(game_id, ply)` as the primary key makes it impossible for two moves to be stored for one ply (NFR-3, NFR-4). A move commits before it is broadcast.
- The draw offer is one column on the game. Each accepted move clears it in the same transaction (FR-25).

## Contracts

### REST

| Method & path | Who | Request | Response |
|---|---|---|---|
| `GET /api/games` | anyone | — | `200 [{id: "chess", name, description, start_path: "/api/games/chess/sessions"}]` |
| `POST /api/games/chess/sessions` | anyone | — | `201 {invite_id}`. Only the session is created. The starter becomes a participant on their first WS join; since that join finds the session with `starter_participant_id is null`, that participant becomes the starter and takes White (FR-3, FR-5). |
| `GET /api/games/chess/sessions/{invite}` | anyone | — | `200 {invite_id, stale: bool, full: bool}`, the pre-join check the window uses to choose between the name prompt, "full" and the stale banner. `404` unknown, `410 {error: "session_deleted"}` deleted. |
| `GET /api/games/chess/sessions/{invite}/chat` | anyone | — | `200 {messages: [...]}` in `app.chat.service.message_dict` shape. 404/410 as above. |
| `DELETE /api/games/chess/sessions/{invite}/chat/{message_id}` | admin | — | `204`, as `present.api`. |
| `POST /api/games/chess/sessions/{invite}/reactivate` | admin | — | `200 {invite_id, stale: false}`; `409 {error: "not_stale"}`. |
| `DELETE /api/games/chess/sessions/{invite}` | admin | — | `204`. Runs `delete_session(reason="admin", by_sub)`, so connected participants receive `session_closed`. 404/410 as above. |
| `GET /api/me/sessions` | signed in | — | existing; `kind` gains `"chess"`, title `"Chess"` (FR-31) |

### WebSocket `/api/games/chess/sessions/{invite}/ws?name=&rejoin=`

The join is the presentation socket's join (`present.ws`): a signed-in user gets the account's participant via `join_as_account`, otherwise `name` is checked with `present.service.valid_name` rules, and a valid `rejoin` token reuses its participant. Close codes: 4404 not found, 4403 full, 4410 stale-and-not-allowed (unused here, since a stale session still lets you watch), 4422 invalid name, 4409 replaced by a newer socket, **4411 deleted**.

**Server → client**

```ts
type Color = "white" | "black";
type Reason = "checkmate" | "resignation" | "abandonment" | "agreement" | "stalemate"
            | "insufficient_material" | "threefold_repetition" | "fifty_moves";

type Welcome = { type: "welcome"; you: You; rejoin_token: string; state: Snapshot };
type You     = { participant_id: string; is_starter: boolean };     // role is derived from state.seats
type StateMsg = { type: "state"; state: Snapshot };                 // after every change, to everyone
type SessionClosed = { type: "session_closed"; result: Color | "draw" | null; reason: Reason | "starter" | "admin" };
type ErrorMsg = { type: "error"; code: ErrorCode; client_id?: string };
// + the existing chat frames: chat_message, chat_removed, gif_results, ... (unchanged)

type Snapshot = {
  invite_id: string;
  stale: boolean;
  seats: { white: Seat | null; black: Seat | null };
  viewers: Person[];                       // connected participants not seated
  game: Game | null;                       // null until the first Start
};
type Person = { participant_id: string; name: string; signed_in: boolean };
type Seat   = Person & { away: boolean };
type Game = {
  status: "in_progress" | "ended";
  fen: string;
  turn: Color;
  ply: number;
  moves: { san: string; from: string; to: string }[];
  last_move: { from: string; to: string } | null;
  check_square: string | null;
  legal: Record<string, string[]>;         // {} when ended
  promotions: string[];
  draw_offer_by: Color | null;
  claim_available_to: Color | null;
  result: Color | "draw" | null;
  reason: Reason | null;
};
```

There is one snapshot for everyone, so all participants always see the same thing (NFR-3). It is a few KB even late in a game. Sending the whole snapshot every time, instead of diffs, keeps clients from drifting apart.

**Client → server**

```ts
| { type: "take_seat"; color: Color }      // free seat, no game in progress; also used to switch seats
| { type: "leave_seat" }
| { type: "start" }
| { type: "move"; from: string; to: string; promotion?: "q" | "r" | "b" | "n"; ply: number }
| { type: "resign" }
| { type: "offer_draw" }
| { type: "answer_draw"; accept: boolean }
| { type: "claim_win" }
| { type: "delete_session" }
// + chat_send / gif_search / chat_send_gif, unchanged from present.ws
```

`ErrorCode`: `session_stale`, `game_in_progress`, `no_game`, `seat_taken`, `not_seated`, `not_a_player`, `seats_incomplete`, `not_your_turn`, `illegal_move`, `promotion_required`, `out_of_date`, `no_draw_offer`, `own_draw_offer`, `claim_not_available`, `not_starter`, plus the chat codes.

### Service signatures (`app.games.chess.service`)

```python
async def create_session(conn) -> ChessSession
async def join(conn, session, *, name: str | None, account: Account | None, rejoin: str | None,
               hub: ChessHub) -> tuple[Participant, str]                     # (participant, rejoin token); seats per FR-5/FR-6
async def take_seat(conn, session_id, participant_id, color: Color) -> Snapshot
async def leave_seat(conn, session_id, participant_id) -> Snapshot
async def start(conn, session_id, participant_id) -> Snapshot
async def move(conn, session_id, participant_id, frm: str, to: str, promotion: str | None, ply: int) -> Snapshot
async def offer_draw(conn, session_id, participant_id) -> Snapshot
async def answer_draw(conn, session_id, participant_id, accept: bool) -> Snapshot
async def resign(conn, session_id, participant_id) -> Closed
async def claim_win(conn, session_id, participant_id, hub: ChessHub) -> Closed
async def delete_session(conn, session_id, *, reason: DeleteReason, by_participant: UUID | None,
                         by_sub: str | None) -> Closed
async def snapshot(conn, session_id, hub: ChessHub) -> Snapshot
class Refused(Exception): code: ErrorCode                                    # → error {code}
```

`move` validates in this order: not stale → game in progress → the participant is the current game's player for `turn` → `ply` matches → `rules.apply` legal. Then it inserts `chess_move`, clears `draw_offer_by`, and on an `outcome` sets `ended_at`, `result` and `reason`. All of this happens in one transaction.

## Test strategy

Levels, all against real dependencies (constitution 4): Postgres from the test compose, a real python-chess, real WebSockets through the app.

- **Unit, backend** (`tests/unit/test_chess_rules.py`): `rules.py` only, positions built by playing moves.
- **Integration, backend** (`tests/integration/test_chess_*.py`): REST and WS via the app with a real DB. Time is controlled with `app.clock.frozen` and `CHESS_ABANDON_SECONDS`. Restart tests are marked `slow`.
- **Unit, frontend** (vitest): `fen.ts`, `chessState.ts`, `Board`, `PromotionPicker`, `SeatsPanel`, `GameControls`, `GamesWindow`, `AreaNav`, `ProfileSessions`.
- **E2E** (Playwright, `e2e/chess*.spec.ts`): multi-browser-context flows, latency, accessibility (axe, as in `a11y.spec.ts`), restart (as in `hub-lifecycle.spec.ts`, `slow`).

| AC | Test(s) |
|---|---|
| AC-1 | vitest `AreaNav` (Games link), `GamesWindow` (chess listed with description); integration `GET /api/games`; e2e navigate → Games |
| AC-2 | integration create + first join → starter, White, `game: null`; e2e anonymous start lands on board |
| AC-3 | integration WS join anonymous with valid/invalid name; signed-in join with no name (Keycloak fixtures as `test_present_ws_accounts.py`) |
| AC-4, AC-5 | integration: join order → white, black, viewer; join during a game → viewer |
| AC-6 | integration `take_seat` / `leave_seat` / switch sequences, snapshot after each |
| AC-7 | integration: raw frames `take_seat`/`leave_seat` during a game → `game_in_progress`, seats unchanged |
| AC-8 | integration snapshot seats + viewers; vitest `SeatsPanel` renders names, colours, viewers |
| AC-9 | vitest `GameControls` disabled reasons; integration `start` → `seats_incomplete` / `not_a_player` |
| AC-10 | integration `start` → every socket gets the start position, turn white |
| AC-11 | integration: mate → ended snapshot kept, seat change allowed, `start` → `ply 0`, empty moves |
| AC-12 | integration raw `move` frames from Black, a viewer, and White moving a black piece → refused, `ply` unchanged |
| AC-13 | unit `rules.view` legal from g1 = {f3, h3}; vitest `Board` marks exactly those squares |
| AC-14 | unit, one case per listed situation (castling both sides, through/out of check, after king/rook moved, en passant now vs. one move later, self-check); integration one illegal → board unchanged |
| AC-15 | unit promotion to q/r/b/n and `promotion_required`; vitest `PromotionPicker`; integration one under-promotion to knight |
| AC-16 | unit SAN for `e4`, `exd5`, `Bb5+`, `O-O`, `e8=Q`; vitest `MoveList` numbering; integration last_move + moves broadcast |
| AC-17 | unit `check_square` set and cleared; vitest `Board` check mark |
| AC-18 | vitest orientation for white / black / viewer and local flip; e2e two players + viewer contexts |
| AC-19 | integration: 10 moves, new socket's `welcome` has full state; e2e viewer reload |
| AC-20 | unit four-move mate → checkmate/white; integration result broadcast; vitest `ResultBanner` text "White wins — checkmate" |
| AC-21 | unit: stalemate, K vs K, threefold, fifty-move positions reached by play; integration one of them end-to-end with reason |
| AC-22 | integration `resign` → `session_closed`, sockets closed 4411, `GET` → 410; vitest confirm cancel keeps game |
| AC-23 | integration offer/accept, offer/decline, offer then move clears offer, `own_draw_offer` refusal |
| AC-24 | integration `slow`: moves + chat, restart app against the same DB, rejoin → same snapshot, next move accepted; e2e `slow` restart in hub harness |
| AC-25 | integration: Black's socket closes → snapshot `away: true`, `take_seat black` by viewer refused, rejoin token → Black, can move |
| AC-26 | integration with `clock.frozen` +30 days → stale; every changing frame → `session_stale`; history readable; admin reactivate → move accepted |
| AC-27 | integration chat from player and viewer reach all sockets (mirrors `test_present_ws_chat.py`) |
| AC-28 | integration `GET /api/me/sessions` lists both chess sessions; rejoin as account → same seat/role |
| AC-29 | e2e latency (pattern of `latency.spec.ts`): three contexts, move seen by the other two < 1 s |
| AC-30 | integration: two concurrent `start` frames → exactly one game; two concurrent `take_seat` → one success, one `seat_taken`, identical snapshots |
| AC-31 | vitest `Board` keyboard flow incl. promotion; e2e keyboard-only game + axe scan + accessible-name/live-region assertions |
| AC-32 | integration: 5 joined (2 seated + 3 viewers) → sixth closes 4403; away seated player rejoins while full → admitted |
| AC-33 | integration with `clock.frozen`: away 119 s → `claim_not_available`; 120 s → `claim_available_to` in snapshot, claim → `session_closed` abandonment; away 90 s, back, away 60 s → not available |
| AC-34 | integration: after close, `GET` → 410, WS → 4411, chat history → 410, absent from `/api/me/sessions`; after checkmate session still present |
| AC-35 | integration: starter `delete_session` → closed; admin REST delete → closed; other participant → `not_starter`; non-admin REST → 403; vitest confirm cancel |

NFR-1 is covered by AC-29, NFR-2 by AC-7/AC-12/AC-35 (raw frames), NFR-3 by AC-30, NFR-4 by AC-24, NFR-5 by AC-31 plus the existing appearance/a11y suites extended to `/games`. NFR-6 needs no test of its own: no new container, no background work per game, timers only while a seated player is away during a game. NFR-7 is a review check on `pieces/`, which are drawn in-repo and need no licence.

## Constitution compliance

1. **Test-first.** Every row above names the failing test a task starts from. `/sdd-tasks` assigns each its AC.
2. **Green before done.** No new harness. Chess tests join the existing suite; restart tests are marked `slow` to keep the per-task run under 5 minutes.
3. **Traceable tests.** All 35 ACs are mapped in the table.
4. **Real dependencies.** Postgres, python-chess and WebSockets are real. The only fake is GIPHY, which already exists and the chat reuses. Time is controlled through `app.clock` and a config value, not mocked.
5. **Fixed stack.** Python 3.12/FastAPI, PostgreSQL, React/TS strict/Vite, docker compose. No departure.
6. **Dependency justification.** One new dependency:
   - **`chess` (python-chess), backend.** Correct move generation, SAN, check/mate, stalemate, insufficient material, threefold repetition and the 50-move rule (FR-16, FR-18, FR-22, FR-23) are a large, subtle surface. A home-made engine would need perft-level testing to trust. Neither the standard library nor existing code covers any of it. **Flag for review: python-chess is GPL-3.0.** The app is hosted, not distributed, and the GPL only puts obligations on distributing the software (it is not the AGPL). Even so, it is the first copyleft dependency here. If that is unacceptable, the alternative is writing `rules.py` from scratch behind the same interface, at roughly one extra wave of work plus perft tests.
   - No frontend dependency: legal moves come from the server, the board is plain buttons, and the pieces are in-repo SVGs.
7. **No secrets.** Nothing new. `CHESS_ABANDON_SECONDS` is not a secret and goes in `.env.example`.
8. **Lint/format clean.** ruff, biome and tsc apply as usual. Each piece SVG is imported as an asset, not inlined into TS.
9. **Module layout and dependency direction.** Stated in *Architecture*: a self-contained `app.games.chess` and `frontend/src/games/chess`, depending on shared chat, auth, accounts and ui code, and never the other way. The only reverse touch points are `main.py`, `accounts/repo.py` (SQL union), `AreaNav`, `App.tsx` and `ProfileSessions`.

## Decisions for the reviewer

All three approved as proposed, 2026-11-06.

- **Soft delete** for FR-34/FR-35 (see *Closing and deleting*). Rows are kept and never shown, matching the project's "nothing dropped" convention.
- **python-chess (GPL-3.0)**, see constitution item 6.
- **The away timer restarts after an app restart.** An absent player gets a full 2 minutes again after a restart, never less.
