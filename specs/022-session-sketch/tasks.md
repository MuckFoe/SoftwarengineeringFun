# 022 — Sketch board in coding sessions: tasks

Assumes both plan.md gate decisions are approved: FR-18's message says *"The sketch is full. Clear the board or undo something to make room."*, and the 1 MB budget counts the visible drawing (actions after the last clear). If either is rejected, stop and send FR-18/NFR-3 back to `/sdd-specify` before task 1.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4 — all `[P]` | Pure leaves with no dependencies: backend validation rules, frontend wire types and geometry, colour tokens, icons. |
| 2 | 5, 6 — all `[P]` | The table and repo need `rules.Action`; the reducer needs the wire types. Different stacks, no shared files. |
| 3 | 7, 8, 9, 10 — all `[P]` | Service and purge both build on the table only; the hook needs the reducer; the canvas needs types, reducer and tokens. No file is touched by two of them. |
| 4 | 11, 12, 13 — all `[P]` | Socket wiring and REST both call the service; the board's controls need the canvas, the hook and the icons. |
| 5 | 14 | The joined session page puts the board beside the editor; needs the socket messages (11) and the full board (13). |
| 6 | 15 | The stale page touches the same file as 14 and needs the REST read (12). |
| 7 | 16, 17, 18, 19 — all `[P]` | End-to-end checks against the finished feature. Separate spec files, but they share the kept stack: take the Playwright lock and run one batched gate. |

## Checklist

- [x] **1** — `[P]` Backend validation rules (`sketch/rules.py`)
- [x] **2** — `[P]` Frontend wire types and geometry
- [x] **3** — `[P]` Sketch colour and board tokens
- [x] **4** — `[P]` Sketch icons
- [x] **5** — `[P]` `sketch_action` table and repo
- [x] **6** — `[P]` Sketch state reducer
- [x] **7** — `[P]` Sketch service: add, clear, undo, snapshot
- [x] **8** — `[P]` Delete the board with its session
- [x] **9** — `[P]` `useSketch` hook
- [x] **10** — `[P]` Canvas rendering and pointer drawing
- [x] **11** — `[P]` Sketch messages on the session socket
- [x] **12** — `[P]` Read-only REST endpoint for the board
- [x] **13** — `[P]` Board toolbar, Undo, Clear, full message, live region
- [x] **14** — Sketch toggle and layout in the joined session window
- [x] **15** — Read-only board on the stale session page
- [x] **16** — `[P]` E2E: drawing tools, clear, reload
- [x] **17** — `[P]` E2E: shared board between participants
- [x] **18** — `[P]` E2E: five participants for 30 s
- [x] **19** — `[P]` E2E: stale page, keyboard, look matrix, no home/jump entry

## Tasks

### 1. `[P]` Backend validation rules (`sketch/rules.py`)

- **Plan:** Module layout — `rules.py`; Data model — limits, `bytes`; Contracts — `invalid`. **Spec:** FR-4, FR-5, FR-6, FR-7, FR-18, NFR-3, NFR-5.
- **Files:** `backend/app/sketch/__init__.py`, `backend/app/sketch/rules.py`, `backend/tests/unit/test_sketch_rules.py`
- **Depends on:** nothing
- **Do:** Stdlib-only module: `PALETTE` (ink, red, orange, yellow, green, blue, purple, pink), `BOARD_W = 1600`, `BOARD_H = 1000`, point and `client_id` limits, `BUDGET_BYTES = 1_000_000`, `SketchError` (`INVALID`, `FULL`, `NOT_YOURS`, `STALE`), frozen `Action`, `parse_action(raw) -> Action | SketchError`, `action_bytes(action)` = compact JSON length of points + 32. Rules: `pen`/`erase` ≥ 1 point, `box`/`ellipse` exactly 2 points, `pen`/`box`/`ellipse` need a palette colour, `erase` has none; integer coordinates in range; ≤ 1,000 points; unknown keys refused.
- **Acceptance:**
  - *AC-22 — Given a participant sends a drawing action containing markup or script text in any field, When others receive it, Then nothing is rendered as markup or run, and malformed actions are refused.* A table test: unknown kind, unknown key, colour `"<script>"`, colour not in palette, float / string / negative / out-of-range coordinate, odd-length points, 1,001 points, box with 1 or 3 points, erase with a colour, non-dict input — each returns `SketchError.INVALID`; each valid kind parses.
  - *AC-7 — it offers about 8 colours.* `len(PALETTE) == 8`.
  - *AC-18 — Given a board with 2,000 drawing actions, Then it is not yet at its limit.* `action_bytes` of a typical action (pen of 45 points, box, ellipse, short erase) × 2,000 ≤ `BUDGET_BYTES`.

### 2. `[P]` Frontend wire types and geometry

- **Plan:** Frontend — `sketchTypes.ts`, `geometry.ts`; Board shape. **Spec:** FR-3, FR-4, FR-5.
- **Files:** `frontend/src/sketch/sketchTypes.ts`, `frontend/src/sketch/geometry.ts`, `frontend/src/sketch/geometry.test.ts`
- **Depends on:** nothing
- **Do:** `SketchColor`, `PALETTE` (same 8 names as the backend), `SketchAction`, `PendingAction`, wire message types, `BOARD_W/H`, line width 4, eraser width 24, point limit. `geometry.ts`: pointer (client px + element rect) → integer board coords clamped to the board; path simplification (drop points within 2 units of the last kept one, never exceed the point limit); click-vs-drag test; standard shape size centred on a click (clamped inside the board); rectangle normalising from any two corners.
- **Acceptance:**
  - *AC-3 — Given A on a 1920 px window and B on a 1024 px window, When A draws a box in the top-left quarter, Then B sees it in the top-left quarter.* The same relative pointer position maps to the same board coordinate at two element widths.
  - *AC-4 — a blue freehand line following that path appears.* Simplifying a dense curve keeps its first and last points and stays within 2 units of the original path.
  - *AC-5 — opposite corners at P and Q … When they click without dragging, Then a shape of the standard size centred on the click appears.* Normalising (Q, P) equals normalising (P, Q); a click gives the standard-size rectangle centred on it; a click near an edge stays inside the board.

### 3. `[P]` Sketch colour and board tokens

- **Plan:** Tokens (UI rules 5, 14). **Spec:** FR-7, NFR-6.
- **Files:** `frontend/src/styles/tokens.css`, `keycloak-theme/collab/login/resources/css/collab.css`, `frontend/src/styles/contrast.test.ts`
- **Depends on:** nothing
- **Do:** Add `--sketch-board` and `--sketch-ink`, `--sketch-red`, `--sketch-orange`, `--sketch-yellow`, `--sketch-green`, `--sketch-blue`, `--sketch-purple`, `--sketch-pink` in light and dark, mirrored in the Keycloak theme copy. Ink is near-black in light, near-white in dark; the others keep their hue and shift lightness per scheme.
- **Acceptance:**
  - *AC-7 — Given A in light appearance and B in dark, When A draws in a palette colour, Then B sees it as the same named colour, clearly visible against the board (contrast checked in both appearances).* `contrast.test.ts`: each of the 8 sketch colours ≥ 3:1 against `--sketch-board`, in light and in dark; the Keycloak copy declares the same tokens.

### 4. `[P]` Sketch icons

- **Plan:** Toolbar and keyboard — icons through `brand/Icon`. **Spec:** FR-8, NFR-6.
- **Files:** `frontend/src/brand/iconMap.ts` (+ its existing test, if any)
- **Depends on:** nothing
- **Do:** Add `pen`, `square`, `circle`, `eraser`, `undo`, `trash`, `sketch` where missing, each with a neutral fallback (UI rule 12).
- **Acceptance:**
  - *NFR-6 — primitives first, tokens only.* Each name resolves through `brand/Icon` to an icon (or its neutral fallback) — no unknown-icon warning.

### 5. `[P]` `sketch_action` table and repo

- **Plan:** Data model; Backend signatures — `sketch/repo.py`. **Spec:** FR-1, FR-11, FR-12, FR-13, FR-16, NFR-4.
- **Files:** `backend/app/migrations/0017_sketch.sql`, `backend/app/sketch/repo.py`, `backend/tests/integration/test_sketch_repo.py`
- **Depends on:** 1
- **Do:** The migration exactly as plan.md's Data model. `repo.py`: `list_actions`, `visible_bytes` (sum of `bytes` after the latest clear), `insert` (single statement that inserts only when the session exists and `stale_at is null`, else `None`), `prune_before_latest_clear`, `delete_own` (only where `author_id` matches).
- **Acceptance:**
  - *AC-1 — Given a newly started coding session, … Then it is empty.* `list_actions` of a new session is `[]`.
  - *AC-11 — Then the board looks exactly as before.* Inserted actions come back from `list_actions` in `seq` order with identical kind, colour and points.
  - *AC-13 — It never reverses another participant's action.* `delete_own` with another participant's id returns `False` and the row stays.
  - *AC-16 — any drawing attempt is refused by the server.* `insert` on a session with `stale_at` set returns `None`, nothing stored.
  - *AC-18 — the budget.* `visible_bytes` counts only rows after the latest clear.
  - Table constraints reject a `clear` with points and a `pen` without colour.

### 6. `[P]` Sketch state reducer

- **Plan:** Frontend — `sketchState.ts`; Contracts — idempotent reducer, own-undo stack, pruning. **Spec:** FR-10, FR-12, FR-13, FR-14, FR-15.
- **Files:** `frontend/src/sketch/sketchState.ts`, `frontend/src/sketch/sketchState.test.ts`
- **Depends on:** 2
- **Do:** `sketchReducer` for `snapshot`, `added`, `removed`, `refused`, `local` (pending); merge by `seq`, remember removed `seq`s; replace pending by the echo with the same `client_id` and push its `seq` onto `ownSeqs`; prune on `added{kind:"clear"}` as the server does; `visible()` = confirmed actions after the last clear in `seq` order, pending on top; `full` flag.
- **Acceptance:**
  - *AC-10 — every participant SHALL end up seeing the same board.* The same set of `added`/`removed`/`snapshot` events delivered in different orders (broadcast before welcome included) give the same `visible()`.
  - *AC-12 — When they press Clear and confirm, Then the board is empty.* After `added{clear}`, `visible()` holds nothing earlier than it.
  - *AC-13 — Repeating it steps back through their earlier actions … never reverses another participant's action.* `ownSeqs` holds only own echoes, newest last; another's `added` doesn't touch it; `removed` drops an entry.
  - *AC-14 — undo a line someone rubbed out; undo an erase; undo a clear.* Removing a line's `seq` drops it from `visible()` even after a later erase; removing an erase or clear `seq` brings earlier actions back into `visible()`.
  - *AC-15 — Given a participant who has drawn nothing this visit … Undo is disabled.* A fresh state, and a fresh state given a snapshot containing own earlier actions, has empty `ownSeqs`.
  - `refused` drops the matching pending action; `refused{reason:"full"}` sets `full`.

### 7. `[P]` Sketch service: add, clear, undo, snapshot

- **Plan:** Architecture — Ordering, Stale; Backend signatures — `sketch/service.py`; Data model — pruning, budget. **Spec:** FR-9, FR-10, FR-12, FR-13, FR-16, FR-18, NFR-3.
- **Files:** `backend/app/sketch/service.py`, `backend/tests/integration/test_sketch_service.py`
- **Depends on:** 5
- **Do:** Per-session `asyncio.Lock`; inside it: `add` parses, checks budget (`visible_bytes + action_bytes > BUDGET` → `FULL`), inserts (`None` → `STALE`), broadcasts `sketch_added` via `sessions.hub`; `clear` prunes, inserts, broadcasts; `undo` deletes own row (`False` → `NOT_YOURS`), broadcasts `sketch_removed`; `snapshot` returns `{"actions": [...], "full": bool}`. `author_id` is never in any outgoing message.
- **Acceptance:**
  - *AC-4 / AC-9 — Then B sees it … without reloading.* `add` stores the action and broadcasts `sketch_added` (with `seq`, `client_id`, no `author_id`) to the session.
  - *AC-12 — Then the board is empty for every participant.* `clear` broadcasts; a second clear prunes the first clear and what it hid.
  - *AC-13 — Then A's box disappears for everyone and B's circle stays.* `undo` of own `seq` deletes and broadcasts `sketch_removed`; undo of B's `seq` or an unknown `seq` returns `NOT_YOURS`, nothing changes.
  - *AC-16 — any drawing attempt is refused by the server.* `add` on a session with `stale_at` set returns `STALE`, nothing stored or broadcast.
  - *AC-18 — Given a board at its limit, When a participant tries to draw, Then the drawing is refused …, and the existing content is unchanged; Given a board with 2,000 drawing actions, Then it is not yet at its limit.* 2,000 typical actions are accepted; the next action past the budget returns `FULL` with rows unchanged; after a clear, `add` succeeds again; `snapshot.full` reflects the state.
  - *AC-22 — malformed actions are refused.* `add` with a malformed action returns `INVALID`; nothing stored or broadcast.

### 8. `[P]` Delete the board with its session

- **Plan:** Data model — Purge. **Spec:** FR-17.
- **Files:** `backend/app/deletion/repo.py`, `backend/tests/integration/test_delete_session.py`
- **Depends on:** 5
- **Do:** Add `"delete from sketch_action where session_id = $1"` to `_PURGE_SQL["coding"]` before the `participant` delete. No new import.
- **Acceptance:**
  - *AC-17 — Given a session with a drawn board, When the session is deleted, Then its board no longer exists anywhere in storage.* After deleting a session with sketch rows, `count(*) from sketch_action where session_id = …` is 0; another session's rows remain.

### 9. `[P]` `useSketch` hook

- **Plan:** Frontend — `useSketch.ts`; Session window layout — keeps applying messages while closed. **Spec:** FR-9, FR-10, FR-11, FR-13, FR-15.
- **Files:** `frontend/src/sketch/useSketch.ts`, `frontend/src/sketch/useSketch.test.tsx`
- **Depends on:** 6
- **Do:** Subscribe to the session provider's messages as `useChat` does: `welcome.sketch` → `snapshot`, `sketch_added`/`sketch_removed`/`sketch_refused` → reducer. Expose `visible`, `full`, `canUndo`, and `add(action)` (new `client_id`, local pending, send `sketch_add`), `clear()` (send `sketch_clear`), `undo()` (send `sketch_undo` for the last `ownSeqs` entry still present). Expose a callback for "someone else changed the board" for the live region.
- **Acceptance:**
  - *AC-9 — Then B sees it … without reloading.* Following `useChat.test.tsx`'s pattern: an incoming `sketch_added` appears in `visible`.
  - *AC-13 — When A presses Undo, Then A's box disappears.* `undo()` sends `sketch_undo` with the newest own `seq`; with no own actions it sends nothing and `canUndo` is false.
  - *AC-21 — each participant's own strokes appeared without visible delay.* `add()` puts the action in `visible` before any echo.
  - The "changed by someone else" callback fires for others' `added`/`removed`, not for own.

### 10. `[P]` Canvas rendering and pointer drawing

- **Plan:** Architecture — Rendering, Board shape; Frontend — `render.ts`, `SketchBoard.tsx` (canvas part); Toolbar and keyboard — Pointer. **Spec:** FR-3, FR-4, FR-5, FR-6, FR-7.
- **Files:** `frontend/src/sketch/render.ts`, `frontend/src/sketch/SketchBoard.tsx`, `frontend/src/sketch/SketchBoard.module.css`
- **Depends on:** 2, 3, 6
- **Do:** `drawBoard(ctx, actions, colours, scale)`: pen as a polyline (single point as a dot), box as `strokeRect`, ellipse inside its rectangle, erase with `destination-out`, width 4 / 24 units; no animation. `SketchBoard` (canvas only for now): 16:10 canvas scaled to its container width via `ResizeObserver`, backing store × `devicePixelRatio`; colours read with `getComputedStyle` and re-read when the scheme changes; Pointer Events with `setPointerCapture`, `touch-action: none`; pen/erase draw live as pending, box/ellipse preview while dragging, click → standard size; on pointer-up call `add`. Props: `visible`, `add`, `tool`, `color`, `readOnly`. `role="img"`, `aria-label="Sketch board"`, `tabIndex=0`, test-only `data-sketch-hash` (hash of the visible `seq` list).
- **Acceptance:**
  - *AC-4, AC-5, AC-6 (pixels).* Asserted in E2E task 16 (jsdom has no canvas pixels); this task's component test checks that a pointer drag with the pen calls `add` once on pointer-up with a `pen` action in board coordinates, a click with the box tool calls `add` with the standard-size box, and `readOnly` never calls `add`.
  - *AC-3 — same relative positions.* Component test: `data-sketch-hash` and the canvas `aria-label` are present; the canvas keeps 16:10 at two container widths.

### 11. `[P]` Sketch messages on the session socket

- **Plan:** Architecture — Transport; Contracts — WebSocket. **Spec:** FR-1, FR-9, FR-10, FR-11, FR-13, FR-16, FR-21, NFR-1, NFR-4, NFR-5.
- **Files:** `backend/app/sessions/ws.py`, `backend/tests/integration/test_sketch_ws.py`
- **Depends on:** 7
- **Do:** Three branches in `_handle_text` (`sketch_add`, `sketch_clear`, `sketch_undo`) calling the service with the socket's session and participant; on an error send `sketch_refused` with `client_id`/`seq` and `reason` to the sender only; malformed frames (missing/non-string `client_id`, non-integer `seq`) → `invalid`. `welcome` gains `"sketch": snapshot`.
- **Acceptance:**
  - *AC-1 — Given a newly started coding session, When any participant opens the board, Then it is empty, and every participant … sees the same board.* `welcome.sketch.actions == []`; after one adds, a second socket's `welcome` holds the same actions.
  - *AC-9 — When A finishes a circle, Then B sees it.* B's socket receives `sketch_added` for A's ellipse.
  - *AC-10 — Given A, B and C draw lines at the same moment … their boards are identical.* Three sockets add concurrently; all three receive the three `sketch_added` in the same `seq` order.
  - *AC-11 — When the app is restarted and they rejoin, Then the board looks exactly as before.* `slow` test: draw, restart the stack, rejoin; `welcome.sketch` is identical.
  - *AC-13 — It never reverses another participant's action.* `sketch_undo` with B's `seq` from A → A gets `sketch_refused{reason:"not_yours"}`; B's action stays.
  - *AC-16 — any drawing attempt is refused by the server.* A stale session's socket is refused (4410) as today.
  - *AC-20 — When they try to read or draw on S's board, Then the server refuses and returns nothing.* A socket of session T never receives S's `sketch_added`; `author_id` never appears in any frame.
  - *AC-22 — malformed actions are refused.* A frame with markup in `client_id`'s place of a number, or unknown kind → sender gets `sketch_refused{reason:"invalid"}`, others receive nothing.

### 12. `[P]` Read-only REST endpoint for the board

- **Plan:** Module layout — `api.py`; Contracts — REST; Architecture — Who may see it. **Spec:** FR-16, FR-19, FR-21.
- **Files:** `backend/app/sketch/api.py`, `backend/app/main.py`, `backend/tests/integration/test_sketch_api.py`
- **Depends on:** 7
- **Do:** `GET /api/sessions/{invite}/sketch` → `200 {"actions": [...], "read_only": bool}` (`read_only` = session stale); unknown or deleted invite → `404 {"error": "not_found"}`. Include the router in `main.py`. No write endpoint.
- **Acceptance:**
  - *AC-16 — Given a stale session with a drawn board, When a participant opens it, Then the drawing is shown.* GET on a stale session returns its actions with `read_only: true`; on a live one `read_only: false`.
  - *AC-20 — Given someone who is not a participant of session S, When they try to read … Then the server refuses and returns nothing of the board.* Unknown and deleted invites → 404 with no `actions` key; no POST/PUT/DELETE route exists.
  - *AC-19 — Then the tile is identical to one without a board.* `/api/home`'s entry for a coding session is identical before and after drawing on its board.

### 13. `[P]` Board toolbar, Undo, Clear, full message, live region

- **Plan:** Toolbar and keyboard; Frontend — `SketchBoard.tsx`. **Spec:** FR-7, FR-8, FR-12, FR-13, FR-15, FR-16, FR-18, NFR-6, NFR-7.
- **Files:** `frontend/src/sketch/SketchBoard.tsx`, `frontend/src/sketch/SketchBoard.module.css`, `frontend/src/sketch/SketchBoard.test.tsx`
- **Depends on:** 4, 9, 10
- **Do:** `SketchBoard` takes the `useSketch` result. `Toolbar`: Pen, Box, Circle, Eraser · 8 swatches · Undo · Clear, each `aria-pressed` and named with state ("Pen, selected", "Red, selected"); defaults Pen, Ink; accent-only selected marker and focus ring. Undo disabled when `!canUndo`, `aria-describedby` → "Nothing of yours to undo in this visit."; Ctrl/Cmd+Z on the board wrapper calls undo and `preventDefault`s. Clear opens a `Dialog` ("Clear for everyone", danger; cancel has default focus). `InlineMessage` when `full`: *"The sketch is full. Clear the board or undo something to make room."* Polite live region, ≤ 1 message / 5 s: "Someone changed the sketch.". `readOnly`: no toolbar, Undo or Clear; label "Sketch board (read-only)". Toolbar wraps on narrow widths.
- **Acceptance:**
  - *AC-7 — it offers about 8 colours.* 8 swatches, each named by its colour.
  - *AC-8 — Given A has the eraser and red selected, When B selects the pen and green, Then A still has the eraser and red.* Selecting Eraser and Red gives "Eraser, selected" / "Red, selected" with `aria-pressed`; selection is never sent.
  - *AC-12 — When a participant presses Clear and cancels, Then nothing changes; When they press Clear and confirm, Then the board is empty.* Cancel sends nothing; confirm calls `clear()` once.
  - *AC-13 — When A presses Ctrl/Cmd+Z with the board focused, Then the same happens as pressing Undo.* Both call `undo()`; Ctrl/Cmd+Z outside the board doesn't.
  - *AC-15 — Then it is disabled with an accessible reason.* Undo is disabled and described when `canUndo` is false.
  - *AC-16 — no tool, Clear or Undo is available.* `readOnly` renders none of them.
  - *AC-18 — the drawing is refused with a message suggesting clearing.* `full` shows the message.
  - *AC-23 — every tool, colour, Undo and Clear is reachable in order with … a name carrying its state.* Tab order is tools → swatches → Undo → Clear; live region announces others' changes at most once per 5 s and never own.

### 14. Sketch toggle and layout in the joined session window

- **Plan:** Session window layout. **Spec:** FR-2, FR-20, NFR-6.
- **Files:** `frontend/src/pages/SessionWindow.tsx`, `frontend/src/pages/SessionWindow.module.css`, `frontend/src/pages/SessionWindow.test.tsx`
- **Depends on:** 11, 13
- **Do:** `useSketch` mounted with the session (keeps applying messages while closed). Header **Sketch** `Button` with `aria-pressed` next to Run/Check; `usePinned("sketch", false)`. ≥ 1024 px: `styles.main` becomes a `SplitPane`, editor left, board right, `usePanelSize("sketch", …)`. < 1024 px: board stacks under the editor at full width, main scrolls vertically, no horizontal overflow. No dock or jump entry added.
- **Acceptance:**
  - *AC-2 — When they open the board, Then the board and the code editor are both visible without leaving the session; When they reload, Then the board is still open for them.* Component test: toggling sets `aria-pressed` and renders the board beside the editor; the pinned value persists across remount; default closed.
  - Existing `SessionWindow` tests stay green (chat, description and run panels unchanged — constitution A4).

### 15. Read-only board on the stale session page

- **Plan:** Architecture — Stale; Session window layout (toggle on the stale page). **Spec:** FR-16.
- **Files:** `frontend/src/pages/SessionWindow.tsx`, `frontend/src/sketch/sketchApi.ts` (or the existing `api/client` module), `frontend/src/pages/SessionWindow.test.tsx`
- **Depends on:** 12, 14
- **Do:** On the stale page the same **Sketch** toggle; when open, fetch `GET /api/sessions/{invite}/sketch` and render `SketchBoard` with `readOnly`. Nothing is fetched while closed.
- **Acceptance:**
  - *AC-16 — Given a stale session with a drawn board, When a participant opens it, Then the drawing is shown and no tool, Clear or Undo is available.* Component test against the stale page: toggle opens a board labelled "(read-only)" with no toolbar.

### 16. `[P]` E2E: drawing tools, clear, reload

- **Plan:** Test strategy — E2E column. **Spec:** FR-4, FR-5, FR-6, FR-11, FR-12, FR-15.
- **Files:** `e2e/sketch.spec.ts`
- **Depends on:** 14
- **Do:** One session, one context unless stated; pixels read with `page.evaluate` + `getImageData` at board coordinates.
- **Acceptance:**
  - *AC-4 — Given the pen and colour blue selected, When a participant drags … along a curve, Then a blue freehand line following that path appears.*
  - *AC-5 — Given the box tool, When a participant drags from P to Q, Then an outlined rectangle with opposite corners at P and Q appears …; circle likewise …; click → standard size centred on the click.*
  - *AC-6 — Given a long horizontal line, When a participant drags the eraser vertically across its middle, Then the middle part is gone and both ends of the line remain.*
  - *AC-11 — When a participant reloads, Then the board looks exactly as before.* Same pixels and same `data-sketch-hash` after reload.
  - *AC-12 — Clear and cancel: nothing changes; Clear and confirm: the board is empty for every participant* (second context checks empty).
  - *AC-15 — Given they drew a line and reloaded, Then Undo is disabled and the line remains.*

### 17. `[P]` E2E: shared board between participants

- **Plan:** Test strategy — E2E column. **Spec:** FR-2, FR-3, FR-8, FR-9, FR-10, FR-13, FR-14, NFR-1.
- **Files:** `e2e/sketch-shared.spec.ts`
- **Depends on:** 14
- **Do:** Two or three contexts in one session.
- **Acceptance:**
  - *AC-2 — on a 1280 px window … board and code editor both visible; reload keeps it open; another participant's board stays closed.*
  - *AC-3 — A on 1920 px, B on 1024 px; A draws a box in the top-left quarter; B sees it in the top-left quarter.*
  - *AC-8 — A has eraser and red; B selects pen and green; A still has eraser and red; each sees their own selection marked.*
  - *AC-9 — When A finishes a circle, Then B sees it within 500 ms without reloading* (timing pattern of `e2e/latency.spec.ts`).
  - *AC-10 — A, B and C draw lines at the same moment; each sees all three; boards identical* (`data-sketch-hash` equal).
  - *AC-13 — A line, A box, B circle; A Undo → box gone for everyone, circle stays; Undo again → line gone; Ctrl/Cmd+Z does the same.*
  - *AC-14 — A's line half rubbed out by B, A undoes → rest gone; A rubbed B's box, A undoes the erase → box whole; A clears, A undoes → content returns for everyone.*

### 18. `[P]` E2E: five participants for 30 s

- **Plan:** Test strategy — AC-21; Constitution compliance 2 (one shared session). **Spec:** NFR-2.
- **Files:** `e2e/sketch-load.spec.ts`
- **Depends on:** 14
- **Do:** Five contexts in one session draw continuously for 30 s. Keep the whole run inside the suite's 10-minute budget; measure its duration and record it in the task's test output.
- **Acceptance:**
  - *AC-21 — Given 5 participants drawing continuously for 30 seconds, When it ends, Then all 5 boards are identical and each participant's own strokes appeared without visible delay for them.* Equal `data-sketch-hash` across all five; for each own stroke, its pixels are present before the server echo arrives.

### 19. `[P]` E2E: stale page, keyboard, look matrix, no home/jump entry

- **Plan:** Test strategy — AC-16, AC-19, AC-23 rows; Constitution compliance 10 (D19–D21). **Spec:** FR-16, FR-19, FR-20, NFR-6, NFR-7.
- **Files:** `e2e/sketch-a11y.spec.ts`, `e2e/audi/matrix-specs.ts`
- **Depends on:** 15
- **Do:** Stale, keyboard and jump-bar checks in one spec; add a look-matrix entry "session window with sketch open" (light, dark, widths incl. 390 px, reduced motion).
- **Acceptance:**
  - *AC-16 — Given a stale session with a drawn board, When a participant opens it, Then the drawing is shown and no tool, Clear or Undo is available.*
  - *AC-19 — the dock and "Jump to anything" have no sketch entry.* Searching "sketch" in the jump bar finds nothing; the dock lists no sketch.
  - *AC-23 — When a keyboard-only user tabs through it, Then every tool, colour, Undo and Clear is reachable in order with a visible focus ring and a name carrying its state; Given dark appearance, reduced motion and a 390 px window, Then the board passes the look checks and is usable without horizontal overflow.*
