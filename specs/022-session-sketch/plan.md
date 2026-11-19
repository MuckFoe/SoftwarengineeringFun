# 022 — Sketch board in coding sessions: plan

Spec: `specs/022-session-sketch/spec.md` (approved). HOW only; requirement numbers point back to the spec.

## Decisions for the human at this gate

1. **"Suggests clearing or erasing" (FR-18).** The board is a log of actions drawn in order; an erase stroke is an action that rubs out what was drawn before it (see Rendering). Erasing therefore *adds* data and never frees room. Undo and Clear do free it. Proposed: the full message says *"The sketch is full. Clear the board or undo something to make room."* — i.e. FR-18's wording changes "erasing" to "undoing". The alternative (cutting lines geometrically on every erase so a fully rubbed-out line disappears) costs a geometry engine on both client and server for little gain. **Approve the wording change, or send FR-18 back to `/sdd-specify`.**
2. **What "1 MB" counts (NFR-3).** The budget is the drawing *on the board*: the actions after the last effective clear, ≤ 1,000,000 bytes. Content hidden by the most recent clear is kept so that clear can be undone (FR-14) and is dropped at the next clear (see Data model, "Pruning"). Worst-case storage per board is therefore about 2 MB. 2,000 actions fit when they average ≤ 500 bytes (a pen line of ~45 points after simplification, any box or circle, a short erase); a board of only very long scribbles reaches its limit sooner. AC-18's 2,000-action test uses typical actions. **Approve, or tighten NFR-3 in the spec.**

## Architecture

```
SessionWindow (header "Sketch" toggle) ── SketchBoard ── useSketch ── session socket (existing)
       │ stale page ── GET /api/sessions/{invite}/sketch                         │
                                                                                 ▼
                                            sessions/ws.py `_handle_text` ── sketch/service.py
                                                     │ welcome.sketch             │ lock, stale check, budget
                                                     ▼                            ▼
                                              sessions/hub.broadcast     sketch/repo.py ── sketch_action table
                                                                          sketch/rules.py (pure validation)
deletion/repo.py `_PURGE_SQL["coding"]` ── deletes sketch_action rows (FR-17)
```

- **Transport.** Drawing travels over the existing coding-session WebSocket as JSON text frames, like chat (FR-9, NFR-1). No new socket, no Yjs: the board is an append-only, server-ordered log, which gives every participant the same board (FR-10) without a CRDT.
- **Ordering.** The server assigns each action a `seq` (the table's `bigserial`). Inserts and their broadcast run under a per-session `asyncio.Lock` in `sketch/service.py` (the same single-process invariant `sessions/hub.py` relies on), so broadcast order = `seq` order and the budget check is atomic (FR-10, FR-18).
- **Rendering.** One `<canvas>` per board. Visible actions (those after the last clear) are drawn in `seq` order onto one transparent layer; pen, box and ellipse are stroked in their colour, an erase is stroked with `globalCompositeOperation = "destination-out"`, which rubs out everything drawn before it and nothing drawn after (FR-6). Undo removes an action from the log and the board is redrawn, which gives FR-14 for free: undoing a line removes what is left of it; undoing an erase or a clear brings back what it hid, unless a later erase or clear still hides it. A canvas never interprets markup (NFR-5). Redraw of 2,000 actions is a few ms; no animation (NFR-6).
- **Board shape.** A fixed logical board of 1600 × 1000 units (16:10), integer coordinates. The canvas is scaled to fit its container's width, its backing store sized by `devicePixelRatio` (FR-3). Line width 4 units, eraser width 24 units, both fixed (out of scope: thickness).
- **Own strokes feel instant.** A participant's stroke is drawn locally while dragging and kept as *pending* (on top of the confirmed board) until the server's `sketch_added` echo with the same `client_id` replaces it (AC-21).
- **Who may see it (FR-21).** The board is reachable only through a session's invite: the WebSocket (which already requires a valid, non-stale invite and a seat) and `GET /api/sessions/{invite}/sketch`, exactly as chat history is (spec 002). Having the invite link is what makes someone a participant (spec 001). Nothing else serves board data; `/api/home` is untouched.
- **Stale (FR-16).** A stale session already refuses the WebSocket (4410), so no drawing message can arrive; the service additionally checks `stale_at is null` inside the insert/delete statement, so a session going stale mid-connection refuses too. The stale page reads the board via the REST GET and renders it with no toolbar.

### Module layout and dependency direction (constitution 9)

Backend, new package `backend/app/sketch/`:

| Module | Role | Imports |
|---|---|---|
| `rules.py` | Pure: palette names, board size, limits, `parse_action(payload) -> Action \| SketchError`, `action_bytes(action)` | stdlib only |
| `repo.py` | SQL on `sketch_action` | asyncpg, `rules` |
| `service.py` | `add`, `clear`, `undo`, `snapshot`; per-session lock, stale check, budget, prune, broadcast | `repo`, `rules`, `app.sessions.hub` |
| `api.py` | `GET /api/sessions/{invite}/sketch` | `service`, `app.sessions.repo`, `app.sessions.api.get_conn` |

`sessions/ws.py` → `sketch.service` (three new branches in `_handle_text`, one `welcome` field). `sketch` never imports `sessions.ws`. `deletion/repo.py` stays a leaf: one SQL string added, no import. `main.py` includes the new router.

Frontend, new folder `frontend/src/sketch/`:

| Module | Role |
|---|---|
| `sketchTypes.ts` | Wire types, `PALETTE` (8 names), `BOARD_W/H`, limits |
| `sketchState.ts` | Pure reducer: snapshot, added, removed, refused, pending, prune on clear, own-undo stack, `visible()` |
| `geometry.ts` | Pure: pointer → board coords, point simplification, click-vs-drag, standard shape size, rect normalising |
| `render.ts` | `drawBoard(ctx, actions, colours, scale)`: the only canvas code |
| `useSketch.ts` | Subscribes to the session provider's messages (as `useChat` does), owns the reducer, sends actions |
| `SketchBoard.tsx` (+ `.module.css`) | Canvas, toolbar, *Undo*, *Clear* + confirm `Dialog`, full message, live region; `readOnly` prop |

`pages/SessionWindow.tsx` → `sketch/*`; `sketch/*` → `ui/*`, `brand/Icon`, `api/client`. Nothing in `sketch/` imports pages.

### Session window layout (FR-2, NFR-6)

- A header toggle **Sketch** (`Button`, `aria-pressed`) in `AppHeader` next to Run/Check, on both the joined and the stale page. Open/closed is `usePinned("sketch", false)` — per browser, default closed, never sent to the server (FR-2, AC-2).
- ≥ 1024 px: when open, the main area (`styles.main`) becomes a `SplitPane` — editor left, board right — with a divider whose position is `usePanelSize("sketch", …)`. Board and code are visible together (AC-2).
- < 1024 px down to ≈390 px: the board stacks under the editor at full width, keeping 16:10, and the main area scrolls vertically; the toolbar wraps. No horizontal overflow (NFR-6, AC-23).
- When closed, the board is unmounted from layout but `useSketch` keeps applying messages, so opening it shows the current board without a fetch.

### Toolbar and keyboard (FR-4–FR-8, FR-13, NFR-7)

- Order: tools (Pen, Box, Circle, Eraser) · 8 colour swatches · Undo · Clear. A `Toolbar` of `IconButton`s/`Button`s; each tool and swatch has `aria-pressed` and an accessible name carrying state ("Pen, selected", "Red, selected"; unselected: "Pen", "Red"). Swatches show the colour as a filled pill; the selected marker and focus ring are accent-only (spec Open questions).
- Tool and colour live in component state, per participant, never sent (FR-8). Defaults: Pen, Ink.
- *Undo* is disabled when the own-undo stack is empty, with `aria-describedby` → "Nothing of yours to undo in this visit." (FR-15). *Clear* opens a `Dialog` (danger confirm "Clear for everyone", cancel default focus) (FR-12).
- The canvas has `tabIndex=0`, `role="img"` and `aria-label="Sketch board"`. Ctrl/Cmd+Z in a `keydown` handler on the board wrapper (canvas + toolbar) calls Undo and `preventDefault`s; CodeMirror's own undo is unaffected because focus is elsewhere (FR-13).
- A polite live region, throttled to one message per 5 s, says "Someone changed the sketch." when an action by someone else is added or removed (NFR-7). Own actions are not announced.
- Read-only (stale): no toolbar, no Undo, no Clear; the canvas keeps its name, with "(read-only)".
- Pointer: Pointer Events with `setPointerCapture`; mouse, touch and pen alike; `touch-action: none` on the canvas so drawing doesn't scroll (FR-4).
- Icons through `brand/Icon`; names missing from `iconMap.ts` (pen, square, circle, eraser, undo, trash, sketch) are added with neutral fallbacks (UI rule 12).

## Data model

Migration `backend/app/migrations/0017_sketch.sql`:

```sql
create table sketch_action (
    seq            bigserial primary key,
    session_id     uuid not null references session (id),
    author_id      uuid not null references participant (id),
    kind           text not null check (kind in ('pen', 'box', 'ellipse', 'erase', 'clear')),
    color          text check (color in ('ink','red','orange','yellow','green','blue','purple','pink')),
    points         jsonb,          -- flat int array [x0,y0,x1,y1,...]; null for clear
    client_id      text not null,
    bytes          integer not null,
    created_at     timestamptz not null default now(),
    check ((kind in ('pen','box','ellipse')) = (color is not null)),
    check ((kind = 'clear') = (points is null))
);
create index sketch_action_session_idx on sketch_action (session_id, seq);
```

- `pen`: ≥ 1 point (a dot is one point). `box`/`ellipse`: exactly 2 points, opposite corners (the client resolves click-to-standard-size before sending, FR-5). `erase`: ≥ 1 point. `clear`: no points, no colour.
- `bytes` = `len(json.dumps(points, separators=(",",":")))` + 32 fixed overhead; computed by `rules.action_bytes`, stored so the budget is one `sum`.
- **Visible actions** = rows with `seq` greater than the latest `clear` row's `seq` (all rows if none).
- **Undo deletes the target row** (no undo records). Only rows whose `author_id` = the sender's participant id may be deleted (FR-13).
- **Pruning.** Inserting a `clear` first deletes every row with `seq ≤` the previous latest `clear` (the previous clear and what it hid). So only the most recent clear's hidden content is kept for undo; the client reducer applies the same rule on `sketch_added{kind:"clear"}`.
- Limits (`rules.py`): coordinates 0 ≤ x ≤ 1600, 0 ≤ y ≤ 1000; ≤ 1,000 points per action; `client_id` ≤ 64 chars; visible budget 1,000,000 bytes (NFR-3). The client simplifies a pen/erase path (drops points within 2 units of the last kept one) before sending.
- Durability: Postgres, like chat (FR-11, NFR-4). Purge: `"delete from sketch_action where session_id = $1"` added to `_PURGE_SQL["coding"]` before the `participant` delete (FR-17).

## Contracts

### WebSocket (session socket, text frames)

Client → server:

```jsonc
{"type": "sketch_add", "client_id": "uuid", "action": {"kind": "pen"|"box"|"ellipse", "color": "red", "points": [x,y,...]}}
{"type": "sketch_add", "client_id": "uuid", "action": {"kind": "erase", "points": [x,y,...]}}
{"type": "sketch_clear", "client_id": "uuid"}
{"type": "sketch_undo", "seq": 123}
```

Server → every connection of the session (including the sender):

```jsonc
{"type": "sketch_added", "action": {"seq": 124, "client_id": "uuid", "kind": "...", "color": "...", "points": [...]}}
{"type": "sketch_removed", "seq": 123}
```

`author_id` is never sent (out of scope: who drew what). The sender recognises its own action by `client_id` and pushes `seq` onto its own-undo stack.

Server → sender only:

```jsonc
{"type": "sketch_refused", "client_id": "uuid"?, "seq": 123?, "reason": "full" | "invalid" | "not_yours" | "stale"}
```

`invalid` covers any malformed frame: unknown keys or kind, colour not in the palette, non-integer or out-of-range coordinate, too many points, wrong point count, non-string `client_id` (NFR-5, AC-22). `not_yours` also covers an unknown/already-removed `seq`. On `full`, `invalid` or `stale` the client drops the pending action; `full` shows the full message (FR-18).

`welcome` gains `"sketch": {"actions": [action, ...], "full": bool}` (visible actions plus the kept hidden ones, in `seq` order). Because broadcasts can reach a socket before its `welcome`, the reducer is idempotent: it merges by `seq` and remembers removed `seq`s, so order of arrival doesn't matter.

### REST

`GET /api/sessions/{invite}/sketch` → `200 {"actions": [...], "read_only": bool}` (same action shape); `404 {"error": "not_found"}` for an unknown or deleted invite, with no board data (FR-21). No write endpoints.

### Backend signatures

```python
# sketch/rules.py
PALETTE: tuple[str, ...]           # 8 names
class SketchError(StrEnum): INVALID, FULL, NOT_YOURS, STALE
@dataclass(frozen=True)
class Action: kind: str; color: str | None; points: list[int] | None
def parse_action(raw: object) -> Action | SketchError
def action_bytes(action: Action) -> int

# sketch/repo.py
async def list_actions(conn, session_id) -> list[StoredAction]
async def visible_bytes(conn, session_id) -> int
async def insert(conn, session_id, author_id, client_id, action, bytes_) -> StoredAction | None   # None: session stale/missing
async def prune_before_latest_clear(conn, session_id) -> None
async def delete_own(conn, session_id, author_id, seq) -> bool

# sketch/service.py
async def add(conn, hub, session_id, participant_id, client_id, raw_action) -> SketchError | None
async def clear(conn, hub, session_id, participant_id, client_id) -> SketchError | None
async def undo(conn, hub, session_id, participant_id, seq) -> SketchError | None
async def snapshot(conn, session_id) -> dict      # {"actions": [...], "full": bool}
```

### Frontend

```ts
type SketchColor = "ink"|"red"|"orange"|"yellow"|"green"|"blue"|"purple"|"pink";
type SketchAction = { seq: number; client_id: string } & (
  | { kind: "pen"|"box"|"ellipse"; color: SketchColor; points: number[] }
  | { kind: "erase"; points: number[] }
  | { kind: "clear" });
interface SketchState { confirmed: SketchAction[]; removed: Set<number>; pending: PendingAction[];
                        ownSeqs: number[]; full: boolean; ownClientIds: Set<string> }
function sketchReducer(s: SketchState, e: SketchEvent): SketchState;   // snapshot|added|removed|refused|local
function visible(s: SketchState): Array<SketchAction | PendingAction>; // after last clear, pending on top
function drawBoard(ctx: CanvasRenderingContext2D, actions: ..., colours: Record<SketchColor,string>, scale: number): void;
```

`ownSeqs` starts empty on every mount of a visit (FR-15); `undo()` sends `sketch_undo` for the last entry still present; entries removed by pruning or by a `sketch_removed` drop out.

### Tokens (UI rules 5, 14)

`tokens.css`, light and dark, mirrored in the Keycloak theme copy: `--sketch-board` (board background, a tone of `--surface-2`) and `--sketch-ink`, `--sketch-red`, `--sketch-orange`, `--sketch-yellow`, `--sketch-green`, `--sketch-blue`, `--sketch-purple`, `--sketch-pink`. "Ink" is near-black in light and near-white in dark; the others keep their hue and shift lightness per scheme, so a colour has the same name for everyone (FR-7). `render.ts` reads the resolved values with `getComputedStyle` and redraws when the scheme changes. These are user content, exempt from the one-accent rule (spec Open questions).

## Test strategy

Backend tests use the real Postgres and the in-process WebSocket test client (existing fixtures); frontend unit tests use Vitest + Testing Library; E2E uses Playwright with several browser contexts against the kept stack. Nothing is mocked (constitution 4). Canvas pixels are not available in jsdom, so pixel outcomes are asserted only in Playwright (`page.evaluate` reading `getImageData` at board coordinates); unit tests cover the pure geometry and reducer.

| AC | Unit (pure) | Integration (backend) | Component | E2E |
|---|---|---|---|---|
| AC-1 | — | new session's `welcome.sketch.actions == []`; two sockets get same snapshot | — | — |
| AC-2 | — | — | toggle `aria-pressed`, persists via `usePinned` | 1280 px: board + editor visible; reload keeps it open; 2nd context stays closed |
| AC-3 | `geometry`: pointer → board coords at two scales | — | — | 1920 vs 1024 contexts: box drawn top-left, pixel in B's top-left quarter |
| AC-4 | simplification keeps path shape | add pen stored + broadcast | — | blue curve: pixels along path are blue |
| AC-5 | rect normalising; click → standard size centred | box/ellipse need exactly 2 points | — | drag P→Q rectangle corners; click places standard shape |
| AC-6 | — | erase stored | — | horizontal line, vertical erase: middle pixel empty, ends present |
| AC-7 | — | colour outside palette refused | 8 swatches named | — ; `contrast.test.ts`: each sketch colour ≥ 3:1 vs `--sketch-board`, light and dark |
| AC-8 | — | — | tool/colour state local; names "Eraser, selected" | two contexts select differently, each keeps own |
| AC-9 | — | `sketch_added` reaches other socket | — | B sees A's circle ≤ 500 ms (latency pattern of `e2e/latency.spec.ts`) |
| AC-10 | reducer: out-of-order arrival → same `visible()` | 3 concurrent sockets add; all receive same `seq` order | — | 3 contexts draw at once; serialized boards identical |
| AC-11 | — | rows survive; `slow` test: restart stack, `welcome` same | — | reload shows same pixels |
| AC-12 | reducer: clear hides earlier | clear + prune rule | cancel sends nothing; confirm sends `sketch_clear` | clear empties both contexts |
| AC-13 | reducer: own-undo stack order | undo deletes own row; other's `seq` → `not_yours` | Undo button, Ctrl/Cmd+Z on focused board | A line, A box, B circle; A undo ×2 |
| AC-14 | reducer: undo line after erase; undo erase; undo clear | — | — | pixel checks for the three cases |
| AC-15 | `ownSeqs` empty on fresh state | — | Undo disabled with description | draw, reload: Undo disabled, line remains |
| AC-16 | — | stale session: WS refused; insert with `stale_at` set returns STALE; GET `read_only: true` | read-only board has no toolbar | stale page shows drawing |
| AC-17 | — | delete session → `count(*) from sketch_action` for it = 0 (`test_delete_session.py` pattern) | — | — |
| AC-18 | `action_bytes` | 2,000 typical actions accepted; past budget → `full`, rows unchanged; clear frees | full message shown | — |
| AC-19 | — | `/api/home` entry for a session identical with and without board | — | jump bar has no sketch entry |
| AC-20 | — | GET with unknown invite → 404 no body data; another session's socket never receives its broadcasts | — | — |
| AC-21 | — | — | — | 5 contexts draw 30 s; boards identical; own pending stroke drawn before echo |
| AC-22 | `parse_action` table of malformed inputs, markup in strings | malformed → `invalid`, nothing stored or broadcast | — | — |
| AC-23 | — | — | tab order, names with state, visible focus | keyboard-only pass; look matrix entry (session window with sketch open: light, dark, widths, 390 px, reduced motion) |

"Serialized boards identical" = each context's `visible()` list exported via a test-only `data-sketch-hash` attribute on the board wrapper (a hash of the visible `seq` list), compared across contexts.

Per-task gate as constitution 2/8 and UI rule 22; the restart test is marked `slow`.

## Constitution compliance

1. **Test-first** — every row above is a failing test written from its AC before the code; `/sdd-tasks` carries them.
2. **Green before done** — per-task `scripts/check.sh` on the kept stack; the restart test (AC-11) is `slow`, run only in `--full`. The 5-context E2E (AC-21) runs 30 s; budget kept by sharing one session across its assertions.
3. **Traceable tests** — the table maps every AC-1…AC-23.
4. **Real dependencies** — real Postgres, real WebSocket, real browsers. No mocks. Pixel assertions moved to E2E rather than faking the canvas.
5. **Fixed stack** — FastAPI, Postgres, React/TS strict, Vite, compose. No departure.
6. **Dependencies** — none added. Canvas 2D, Pointer Events and `ResizeObserver` are browser built-ins; validation is hand-written in `rules.py` like `chat/rules.py`.
7. **No secrets** — none involved.
8. **Lint/format** — ruff, biome, tsc as usual.
9. **Architecture** — module layout and dependency direction stated above.
10. **UI rules** —
    - A1 home: none (FR-19); `/api/home` snapshot change: **none**; "home changed" trigger: **none**; AC-19 test proves the tile is unchanged.
    - A2 dock / jump: none (FR-20).
    - A3 guests: same as any participant; server-scoped by invite (FR-21).
    - A4 existing behaviour: chat/description/run panels and their shortcuts unchanged; Ctrl/Cmd+Z only on the focused board.
    - B5 tokens: new `--sketch-*` tokens in light, dark and Keycloak copy; no literals.
    - B7 one accent: sketch colours are user content (spec decision); chrome stays accent-only; Clear's confirm uses `danger`.
    - B8 primitives: `Button`, `IconButton`, `Toolbar`, `Dialog`, `InlineMessage`, `SplitPane`, `usePinned`, `usePanelSize`. **No new primitive**: the drawing surface is specific to this feature and lives in `frontend/src/sketch/`, not `ui/`.
    - B9 states: from the reused primitives; the canvas gets the standard focus ring.
    - B12 icons: through `brand/Icon`, neutral fallbacks.
    - C13 responsive, C14 dark, C15 reduced motion (no animation at all), C16 accessibility, C17 privacy (no board data outside the invite), C18 performance (board renders after `welcome`, nothing waits on it).
    - D19–D21: component tests, look-matrix entry and E2E listed in the table.

Out of scope and not planned: anything under the spec's "Out of scope", touching session activity on drawing (spec doesn't ask), reusing spec 013's presentation strokes (ephemeral, per-participant colour, different semantics).
