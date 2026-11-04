# 013 — HTML presentations: tasks

From [plan.md](plan.md) and [spec.md](spec.md). Paths are relative to the repository root. Every task is test-first (constitution 1): write the listed tests, see them fail for the right reason, then implement. A task is ticked only when its per-task gate passes: the task's own tests while iterating, then `scripts/check.sh` once, every failure reported (constitution 2, 8). The complete suite on a fresh stack runs once after task 31, before `/sdd-validate`.

The working tree holds uncommitted, finished work from specs 007–009. Don't revert or reformat it. This feature only touches the shared files named in each task.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6, 7 — all `[P]` | Leaves: schema, HTML rules, setting, frame builder, live hub, frontend contract, the GIF transport type |
| 2 | 8, 9, 10, 11, 12 — all `[P]` | The bridge needs the frame builder (4); the repo needs the schema (1); socket, state and frame link need the contract (6, 7) |
| 3 | 13, 14, 15, 16 — all `[P]` | Service, chat and stale need the repo (9); the frame component needs state and frame link (11, 12) |
| 4 | 17, 18, 19 — all `[P]` | Hosting needs service + hub + setting; library REST needs service + HTML rules; library window needs the client |
| 5 | 20, 21 — `[P]` | Session REST needs library REST (same `api.py`), frame builder, chat, stale; editor sheet needs the library window |
| 6 | 22 | WebSocket core needs hosting and the session REST |
| 7 | 23, then 24 | Drawing, then chat, over the same `ws.py` |
| 8 | 25 | The session page needs socket, state, frame component and the wire contract |
| 9 | 26, 27, 28, 29, 30, 31 — in order | E2E on the one shared stack |

## Checklist

- [x] **1** — `[P]` Migration 0006: presentations, versions, sessions, participants, chat
- [x] **2** — `[P]` `html_check`: size, HTML test, slide rule
- [x] **3** — `[P]` `present_host_grace_seconds` setting
- [x] **4** — `[P]` `frame.py`: build the frame document and its headers
- [x] **5** — `[P]` `present/hub.py`: live connections, colours, strokes
- [x] **6** — `[P]` Frontend wire types and REST client
- [x] **7** — `[P]` `GifSearchTransport`: widen ChatPane/useGifSearch's provider type
- [x] **8** — `[P]` `bridge.js`: slides, follow lock, anchors, messages
- [x] **9** — `[P]` `present/repo.py`
- [x] **10** — `[P]` `PresentSocket` client
- [x] **11** — `[P]` `presentState` reducer
- [x] **12** — `[P]` `frameLink`: parent side of the bridge protocol
- [x] **13** — `[P]` Service: library, start, join/rejoin, place
- [x] **14** — `[P]` Presentation chat (text and GIF)
- [x] **15** — `[P]` Stale presentation sessions
- [x] **16** — `[P]` `PresentationFrame` component: iframe, cursor, strokes, drawing input
- [x] **17** — `[P]` Hosting rules
- [x] **18** — `[P]` Library REST and router
- [x] **19** — `[P]` Library window, route and Present area
- [x] **20** — `[P]` Session REST: start, state, frame, chat, reactivate; SPA `frame-src`
- [x] **21** — `[P]` Editor sheet: add, replace, remove
- [x] **22** — WebSocket core: join, rejoin, place, pointer, hosting, removal
- [x] **23** — WebSocket drawing
- [x] **24** — WebSocket chat and GIFs
- [x] **25** — Session window
- [x] **26** — E2E: library and editor
- [x] **27** — E2E: following, cursor, sizes, latency
- [x] **28** — E2E: hosting
- [x] **29** — E2E: isolation and runaway scripts
- [x] **30** — E2E: drawing
- [x] **31** — E2E: stale, chat, keyboard and accessibility

## Tasks

### 1. `[P]` Migration 0006

- **Plan:** Data model. **Spec:** FR-1, FR-4, FR-5, FR-24, FR-30, FR-32.
- **Files:** `backend/app/migrations/0006_presentations.sql`, `backend/tests/integration/test_present_schema.py`
- **Depends on:** nothing
- **Do:** Tables exactly as in plan "Data model", `presentation_chat_message` mirroring `chat_message` after 0005 (kind/gif columns and the `coalesce` shape check). No cascades, no drawing table.
- **Acceptance:**
  - *AC-1/AC-3 storage limits:* a title of 101 chars, a topic of 61, an empty title, or HTML over 5 242 880 bytes are refused by the database.
  - *AC-4:* two versions of one presentation can both exist; a session references a version.
  - *AC-23:* no table in the schema has a column for strokes (assert the column list of every `presentation*` table).
  - *slide_count shape:* `slides` with 0, or `page` with 3, is refused.

### 2. `[P]` `html_check`

- **Plan:** Contracts — `html_check.py`; Slides vs. single page. **Spec:** FR-1, FR-2, FR-3, NFR-4.
- **Files:** `backend/app/present/__init__.py`, `backend/app/present/html_check.py`, `backend/tests/unit/test_html_check.py`, `backend/tests/fixtures/presentations/` (`four-data-slides.html`, `four-sections.html`, `nested-data-slide.html`, `single-page.html`, `doctype-and-bom.html`)
- **Depends on:** nothing
- **Do:** `analyze(data) -> Analysis` / `Rejected(code)` with `MAX_BYTES = 5 * 1024 * 1024`; stdlib `html.parser` only. The fixtures are reused by task 8.
- **Acceptance:**
  - *AC-2:* 4 non-nested `data-slide` → `slides`, 4; 4 `body > section` → `slides`, 4; `data-slide` inside `data-slide` counts once; `data-slide` present wins over sections; none → `page`, 0.
  - *AC-3:* 5 MB + 1 byte → `too_large` (exactly 5 MB is fine); PNG magic bytes → `not_html`; NUL byte → `not_html`; plain text with no tag → `not_html`; empty → `empty`; a UTF-8 BOM is accepted.

### 3. `[P]` Grace setting

- **Plan:** Configuration. **Spec:** FR-16, FR-26.
- **Files:** `backend/app/config.py`, `backend/tests/unit/test_config.py`
- **Depends on:** nothing
- **Do:** `Settings.present_host_grace_seconds: float = 60.0`, read from `PRESENT_HOST_GRACE_SECONDS`.
- **Acceptance:** *FR-16:* default 60; env `"0.5"` gives 0.5; a non-number or ≤ 0 raises `ConfigError`.

### 4. `[P]` `frame.py`

- **Plan:** Isolation 1, 4; Slides vs. single page; Contracts — `frame.py`. **Spec:** FR-10, FR-17, NFR-2.
- **Files:** `backend/app/present/frame.py`, `backend/app/present/bridge.js` (stub: one comment line, filled by task 8), `backend/tests/unit/test_frame.py`
- **Depends on:** nothing (creates `present/__init__.py` if task 2 hasn't)
- **Do:** `build_frame(html, kind, slide)` inserts one `<style>` (slide-hiding CSS for the detected mark form, nothing for `page`) and one `<script>` (bridge.js contents, prefixed with `window.__SDD = {kind, slide}` as JSON) right after a leading doctype, or at the very start; `FRAME_HEADERS` exactly as plan. bridge.js is read once at import.
- **Acceptance:**
  - *AC-16:* `FRAME_HEADERS["Content-Security-Policy"]` contains `sandbox allow-scripts`, `default-src 'none'`, `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'`; `X-Content-Type-Options: nosniff`.
  - *FR-10:* output for `<!DOCTYPE html><html>…` keeps the doctype first and the injected script before the presentation's first `<script>`; without doctype the injection is the first thing.
  - The initial slide and kind are in `window.__SDD`; a `</script>` inside the slide value can't break out (JSON-escaped `<`).

### 5. `[P]` `present/hub.py`

- **Plan:** Drawing; Hosting (longest connected). **Spec:** FR-20, FR-21, FR-22, FR-23, FR-24, FR-26, NFR-3.
- **Files:** `backend/app/present/hub.py`, `backend/tests/unit/test_present_hub.py`
- **Depends on:** nothing
- **Do:** `PresentHub` with connections keyed by participant id (each with `connected_at`, colour index), `try_reserve`/`release_reservation` against `sessions.hub.MAX_PARTICIPANTS` (a reconnect of a connected participant needs no seat), `replace` returning the old connection, `longest_connected(exclude=None)`, strokes (`start`, `append`, `clear`, caps 2 000 points / 500 strokes), `host_timer` handle slot, `get_hub`/`peek_hub`/`drop_if_empty` registry separate from coding sessions'. Removing the last connection clears strokes.
- **Acceptance:**
  - *AC-19:* two participants get different colours; a freed colour is reused by the next joiner.
  - *AC-21/AC-20:* `clear` empties strokes. *AC-22:* strokes are returned in insertion order with their points. *AC-23:* removing the last connection empties strokes.
  - *AC-15c:* `longest_connected` is the earliest `connected_at` among current connections.
  - *NFR-3:* the 2 001st point or 501st stroke is refused; cap of 5 connections.

### 6. `[P]` Frontend wire types and REST client

- **Plan:** Contracts — REST, WebSocket, Bridge protocol. **Spec:** FR-1–FR-8, FR-31.
- **Files:** `frontend/src/present/presentTypes.ts`, `frontend/src/present/presentApi.ts`, `frontend/src/present/presentApi.test.ts`
- **Depends on:** nothing
- **Do:** Types for every REST body, WS frame and bridge message in plan. `presentApi`: `listPresentations`, `analyze(body: Blob | string)`, `addPresentation(title, topic, body)`, `replaceHtml(id, body)`, `removePresentation`, `startSession`, `getSession`, `getChat`, `removeChatMessage`, `reactivate`, `frameUrl(invite, slide)` — via `apiPath`, `credentials: "same-origin"`, raw bodies, errors returned as `{error, limit_bytes?}`.
- **Acceptance:** with a fake `fetch`: *AC-1* add sends the raw bytes with `title`/`topic` query params; *AC-3* a 413 resolves to `{error: "too_large", limit_bytes}` and a 422 to `{error: "not_html"}`; *AC-7* a 403 resolves to `{error: "missing_role"}`; *AC-8* `startSession` returns the invite.

### 7. `[P]` `GifSearchTransport`

- **Plan:** Chat (frontend reuse). **Spec:** FR-32.
- **Files:** `frontend/src/chat/gifs/useGifSearch.ts`, `frontend/src/components/ChatPane.tsx`, `frontend/src/chat/gifs/useGifSearch.test.tsx`
- **Depends on:** nothing
- **Do:** Export `GifSearchTransport` (`send(gif_search)`, `on("gif_results" | "error" | "closed")`) from `useGifSearch.ts`; `useGifSearch` and `ChatGifs.provider` take it instead of `CollabProvider`. Type change only, no behaviour change.
- **Acceptance:** *AC-15h groundwork:* a test drives `useGifSearch` with a minimal object that is not a `CollabProvider` and gets results; every existing ChatPane/GIF test still passes unchanged.

### 8. `[P]` `bridge.js`

- **Plan:** Isolation 4; Slides vs. single page; Content-relative place; Following; Bridge protocol. **Spec:** FR-10–FR-15, FR-17, FR-21, AC-14.
- **Files:** `backend/app/present/bridge.js`, `e2e/present-bridge.spec.ts`, `e2e/present-harness.ts`
- **Depends on:** 4 (and 2's fixtures)
- **Do:** The whole frame side of the protocol. The harness serves a parent page and a frame built the way `frame.py` does, via `page.route` on a fake origin. It doesn't need the app stack. If Playwright's global setup would start the stack, run this spec with a small config that skips it, documented at the top of the spec.
- **Acceptance (real Chromium):**
  - *AC-2 parity:* for every task 2 fixture, `ready.slideCount` and kind equal the Python result.
  - *AC-10:* `show {slide: 2}` shows only the third mark; `#slide=1` in the URL shows the second mark before `ready`.
  - *AC-14:* an anchor taken at a heading in a 1920 px frame resolves inside the same heading's box in a 1024 px frame; `show {anchor}` scrolls so that point is at the vertical centre (±10 px, clamped at page ends).
  - *AC-13:* with `follow {on: true}`, wheel and keyboard don't move the scroll position; `show` still does.
  - *AC-12:* moving the mouse over the frame posts `pointer` with an anchor; leaving posts `pointer {anchor: null}`.
  - *NFR-2:* `RTCPeerConnection` is undefined in the frame. Messages not from `window.parent` are ignored.

### 9. `[P]` `present/repo.py`

- **Plan:** Data model. **Spec:** FR-1, FR-4, FR-5, FR-6, FR-8, FR-9, FR-30.
- **Files:** `backend/app/present/repo.py`, `backend/tests/integration/test_present_repo.py`
- **Depends on:** 1
- **Do:** Dataclasses and SQL: `create_presentation` (with first version, in one transaction), `add_version` (+ repoint), `mark_removed`, `list_presentations` (not removed, by title), `get_presentation`, `get_version`, `create_session`, `get_session_by_invite`, `set_place`, `set_host`, `set_host_away`, `touch_activity`, `add_participant(token_hash)`, `get_participant_by_token_hash`, `leave_participant`, `sessions_of_presentation`. No `DELETE`.
- **Acceptance:** *AC-1* created rows read back; *AC-4* a session keeps its `version_id` after `add_version`; *AC-5* removed presentations are not listed but their sessions and versions still read; *AC-6* listing returns topic per row; *AC-15f* place and host persist and read back.

### 10. `[P]` `PresentSocket`

- **Plan:** Contracts — WebSocket; Chat (frontend reuse). **Spec:** FR-9, FR-11, FR-13, FR-20, FR-25, FR-32.
- **Files:** `frontend/src/present/presentSocket.ts`, `frontend/src/present/presentSocket.test.ts`
- **Depends on:** 6, 7
- **Do:** Modelled on `LearnSocket`: URL with `name` and `rejoin`, typed `on`, `send`, helpers (`place`, `pointer`, `handOver`, `strokeStart`, `strokePoints`, `clearDrawings`). Implements `ChatTransport`, `GifChatTransport`, `GifSearchTransport`. Stores `welcome.you.rejoin_token` + name in `localStorage["present:<invite>"]`; `storedIdentity(invite)` reads it. Close codes map to `not_found`, `full`, `stale`, `invalid_name`, `replaced`, `disconnected`.
- **Acceptance (fake socket):** *AC-15* reconnect URL carries the stored `rejoin` token; *AC-9* close 4403 maps to `full`; *AC-15h* `chat_send_gif` and `gif_search` are sent as 007 frames; malformed frames are ignored.

### 11. `[P]` `presentState`

- **Plan:** Hosting, Drawing, Following. **Spec:** FR-10–FR-16, FR-19–FR-25, FR-29.
- **Files:** `frontend/src/present/presentState.ts`, `frontend/src/present/presentState.test.ts`
- **Depends on:** 6
- **Do:** Reducer over server frames plus local actions (`drawing_toggled`, local stroke echo). Derived: `isHost`, `hostName`, `hostAway`, `canLead`.
- **Acceptance:** *AC-8* welcome with you = host gives `isHost`; *AC-15b* `host {handover}` moves `isHost` and keeps `place`; *AC-15* `host {away}` sets `hostAway` and keeps place; *AC-20* `place` with a different slide clears strokes; same-slide anchor change keeps them (*AC-20b*); *AC-21* `drawings_cleared` empties; *AC-12* `pointer null` hides the cursor; *AC-5* `presentation_removed` sets `available: false`; *AC-18* drawing toggle is local only.

### 12. `[P]` `frameLink`

- **Plan:** Bridge protocol. **Spec:** FR-13, FR-15, FR-17, FR-21.
- **Files:** `frontend/src/present/frameLink.ts`, `frontend/src/present/frameLink.test.ts`
- **Depends on:** 6
- **Do:** `createFrameLink(iframe)` → `{show, follow, resolve(anchors), anchorAt(x, y), on(type, handler), destroy}`; request/response by `req` id with a 150 ms timeout resolving to `null`; filters `event.source !== iframe.contentWindow`.
- **Acceptance:** *NFR-2* a message from another window is ignored; *FR-18* an unanswered `anchorAt` resolves `null` after 150 ms (fake timers); `resolved` maps rects back to the request; `destroy` removes the listener.

### 13. `[P]` Service: library, start, join, place

- **Plan:** Contracts — `service.py`; Session lifetime. **Spec:** FR-1, FR-4, FR-5, FR-8, FR-9, FR-10, FR-11, FR-12, FR-14, FR-30.
- **Files:** `backend/app/present/service.py`, `backend/tests/integration/test_present_service.py`
- **Depends on:** 9, 2
- **Do:** `add_presentation`, `replace_html`, `remove_presentation`, `start_session` (slide 0 for slides, null for page), `join` (new participant with fresh token, or reuse by token; name rule 1–30), `set_place` (host only; slide in range; returns whether the slide changed; touches activity), `session_state`. Errors as small exception classes with a `code`.
- **Acceptance:** *AC-4* a session started before `replace_html` reports 4 slides, one after reports 6; *AC-5* `start_session` on a removed presentation raises not-found; *AC-8* a slides session starts at slide 0; *AC-10/AC-11* `set_place` persists and `session_state` returns it; *AC-13* `set_place` by a non-host raises `not_host` and changes nothing; slide 4 of 4 raises `bad_slide`; *AC-15e groundwork* `join` with a valid token returns the same participant id and name; a wrong token makes a new participant.

### 14. `[P]` Presentation chat

- **Plan:** Chat. **Spec:** FR-32.
- **Files:** `backend/app/present/chat.py`, `backend/tests/integration/test_present_chat.py`
- **Depends on:** 9
- **Do:** `insert`, `insert_gif`, `history`, `mark_removed`, `send`, `send_gif`, `remove` on `presentation_chat_message`, wire shape via `app.chat.service.message_dict`, touch activity on send, refuse when stale.
- **Acceptance:** *AC-15h* text and GIF messages are stored and come back in id order with the 007 wire shape; admin removal hides one and a second removal is false; *AC-15g* a stale session refuses `send` and `send_gif` with `session_stale`; messages are scoped to their session.

### 15. `[P]` Stale presentation sessions

- **Plan:** Session lifetime (stale). **Spec:** FR-31.
- **Files:** `backend/app/present/stale.py`, `backend/tests/integration/test_present_stale.py`
- **Depends on:** 9
- **Do:** Mirror `learn/stale.py`: `mark_stale(conn, now)`, `run_periodically(pool)`, `reactivate(conn, invite)` with `SessionNotFound`/`SessionNotStale`.
- **Acceptance:** *AC-15g* with a frozen clock, 30 days + 1 s idle marks stale, 29 days doesn't; reactivate clears it and touches activity; reactivating a non-stale session raises `SessionNotStale`.

### 16. `[P]` `PresentationFrame`

- **Plan:** Content-relative place; Drawing; Following. **Spec:** FR-13, FR-15, FR-19, FR-20, FR-21.
- **Files:** `frontend/src/present/PresentationFrame.tsx`, `frontend/src/present/PresentationFrame.module.css`, `frontend/src/present/PresentationFrame.test.tsx`
- **Depends on:** 11, 12
- **Do:** Renders `<iframe sandbox="allow-scripts" title=…>` with `frameUrl`, and an SVG overlay over it: the host cursor with a name label, and strokes as polylines in each stroke's colour, positioned from `frameLink.resolve`. Re-resolves on `layout`/`scrolled`. While drawing is on, the overlay takes pointer events and turns drags into `onStrokeStart`/`onStrokePoints` (30 ms batches) with `anchorAt` at pointer-down. Otherwise it has `pointer-events: none`. Props carry `isHost`, `place`, `cursor`, `strokes`, `drawing`, and callbacks for host place/pointer reports.
- **Acceptance (RTL with a fake frame link):** *AC-18* overlay has `pointer-events: none` unless drawing; a drag while drawing emits a stroke start + points and never reaches the iframe; *AC-12* a cursor anchor renders a label "Ana" at the resolved point, `null` removes it; *AC-19* two strokes render in their own colours; *AC-13* a follower's component sends `follow {on: true}`; the iframe has `sandbox="allow-scripts"` and nothing more.

### 17. `[P]` Hosting rules

- **Plan:** Hosting table. **Spec:** FR-8, FR-16, FR-25–FR-29.
- **Files:** `backend/app/present/hosting.py`, `backend/tests/integration/test_present_hosting.py`
- **Depends on:** 13, 5, 3
- **Do:** `on_connect`, `on_disconnect`, `hand_over`, `promote_if_due` (signatures in plan, in their own module to keep `service.py` small), returning `HostEvent(host_id, host_name, away, reason)` for the caller to broadcast; per-session `asyncio.Lock`; place never changed.
- **Acceptance (real DB, frozen clock, a real `PresentHub` with fake sockets):**
  - *AC-8* first connect → host (`start`). *AC-15* host disconnects → `away`; returns after 30 s → host, `returned`.
  - *AC-15c* host away; Ben (connected first) and Cleo connected; `promote_if_due` at +59 s → None, at +60 s → Ben, `timeout`; place unchanged (*FR-29*).
  - *AC-15b* `hand_over` to Cleo → Cleo host; Ana's later `set_place` raises `not_host`; hand-over by a non-host or to a disconnected participant is refused.
  - *AC-15d* host away 61 s, nobody connected, Ben connects → Ben host (`claimed`).
  - *AC-15e* Ana returns after hosting passed to Ben → Ben stays host.
  - *AC-15f* Cleo host, everyone leaves, Dana connects within the grace → Cleo still host (away).

### 18. `[P]` Library REST and router

- **Plan:** Contracts — REST (library rows). **Spec:** FR-1–FR-7.
- **Files:** `backend/app/present/api.py`, `backend/app/main.py`, `backend/tests/integration/test_present_api.py`
- **Depends on:** 13, 2
- **Do:** `GET /presentations`, `POST /analyze`, `POST /presentations`, `PUT /presentations/{id}/html`, `DELETE /presentations/{id}` (broadcast to live hubs comes in 22). Capped raw-body read as in `images_api`. Include the router in `create_app`.
- **Acceptance (real Keycloak `login_as`):** *AC-1* editor adds by raw upload and by pasted markup (UTF-8 string body); listed with title and topic; empty title/topic or 101-char title → 422 and nothing saved. *AC-2* analyze answers `{kind:"slides", slide_count:4}` and `{kind:"page", slide_count:0}`. *AC-3* 6 MB → 413 with `limit_bytes: 5242880`, PNG → 422 `not_html`, library unchanged. *AC-6* list carries topics. *AC-7* plain user → 403 `missing_role`, signed out → 401, for analyze/add/replace/remove; library unchanged. *AC-5* delete → gone from list.

### 19. `[P]` Library window, route, Present area

- **Plan:** Module layout (frontend). **Spec:** FR-6, FR-8.
- **Files:** `frontend/src/present/PresentWindow.tsx`, `frontend/src/present/PresentWindow.module.css`, `frontend/src/present/PresentWindow.test.tsx`, `frontend/src/App.tsx`, `frontend/src/components/AreaNav.tsx` (+ their existing tests if the area list is asserted)
- **Depends on:** 6
- **Do:** A window like `LearnWindow`: sidebar with `AreaNav` (adds "Present" → `/present`, current under `/present/…`), a topic filter (all topics from the list, "All" default), rows with title, topic and slide count/"Single page", *Start session* per row (→ `/present/s/:invite`). Editors get *Add*, *Replace*, *Remove* entry points (wired in 21). Routes `/present`, `/present/s/:invite` (the session route renders a placeholder until 25).
- **Acceptance:** *AC-6* with Networking and Docker rows, choosing "Docker" lists only Docker rows, each with title and topic; *AC-8* Start session navigates to the returned invite; *AC-7* non-editors see no add/replace/remove controls; AreaNav marks Present current under `/present/s/x`.

### 20. `[P]` Session REST and SPA `frame-src`

- **Plan:** Contracts — REST (session rows); Isolation 1, 3. **Spec:** FR-4, FR-5, FR-8, FR-17, FR-30, FR-31, FR-32, NFR-2.
- **Files:** `backend/app/present/api.py`, `backend/app/main.py`, `backend/tests/integration/test_present_session_api.py`
- **Depends on:** 18, 4, 14, 15
- **Do:** `POST /sessions`, `GET /sessions/{invite}`, `GET /sessions/{invite}/frame`, `GET/DELETE …/chat…`, `POST …/reactivate`; SPA fallback response gets `Content-Security-Policy: frame-src 'self'`; stale job started and cancelled in `lifespan`.
- **Acceptance:** *AC-8* anyone (signed out) starts a session → 201 invite. *AC-4* frame of an old session contains the 4-slide HTML, a new session's the 6-slide one. *AC-5* after removal: frame → 410, state `available: false`. *AC-16* frame response headers equal `FRAME_HEADERS`; `GET /` and `GET /present/s/x` carry `frame-src 'self'`. *AC-15g* stale state is `stale: true` with `can_reactivate` true only for admins; reactivate is admin-only (403 otherwise), 409 when not stale. *AC-15h* chat GET returns history and `read_only`; DELETE admin-only.

### 21. `[P]` Editor sheet

- **Plan:** Contracts — REST (library). **Spec:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-7.
- **Files:** `frontend/src/present/PresentationEditorSheet.tsx`, `frontend/src/present/PresentationEditorSheet.test.tsx`, `frontend/src/present/PresentWindow.tsx`
- **Depends on:** 19
- **Do:** A `Sheet` with title (≤ 100), topic (≤ 60), a *File* / *Paste* segmented choice (file input accepting `.html,.htm`, or a textarea), *Check* → shows "Presentation of N slides" or "Single page" from `analyze`, then *Save* (add or replace). Errors shown inline: the 5 MB limit, "not HTML", empty/too-long fields. *Remove* asks to confirm. Wire into `PresentWindow`.
- **Acceptance:** *AC-1* save calls add with title, topic and the file or pasted text; empty title/topic or 101 chars blocks save with a message. *AC-2* after Check the sheet says "4 slides" / "single page" and only then enables Save. *AC-3* a `too_large` answer shows "5 MB" and nothing is saved; `not_html` shows "isn't HTML". *AC-4* Replace sends `replaceHtml`. *AC-5* Remove confirms then calls remove and the row disappears.

### 22. WebSocket core

- **Plan:** Contracts — WebSocket; Hosting; Following; Session lifetime. **Spec:** FR-5, FR-8–FR-16, FR-25–FR-31.
- **Files:** `backend/app/present/ws.py`, `backend/app/present/api.py` (DELETE broadcasts `presentation_removed`), `backend/app/main.py` (router), `backend/tests/integration/test_present_ws.py`
- **Depends on:** 17, 20
- **Do:** Join (close codes, seat reservation, rejoin, replace older connection with 4409), `welcome`, `presence`, `place` (host only, broadcast to all, slide change clears strokes via hub and broadcasts `drawings_cleared`), `pointer` (host only, to others), `hand_over`, host timer task per hub (`promote_if_due` after the grace from settings), leave → `on_disconnect`. Stale refuses join (4410) and actions (`session_stale`). Connection borrowed per step, as `learn/ws.py`.
- **Acceptance (TestClient, real DB, grace 0.3 s):** *AC-8* first joiner's welcome says they are host at slide 0. *AC-9* a 6th joiner closes 4403; a name of 31 chars closes 4422. *AC-10/AC-11* host `place` reaches Ben; a new joiner's welcome has it. *AC-12* host `pointer` reaches Ben, not the host; Ben's `pointer` reaches nobody. *AC-13* Ben's `place` → `error not_host`, nobody gets a `place`. *AC-15* host disconnects → others get `host away`; host reconnects with its token within the grace → `host returned`. *AC-15c* after the grace the longest-connected becomes host. *AC-15b* hand-over broadcast. *AC-5* deleting the presentation sends `presentation_removed` to a live session. *AC-15g* stale → 4410.

### 23. WebSocket drawing

- **Plan:** Drawing. **Spec:** FR-19–FR-24, NFR-3.
- **Files:** `backend/app/present/ws.py`, `backend/tests/integration/test_present_ws_drawing.py`
- **Depends on:** 22
- **Do:** `stroke_start` (server sets `participant_id` and colour), `stroke_points`, `clear_drawings`, strokes in `welcome`, caps → `drawing_full`, stale → `session_stale`, activity touched (throttled).
- **Acceptance:** *AC-19* Ben's and Cleo's strokes reach every other participant with different colours. *AC-20* a slide change → `drawings_cleared`, a joiner after it gets no strokes. *AC-21* Cleo's `clear_drawings` reaches everyone. *AC-22* a joiner's welcome has current strokes with points. *AC-23* after everyone leaves, a new joiner gets none, and no `presentation*` table row contains a stroke id. *AC-15g* drawing in a stale session is refused.

### 24. WebSocket chat and GIFs

- **Plan:** Chat. **Spec:** FR-32.
- **Files:** `backend/app/present/ws.py`, `backend/tests/integration/test_present_ws_chat.py`
- **Depends on:** 23
- **Do:** `chat_send`, `chat_send_gif`, `gif_search` exactly as `sessions/ws.py` (tasks spawned, drained on shutdown via a `drain_gif_tasks` registered in `lifespan`), `welcome.chat`.
- **Acceptance (fake GIPHY):** *AC-15h* Ben's text and GIF reach everyone and are in a later joiner's `welcome.chat`; admin REST removal sends `chat_removed`; GIF search answers the sender only; refusals carry `client_id`.

### 25. Session window

- **Plan:** Following; Hosting; Drawing; Session lifetime; Chat. **Spec:** FR-8–FR-16, FR-19–FR-23, FR-25–FR-32, NFR-5, NFR-6.
- **Files:** `frontend/src/present/PresentSessionWindow.tsx`, `frontend/src/present/PresentSessionWindow.module.css`, `frontend/src/present/PresentSessionWindow.test.tsx`, `frontend/src/App.tsx` (route to it)
- **Depends on:** 10, 11, 16, 19
- **Do:** Name prompt (skipped when a stored identity exists), toolbar (◀ ▶ "n / m" for slides, *Draw* toggle `aria-pressed`, *Clear drawings*, *Hand over…* menu of connected participants for the host), host-away banner, "no longer available" empty state, stale view (frame at stored place, chat read-only, *Reactivate* for admins), inspector with presence (host marked, colour swatch) and `ChatPane` with GIFs. Arrow keys / PageUp / PageDown step slides for the host only, registered through the shortcut registry.
- **Acceptance (RTL, fake socket):** *AC-8* host sees enabled ◀ ▶ at "1 / 4"; *AC-13* a follower's ◀ ▶ are disabled and arrow keys send nothing; *AC-15* `host away` shows the banner naming the host; *AC-15b* host can hand over to Cleo from the menu; *AC-5* `presentation_removed` replaces the frame with the message; *AC-15g* stale: no socket, chat read-only, Reactivate only for admins; *AC-15h* chat shows a GIF button; *AC-18/AC-21* Draw toggles `aria-pressed` and Clear sends `clear_drawings`; *AC-25* every control is a native button with an accessible name.

### 26. E2E: library and editor

- **Files:** `e2e/present-library.spec.ts`, `e2e/fixtures/presentations/` (copies or symlinks of task 2's fixtures plus a 6 MB file generated at runtime and a PNG)
- **Depends on:** 21, 25
- **Acceptance:** *AC-1* editor1 adds "Intro to DNS"/"Networking" by file and another by paste; both listed. *AC-2* the sheet says "4 slides" / "single page" before Save. *AC-3* 6 MB and PNG-as-.html are refused with their messages; library unchanged. *AC-6* filter by Docker. *AC-7* plain1 and a signed-out visitor see no editor controls, and direct API calls are refused. *AC-5* removing P while a session is open shows "no longer available" in that session.

### 27. E2E: following, cursor, sizes, latency

- **Files:** `e2e/present-follow.spec.ts`
- **Depends on:** 25, 8
- **Acceptance:** *AC-8* Ana starts a session, is host, sees slide 1. *AC-9* Ben joins by link without an account. *AC-10* slide 3 / back to 2 followed; single page: Ana scrolls to the third heading, Ben sees it. *AC-11* Ben reloads and Cleo joins: both on Ana's slide immediately. *AC-12* cursor labelled "Ana" over the same word; hidden on leave. *AC-13* Ben's next button, arrow keys and wheel change nothing. *AC-14* Ana 1920 px, Ben 1024 px, heading half-way down: visible for Ben with the cursor inside its box. *AC-24* slide change ≤ 500 ms and cursor ≤ 200 ms on the local stack (median of 5, same method as `latency.spec.ts`).

### 28. E2E: hosting

- **Files:** `e2e/present-hosting.spec.ts`
- **Depends on:** 25
- **Acceptance:** *AC-15* Ana closes her tab, Ben told host is away; Ana reopens within 60 s, moves to slide 3, Ben follows. *AC-15b* hand-over to Cleo; Ana's controls disabled. *AC-15c* (one test, ~61 s real time) Ana gone, Ben (joined first) becomes host, place kept. *AC-15e* Ana returns as follower. *AC-15f* everyone leaves, Dana opens within 60 s: slide 3, Cleo shown as host. *AC-15d* stays covered at integration level (task 17), which avoids a second 60 s wait in the gate.

### 29. E2E: isolation and runaway scripts

- **Files:** `e2e/present-isolation.spec.ts`, `e2e/fixtures/presentations/hostile.html`, `e2e/fixtures/presentations/loop.html`
- **Depends on:** 25
- **Acceptance:** *AC-16* the hostile presentation tries `document.cookie`, `localStorage`, `parent.document`, `top.location = …`, `location = "https://example.com/"`, `fetch`, an `<img>` to another host, `new WebSocket`, `RTCPeerConnection`. It records each outcome where only the test can read it: in the frame's own DOM, read via `frame.evaluate`. Every attempt fails; the session page's URL and DOM are unchanged; `page.on("request")` sees no request to a host other than the app's. The frame's canvas animation changes pixels over time. *AC-17* `loop.html` (`while(true){}` in slide 2's script): host moves slides, Ben's counter follows, a stroke drawn by Ben shows for Ana.

### 30. E2E: drawing

- **Files:** `e2e/present-drawing.spec.ts`
- **Depends on:** 25
- **Acceptance:** *AC-18* Ben toggles Draw, drags across text: a stroke appears, no text is selected in the frame, Ana's Draw stays off; off again → the pointer reaches the presentation (a link hover/click inside the frame works). *AC-19* Ben and Cleo strokes visible to all within 500 ms in two colours. *AC-20* slide change clears; back to slide 2 shows none. *AC-20b* single page: Ben circles heading 2, Ana scrolls it off-screen and back, the stroke still surrounds heading 2 for everyone. *AC-21* Cleo clears for all. *AC-22* Dana joins and sees strokes. *AC-23* everyone leaves, Ana reopens: none.

### 31. E2E: stale, chat, keyboard and accessibility

- **Files:** `e2e/present-session-extras.spec.ts`
- **Depends on:** 25
- **Acceptance:** *AC-15g* a session made stale through the database (as `stale.spec.ts` does) shows the last place read-only; slide change, drawing and chat refused; admin1 reactivates and all three work. *AC-15h* Ben posts text and a GIF (fake GIPHY); everyone sees both; after reload they remain; admin1 removes one. *AC-25* keyboard-only host reaches ◀ ▶, Draw, Clear with Tab and uses them; axe WCAG 2 AA on the session and library windows reports no violations.
