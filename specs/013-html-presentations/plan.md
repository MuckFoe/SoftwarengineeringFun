# 013 — HTML presentations: plan

From [spec.md](spec.md). HOW only; every decision names the requirement it serves.

## Architecture

```
browser (session page, app origin)                       backend (one api process, --workers 1)
┌──────────────────────────────────────────────┐         ┌────────────────────────────────────┐
│ PresentSessionWindow                          │  WS     │ present/ws.py ── present/service.py│
│  ├ toolbar: ◀ ▶ n/m, Draw, Clear, Hand over   │◀──────▶│      │              │              │
│  ├ PresentationFrame                          │  JSON   │ present/hub.py   present/repo.py   │
│  │   ├ <iframe sandbox="allow-scripts"        │         │ (live: conns,    (Postgres)        │
│  │   │    src=/api/present/sessions/X/frame>  │  HTTP   │  strokes, timer) present/chat.py   │
│  │   │    └ bridge.js (injected, first)  ◀─postMessage─▶│ present/api.py   present/stale.py  │
│  │   └ overlay (SVG): host cursor, strokes,   │         │ present/html_check.py  frame.py    │
│  │       drawing input                        │         └────────────────────────────────────┘
│  └ inspector: participants (host marked), chat│
└──────────────────────────────────────────────┘
```

### Isolation (FR-17, FR-18, NFR-2)

The presentation never shares an origin with the app:

1. **Frame document served by the backend** at `GET /api/present/sessions/{invite}/frame`, with response headers
   `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
   The CSP `sandbox` directive gives the document an opaque origin even if opened directly, so cookies, `localStorage` and the app's DOM are out of reach (AC-16). `connect-src`/`img-src`/… stop fetch, XHR, WebSocket, beacons, remote images, fonts and scripts (FR-17 "load anything from elsewhere"; out-of-scope list: only data: resources inside the HTML).
2. **The iframe element** carries `sandbox="allow-scripts"` (no `allow-same-origin`, `allow-top-navigation*`, `allow-popups`, `allow-forms`, `allow-modals`): no navigating the session window, no popups, no forms, no `alert()` blocking.
3. **The app page** (the SPA's `index.html`, served by `_spa_fallback`) gets `Content-Security-Policy: frame-src 'self'`. The frame navigating *itself* elsewhere (`location = …`, `<meta http-equiv=refresh>`) is checked against the embedder's `frame-src` and blocked, so no request leaves for another host (AC-16). Same-origin navigations of the frame stay sandboxed and carry no cookies (Lax cookie, cross-site initiator).
4. **bridge.js** runs first in the frame and deletes `RTCPeerConnection`/`webkitRTCPeerConnection`/`RTCDataChannel` from the frame's window (WebRTC is not governed by CSP). **Residual risk, flagged for the human:** a script can create an `about:blank` child frame and take a fresh `RTCPeerConnection` from it; CSP has no WebRTC switch in shipped browsers. Practical exposure: an *editor* would have to author such HTML (FR-1/FR-7), and the frame holds no participant data to leak.
5. **Runaway scripts (FR-18):** everything the session needs — controls, presence, chat, cursor and drawing overlay — lives in the parent page, never in the frame. Chromium runs opaque-origin sandboxed frames in their own process (site isolation for sandboxed frames), so a frame stuck in `while(true){}` freezes only itself. AC-17 is verified end-to-end in Chromium (the browser the E2E suite uses). If the frame stops answering, the parent keeps working from its last known geometry (see Bridge protocol, fallback anchors).

### Slides vs. single page (FR-2, FR-10, FR-11)

One rule, implemented twice (Python for the editor's answer and the stored `slide_count`, JS in `bridge.js` for display), and a shared fixture set proves both agree:

- **Slide marks:** elements with a `data-slide` attribute that are not inside another `data-slide` element. If there are none, the `<section>` elements that are direct children of `<body>`.
- One or more marks → `kind = "slides"`, `slide_count` = number of marks. None → `kind = "page"`, `slide_count = 0`.

Showing slide *i*: `frame.py` injects a stylesheet that hides every slide mark that lacks `data-sdd-current` (`[data-slide]:not([data-sdd-current]){display:none!important}` or the `body>section` form); bridge.js sets `data-sdd-current` on mark *i* (initially from the frame URL's `#slide=i`, before first paint), and switches it on `show` messages without reloading the frame.

### Content-relative place, cursor and strokes (FR-13, FR-15, FR-21, AC-14, AC-20b)

Screen coordinates differ between participants; layout reflows with width. Everything that is synced is therefore an **anchor**:

```ts
type Anchor = { path: number[]; fx: number; fy: number } // path: child-element indices from <body>; fx/fy: fraction of that element's border box
```

- `bridge.js` turns a viewport point into an anchor with `document.elementFromPoint` (overlay hidden from hit-testing because it is in the parent) and back into a viewport point by walking `path` and reading `getBoundingClientRect()`. A path that no longer resolves falls back to the nearest existing ancestor.
- **Place** = `{slide: number | null, anchor: Anchor | null}`. The anchor is the point at the horizontal centre, vertical centre of the host's viewport. Followers scroll so that point lands at *their* viewport centre (AC-14: a heading half-way down the host's screen is mid-screen for Ben).
- **Host cursor** = an anchor of the host's pointer, or `null` when it leaves the frame (FR-13).
- **Stroke** = an anchor element chosen at pointer-down plus its points as `[fx, fy]` fractions of that element's box. Rendering re-resolves the element's box on every scroll/resize report, so strokes stay on the content and scroll with it (FR-21 single page). A stroke started where the frame does not answer within 150 ms uses `anchor = null`: fractions of the frame's viewport box.

### Following and not leading (FR-10–FR-14)

- Host: bridge reports `scrolled` (throttled to one per animation frame, then ≤ 1 per 50 ms to the server) and `pointer`; the page sends `place`/`pointer` frames; the server checks the sender is host.
- Followers: the page sends `follow: true` to the bridge, which sets `overflow: hidden` on `html` and `body` (wheel, keyboard and scrollbar scrolling stop; programmatic `scrollTo` still works) and ignores nav keys. Slide buttons are disabled; the page's nav shortcuts check `isHost` (AC-13). The server also refuses `place` from a non-host (`error not_host`), so a modified client changes nothing for anyone.
- Keys inside the frame: bridge forwards `ArrowLeft/ArrowRight/PageUp/PageDown/Home/End` (slides) to the page, which acts only for the host.

### Hosting (FR-8, FR-16, FR-25–FR-29)

State per session, persisted: `host_participant_id`, `host_away_since`. Persisted so FR-30 (reopen shows the host) survives restarts.

Participants are **re-identified across reconnects** by a `rejoin_token` (32 random bytes, base64url) issued in `welcome` and kept in the browser's `localStorage` under `present:<invite>` with the name; the server stores its SHA-256 only. Reconnecting with a valid token reuses the participant row (and its name), which is what makes "the host returns within 60 s" (FR-16) and "the former host returns" (FR-28) recognisable. If that participant already has a live connection, the older connection is closed with `4409` (replaced).

Rules, in `service.py`, all under one per-session `asyncio.Lock`, time from `app.clock`, grace `settings.present_host_grace_seconds` (default 60; tests shorten it):

| Event | Effect |
|---|---|
| connect, `host_participant_id` null | joiner becomes host (the starter connects first — FR-8) |
| connect, joiner is host | clear `host_away_since`; broadcast `host` (`returned`) — FR-16 |
| connect, host away ≥ grace | host := longest-connected among connected (the joiner, if alone) — FR-26 catch-up after a restart, FR-27 |
| host's last connection drops | `host_away_since := now`; broadcast `host` (`away`); start timer — FR-16 |
| timer fires (grace after away), host still away, someone connected | host := connected participant with the earliest `connected_at`; broadcast `host` (`timeout`) — FR-26 |
| `hand_over {participant_id}` from host, target connected | host := target; broadcast `host` (`handover`) — FR-25 |

The place is untouched by every change of host (FR-29). AC-15f ("everyone leaves, Dana reopens later, Cleo shown as host") holds when Dana opens it within the grace; after it, FR-27 makes Dana host. The tests use exactly that split.

### Drawing (FR-19–FR-24)

Live only, in `present/hub.py` memory: `strokes: dict[stroke_id, Stroke]`, insertion-ordered. Never written to Postgres (FR-24). Cleared: on a slide change (FR-21), on `clear_drawings` from anyone (FR-22), when the last connection leaves (FR-24). Joiners get the current strokes in `welcome` (FR-23). Colour: index into a 5-colour palette, the lowest index not used by a connected participant, kept per participant while connected (FR-20). Caps (NFR-3): 2 000 points per stroke, 500 strokes per session; past a cap the stroke is refused with `error drawing_full`.

The page collects pointer moves while drawing and sends `stroke_points` batches every 30 ms; the server relays at once (NFR-1 ≤ 500 ms). Drawing mode is page-local state (FR-19); the overlay takes pointer events only while it is on, so the presentation gets no clicks or selections (AC-18).

### Session lifetime, stale, removal (FR-4, FR-5, FR-30–FR-32)

- A session references the **version** it started from (FR-4). Replacing HTML makes a new version and repoints the presentation; existing sessions keep theirs.
- Removing sets `presentation.removed_at` (never `DELETE`, as everywhere in this app). The frame endpoint answers `410 {error: "presentation_removed"}`; session GET returns `available: false`; live hubs of its sessions get `presentation_removed` and the page shows "This presentation is no longer available" instead of the frame (FR-5). Chat keeps working.
- Stale: `present/stale.py` mirrors `learn/stale.py` on `presentation_session` (30 days, hourly, started in `main.lifespan`). A stale session refuses the WebSocket (`4410`); the page then renders the frame at the stored place, no following, chat read-only from REST, and *Reactivate* for admins (FR-31). Activity = place change, stroke, chat; touched at most once a minute except place changes, which write the place anyway.

### Chat (FR-32)

`present/chat.py`: spec 002 rules (`app.chat.rules`), spec 007 GIF messages (`app.gifs.service.search`, `resolve_for_post`, the app-wide limiters on `app.state`), wire shape `app.chat.service.message_dict` (it takes the `ChatMessage` dataclass from `app.chat.repo`, which this module reuses). Table `presentation_chat_message` mirrors `chat_message` after migration 0005.

Frontend reuses `useChat` and `ChatPane` with GIFs; `ChatGifs.provider` and `useGifSearch` are widened from `CollabProvider` to a `GifSearchTransport` interface that both `CollabProvider` and `PresentSocket` satisfy (type change only). Stale history and admin removal use this feature's REST, as the learning page does.

## Module layout and dependency direction (constitution 9)

```
backend/app/present/
  html_check.py   validate + analyze bytes → Analysis | Rejected      (stdlib html.parser)
  frame.py        build_frame(html, kind, slide) → str; FRAME_HEADERS; bridge.js loaded once
  bridge.js       injected verbatim; no imports
  repo.py         SQL for presentations, versions, sessions, participants
  hub.py          live connections, colours, strokes, host timer handle
  service.py      library ops, start/join/leave, place, hosting rules, drawing rules
  chat.py         presentation chat (text + GIF) repo+service
  stale.py        mark_stale, run_periodically, reactivate
  api.py          REST
  ws.py           WebSocket
backend/app/migrations/0006_presentations.sql
frontend/src/present/
  presentTypes.ts   wire + bridge message types
  presentApi.ts     REST client
  presentSocket.ts  WS client; implements ChatTransport, GifChatTransport, GifSearchTransport
  presentState.ts   reducer: participants, host, place, strokes, cursor, availability
  frameLink.ts      parent side of the postMessage protocol
  PresentationFrame.tsx (+ .module.css)  iframe + SVG overlay + drawing input
  PresentWindow.tsx (+ .module.css)      library with topic filter
  PresentationEditorSheet.tsx            add / replace (editors)
  PresentSessionWindow.tsx (+ .module.css)
```

Direction: `present` → `auth.deps`, `chat.rules`, `chat.repo.ChatMessage`, `chat.service.message_dict`, `gifs.service`, `sessions.api.get_conn`, `sessions.hub.MAX_PARTICIPANTS`, `clock`, `config`. Nothing imports `present` except `main.py`. Frontend `present/` → `chat/`, `components/`, `ui/`, `api/types` (shared chat types), `base`, `auth/useMe`; only `App.tsx` and `AreaNav.tsx` import `present/`.

Touched outside `present/`: `main.py` (routers, stale task, SPA `frame-src` header), `config.py` (`present_host_grace_seconds`), `App.tsx` (routes `/present`, `/present/s/:invite`), `AreaNav.tsx` (Present area), `ChatPane.tsx` + `useGifSearch.ts` (transport type widening only).

## Data model — `0006_presentations.sql`

```sql
create table presentation (
    id                 uuid primary key default gen_random_uuid(),
    title              text not null check (char_length(title) between 1 and 100),
    topic              text not null check (char_length(topic) between 1 and 60),
    current_version_id uuid null,               -- set right after the first version insert
    created_by_sub     text not null,
    created_at         timestamptz not null default now(),
    removed_at         timestamptz null,
    removed_by_sub     text null,
    check ((removed_at is null) = (removed_by_sub is null))
);
create table presentation_version (
    id              uuid primary key default gen_random_uuid(),
    presentation_id uuid not null references presentation (id),
    html            text not null check (octet_length(html) between 1 and 5242880),
    kind            text not null check (kind in ('slides', 'page')),
    slide_count     int  not null check ((kind = 'slides' and slide_count >= 1) or (kind = 'page' and slide_count = 0)),
    created_by_sub  text not null,
    created_at      timestamptz not null default now()
);
alter table presentation add foreign key (current_version_id) references presentation_version (id);

create table presentation_session (
    id                  uuid primary key default gen_random_uuid(),
    invite_id           text not null unique,
    version_id          uuid not null references presentation_version (id),
    slide               int  null,              -- 0-based; null for a single page
    anchor              jsonb null,             -- last place's Anchor
    host_participant_id uuid null,              -- FK added below
    host_away_since     timestamptz null,
    created_at          timestamptz not null default now(),
    last_activity_at    timestamptz not null default now(),
    stale_at            timestamptz null
);
create table presentation_participant (
    id                uuid primary key default gen_random_uuid(),
    session_id        uuid not null references presentation_session (id),
    display_name      text not null,
    rejoin_token_hash text not null unique,     -- sha256 hex of the rejoin token
    joined_at         timestamptz not null default now(),
    left_at           timestamptz null
);
alter table presentation_session add foreign key (host_participant_id) references presentation_participant (id);

create table presentation_chat_message ( ... same columns and checks as chat_message after 0005,
    session_id references presentation_session, participant_id references presentation_participant ...);
create index presentation_chat_message_session on presentation_chat_message (session_id, id);
```

No drawing table (FR-24). Strokes and the host's pointer are memory only.

## Contracts

### Python

```python
# html_check.py
MAX_BYTES = 5 * 1024 * 1024
class Rejected(Exception): code: Literal["too_large", "not_html", "empty"]
@dataclass(frozen=True) class Analysis: kind: Literal["slides", "page"]; slide_count: int; html: str
def analyze(data: bytes) -> Analysis   # raises Rejected
#   not_html: not strict UTF-8 (BOM allowed), contains NUL, or has no element start tag

# frame.py
def build_frame(html: str, kind: str, slide: int | None) -> str   # injects <style>+<script> after doctype or at start
FRAME_HEADERS: dict[str, str]

# service.py (selected)
async def start_session(conn, presentation_id) -> Session                       # PresentationNotFound
async def join(conn, session_id, name, rejoin_token: str | None) -> Joined       # (participant, token, reused)
async def set_place(conn, session_id, participant_id, slide, anchor) -> PlaceChange  # NotHost, BadSlide, Stale, Unavailable
async def on_connect(conn, hub, session_id, participant_id, now) -> HostEvent | None
async def on_disconnect(conn, hub, session_id, participant_id, now) -> HostEvent | None
async def hand_over(conn, hub, session_id, from_id, to_id) -> HostEvent          # NotHost, NotConnected
async def promote_if_due(conn, hub, session_id, now, grace) -> HostEvent | None
```

### REST (all JSON unless noted; errors `{error: code, ...}`)

| Method, path | Who | Request | Response |
|---|---|---|---|
| `GET /api/present/presentations` | anyone | — | `200 [{id, title, topic, kind, slide_count}]`, not removed, by title (FR-6) |
| `POST /api/present/analyze` | editor | raw body ≤ 5 MB | `200 {kind, slide_count}`; `413 {error:"too_large", limit_bytes}`; `422 {error:"not_html"}` (FR-2, FR-3) |
| `POST /api/present/presentations?title=&topic=` | editor | raw body | `201 {id, title, topic, kind, slide_count}`; 413/422 as above; `422 {error:"invalid_title"\|"invalid_topic"}` (FR-1) |
| `PUT /api/present/presentations/{id}/html` | editor | raw body | `200 {...same}`; 404; 413/422 (FR-4) |
| `DELETE /api/present/presentations/{id}` | editor | — | `204`; 404; live sessions get `presentation_removed` (FR-5) |
| `POST /api/present/sessions` | anyone | `{presentation_id}` | `201 {invite_id}`; 404 (FR-8) |
| `GET /api/present/sessions/{invite}` | anyone | — | `200 {title, topic, kind, slide_count, available, stale, can_reactivate, host_name, place:{slide, anchor}}`; 404 |
| `GET /api/present/sessions/{invite}/frame` | anyone | — | `200 text/html` + `FRAME_HEADERS`; 404; `410 {error:"presentation_removed"}` |
| `GET /api/present/sessions/{invite}/chat` | anyone | — | `{messages, read_only}` |
| `DELETE /api/present/sessions/{invite}/chat/{id}` | admin | — | 204; 404 |
| `POST /api/present/sessions/{invite}/reactivate` | admin | — | `{}`; 404; `409 {error:"not_stale"}` |

401 signed out / 403 `{error:"missing_role", role:"editor"|"admin"}` via `require_role` (FR-7). Uploads read with the images API's capped stream reader. Title/topic are stripped; empty or over-length → 422.

### WebSocket `/api/present/sessions/{invite}/ws?name=…&rejoin=…`

Close codes as other sessions: `4404` not found, `4403` full (`MAX_PARTICIPANTS`), `4410` stale, `4422` bad name (ignored when `rejoin` matches), `4409` replaced by a newer connection of the same participant.

Server → client:

```ts
{type:"welcome", you:{participant_id, rejoin_token, name}, available, kind, slide_count,
 host:{id, name, away}, place:{slide, anchor}, participants:[{id, name, color}],
 strokes: Stroke[], chat: ChatMessage[]}
{type:"presence", participants:[{id, name, color}]}
{type:"host", host:{id, name, away}, reason:"start"|"returned"|"away"|"timeout"|"handover"|"claimed"}
{type:"place", slide, anchor}
{type:"pointer", anchor: Anchor | null}                    // host's, to everyone but the host
{type:"stroke_start", stroke: Stroke}                      // to everyone but the drawer
{type:"stroke_points", id, points:[number, number][]}      // to everyone but the drawer
{type:"drawings_cleared"}
{type:"presentation_removed"}
{type:"error", code}                                       // not_host, bad_slide, session_stale, drawing_full, not_connected, presentation_unavailable
// + chat_message, chat_removed, gif_results, chat/gif errors exactly as spec 002/007
Stroke = {id: string, participant_id, color, anchor: Anchor | null, points: [number, number][]}
```

Client → server: `place {slide, anchor}`, `pointer {anchor|null}`, `hand_over {participant_id}`, `stroke_start {id, anchor, points}`, `stroke_points {id, points}`, `clear_drawings {}`, `chat_send`, `chat_send_gif`, `gif_search` (002/007 shapes). Malformed frames are ignored, as on the other sockets.

### Bridge protocol (`window.postMessage`, every message `{sdd: <type>, ...}`)

Parent accepts only messages whose `event.source` is its iframe's `contentWindow`; bridge accepts only `event.source === window.parent`. Origin is opaque, so `targetOrigin` is `"*"`; nothing secret travels.

| Direction | Message |
|---|---|
| frame → page | `ready {kind, slideCount}` · `scrolled {anchor}` · `pointer {x, y, anchor}` · `pointer {anchor:null}` · `key {key}` · `layout {}` (resize/scroll/slide change) |
| page → frame | `show {slide, anchor}` · `follow {on}` · `resolve {req, anchors}` → `resolved {req, rects:[{x,y,w,h}\|null]}` · `anchorAt {req, x, y}` → `anchorAt {req, anchor, rect}` |

## Configuration

`Settings.present_host_grace_seconds: float = 60.0`, env `PRESENT_HOST_GRACE_SECONDS` (FR-16, FR-26). Production and hub compose leave it unset.

## Test strategy

Levels: **unit** (pytest, pure functions; vitest, reducers/clients with fake sockets and fake frames), **integration** (pytest with real Postgres via the `db`/`database_url` fixtures, real app via `TestClient`, real test Keycloak via `login_as` for roles), **E2E** (Playwright, Chromium, production compose stack — layout, iframe isolation, multiple browser contexts at different viewport sizes). Nothing owned by the project is mocked (constitution 4); GIPHY is the existing fake server.

| AC | Test | Level |
|---|---|---|
| AC-1 | `test_present_api.py::test_add_upload_and_paste`, `test_add_refuses_empty_or_long_title_topic`; e2e `present-library.spec.ts` add by file and by paste | integration, E2E |
| AC-2 | `test_html_check.py` (slide rule fixtures: 4 `data-slide`, 4 `body>section`, nested `data-slide`, none); `test_present_api.py::test_analyze`; e2e editor sees "4 slides" / "single page" before saving | unit, integration, E2E |
| AC-3 | `test_html_check.py` (6 MB, PNG bytes, NUL, no tags); `test_present_api.py::test_too_large_and_not_html_save_nothing` | unit, integration |
| AC-4 | `test_present_service.py::test_replace_keeps_running_sessions_on_old_version`; frame endpoint serves old/new | integration |
| AC-5 | `test_present_api.py::test_remove_hides_and_frame_410`; `test_present_ws.py::test_remove_notifies_live_session`; e2e unavailable message | integration, E2E |
| AC-6 | `PresentWindow.test.tsx` filter; e2e filter | unit, E2E |
| AC-7 | `test_present_api.py::test_non_editor_refused` (plain user, signed out) for analyze/add/replace/remove | integration |
| AC-8 | `test_present_ws.py::test_starter_becomes_host_on_slide_0`; e2e start | integration, E2E |
| AC-9 | `test_present_ws.py::test_join_without_account_and_cap` | integration |
| AC-10, AC-11 | `test_present_ws.py::test_place_broadcast_and_welcome_place`; e2e `present-follow.spec.ts` slides + single page | integration, E2E |
| AC-12 | `test_present_ws.py::test_pointer_relayed_to_others_only`; e2e cursor labelled "Ana" over same word, hidden on leave | integration, E2E |
| AC-13 | `test_present_ws.py::test_non_host_place_refused`; `PresentSessionWindow.test.tsx` controls disabled; e2e keyboard/wheel/next by Ben change nothing | integration, unit, E2E |
| AC-14 | e2e 1920 px vs 1024 px contexts: heading visible and cursor within its box | E2E |
| AC-15–15f | `test_present_hosting.py` (service, frozen clock: away, return < grace, timeout → longest connected, 59 s vs 60 s, claim when alone, former host returns as participant, reopen shows host); `test_present_ws.py::test_host_timer` with grace 0.3 s; e2e hand-over + tab close/reopen | integration, E2E |
| AC-15g | `test_present_stale.py` (mark, refuse ws/actions/chat, reactivate admin-only); e2e stale view | integration, E2E |
| AC-15h | `test_present_chat.py` (text, GIF via fake GIPHY, history, admin remove, stale read-only); e2e chat + GIF | integration, E2E |
| AC-16 | `test_present_frame.py` (headers exact, injection position); e2e hostile presentation: cookie/localStorage/parent/top/navigation/fetch/img/WebSocket all fail, no request to another host recorded, page unchanged; animation runs | integration, E2E |
| AC-17 | e2e `while(true){}` presentation: host changes slide, follower's counter follows, drawing visible | E2E |
| AC-18 | `PresentationFrame.test.tsx` overlay pointer-events only while drawing; e2e drag draws and doesn't select text, other user's tool off | unit, E2E |
| AC-19 | `test_present_ws.py::test_strokes_relayed_with_distinct_colours`; e2e two drawers, < 500 ms | integration, E2E |
| AC-20, AC-20b | `test_present_ws.py::test_slide_change_clears`; e2e single-page stroke stays around heading across scroll | integration, E2E |
| AC-21 | `test_present_ws.py::test_clear_by_anyone` | integration |
| AC-22 | `test_present_ws.py::test_joiner_gets_strokes` | integration |
| AC-23 | `test_present_ws.py::test_strokes_gone_after_everyone_leaves` + no stroke data in any table | integration |
| AC-24 | e2e `present-latency` style timing on the local stack (same approach as `latency.spec.ts`) | E2E |
| AC-25 | e2e keyboard-only host (Tab to ◀ ▶, Draw, Clear; arrow shortcuts) + axe WCAG AA scan | E2E |

Bridge-side rules (slide detection parity, anchor round-trip) run in real Chromium in E2E; the slide-mark fixtures in `backend/tests/fixtures/presentations/` are shared by the Python unit test and an E2E check that the bridge reports the same `slideCount`.

## Constitution compliance

1. **Test-first** — every task lists tests from the ACs above; written and seen failing first.
2. **Green before done** — per task, `scripts/check.sh` once before ticking; E2E specs that need the stack are their own tasks. The host-timeout E2E waits ~60 s real time; it does not restart the stack, so it is not `slow`, but it is kept to one test to stay inside the 5-minute gate.
3. **Traceable tests** — table above; tasks.md names ACs per task.
4. **Real dependencies** — Postgres, Keycloak, the app and Chromium are real; only GIPHY is faked (existing fake). No mock of the frame: frame behaviour is tested in a real browser.
5. **Fixed stack** — Python/FastAPI, Postgres, React+TS strict/Vite, compose. Nothing departs.
6. **Dependencies** — none added. HTML analysis uses stdlib `html.parser`; overlay is plain SVG; no drawing or iframe library.
7. **No secrets** — rejoin tokens are generated at runtime and stored hashed; test passwords stay generated as today.
8. **Lint/format** — ruff, ruff format, biome, tsc per task; `bridge.js` is plain browser JS outside `frontend/` and excluded from nothing (biome does not see backend/; it is kept small and covered by E2E).
9. **Architecture** — layout and dependency direction stated above.
