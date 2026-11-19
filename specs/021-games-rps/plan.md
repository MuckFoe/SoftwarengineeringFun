# 021 — Rock Paper Siege: plan

Spec: `specs/021-games-rps/spec.md` (approved, no open markers). HOW only; requirement IDs refer to the spec.

Revised 2026-11-19 for the spec change that added FR-27 (soldier figures) and FR-28 (playing field), with AC-28 and AC-29. That revision is frontend-only: no backend, data model or wire contract changes. It is laid out under *Figures and playing field* below, and it changes the piece and board lines elsewhere in this plan.

## Decisions for review

1. **A parallel game package, not a generalised session core.** Rock Paper Siege gets its own backend package and tables (`rps_*`), mirroring `app.games.chess` the way chess mirrored `app.present`. Generalising chess's session lifecycle into a shared core would touch every chess module, and the spec puts changes to chess out of scope. Cost: the lifecycle code (join, seats, start, resign, claim, delete, stale, chat) is copied and adapted, about 1,200 lines. What can be shared as-is is shared: `ChessHub` (cap, presence, away timers; its unused `board` field stays `None`), `app.chat.rules`/`app.chat.service.message_dict`, `app.gifs`, `app.accounts.identity`, the close codes.
2. **One secrecy choke point.** Chess sends one snapshot to everyone. Here every outgoing game payload (welcome, state, event, home tile, profile list) goes through one pure module, `app.games.rps.views`, which takes the full stored state plus the recipient and returns only what that recipient may see (FR-21, FR-22, NFR-1). No other module builds board JSON.
3. **No piece ids on the wire.** Pieces are identified by square (0–41), never by an id, so nothing about deal order or kind can leak through ids, including across re-deals.
4. **Events are transient.** Fight, duel and trap results go out once, with the state that follows the action. They are not stored. A reload restores the board, setup and pending duel (FR-24), not the last animation.
5. **Figures are layered inline SVG drawn from one part table, not six single-path files** (FR-27). A chunky cartoon soldier needs at least three tones (body, outline, details) and a separate weapon layer, and a single `currentColor` path cannot carry that. One `PieceFigure` component draws every piece on the board, in the home preview and as the weapon glyphs in the duel picker. That also removes the duplicate piece paths in `RpsBoardPreview` (a follow-up noted at implementation).
6. **The field is drawn in tone, not in a new hue** (FR-28, UI rule 7). There is no green grass: the one-accent rule forbids another hue. Zones are separated by surface tones and an accent-tinted home zone. Squares are rounded tiles separated by gaps that show the field lines. The midline is a solid line.

## Architecture

### Module layout (backend)

```
backend/app/games/rps/
  rules.py    pure game logic: board, deal, legal moves, fight, duel, endings. No I/O.
  views.py    pure: stored state + recipient -> wire dicts (state, event, tile preview).
  repo.py     SQL on the rps_* tables.
  service.py  per-session lock + transactions; seats, start, setup, move, duel, draw,
              resign, claim, delete, snapshot. Returns raw state + raw event.
  ws.py       socket join/leave (as chess), frame handlers, per-recipient encode via views.
  api.py      REST: start, check, reactivate, chat history, chat remove, delete (as chess).
  chat.py     chess/chat.py adapted to rps_chat_message / rps_participant.
  stale.py    chess/stale.py adapted to rps_session.
backend/app/migrations/0016_rps.sql
```

Dependency direction: `api`, `ws` → `service` → `rules`, `repo`; `ws` → `views` → `rules`. `rules` and `views` import nothing from the app except each other's types. `app.home`, `app.accounts`, `app.deletion` import `app.games.rps.{repo,views,service,ws}` exactly where they import chess today. Nothing in `app.games.chess` imports from `rps`; `rps` imports only `app.games.chess.hub.ChessHub`.

### Touched shared modules

| Module | Change | FR |
|---|---|---|
| `games/catalog.py` | add `Game(id="rps", name="Rock Paper Siege", description=…, start_path="/api/games/rps/sessions")` | FR-1, FR-3 |
| `main.py` | include rps routers, start `rps.stale.run_periodically`, `app.state.rps_hubs = {}` | FR-2 |
| `config.py` | none: rps reuses `chess_abandon_seconds` (spec 014's 2 minutes) | FR-2 |
| `home/service.py`, `home/api.py` | rps tiles in `games` (see Contracts); `connected_now()` also reads `rps_hubs`; `_GUEST` gains `rps_participant` | FR-25, NFR-1 |
| `accounts/repo.py`, `accounts/api.py` | kind `"rps"`, title "Rock Paper Siege", host rule as chess, connected from `rps_hubs` | FR-2 (spec 012) |
| `deletion/repo.py`, `deletion/service.py` | kind `"rps"`: purge order and lock as chess, `rps.ws.close_session` | FR-2 (spec 019) |

### Frontend

```
frontend/src/games/rps/
  rpsTypes.ts            wire types (Contracts below), strict
  rpsSocket.ts           chessSocket.ts adapted: URL, close codes, rejoin key "rps-rejoin:<invite>"
  rpsState.ts            reducer + selectors: role, bottom side, selected square, targets, announcements
  RpsBoard.tsx/.css      7×6 playing field (FR-28), own side at the bottom, keyboard play
  SetupBar.tsx/.css      place flag / place trap, Re-deal, Ready
  DuelPicker.tsx/.css    rock / paper / scissors pick, waiting state, last tied round
  RpsSeatsPanel.tsx      two seats + viewers, take/leave seat (as chess SeatsPanel, sides not colours)
  RpsResult.tsx          result banner text per reason; ClosedSheet reused from chess/ResultBanner if
                         its `result` type can widen to a string union, else a copy
  RpsSessionWindow.tsx   composes the above with Window, AppHeader, InviteLink, ChatPane, useChat,
                         GameControls-like row (Start, Offer draw, Accept/Decline, Resign, Claim, Delete)
  pieces/figureParts.ts  original soldier-figure artwork as data: shared body parts + per-kind parts (FR-27)
  pieces/PieceFigure.tsx inline SVG figure for (kind | hidden, side); used by board, home preview, duel picker
```

Touched: `App.tsx` (route `/games/rps/s/:invite`), `games/gamesApi.ts` (`createRpsSession`, `getRpsSession`), `games/GamesWindow.tsx` (start any catalogue game through its `start_path` and route by `id`), `api/types.ts` (`GameTile` union, `RecentSession.kind` gains `"rps"`), `home/GameTile.tsx` + new `home/RpsBoardPreview.tsx`, `home/HomeLanding.tsx` (open route by tile `game`), `home/rejoinToken.ts` (also read `rps-rejoin:*`), `pages/ProfileSessions.tsx` and `shell/useJumpIndex.ts` (kind `"rps"` label, icon and route `/games/rps/s/`), `styles/tokens.css` + Keycloak theme copy.

**New UI primitives: none.** The board, pieces, setup bar and duel picker are game-specific components (as the chess `Board` is), built from `Button`, `Card`, `SegmentedControl`, `Banner`, `InlineMessage`, `LiveBadge`.

## Data model (`0016_rps.sql`)

Same lifecycle columns and checks as `chess_session`/`chess_participant`/`chess_chat_message` (0008, 0011, 0012), names prefixed `rps_`, seats `a`/`b` instead of white/black:

- `rps_session`: `id, invite_id unique, starter_participant_id, a_participant_id, b_participant_id, current_game_id, started_by_sub, created_at, last_activity_at, stale_at, deleted_at, deleted_reason ('resignation','abandonment','starter','admin'), deleted_by_sub`.
- `rps_participant`: as `chess_participant`, with the account unique index and the first-signed-in index.
- `rps_chat_message`: as `chess_chat_message`.

Game state:

```sql
create table rps_game (
    id                 uuid primary key default gen_random_uuid(),
    session_id         uuid not null references rps_session (id),
    a_participant_id   uuid not null references rps_participant (id),
    b_participant_id   uuid not null references rps_participant (id),
    first_side         text not null check (first_side in ('a','b')),        -- FR-8
    started_at         timestamptz not null,
    a_ready            boolean not null default false,                        -- FR-6
    b_ready            boolean not null default false,
    turn               text null check (turn in ('a','b')),   -- null in setup, during a duel, ended
    ply                int not null default 0,                -- completed turns
    draw_offer_by      text null check (draw_offer_by in ('a','b')),
    ended_at           timestamptz null,
    result             text null check (result in ('a','b','draw')),
    reason             text null check (reason in ('flag','no_moves','resignation',
                                                   'abandonment','agreement')),   -- FR-20
    check ((ended_at is null) = (result is null) and (result is null) = (reason is null))
);
-- Phase is derived: ended if ended_at; play if a_ready and b_ready; else setup.

create table rps_piece (
    game_id   uuid not null references rps_game (id),
    square    smallint not null check (square between 0 and 41),   -- row * 7 + col
    side      text not null check (side in ('a','b')),
    kind      text not null check (kind in ('rock','paper','scissors','flag','trap')),
    revealed  boolean not null default false,                       -- FR-12; never true for flag/trap
    primary key (game_id, square)
);
-- A removed piece's row is deleted (no history is kept: out of scope).

create table rps_duel (                                            -- FR-13, NFR-3
    game_id      uuid primary key references rps_game (id),
    from_square  smallint not null,      -- the attacker, still on its square
    to_square    smallint not null,      -- the defender
    attacker     text not null check (attacker in ('a','b')),
    round        int  not null default 1,
    a_pick       text null check (a_pick in ('rock','paper','scissors')),
    b_pick       text null check (b_pick in ('rock','paper','scissors')),
    last_a_pick  text null,              -- the previous, tied round; shown to everyone
    last_b_pick  text null
);
```

Plus: `alter table deleted_session` drops and re-adds its `kind` check with `'rps'`.

Board coordinates: col 0–6, row 0–5, `square = row*7 + col`. Side `a` owns rows 0–1, side `b` rows 4–5. Clients render the recipient's own side at the bottom; viewers and the home preview put `a` at the bottom.

## Contracts

### `rules.py` (pure)

```python
Side = Literal["a", "b"]; Weapon = Literal["rock", "paper", "scissors"]
Kind = Weapon | Literal["flag", "trap"]

@dataclass(frozen=True)
class Piece: side: Side; kind: Kind; revealed: bool
Board = Mapping[int, Piece]                       # square -> piece

def home_squares(side: Side) -> list[int]                       # the 14 squares
def deal(side: Side, flag: int, trap: int, rng: random.Random) -> dict[int, Piece]   # FR-4
def redeal(board: Board, side: Side, rng: random.Random) -> dict[int, Piece]         # FR-5: fighters only
def place(board: Board, side: Side, what: Literal["flag","trap"], square: int) -> dict[int, Piece]
    # FR-4/5: moves flag or trap to any own home square; whatever stood there swaps into the
    # vacated square. Raises Illegal outside the side's home rows.
def beats(x: Weapon, y: Weapon) -> bool                          # weapon order
def legal_moves(board: Board, side: Side) -> dict[int, list[int]]  # FR-9, FR-10, FR-18
def resolve_move(board: Board, side: Side, frm: int, to: int) -> MoveOutcome
    # Moved | Fought(winner: "attacker"|"defender") | DuelStarted | Trapped | FlagTaken | Illegal(code)
def resolve_duel(a_pick: Weapon, b_pick: Weapon, attacker: Side) -> Literal["attacker","defender"] | None
def apply(board: Board, outcome: MoveOutcome) -> dict[int, Piece]   # the board after it (FR-12, 14, 15)
def first_side(prev: PrevGame | None, a_pid, b_pid, rng) -> Side
    # FR-8: if the previous non-first-mover is seated, they go first; elif the previous first
    # mover is seated, the other seat goes first; else random.
```

Randomness: `service` passes one module-level `secrets.SystemRandom()` (NFR-1). Tests pass a seeded `random.Random`.

### `views.py` (pure — the secrecy filter)

```python
Recipient = Literal["a", "b", "viewer"]
def state_for(full: FullState, recipient: Recipient) -> dict    # the "state" payload below
def event_for(event: RawEvent, recipient: Recipient) -> dict | None
def tile_board(full: FullState) -> list[dict | None]             # 42 cells, player-visible only
```

Rules applied, in one place: own pieces in full; opponent pieces as `kind: null` unless a revealed fighter; viewer sees all kinds (FR-21); flag and trap of the opponent are always `null`; during setup the opponent's 14 squares are all `kind: null` (FR-7); duel picks: only `your_pick` for a player and nobody's current-round pick for anyone else, `last_round` for all (FR-13, FR-21); `legal` only to the side to move; after `ended`, every piece's kind to everyone (FR-20). `tile_board` = the intersection of the two players' views (revealed fighters only).

### WebSocket `GET /api/games/rps/sessions/{invite}/ws?name=&rejoin=`

Join, cap, rejoin token, close codes (4404, 4403, 4411, 4422, 4409), stale guard and chat/GIF frames exactly as chess.

Client → server (game frames; all refused with `error {code}` to the sender only):

| type | fields | refused when |
|---|---|---|
| `take_seat`, `leave_seat`, `start`, `resign`, `claim_win`, `delete_session` | as chess | as chess |
| `place` | `what: "flag"\|"trap"`, `square` | not a player, ready, not own home square |
| `redeal` | — | not a player, ready |
| `ready` | — | not a player, already ready |
| `move` | `from`, `to` | not your turn, duel pending, `to` not in `legal[from]` |
| `duel_pick` | `weapon` | no duel, not a player, already picked this round |
| `offer_draw`, `answer_draw` | `accept: bool` on answer | as chess; offer cleared by the next `move` (FR-19) |

Server → client: `welcome {you:{participant_id, is_starter}, rejoin_token, state}`, `state {state, event?}`, `error {code}`, `closed`, chat frames as chess. After every committed change, `ws` sends each connection its own `views.state_for` (+ `event_for`).

`state`:

```ts
interface RpsState {
  invite_id: string; stale: boolean;
  seats: { a: Seat | null; b: Seat | null }; viewers: Person[];
  you: "a" | "b" | "viewer";
  game: null | {
    status: "setup" | "play" | "ended";
    ready: { a: boolean; b: boolean };
    first: "a" | "b"; turn: "a" | "b" | null; ply: number;
    pieces: { square: number; side: "a" | "b"; kind: Kind | null; revealed: boolean }[];
    legal: Record<number, number[]>;          // empty unless it is your move
    duel: null | { from: number; to: number; attacker: "a" | "b"; round: number;
                   picked: { a: boolean; b: boolean }; your_pick: Weapon | null;
                   last_round: { a: Weapon; b: Weapon } | null };
    draw_offer_by: "a" | "b" | null; claim_available_to: "a" | "b" | null;
    result: "a" | "b" | "draw" | null;
    reason: "flag" | "no_moves" | "resignation" | "abandonment" | "agreement" | null;
  };
}
type RpsEvent =
  | { kind: "moved"; from: number; to: number }
  | { kind: "fight"; from: number; to: number; attacker: Weapon; defender: Weapon; winner: "attacker" | "defender" }
  | { kind: "duel"; from: number; to: number; weapon: Weapon }          // tie: picking starts
  | { kind: "duel_round"; picks: { a: Weapon; b: Weapon }; outcome: "again" | "attacker" | "defender" }
  | { kind: "trapped"; from: number; to: number; attacker: Weapon | null } // to both players (FR-15); attacker is null for the trap's owner, who learns only that a hidden fighter fell in (user decision 2026-11-15); the attacking side and viewers get the weapon
  | { kind: "flag"; from: number; to: number };
```

Resign, claim and delete close the session as in chess (`closed` + `ClosedSheet`).

### Service flow (one `async with lock(session_id), conn.transaction()` per call)

- `start`: create `rps_game` with `first_side` (FR-8), `rules.deal` both sides with a random flag and trap square, write 28 pieces.
- `place` / `redeal` / `ready`: rewrite that side's 14 rows; on the second `ready`, set `turn = first_side`, then the FR-18 check for that side.
- `move`: `rules.resolve_move`; `Moved`/`Fought`/`Trapped` → apply, `ply += 1`, clear draw offer, `turn` = other side, FR-18 check (end with `no_moves` if none); `DuelStarted` → mark both revealed, insert `rps_duel`, `turn = null`; `FlagTaken` → end, reason `flag`.
- `duel_pick`: store the pick; when both are in, `resolve_duel`; tie → `round += 1`, move picks to `last_*`, clear picks; decided → apply as `Fought`, delete `rps_duel`, continue as `move` (FR-14, FR-17).
- `snapshot`: load session, game, pieces, duel → `FullState` (no filtering here).

### REST

`POST /api/games/rps/sessions` → `201 {invite_id}`; `GET /api/games/rps/sessions/{invite}` → `{full, stale, …}` as chess `CheckOut`; `POST …/reactivate`, `GET …/chat`, `DELETE …/chat/{id}`, `DELETE …/{invite}`: as chess. `GET /api/games` lists both games.

### Home (`/api/home`), profile, jump bar

`games` entries become a union keyed by `game`:

```ts
type GameTile =
  | ({ game: "chess" } & ExistingChessTileFields)
  | { game: "rps"; id: string; invite_id: string; title: "Rock Paper Siege";
      starter: { id: string; name: string };
      status: "waiting" | "setup" | "in_progress"; turn: "you" | "opponent" | "none";
      live: boolean; participant_count: number; participants: HomeParticipant[];  // ≤ AVATAR_CAP
      board: ({ side: "a" | "b"; kind: Weapon | null } | null)[] };               // 42, views.tile_board
```

Visibility: the same participant-row membership query as chess (`_GAMES` on `rps_*`), active and not stale or deleted (FR-25). `board` comes from `views.tile_board`, so even a viewer of the session gets hidden pieces (AC-24). **"Home changed" trigger:** none new. The home feed's existing 5 s poll and debounced refetch pick up rps tiles; live state and avatars come from `rps_hubs` at request time. Profile rows (spec 012) and jump bar items come from `GET /api/me/sessions` with kind `"rps"`, which the jump bar already lists (FR-26).

## UI notes (constitution-ui)

- **Sides** without a second hue (as revised for the figures, see *Figures and playing field*): side `a` = `--accent` filled pieces, side `b` = `--text` outlined pieces, so they differ by shape, not only by colour. Hidden pieces use `hidden.svg` in the side's style. Each piece has a fill and an edge (stroke), and, as in chess, it counts as readable when either one reaches 3:1 against the square. Side `a`: fill `--rps-side-a` (alias of `--accent`), edge `--rps-side-a-edge` (alias of `--on-accent`). Side `b`: fill `--rps-side-b-fill` (alias of `--bg`), edge `--rps-side-b` (alias of `--text`). Single-colour pieces fail on one square colour in each theme (as low as 1.28:1), so the fill-plus-edge rule above was chosen at implementation on 2026-11-15. New tokens `--rps-side-a`, `--rps-side-a-edge`, `--rps-side-b`, `--rps-side-b-fill` (aliases), plus `--rps-trap-flash` aliased to `--danger` for the trap notice, in light and dark and in the Keycloak theme copy. Squares no longer use `--board-light` / `--board-dark`; the field tokens below replace them on this board (chess keeps them).
- **Narrow:** `grid-template-columns: repeat(7, minmax(0, 1fr))`, `aspect-ratio: 7 / 6`, inline size capped by the window width and `100dvh` minus header, dock and the setup/duel bar, so the whole board fits at 390 px.
- **Keyboard:** `role="grid"` named "Rock Paper Siege board", roving tabindex, arrows move focus, Enter/Space selects a fighter then a target, Escape cancels. In setup, Enter on a home square places whichever of flag/trap the `SegmentedControl` selects. Duel picker: three buttons, focus moves to it when a duel starts and back to the board after.
- **Screen reader:** each cell "Your rock, C2", "Opponent hidden piece, D5", "Empty, E3" (columns A–G, rows 1–6 from the reader's own side; viewers from side a). One polite live region announces events (fight result, duel tie or win, trapped, flag taken, game over) only when a new event arrives.
- **Reduced motion:** fight and trap effects are CSS transitions on motion tokens, so `--motion-*: 0s` turns them off. No other animation besides `LiveBadge`.
- **Original assets (FR-3, NFR-6):** the figure part table is drawn for this repo, with no names, sprites, poses or sounds taken from the original game. `check-no-apple-assets.sh` still passes.

## Figures and playing field (FR-27, FR-28)

### Figure construction (FR-27)

- **Grid and silhouette.** A 48-unit grid (the viewBox is cropped to the art, see the look fixes below). Every figure, hidden or not, shares one silhouette: a round helmet, a big head, a short wide body and stubby legs, filling about 40×44 units and standing on a base line at y=45. The silhouette is identical for every kind, so the outline of a piece never gives away its kind.
- **Chunky look.** The outline stroke is 3 units with `stroke-linejoin` and `stroke-linecap: round`, and there are no details thinner than 2 units. At 390 px a square is about 50 px wide and the figure about 40 px tall, so a 3-unit stroke draws at about 2.5 px.
- **Weapon carries the kind.** The weapon is held up in front of the chest and takes about 40 % of the figure's width, so the kind reads from the weapon and not from anything else:
  - rock: a lumpy boulder held in both hands
  - paper: a sheet with a folded corner and two text lines
  - scissors: open blades with two round handles
- **Flag and trap.**
  - flag: the same soldier holding a pole with a pennant above the helmet. The pennant may extend beyond the silhouette, because the flag is never shown to the opponent (FR-21).
  - trap: no soldier. A chunky toothed jaw trap on a pressure plate, drawn with the same stroke and tones. It too is never shown to the opponent, as a trap.
- **Hidden piece.** The common soldier with both arms behind its back and no weapon layer. The SVG is emitted from `kind: null` alone. The component has no input that could make one hidden figure differ from another, so the DOM cannot leak the kind (FR-21, FR-22 stay enforced server-side as before).
- **Parts.** `figureParts.ts` exports `BODY: Part[]`, `HIDDEN_ARMS: Part[]` and `KIND_PARTS: Record<Kind, Part[]>`, where `Part = { d: string; role: "fill" | "edge" | "detail" }`. `fill` parts are painted with the side's fill and stroked with its edge colour. `edge` parts are strokes only. `detail` parts (eyes, helmet rim, paper lines) are filled with the edge colour.

- **Look fixes, 2026-11-19, after the first look at 390 px:**
  - **Bigger figures.** The figure fills its cell (`inline-size: 100%`, not 82 %). The viewBox is cropped to the art plus its contour (`0 -1.5 48 50`), not the plain 48 grid.
  - **Contour.** Each layer is drawn twice: first every `fill` and `edge` part as a 6-unit stroke in `--rps-figure-contour` (a new alias of `--text`), then the parts themselves. The contour shows only outside the silhouette. Without it, side a's `--on-accent` edge vanished on a light tile. `detail` parts get no contour.
  - **Flag.** The bearer is the common soldier drawn at 72 % (`FLAG_BEARER` transform on its own `<g>`) beside a tall pole (`FLAG_POLE`). The cloth is about 22×10 units with a swallowtail and a roundel, and it flies left over the helmet. `KIND_PARTS.flag` is `FLAG_ARMS` plus `FLAG_POLE`.

- **Marks and zone tones, 2026-11-19, second look fix:**
  - **Zone tones.** In dark mode, `--surface-1` and `--surface-2` were only about 1.1:1 apart. So `--rps-zone-middle` is now `--surface-3` and `--rps-field` is `--surface-4`. Home and middle are held to at least 1.25:1 apart in both themes.
  - **Neutral marks.** The target dot and ring use `--rps-target` (alias of `--text`). The last move is diagonal hatching in `--rps-last-move` (alias of `--text-muted`) instead of a `--highlight` tint. Before this, the target dot, the last move and side a's pieces were all the same blue. Blue on the board now means side a and the focus ring only.

### Contract

```ts
type PieceFigureProps = {
  kind: Kind | null;          // null = hidden
  side: "a" | "b";
  title?: string;             // omitted when the cell itself carries the accessible name
  weaponOnly?: boolean;       // duel picker glyph: only KIND_PARTS[weapon], no body
};
// renders <svg viewBox="0 -1.5 48 50" aria-hidden={!title} data-side={side}>
// with fill/stroke from var(--rps-side-*) tokens via CSS classes, never literals
```

### Side marks (NFR-5: not by colour alone)

Both sides keep the fill-and-edge token pairs already in this plan: side `a` is accent-filled with an `--on-accent` edge, side `b` is `--bg`-filled with a `--text` edge. To set the sides apart by shape as well, each helmet gets an emblem drawn as a `detail` part: a round boss for side `a` and a horizontal bar for side `b`. These emblems are the only per-side geometry. Hidden figures carry them too, because a piece's side is always public.

### Playing field (FR-28)

- **Zones.** Each cell gets `data-zone="home-bottom" | "middle" | "home-top"`, derived from its row and from which side is drawn at the bottom. Zone tones are new alias tokens, in light and dark and in the Keycloak copy:
  - `--rps-field`: the field and gap colour (alias of `--surface-4`; was `--surface-3`)
  - `--rps-zone-home`: both home zones (alias of `--surface-1`)
  - `--rps-zone-middle`: the two empty rows (alias of `--surface-3`; was `--surface-2`, see the second look fix)
  - `--rps-zone-home-rule`: a 2-unit inner rule along the outer edge of each home zone, so the zone reads as a team area (alias of `--accent` at the existing `--edge-light` weight). Renamed at implementation on 2026-11-19 from `--rps-zone-home-accent`, because the one-accent guard test rejects any other token named `*accent*`.
- **Squares.** Each cell is a tile with `--radius-sm`, a 1 px `--rps-field-line` outline and a `--space-2` gap on the field. There are no checker tones. Decided 2026-11-19 at implementation: `--rps-field` (`--surface-3`) reaches only 1.10–1.34:1 against the zone tones, and no surface alias reaches 3:1. So the tile outline carries the 3:1 square boundary, and the gap colour is not held to 3:1. The midline stays distinct because it is thicker (3 units against 1 px).
- **Midline.** A 3-unit line drawn as a board `::after` across the row 2/3 boundary in `--rps-field-line` (alias of `--ui-stroke`).
- **Highlights.** The existing selection, target and last-move styling is kept and re-checked on the new tones:
  - selected fighter: a two-tone ring, an outer `--focus` ring with a thin inner `--bg` ring. Decided 2026-11-19: `--focus` alone reaches only 2.96:1 on `--rps-zone-middle` in light. The two-tone ring is visible on any tone, because `--focus` against `--bg` reaches 3:1.
  - legal target: a centred `--rps-target` dot (neutral, see the second look fix)
  - last move: both squares hatched in `--rps-last-move`
- **Motion.** No new animation and no idle movement of the figures. Fight and trap effects are unchanged and stay on motion tokens, so reduced motion turns them off.
- **Size.** The narrow-width sizing rule is unchanged. The figure fills the cell (`inline-size: 100%`; see the look fixes above).

### Touched files

| File | Change |
|---|---|
| `games/rps/pieces/figureParts.ts`, `PieceFigure.tsx` | new; replace the six `.svg` files and `paths.ts`, which are deleted, along with whatever imports them |
| `games/rps/pieces/pieces.test.ts` | rewritten for the figures (see tests) |
| `games/rps/RpsBoard.tsx`, `RpsBoard.module.css` | `PieceFigure`, `data-zone`, tiles, midline, field tokens |
| `home/RpsBoardPreview.tsx` | `PieceFigure` and the field look at preview size, still `aria-hidden` |
| `games/rps/DuelPicker.tsx` | `PieceFigure weaponOnly` glyphs |
| `styles/tokens.css`, Keycloak theme copy, `tokens`/`contrast` tests | `--rps-field`, `--rps-field-line`, `--rps-zone-home`, `--rps-zone-middle`, `--rps-zone-home-rule` |

## Test strategy

Levels: **unit** = pytest on `rules`/`views` (no DB) and vitest component/reducer tests; **integration** = pytest against the real Postgres and app (`TestClient` sockets), as `test_chess_*`; **E2E** = Playwright on the kept stack; **look** = `e2e/audi/matrix.ts`. No mocks (constitution 4). Fixed boards for integration tests are written through `repo` into the real database by a test helper, not by stubbing the random source.

| AC | Test |
|---|---|
| AC-1 | integration `test_games_api` lists `rps`; vitest `GamesWindow` starts it and routes to `/games/rps/s/…` |
| AC-2 | integration `test_rps_ws`: 3 joins → 2 seats + viewer, 6th closed 4403, seat switch only when free |
| AC-3 | human review at `/sdd-validate` (screens and `git ls-files`); no denylist test, since it would put the original's name in the repo |
| AC-4 | unit `test_rps_rules`: deal gives 4/4/4 + flag + trap on home squares; `place` anywhere in 14 |
| AC-5 | unit: three `redeal`s keep flag/trap, keep 4/4/4, stay on the other 12 squares |
| AC-6 | integration `test_rps_setup`: `place`/`redeal` after `ready` refused, `move` refused until both ready |
| AC-7 | integration: record every frame to A during B's setup, assert no `kind` and no flag/trap info for side b |
| AC-8 | unit: `first_side` over 2,000 `SystemRandom` draws within 45–55 %; alternation by participant incl. seat swaps |
| AC-9, AC-10 | unit `legal_moves` on fixed boards; integration: `move` out of turn refused |
| AC-11 | integration: B's frame after A's move shows the square with `kind: null` |
| AC-12 | unit `resolve_move`/`apply` for win and loss; integration both players see both weapons and `revealed` |
| AC-13 | integration `test_rps_duel`: A's frames contain no `b_pick` before B picks; tie repeats; decisive round resolves |
| AC-14 | unit: winner keeps its weapon after a duel |
| AC-15 | unit + integration: attacker removed, `trapped` event to both, trap `kind: null` for A afterwards, second attacker removed |
| AC-16 | unit + integration: flag capture ends with `reason: flag` |
| AC-17 | unit: turn passes after fight and after duel |
| AC-18 | unit: boxed-in and no-fighters positions; integration: game ends `no_moves` at turn start |
| AC-19 | integration `test_rps_draw`: accept → draw, decline and move both clear; unit: 500 quiet moves don't end |
| AC-20 | integration: ended state shows every kind to A, B and viewer |
| AC-21 | unit `test_rps_views` (every recipient × phase); integration: viewer gets no pick until both in |
| AC-22 | integration: viewer of game 1 seated in game 2 receives the player view only |
| AC-23 | integration `test_rps_restart` (marked `slow`): unconfirmed setup and pending pick survive an app restart |
| AC-24 | integration `test_home`: rps tile fields, `board` hidden for a session viewer, absent for a non-member and guest of another session; vitest `GameTile` rps variant; E2E home opens the session |
| AC-25 | vitest `useJumpIndex` route for `rps`; E2E jump bar opens it; dock *Games* reaches the catalogue |
| AC-26 | E2E `rps-latency.spec.ts` as `chess-latency`: fight visible on three pages within 1 s |
| AC-28 | vitest `pieces.test.ts`: each of rock/paper/scissors/flag/trap renders its own `KIND_PARTS` and no other kind's; two hidden figures of the same side serialise to identical markup, and the markup contains no weapon part; side `a` and `b` figures differ in their emblem part, not only in class; every `d` is drawn from `figureParts` (no inline art). `contrast.test.ts`: every piece's fill or edge reaches 3:1 against `--rps-zone-home` and `--rps-zone-middle`, in light and dark. Look matrix: the "rps session (guest)" entries in setup and play, at 390 px in light and dark, now show own figures and revealed fighters. Recognisability itself is a human check at `/run` per task and at `/sdd-validate`. |
| AC-29 | vitest `RpsBoard`: cells carry the right `data-zone` for a player at either side and for a viewer; a selected fighter, its targets and the last move keep their accessible names and states. `contrast.test.ts`: `--rps-field-line` (midline and tile outline) reaches 3:1 (non-text) against both zone tones, in light and dark; `--focus` reaches 3:1 against `--bg` (the two-tone ring) and the target dot and `--highlight` tint stay readable on both zones. `--rps-field` is not held to 3:1 (decided 2026-11-19). Look matrix as AC-28. |
| AC-27 | E2E `rps-a11y.spec.ts`: 390 px, dark, reduced motion, keyboard-only setup + move + duel, accessible names and live announcement; vitest `RpsBoard` names and keys; look matrix entries "rps session (guest)" in setup and in play |

Frontend unit: `rpsState` reducer (events → announcements, selection, own side at the bottom), `SetupBar`, `DuelPicker` (waiting, disabled after pick), `RpsBoard` (roles, names, keyboard), `tokens`/`guard`/`contrast` tests covering the new tokens, including the five field tokens from the 2026-11-19 revision. `RpsBoardPreview` and `DuelPicker` tests switch to `PieceFigure`, with the same role and name queries.

## Constitution compliance

| Rule | How |
|---|---|
| 1 Test-first | Every AC above maps to a test that `/sdd-tasks` puts before its implementation. |
| 2 Green before done | Per-task `scripts/check.sh` on the kept stack. The restart test is `slow`. New integration files reuse chess's fixtures so the run stays under 5 min. |
| 3 Traceable | Table above; `tasks.md` names the AC per task. |
| 4 Real dependencies | Real Postgres and app; randomness made deterministic by passing a seeded `random.Random` into pure `rules` functions and by writing fixed boards through `repo`. No mocks. |
| 5 Fixed stack | FastAPI, Postgres, React/TS strict, Vite, compose. No departure. |
| 6 Dependencies | None new. `secrets`/`random` are stdlib; python-chess is not used by rps. |
| 7 No secrets | None involved; rejoin tokens are hashed as in chess. |
| 8 Lint | ruff, biome, tsc as usual. |
| 9 Architecture | Module layout and dependency direction stated above. |
| 10 / UI A.7 | Home tile kind, `/api/home` change and the trigger are named above (no new trigger: polling). |
| UI A.8 | Existing *Games* dock entry; sessions in the jump bar through `/api/me/sessions`. |
| UI A.9 | Guests and invitees as chess; secrecy is enforced server-side in `views`. |
| UI B.5–12 | Tokens only: five aliases for the sides, five for the field, and one each for the figure contour, target and last move, mirrored in Keycloak. One accent: the field is drawn in surface tones with no green, and the sides differ by fill vs outline plus a helmet emblem. Primitives reused; `PieceFigure` is a game component, not a primitive. The figure art is original and drawn as data. |
| UI C.13–18 | Narrow fit, light/dark, reduced motion, keyboard and screen-reader behaviour above; preview board `aria-hidden`; first paint does not wait on the tile board. |
| UI D.19–22 | Component tests, look matrix entries, E2E specs listed above; `/run` look per visible task. |

**Conflict to flag: none.** The FR-28 'playing field' is drawn under rule B.7 (one accent), so it reads as a field in tone and lines, not as a green pitch. If you want green turf, that needs a constitution exception first. Note for review: Decision 1 accepts duplicated lifecycle code to keep chess untouched. If you would rather extract a shared session core first, that is a separate refactor spec before this one.
