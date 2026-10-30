# 007 — GIF search in session chat: plan

HOW for [spec.md](spec.md). Extends 002's chat (`backend/app/chat/`, `chat_message`, the `chat_send` / `chat_message` / `chat_removed` frames on 001's session WebSocket, `frontend/src/chat/*`, `components/ChatPane.tsx`). Paths are relative to the repository root.

## Architecture

### GIF service: GIPHY, called only by the backend

- **Provider.** GIPHY's API (`api.giphy.com/v1`). It has a `rating` parameter that caps results (`g`, `pg`, `pg-13`, `r`), a trending endpoint, a get-by-id endpoint, and every result carries its own `rating` and `title`. Those four map directly onto FR-1, FR-2, NFR-2, FR-12 and FR-10. See *Decisions for the human to confirm*.
- **The browser never talks to the API.** Search and post go over the session's existing WebSocket to the backend, which calls GIPHY. That gives four properties with no extra machinery:
  - the API key stays on the server, read from the environment (NFR-5), and never reaches the bundle;
  - the backend builds the outgoing request itself from the search term and fixed parameters, so nothing else can be attached to it (NFR-1);
  - the per-participant limits are enforced where they can't be bypassed (NFR-3);
  - a stale session already refuses the WebSocket (001, close 4410), so a stale session cannot search (FR-8).
- **Module `backend/app/gifs/`** (new):
  - `models.py`: `GifRef` dataclass, the data both sides share.
  - `giphy.py`: `GiphyClient` over `httpx.AsyncClient` (already a dependency). `search(q)`, `trending()`, `get(gif_id)`. Base URL and key from `Settings`. A 1.5 s total timeout per call, so a result or an error reaches the participant inside NFR-4's 2 s. Any transport error, timeout, non-2xx, or unparsable body becomes `GifServiceError`. A 404 from `get` becomes `None`.
  - `rules.py` (pure): `ALLOWED_RATINGS = {"g", "pg", "pg-13"}`; `parse_result(item) -> GifRef | None` drops any item whose `rating` is not allowed or that lacks an `http`/`https` URL; `normalise_query(q)` strips it and clips it to GIPHY's documented 50-character maximum.
  - `ratelimit.py` (pure): `SlidingWindowLimiter`, an in-memory per-key sliding window. Two app-wide instances on `app.state`: searches 20 per 60 s, posts 5 per 60 s. In memory is enough: the backend runs one process (`--workers 1`, which the session hub already requires). A restart resets the counters, which the spec permits.
- **Outgoing request (NFR-1, NFR-2).** Exactly these query parameters and nothing else: search `GET /v1/gifs/search?api_key&q&rating=pg-13&limit=24&bundle=messaging_non_clips`; trending `GET /v1/gifs/trending?api_key&rating=pg-13&limit=24&bundle=messaging_non_clips`; lookup `GET /v1/gifs/{id}?api_key`. No `random_id`, no `lang`, no forwarded headers, no `Referer`; the client is built with fixed default headers. The participant's name, invite, session id and chat text are not parameters of any `GiphyClient` method, so the code can't pass them.
- **The rating is enforced twice.** Once in the request (`rating=pg-13`), and again on every item in the response by `parse_result`. A post is re-checked by looking the id up at GIPHY (`get`), so a client that sends an arbitrary id can't post a GIF rated above PG-13 (NFR-2).
- **No key configured.** If `GIPHY_API_KEY` is unset, every search and post answers `gif_unavailable` (FR-9). Local runs and CI need no key.

### WebSocket flow

- **Search (FR-1, FR-2, FR-9, NFR-3).** `sessions/ws.py` dispatches `gif_search` to `gifs.service.search`. That function charges the search limiter, calls `trending()` when the normalised term is empty or `search(q)` otherwise, and replies to the sender only with `gif_results`, or with an `error` (`gif_rate_limited` with `retry_after`, or `gif_unavailable`). Each search is its own task (as 001's `run` is) so a slow call to GIPHY never blocks that participant's edits. A refused search does not count toward the limit.
- **Post (FR-3, FR-4, FR-6, NFR-2, NFR-3).** `chat_send_gif` carries only a `gif_id`. `ws.py` charges the post limiter, resolves the id with `GiphyClient.get` (`None` or a disallowed rating → `gif_not_allowed`; service error → `gif_unavailable`), then calls `chat.service.send_gif`. That function follows 002's `send` exactly: it re-reads `stale_at` (`session_stale`), inserts the row, commits, and broadcasts the same `chat_message` frame to everyone, with the sender's session name and server time (FR-3, FR-4). Order is still the bigserial id, so GIFs sort with text messages (FR-4, FR-6).
- **Limiter key (NFR-3).** `(session_id, sender name)`. 001 creates a new `participant` row on every connection, so keying by `participant_id` would reset the limit on reconnect. A name is unique within a live session. Other participants have their own keys, so they are unaffected.
- **History, removal, stale (FR-6, FR-7, FR-8).** These are 002's code paths, unchanged except that the queries and `ChatMessage` serialisation now carry the GIF fields. `welcome.chat` and `GET /api/sessions/{invite}/chat` return GIF messages in id order. Admin `DELETE /api/sessions/{invite}/chat/{id}` and the `chat_removed` broadcast work on any row regardless of kind. A stale session's history comes from REST, and the client offers no GIF control when `readOnly`.
- **Text chat is independent of GIPHY (FR-9).** Neither `chat_send` nor `welcome` touches `gifs/`. A GIPHY failure can only produce a `gif_*` error on a `gif_*` frame.

### Stored as a reference (FR-12)

- A GIF row stores GIPHY's id, its title, two media URLs (animated and still, GIPHY's `fixed_width` and `fixed_width_still` renditions) and their width and height. All of these come from the server's own lookup, never from the client. No GIF bytes are stored or proxied.
- The browser loads the media straight from GIPHY's CDN. If GIPHY no longer serves it, the `<img>` fails to load and the client swaps it for the "GIF no longer available" placeholder in the same message row. The author, time and position (id order) are unchanged, because the row is still there. Nothing is checked or rewritten on the server; there is no background job.
- **Referrer (NFR-1).** The session URL contains the invite. Every GIF `<img>` gets `referrerPolicy="no-referrer"`, so loading media never sends the invite to GIPHY. The browser's IP address still reaches GIPHY's CDN when media loads; see *Decisions*.

### Frontend

- `frontend/src/api/types.ts`: `ChatMessage` becomes a union, below.
- `frontend/src/chat/useChat.ts`: gains `sendGif(gifId)`. It resolves to `"ok"` or an error code, like `send`, and is matched by `client_id`. `chatState.ts` is unchanged: it sorts and dedupes by id, whatever the kind.
- `frontend/src/chat/gifs/` (new):
  - `useGifSearch.ts`: sends `gif_search` 400 ms after the last keystroke, and right away for the empty term when the picker opens. It tags each request with a `request_id` and ignores replies to anything but the latest. It exposes `status: "idle" | "loading" | "results" | "unavailable" | "rate_limited"`, `results` and `retryAfter`.
  - `gifNotice.ts` (pure, over `localStorage`): `noticeSeen(invite)` and `markNoticeSeen(invite)`, under the key `gif-notice-seen:<invite>`.
  - `GifPicker.tsx`: a popover anchored to the chat's *GIF* button. The first time it opens for an invite, it shows only the third-party notice and a *Continue* button. No `gif_search` frame is sent until *Continue*, not even the trending one (FR-5). After that it shows a search field, a results grid, "Powered by GIPHY" (FR-11), and the states *Loading*, *GIF search unavailable* (FR-9) and *Too many searches — wait N s* (NFR-3).
  - `GifImage.tsx`: a `<picture>` whose `<source media="(prefers-reduced-motion: reduce)">` is the still URL and whose `<img>` is the animated URL. It has `alt` = title, or `"GIF"` when the title is empty (FR-10), `referrerPolicy="no-referrer"`, explicit width and height so a late load doesn't shift the chat, and `onError` → the placeholder (FR-12). Results in the picker and messages in the chat both use it, so reduced motion applies to both (NFR-6).
- `frontend/src/components/ChatPane.tsx`: a *GIF* button beside the input, not rendered when `readOnly` (FR-8). A GIF message renders `GifImage` plus a small "via GIPHY" credit (FR-11) in the same row layout as a text message, with the same name, time and admin *Remove* action (FR-3, FR-7). The *Remove* action needs no change. Note that `ChatPane.tsx` has uncommitted changes in the working tree from other work; `/sdd-tasks` should sequence this after that lands.
- **Keyboard (NFR-6).** The *GIF* button opens the picker with focus in the search field (or on *Continue* the first time). `ArrowDown` moves into the grid. The grid is `role="listbox"` with `aria-activedescendant`; arrow keys move by cell and by row. `Enter` posts the active GIF and closes the picker. `Escape` closes it and returns focus to the *GIF* button. The status line is `aria-live="polite"`. Colours and focus rings use 003's existing tokens, which already meet WCAG AA.

### Dependency direction

`sessions.ws → gifs.service → gifs.giphy, gifs.ratelimit, gifs.rules, gifs.models`; `sessions.ws → chat.service → chat.repo, sessions.hub, gifs.models`. `gifs` imports neither `chat` nor `sessions`. `chat` imports only `gifs.models`, which is data and no behaviour. Frontend: `chat/gifs/*` depends on `api/*` and `collab/provider.ts`; `ChatPane.tsx` depends on `chat/gifs/*` and `chat/useChat.ts`, never the reverse.

## Data model

Migration `backend/app/migrations/0005_chat_gifs.sql`:

```sql
alter table chat_message drop constraint chat_message_body_check;
alter table chat_message alter column body drop not null;

alter table chat_message
    add column kind            text not null default 'text' check (kind in ('text', 'gif')),
    add column gif_id          text null,
    add column gif_title       text null,           -- '' when GIPHY gives none
    add column gif_url         text null,
    add column gif_still_url   text null,
    add column gif_width       int  null,
    add column gif_height      int  null;

alter table chat_message add constraint chat_message_kind_shape check (
    (kind = 'text' and char_length(body) between 1 and 2000
        and gif_id is null and gif_title is null and gif_url is null
        and gif_still_url is null and gif_width is null and gif_height is null)
 or (kind = 'gif' and body is null
        and gif_id is not null and gif_title is not null
        and gif_url ~ '^https?://' and gif_still_url ~ '^https?://'
        and gif_width > 0 and gif_height > 0)
);
```

Existing rows become `kind = 'text'` through the default and satisfy the new check, so no data is migrated. 002's text rule (1–2000 characters) is unchanged. It moves into the combined check. `learning_chat_message` (006) is not touched.

## Contracts

### Configuration (`app/config.py`, optional variables)

| Variable | Default | Meaning |
|---|---|---|
| `GIPHY_API_KEY` | unset | unset → GIF search and post answer `gif_unavailable` |
| `GIPHY_BASE_URL` | `https://api.giphy.com` | tests and E2E point it at the fake service |

`Settings.giphy_api_key` is `field(repr=False)`. Both are added to `docker-compose.yml` and `docker-compose.hub.yml` as `${GIPHY_API_KEY:-}` passthroughs; `docker-compose.test.yml` sets `GIPHY_BASE_URL` to the fake and a dummy key.

### WebSocket (additions to 002's frames)

Client → server:

- `{"type": "gif_search", "request_id": str, "q": str}`. `q` may be `""` (trending).
- `{"type": "chat_send_gif", "client_id": str, "gif_id": str}`.

Server → client:

- `{"type": "gif_results", "request_id": str, "trending": bool, "results": [GifResult]}` to the sender only. Up to 24 results; `[]` when nothing matches.
- `{"type": "chat_message", "message": ChatMessage, "client_id": str}` to everyone (002's frame; `message` may now be a GIF message).
- `{"type": "error", "code": "gif_unavailable", "request_id" | "client_id": str}` to the sender only. It carries `request_id` when it answers a search and `client_id` when it answers a post.
- `{"type": "error", "code": "gif_rate_limited", "retry_after": int, "request_id" | "client_id": str}`. `retry_after` is in whole seconds, at least 1.
- `{"type": "error", "code": "gif_not_allowed", "client_id": str}`: the id is unknown to GIPHY or rated above PG-13.
- `{"type": "error", "code": "session_stale", "client_id": str}` (002's code, now also for `chat_send_gif`).

`GifResult = {"id": str, "title": str, "url": str, "still_url": str, "width": int, "height": int}`.

### REST

No new endpoints. `GET /api/sessions/{invite}/chat` and `DELETE /api/sessions/{invite}/chat/{message_id}` (002) are unchanged in shape. Their `ChatMessage` now follows the union below.

`ChatMessage` (everywhere 002 used it):

```
{"id": int, "sender_name": str, "sent_at": ISO-8601 UTC str, "kind": "text", "text": str}
{"id": int, "sender_name": str, "sent_at": ISO-8601 UTC str, "kind": "gif",  "gif": GifResult}
```

### Python signatures

```python
# gifs/models.py
@dataclass(frozen=True)
class GifRef: id: str; title: str; url: str; still_url: str; width: int; height: int

# gifs/rules.py
ALLOWED_RATINGS: frozenset[str] = frozenset({"g", "pg", "pg-13"})
REQUEST_RATING = "pg-13"
MAX_QUERY_CHARS = 50
RESULT_LIMIT = 24
def normalise_query(q: str) -> str: ...
def parse_result(item: Mapping[str, object]) -> GifRef | None: ...   # None: disallowed rating or bad media

# gifs/giphy.py
class GifServiceError(Exception): ...
class GiphyClient:
    def __init__(self, base_url: str, api_key: str | None, *, timeout_s: float = 1.5,
                 transport: httpx.AsyncBaseTransport | None = None) -> None: ...
    async def search(self, q: str) -> list[GifRef]: ...      # raises GifServiceError
    async def trending(self) -> list[GifRef]: ...            # raises GifServiceError
    async def get(self, gif_id: str) -> GifRef | None: ...   # None: gone or disallowed rating
    async def aclose(self) -> None: ...

# gifs/ratelimit.py
class SlidingWindowLimiter:
    def __init__(self, limit: int, window_s: float, now: Callable[[], float]) -> None: ...
    def try_acquire(self, key: Hashable) -> int | None: ...  # None: allowed; int: retry_after seconds
SEARCHES_PER_MINUTE = 20
POSTS_PER_MINUTE = 5

# gifs/service.py
class GifError(StrEnum):
    UNAVAILABLE = "gif_unavailable"; RATE_LIMITED = "gif_rate_limited"; NOT_ALLOWED = "gif_not_allowed"
async def search(client, limiter, key, q: str) -> tuple[bool, list[GifRef]] | tuple[GifError, int | None]: ...
async def resolve_for_post(client, limiter, key, gif_id: str) -> GifRef | tuple[GifError, int | None]: ...

# chat/service.py (002, extended)
async def send_gif(conn, hub, session_id, participant_id, sender_name, gif: GifRef,
                   client_id: str) -> ChatError | None: ...   # ChatError.STALE only
```

The `GiphyClient` and both limiters are created in the app lifespan (`main.py`) and kept on `app.state`. The client is closed on shutdown.

### TypeScript signatures

```ts
// api/types.ts
type GifResult = { id: string; title: string; url: string; still_url: string; width: number; height: number };
type TextChatMessage = { id: number; sender_name: string; sent_at: string; kind?: "text"; text: string };
type GifChatMessage  = { id: number; sender_name: string; sent_at: string; kind: "gif"; gif: GifResult };
type ChatMessage = TextChatMessage | GifChatMessage;   // kind absent = text (006's learning chat)

// chat/useChat.ts (002, extended)
sendGif(gifId: string): Promise<"ok" | "gif_unavailable" | "gif_rate_limited" | "gif_not_allowed" | "session_stale">;

// chat/gifs/useGifSearch.ts
function useGifSearch(opts: { provider: CollabProvider | null; enabled: boolean }): {
  query: string; setQuery(q: string): void;
  status: "idle" | "loading" | "results" | "unavailable" | "rate_limited";
  results: GifResult[]; trending: boolean; retryAfter: number | null;
};

// chat/gifs/gifNotice.ts
function noticeSeen(invite: string, storage?: Storage): boolean;
function markNoticeSeen(invite: string, storage?: Storage): void;

// chat/gifs/GifImage.tsx, GifPicker.tsx
function GifImage(props: { gif: GifResult }): JSX.Element;
function GifPicker(props: { invite: string; provider: CollabProvider | null;
                            onPick(gifId: string): void; onClose(): void }): JSX.Element;
```

## Test strategy

Levels, per the constitution's real-dependencies rule:

- **Backend unit** (`backend/tests/unit/`): `gifs/rules.py` (rating filter, query clipping, media URL checks), `gifs/ratelimit.py` with an injected clock.
- **Backend integration** (`backend/tests/integration/`, real Postgres, FastAPI `TestClient` and its WebSocket client, 001's `login_as`). GIPHY is the one thing faked. A **fake GIPHY** (`backend/tests/fakes/fake_giphy.py`, stdlib `ThreadingHTTPServer`) runs on a real local socket, so the real `httpx` path is exercised. It serves fixtures for `search`, `trending` and get-by-id. It has a known "gone" id that answers 404 and a fixture item rated `r`. It can be switched to refuse connections or answer 500, and it records every request it receives (path, query, headers) for inspection.
- **Frontend unit** (Vitest + Testing Library): `gifNotice`, `useGifSearch` and `useChat.sendGif` against 001's fake `SocketLike`, `GifImage`, `GifPicker`, `ChatPane`.
- **End to end** (Playwright, `e2e/gifs.spec.ts`, against the compose test stack with the same fake GIPHY as a service in `docker-compose.test.yml`; media URLs in its fixtures point at itself).

| Acceptance criterion | Test |
|---|---|
| FR-1 search "cat" shows matching GIFs; request asks ≤ PG-13 | integration `test_ws_gifs`: `gif_search "cat"` → `gif_results` with the fake's "cat" fixtures; the fake recorded `/v1/gifs/search` with `q=cat`, `rating=pg-13`. Vitest `GifPicker`: typing "cat" sends one `gif_search` after the debounce and renders the results. E2E: type "cat", results visible |
| FR-2 empty field shows trending, PG-13 | integration: `gif_search ""` → `trending: true`; the fake recorded `/v1/gifs/trending` with `rating=pg-13`. Vitest: opening the picker (notice already seen) sends `q: ""` |
| FR-3 "Ada" picks one → message from Ada, current time, with the GIF | integration: Ada's `chat_send_gif` → `chat_message` with `kind: "gif"`, `sender_name: "Ada"`, `sent_at` within 1 s of the frozen `clock`, and `gif.id` the picked id. Vitest `ChatPane`: Enter on a result calls `sendGif(id)` and closes the picker. E2E: Ada picks, her row shows name, time and image |
| FR-4 three participants, others see it after earlier messages | integration: three WS clients; two text messages, then a GIF → the other two receive the GIF `chat_message` with an id greater than both. E2E: three browser contexts, the GIF appears last without reload |
| FR-5 notice visible before the first search is sent | Vitest `GifPicker` with empty storage: notice visible, the fake socket has received no `gif_search`; after *Continue*, the first `gif_search` is sent and `noticeSeen(invite)` is true; a second open shows no notice. Unit `gifNotice` keys per invite. E2E: first open shows the notice |
| FR-6 GIF still there in position after reload | integration: text, GIF, text → new app instance on the same DB → `welcome.chat` kinds `text, gif, text` in id order; `GET /chat` the same. E2E reload |
| FR-7 admin removes GIF, gone for everyone and after reload | integration: two clients, admin `DELETE` on the GIF message → both get `chat_removed`; next `welcome.chat` has no GIF. E2E via *Remove* |
| FR-8 stale: GIFs shown, no GIF control | integration: stale session with a GIF row → `GET /chat` has the GIF message and `read_only: true`; WS refused 4410 (no `gif_search` possible); `send_gif` on a session marked stale mid-connection → `session_stale`. Vitest `ChatPane` with `readOnly`: GIF rendered, no *GIF* button. E2E `stale` |
| FR-9 service unreachable → "GIF search unavailable", text still sends | integration: fake refusing connections (and, separately, answering 500 and timing out past 1.5 s) → `error gif_unavailable`; a `chat_send` in the same connection then succeeds; with `GIPHY_API_KEY` unset → `gif_unavailable` and no request reaches the fake. Vitest: status text "GIF search unavailable". E2E: fake switched off, message shown, text message delivered |
| FR-10 title "Happy dance" announced; no title → "GIF" | Vitest `GifImage`: `getByRole("img", {name: "Happy dance"})`; empty title → name "GIF"; same for the placeholder-free message row in `ChatPane` |
| FR-11 attribution visible on results and messages | Vitest: `GifPicker` shows "Powered by GIPHY" with results; a GIF row in `ChatPane` shows "via GIPHY". E2E: both visible |
| FR-12 stored as a reference, no file | integration `test_chat_repo`: after a GIF post, the row has `gif_id`, URLs and `body is null`; the schema has no binary column added (`information_schema` check on `chat_message` columns); the fake recorded no media download by the backend |
| FR-12 gone → placeholder keeping author, time, position | Vitest `GifImage`: firing `error` on the `<img>` shows "GIF no longer available"; `ChatPane`: that row keeps sender and time between its neighbours. E2E: a stored message whose media URL is the fake's 404 path shows the placeholder in its original position after reload |
| NFR-1 request has "cat", not "Ada", S's id or chat text | integration: Ada sends a text message "secret words", then searches "cat" → the fake's recorded request: query keys exactly `{api_key, q, rating, limit, bundle}`, `q == "cat"`; neither the full URL nor any header value contains "Ada", the invite, the session uuid or "secret words"; no `Referer`, `Cookie`, `X-Forwarded-For`. Vitest `GifImage`: `referrerpolicy="no-referrer"`. E2E: media requests captured by Playwright carry no `Referer` |
| NFR-3 21st search / 6th post refused with wait message; others unaffected | unit `ratelimit`: 20 allowed, the 21st returns `retry_after`, allowed again after the window. Integration: Ada's 21st `gif_search` within a minute → `gif_rate_limited` with `retry_after ≥ 1` and the fake receives no 21st request; Ada's 6th `chat_send_gif` → `gif_rate_limited` and no row; Ben's search and post at the same moment succeed; Ada reconnecting under the same name is still limited. Vitest: "wait N s" message |
| NFR-6 keyboard: type, move, post | Vitest `GifPicker` with `userEvent` only: type the term, `ArrowDown`, `ArrowRight`, `Enter` → `onPick` with the second result's id; `Escape` restores focus to the *GIF* button. E2E `keyboard` with no mouse. E2E `a11y` axe scan of the open picker: no WCAG AA violations |
| NFR-6 reduced motion → no animation | Vitest `GifImage`: `<source media="(prefers-reduced-motion: reduce)">` has the still URL. E2E with `reducedMotion: "reduce"`: the image's `currentSrc` is the still URL, in the picker and in chat |

NFR-2 is covered by the FR-1/FR-2 rows (the request asks for `pg-13`) and by an integration test: the fake's `r`-rated fixture is dropped from `gif_results`, and `chat_send_gif` with its id → `gif_not_allowed` and no row. NFR-4 is covered by an integration test: with the fake answering at once, `gif_results` arrives within 2 s; with it delayed 3 s, `gif_unavailable` arrives within 2 s. NFR-5 is covered by a unit test of `load_settings` reading `GIPHY_API_KEY` from the passed environment, with `repr(settings)` not containing it.

## Constitution compliance

1. **Test-first.** Every row above is written as a failing test in the task that implements it.
2. **Green before done.** No change: `scripts/check.sh` runs the full suite.
3. **Traceable tests.** The table maps every acceptance criterion in spec.md (FR-1–FR-12, NFR-1, NFR-3, NFR-6: all Given/When/Then lines) to at least one test. NFR-2, NFR-4 and NFR-5, which have no Given/When/Then, are tested too. `/sdd-tasks` names them per task.
4. **Real dependencies.** Postgres, Keycloak and the app run for real. GIPHY is the only thing faked: it is a third-party network service the project doesn't control, which rule 4 allows. The fake is a real HTTP server on a local socket, so `httpx`, timeouts and connection refusal are exercised for real. The browser `WebSocket` fake in Vitest is 001's existing `SocketLike` seam, already justified in 002's plan.
5. **Fixed stack.** Python 3.12/FastAPI, PostgreSQL, React/TS strict/Vite, docker compose. No departure.
6. **Dependency justification.** None new. `httpx` is already a backend dependency (001). The fake GIPHY uses the standard library. No frontend packages: the picker is plain React.
7. **No secrets in the repo.** `GIPHY_API_KEY` comes only from the environment. Compose files reference `${GIPHY_API_KEY:-}`, and the test stack uses the literal `test-key-not-secret` against the fake, which is not a credential. `Settings` hides the key from `repr`.
8. **Lint and format clean.** New code goes through `ruff check`, `ruff format --check`, `biome ci` and `tsc --noEmit` via `scripts/check.sh`.
9. **Module layout and dependency direction.** Stated under *Dependency direction* above.

No conflicts.

## Decisions for the human to confirm

- **GIPHY as the service.** It has an explicit rating cap, trending, get-by-id (needed to re-check a post's rating server-side) and per-result titles. It needs a free API key from GIPHY's developer dashboard, set as `GIPHY_API_KEY` on the hub. GIPHY's beta keys are rate-limited by GIPHY; the hub needs a production key once usage grows.
- **Attribution form (FR-11).** The plan uses text: "Powered by GIPHY" in the picker and "via GIPHY" on each GIF message. GIPHY's guidelines may require their official attribution logo instead. If so, that logo is a GIPHY-owned asset to add to the repo.
- **Media loads directly from GIPHY's CDN.** Requests carry no referrer, so the invite and session never reach GIPHY, but each viewer's IP address does when a GIF is shown. Proxying the media through the hub would hide it. It would also cost memory and bandwidth under 005's 1 GB budget, and the spec only bounds what accompanies the search term (NFR-1). Say so if you want the media proxied.
- **The first-time notice blocks the first request.** The trending request waits until *Continue* is pressed, even though it carries no term. "Seen" is remembered per invite in this browser's `localStorage`, so another browser or a cleared one shows it again.
- **Limits are keyed by session and name**, not by connection, because 001 creates a new participant record on every join. Rejoining under a different name gets a fresh allowance. Without accounts, that can't be told apart from a new participant.
- **Search as you type, debounced 400 ms**, with at most 24 results and no "load more". Every debounced request counts toward the 20 per minute.
- **Only the coding-session chat (spec 002) gets GIFs.** The *Learn* sessions' chat (006, `learning_chat_message`) is left as it is: the spec amends 002 only. Say so if *Learn* chat should get GIFs too. That would mean a spec change first.
