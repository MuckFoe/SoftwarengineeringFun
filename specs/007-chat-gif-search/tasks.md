# 007 — GIF search in session chat: tasks

From [plan.md](plan.md) and [spec.md](spec.md). Paths are relative to the repository root. Every task is test-first (constitution 1): write the listed tests, see them fail, then implement. A task is ticked only when `scripts/check.sh` is fully green, lint and `tsc` included (constitution 2, 8).

The plan's note that `frontend/src/components/ChatPane.tsx` had uncommitted changes from other work is settled: the working tree was clean when this list was written (that work landed in 7c6ba06). Re-check `git status` before task 16.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6, 7 — all `[P]` | Leaves with no dependency: pure backend rules, limiter, settings, compose passthroughs, the fake GIPHY, the frontend contract, the notice store |
| 2 | 8, 9, 10, 11, 12 — all `[P]` | Need only wave 1: the stored shape needs `GifRef` (1); the client needs rules (1), settings (3) and the fake (4); frontend pieces need the new types (5) |
| 3 | 13, 14, 15 — all `[P]` | The GIF service needs the client and limiter; `send_gif` needs the repo; the picker needs image, search hook and notice |
| 4 | 16, 17, 18 — all `[P]` | Search over the WebSocket needs the service; history/REST checks need `send_gif`; `ChatPane` needs the picker and `sendGif` |
| 5 | 19, 20 — all `[P]` | Post over the WebSocket extends 17's `ws.py` wiring; the page wiring needs 18's `ChatPane` props |
| 6 | 21 | The E2E stack needs the whole backend and frontend path |
| 7 | 22 | Functional E2E on that stack |
| 8 | 23 | Accessibility E2E; same spec file as 22, so after it |

## Checklist

- [x] **1** — `[P]` GIF rules and `GifRef` model
- [x] **2** — `[P]` Sliding-window rate limiter
- [x] **3** — `[P]` GIPHY settings from the environment
- [x] **4** — `[P]` Compose passthroughs for the GIPHY variables
- [x] **5** — `[P]` Fake GIPHY test server
- [x] **6** — `[P]` Frontend `ChatMessage` union and GIF frame types
- [x] **7** — `[P]` First-time notice store (`gifNotice`)
- [x] **8** — `[P]` Migration 0005 and GIF rows in the chat repo
- [x] **9** — `[P]` `GiphyClient` over httpx
- [x] **10** — `[P]` `useChat.sendGif`
- [x] **11** — `[P]` `GifImage` component
- [x] **12** — `[P]` `useGifSearch` hook
- [x] **13** — `[P]` GIF service: search and resolve-for-post
- [x] **14** — `[P]` `chat.service.send_gif` and GIF serialisation
- [x] **15** — `[P]` `GifPicker` component
- [x] **16** — `[P]` App lifespan and `gif_search` over the session WebSocket
- [x] **17** — `[P]` GIF messages in history, removal and stale reads
- [x] **18** — `[P]` `ChatPane`: GIF button and GIF message rows
- [x] **19** — `[P]` `chat_send_gif` over the session WebSocket
- [x] **20** — `[P]` Wire GIFs into the coding-session page
- [x] **21** — E2E stack: fake GIPHY as a compose test service
- [x] **22** — E2E: GIF search, post, history, removal, failure
- [x] **23** — E2E: keyboard, axe, reduced motion

## Tasks

### 1. `[P]` GIF rules and `GifRef` model

- **Plan:** GIF service — `gifs/models.py`, `gifs/rules.py`; Python signatures. **Spec:** FR-1, FR-2, FR-10, FR-12, NFR-1, NFR-2.
- **Files:** `backend/app/gifs/__init__.py`, `backend/app/gifs/models.py`, `backend/app/gifs/rules.py`, `backend/tests/unit/test_gif_rules.py` (`__init__.py` is empty)
- **Depends on:** nothing
- **Do:** Frozen `GifRef` dataclass. `ALLOWED_RATINGS`, `REQUEST_RATING`, `MAX_QUERY_CHARS = 50`, `RESULT_LIMIT = 24`. `normalise_query` strips and clips to 50 characters. `parse_result` maps a GIPHY item to `GifRef` from its `fixed_width` and `fixed_width_still` renditions, using `title` (`""` when missing), and returns `None` for a rating outside `ALLOWED_RATINGS`, a missing rendition, a URL that is not `http`/`https`, or a non-positive width/height. `gifs` imports nothing from `chat` or `sessions`.
- **Acceptance:**
  - *FR-1 / NFR-2 — results are rated no higher than PG-13 regardless of what the participant types:* items rated `g`, `pg`, `pg-13` parse; `r` and an unknown/missing rating give `None`.
  - *FR-12 — the stored message holds a reference to the GIF:* a parsed item carries id, title, both media URLs, width and height; `javascript:` / relative / missing URLs give `None`.
  - *FR-10 — title, or "GIF" when it has none:* a missing title parses to `""` (the client renders "GIF").
  - *NFR-1 — only the search term goes to the service:* `normalise_query("  cat  ") == "cat"`; a 60-character term is clipped to 50.

### 2. `[P]` Sliding-window rate limiter

- **Plan:** GIF service — `gifs/ratelimit.py`. **Spec:** NFR-3.
- **Files:** `backend/app/gifs/ratelimit.py`, `backend/tests/unit/test_gif_ratelimit.py`
- **Depends on:** nothing (creates `backend/app/gifs/` if task 1 hasn't yet; both create an empty `__init__.py`)
- **Do:** `SlidingWindowLimiter(limit, window_s, now)` with `try_acquire(key) -> int | None`; a refused call is not recorded. `SEARCHES_PER_MINUTE = 20`, `POSTS_PER_MINUTE = 5`.
- **Acceptance:**
  - *NFR-3 — Given a participant who has made 20 searches (or posted 5 GIFs) within the last minute, When they search or post again, Then the action is refused with a message saying to wait, And other participants are unaffected:* with an injected clock, 20 acquires on one key return `None`, the 21st returns `retry_after ≥ 1`; a different key is still allowed; after the window passes the first key is allowed again; refused calls don't extend the wait. Same with limit 5.

### 3. `[P]` GIPHY settings from the environment

- **Plan:** Contracts — Configuration (`app/config.py`). **Spec:** NFR-5, FR-9.
- **Files:** `backend/app/config.py`, `backend/tests/unit/test_config.py`
- **Depends on:** nothing
- **Do:** `Settings.giphy_api_key: str | None` (`field(repr=False)`, unset → `None`) and `Settings.giphy_base_url` (default `https://api.giphy.com`), read by `load_settings` from the passed environment.
- **Acceptance:**
  - *NFR-5 — any key needed comes from the environment:* `load_settings({"GIPHY_API_KEY": "k123", …})` gives `giphy_api_key == "k123"`, and `"k123"` is not in `repr(settings)`; without the variable it is `None`; `GIPHY_BASE_URL` overrides the default.

### 4. `[P]` Compose passthroughs for the GIPHY variables

- **Plan:** Contracts — Configuration (compose). **Spec:** NFR-5.
- **Files:** `docker-compose.yml`, `docker-compose.hub.yml`, `backend/tests/unit/test_hub_compose.py`
- **Depends on:** nothing
- **Do:** Add `GIPHY_API_KEY: ${GIPHY_API_KEY:-}` (and `GIPHY_BASE_URL` passthrough if set) to the backend service of both files. No literal key anywhere (constitution 7). `docker-compose.test.yml` is task 21.
- **Acceptance:**
  - *NFR-5 — the key comes from the environment:* `test_hub_compose.py` asserts the hub backend's `GIPHY_API_KEY` is exactly the `${GIPHY_API_KEY:-}` reference, not a value.

### 5. `[P]` Fake GIPHY test server

- **Plan:** Test strategy — fake GIPHY (`backend/tests/fakes/fake_giphy.py`). **Spec:** FR-1, FR-2, FR-9, FR-12, NFR-1, NFR-2, NFR-4.
- **Files:** `backend/tests/fakes/__init__.py` (empty), `backend/tests/fakes/fake_giphy.py`, `backend/tests/conftest.py`
- **Depends on:** nothing
- **Do:** Stdlib `ThreadingHTTPServer` on a real local port, startable both from pytest (a `fake_giphy` fixture in `conftest.py` yielding its base URL and controls) and as `python -m` for task 21. Serves `/v1/gifs/search` (a "cat" fixture set, `[]` for other terms), `/v1/gifs/trending`, `/v1/gifs/{id}`; a known "gone" id → 404; one fixture item rated `r`; one item with an empty title; one item whose media URL is a 404 path on the fake. Media URLs point at the fake itself (configurable host). Controls: refuse connections, answer 500, delay N seconds, reset. Records every request (path, query, headers).
- **Acceptance:** infrastructure for the criteria below; checked by a short `backend/tests/integration/test_fake_giphy.py`: a raw `httpx` search for "cat" returns the fixtures and is recorded with its query and headers; the 500, delay and refuse switches each take effect and reset.

### 6. `[P]` Frontend `ChatMessage` union and GIF frame types

- **Plan:** Frontend — `api/types.ts`; TypeScript signatures. **Spec:** FR-3, FR-4, FR-6.
- **Files:** `frontend/src/api/types.ts`, `frontend/src/chat/chatState.test.ts`, `frontend/src/components/ChatPane.tsx`
- **Depends on:** nothing
- **Do:** `GifResult`, `TextChatMessage` (`kind?: "text"`), `GifChatMessage`, `ChatMessage` union; frame types for `gif_search`, `chat_send_gif`, `gif_results` and the `gif_*` error codes. Narrow the one `m.text` use in `ChatPane.tsx` so `tsc --noEmit` stays green (a GIF message renders nothing extra yet; task 18 renders it). Learn chat (006) keeps compiling, `kind` absent = text. `chatState.ts` is unchanged.
- **Acceptance:**
  - *FR-4 — the GIF appears after the messages posted before it:* `chatState.test.ts`: `addMessage` with a GIF message of id 3 into text messages 1, 2, 4 sorts it third; a duplicate id is deduped whatever the kind. `tsc --noEmit` passes (the failing check before the narrowing).

### 7. `[P]` First-time notice store (`gifNotice`)

- **Plan:** Frontend — `chat/gifs/gifNotice.ts`. **Spec:** FR-5.
- **Files:** `frontend/src/chat/gifs/gifNotice.ts`, `frontend/src/chat/gifs/gifNotice.test.ts`
- **Depends on:** nothing
- **Do:** `noticeSeen(invite, storage?)`, `markNoticeSeen(invite, storage?)` under `gif-notice-seen:<invite>`; a throwing/unavailable storage counts as not seen.
- **Acceptance:**
  - *FR-5 — Given a participant who hasn't used GIF search in this session, When they open it, Then a notice … is visible before the first search is sent:* empty storage → `noticeSeen("A") === false`; after `markNoticeSeen("A")`, `noticeSeen("A") === true` and `noticeSeen("B") === false`.

### 8. `[P]` Migration 0005 and GIF rows in the chat repo

- **Plan:** Data model (`0005_chat_gifs.sql`); History, removal, stale. **Spec:** FR-6, FR-12.
- **Files:** `backend/app/migrations/0005_chat_gifs.sql`, `backend/app/chat/repo.py`, `backend/tests/integration/test_chat_repo.py`
- **Depends on:** 1
- **Do:** The migration exactly as the plan's SQL. `ChatMessage` (repo) gains `kind` and optional GIF fields; `_message` reads them; add `insert_gif(conn, session_id, participant_id, sender_name, gif: GifRef)`; `history` returns both kinds in id order. `chat` imports only `gifs.models`.
- **Acceptance:**
  - *FR-12 — Given a posted GIF message, When it is stored, Then the stored message holds a reference to the GIF and no GIF file:* after `insert_gif`, the row has `kind = 'gif'`, `gif_id`, both URLs, width, height and `body is null`; `information_schema.columns` for `chat_message` shows no `bytea` column.
  - *FR-6 — Given a posted GIF message, When the session is reloaded later, Then the GIF message is still in the chat in its original position:* text, GIF, text inserted → `history` returns kinds `text, gif, text` in id order.
  - Existing text rows still satisfy the check (002's 1–2000 rule); a GIF row with a `javascript:` URL or with a body is rejected by the constraint.

### 9. `[P]` `GiphyClient` over httpx

- **Plan:** GIF service — `gifs/giphy.py`; Outgoing request. **Spec:** FR-1, FR-2, FR-9, NFR-1, NFR-2, NFR-4.
- **Files:** `backend/app/gifs/giphy.py`, `backend/tests/integration/test_giphy_client.py`
- **Depends on:** 1, 3, 5
- **Do:** `GiphyClient(base_url, api_key, timeout_s=1.5, transport=None)` with `search`, `trending`, `get`, `aclose`; exactly the plan's query parameters; fixed default headers, no `Referer`; transport error, timeout, non-2xx (except 404 on `get`) or bad body → `GifServiceError`; `get` 404 or disallowed rating → `None`; every item goes through `parse_result`.
- **Acceptance:**
  - *FR-1 — When a participant searches "cat", Then GIFs matching "cat" are shown, and the request to the service asks for a rating of PG-13 or lower:* `search("cat")` returns the fake's cat fixtures; the fake recorded `/v1/gifs/search` with `q=cat`, `rating=pg-13`.
  - *FR-2 — empty field → trending, limited to PG-13:* `trending()` hits `/v1/gifs/trending` with `rating=pg-13`.
  - *NFR-2:* the `r`-rated fixture is not in the results; `get(<r id>)` → `None`; `get(<gone id>)` → `None`.
  - *NFR-1:* recorded query keys are exactly `{api_key, q, rating, limit, bundle}`; no `Referer`, `Cookie`, `X-Forwarded-For` header.
  - *FR-9 / NFR-4:* refused connection, 500, and a 3 s delay each raise `GifServiceError`, the delay within 2 s.

### 10. `[P]` `useChat.sendGif`

- **Plan:** Frontend — `chat/useChat.ts`. **Spec:** FR-3, FR-8, FR-9, NFR-2, NFR-3.
- **Files:** `frontend/src/chat/useChat.ts`, `frontend/src/chat/useChat.test.tsx`
- **Depends on:** 6
- **Do:** `sendGif(gifId)` sends `chat_send_gif` with a fresh `client_id`; resolves `"ok"` on the matching `chat_message`, or the error code of a matching `error` frame (`gif_unavailable`, `gif_rate_limited`, `gif_not_allowed`, `session_stale`).
- **Acceptance:**
  - *FR-3 — When participant "Ada" picks one, Then a chat message from "Ada" … appears containing that GIF:* against 001's fake `SocketLike`, `sendGif("g1")` sends `{type: "chat_send_gif", client_id, gif_id: "g1"}`; the echoed GIF `chat_message` with that `client_id` resolves `"ok"` and is in `messages`.
  - *NFR-3 / NFR-2 / FR-8:* an `error` frame with that `client_id` and `gif_rate_limited` / `gif_not_allowed` / `session_stale` resolves to that code; another `client_id` doesn't resolve it.

### 11. `[P]` `GifImage` component

- **Plan:** Frontend — `chat/gifs/GifImage.tsx`; Referrer. **Spec:** FR-10, FR-12, NFR-1, NFR-6.
- **Files:** `frontend/src/chat/gifs/GifImage.tsx`, `frontend/src/chat/gifs/GifImage.module.css`, `frontend/src/chat/gifs/GifImage.test.tsx`
- **Depends on:** 6
- **Do:** `<picture>` with `<source media="(prefers-reduced-motion: reduce)" srcset={still_url}>` and `<img src={url}>`; `alt` = title or `"GIF"`; `referrerPolicy="no-referrer"`; explicit width/height; `onError` → "GIF no longer available" placeholder of the same size.
- **Acceptance:**
  - *FR-10 — Given a GIF … with the title "Happy dance", When it is read by a screen reader, Then "Happy dance" is announced; Given one with no title, Then "GIF" is announced:* `getByRole("img", {name: "Happy dance"})`; empty title → name `"GIF"`.
  - *FR-12 — Given the service no longer serves that GIF, … Then the message shows "GIF no longer available":* firing `error` on the `<img>` shows that text.
  - *NFR-1:* the `<img>` has `referrerpolicy="no-referrer"`.
  - *NFR-6 — Given reduced motion is on, When a GIF message is shown, Then it does not animate:* the reduced-motion `<source>` carries the still URL.

### 12. `[P]` `useGifSearch` hook

- **Plan:** Frontend — `chat/gifs/useGifSearch.ts`. **Spec:** FR-1, FR-2, FR-9, NFR-3.
- **Files:** `frontend/src/chat/gifs/useGifSearch.ts`, `frontend/src/chat/gifs/useGifSearch.test.tsx`
- **Depends on:** 6
- **Do:** Per the plan's signature: when `enabled` becomes true sends `gif_search` with `q: ""` at once; afterwards 400 ms after the last `setQuery`; tags each with a `request_id` and ignores stale replies; maps `gif_results` → `results`, `gif_unavailable` → `"unavailable"`, `gif_rate_limited` → `"rate_limited"` with `retryAfter`. Sends nothing while `enabled` is false.
- **Acceptance:**
  - *FR-1 — When a participant searches "cat", Then GIFs matching "cat" are shown:* with fake timers, typing "c", "ca", "cat" sends one `gif_search` with `q: "cat"` after 400 ms; its `gif_results` sets `status: "results"`; a reply to an earlier `request_id` is ignored.
  - *FR-2 — empty search field → trending:* enabling sends `q: ""`; `trending` reflects the reply.
  - *FR-9 / NFR-3:* `gif_unavailable` → `status: "unavailable"`; `gif_rate_limited` with `retry_after: 12` → `status: "rate_limited"`, `retryAfter: 12`.
  - *FR-5 (support):* with `enabled: false`, no frame is sent.

### 13. `[P]` GIF service: search and resolve-for-post

- **Plan:** GIF service / WebSocket flow — `gifs/service.py`; Python signatures. **Spec:** FR-1, FR-2, FR-9, NFR-2, NFR-3.
- **Files:** `backend/app/gifs/service.py`, `backend/tests/integration/test_gif_service.py`
- **Depends on:** 2, 9
- **Do:** `GifError`; `search(client, limiter, key, q)` charges the limiter, then `trending()` for an empty normalised term or `search(q)`; `resolve_for_post(client, limiter, key, gif_id)` charges the post limiter, then `get`. A client built with no API key → `UNAVAILABLE` without any request. Rate-limited → `(RATE_LIMITED, retry_after)` with no request made.
- **Acceptance:**
  - *FR-2:* `search(…, "  ")` → `(True, trending fixtures)`; `search(…, "cat")` → `(False, cat fixtures)`.
  - *FR-9 — Given the GIF service is unreachable, When a participant searches, Then … unavailable:* fake refusing → `(UNAVAILABLE, None)`; no key → `(UNAVAILABLE, None)` and the fake recorded nothing.
  - *NFR-3 — 21st search / 6th post refused, others unaffected:* 21st call on key `(S, "Ada")` → `(RATE_LIMITED, n ≥ 1)` and the fake received only 20 requests; key `(S, "Ben")` still succeeds.
  - *NFR-2:* `resolve_for_post` with the `r`-rated id or the gone id → `(NOT_ALLOWED, None)`.

### 14. `[P]` `chat.service.send_gif` and GIF serialisation

- **Plan:** WebSocket flow — Post; Contracts — `ChatMessage`. **Spec:** FR-3, FR-4, FR-6, FR-8.
- **Files:** `backend/app/chat/service.py`, `backend/tests/integration/test_chat_service_gif.py`
- **Depends on:** 8
- **Do:** `send_gif(conn, hub, session_id, participant_id, sender_name, gif, client_id)` follows 002's `send`: re-reads `stale_at` (→ `ChatError.STALE`), inserts, commits, broadcasts `chat_message` with `client_id`. `message_dict` emits `{"kind": "text", "text": …}` or `{"kind": "gif", "gif": GifResult}`.
- **Acceptance:**
  - *FR-3 — Then a chat message from "Ada" with the current time appears containing that GIF:* with `frozen_clock`, the broadcast has `kind: "gif"`, `sender_name: "Ada"`, `sent_at` within 1 s of the clock, `gif.id` the given id.
  - *FR-4:* after two text messages, the GIF's id is greater than both.
  - *FR-8:* on a session marked stale, `send_gif` returns `ChatError.STALE` and inserts no row.
  - Text `message_dict` output now includes `kind: "text"`; existing 002 chat tests stay green.

### 15. `[P]` `GifPicker` component

- **Plan:** Frontend — `chat/gifs/GifPicker.tsx`; Keyboard. **Spec:** FR-1, FR-2, FR-5, FR-9, FR-11, NFR-3, NFR-6.
- **Files:** `frontend/src/chat/gifs/GifPicker.tsx`, `frontend/src/chat/gifs/GifPicker.module.css`, `frontend/src/chat/gifs/GifPicker.test.tsx`
- **Depends on:** 7, 11, 12
- **Do:** Popover per the plan: first open for an invite shows only the third-party notice and *Continue* (`useGifSearch` disabled until then, then `markNoticeSeen`); afterwards search field (focused), `role="listbox"` grid of `GifImage` with `aria-activedescendant`, "Powered by GIPHY", `aria-live="polite"` status line ("Loading", "GIF search unavailable", "Too many searches — wait N s"). `ArrowDown` from the field into the grid, arrows by cell/row, `Enter` → `onPick(id)`, `Escape` → `onClose()`. Uses 003's tokens.
- **Acceptance:**
  - *FR-5 — Given a participant who hasn't used GIF search in this session, When they open it, Then a notice that search terms go to a third-party service is visible before the first search is sent:* empty storage → notice visible, fake socket received no `gif_search`; after *Continue*, the first `gif_search` is sent and `noticeSeen(invite)` is true; a second mount shows no notice.
  - *FR-2:* notice already seen → mounting sends `q: ""`.
  - *FR-1:* typing "cat" sends one `gif_search` after the debounce and renders the results.
  - *FR-11 — Given GIF search results …, Then the service attribution … is visible:* "Powered by GIPHY" shown with results.
  - *FR-9 / NFR-3:* status text "GIF search unavailable"; "wait 12 s" on `gif_rate_limited`.
  - *NFR-6 — When a participant uses only the keyboard, Then they can type a term, move through results and post one:* with `userEvent` only: type, `ArrowDown`, `ArrowRight`, `Enter` → `onPick` with the second result's id; `Escape` → `onClose`.

### 16. `[P]` App lifespan and `gif_search` over the session WebSocket

- **Plan:** WebSocket flow — Search, Limiter key; `main.py` lifespan. **Spec:** FR-1, FR-2, FR-8, FR-9, NFR-1, NFR-3, NFR-4.
- **Files:** `backend/app/main.py`, `backend/app/sessions/ws.py`, `backend/tests/integration/test_ws_gifs.py`
- **Depends on:** 3, 13
- **Do:** Lifespan creates `GiphyClient` from settings and two limiters on `app.state`, closes the client on shutdown. `ws.py` dispatches `gif_search` as its own task to `gifs.service.search` with key `(session_id, sender name)`; replies to the sender only with `gif_results` (`request_id`, `trending`, `results`) or `error` (`gif_unavailable` / `gif_rate_limited` + `retry_after`, carrying `request_id`).
- **Acceptance:**
  - *FR-1:* `gif_search "cat"` → `gif_results` with the cat fixtures; the fake recorded `q=cat`, `rating=pg-13`.
  - *FR-2:* `gif_search ""` → `trending: true`; recorded `/v1/gifs/trending` with `rating=pg-13`.
  - *NFR-2:* the `r`-rated fixture is absent from `gif_results`.
  - *NFR-1 — Given a participant named "Ada" searches "cat" in session S, When the outgoing request … is inspected, Then it contains "cat" and contains neither "Ada", S's identifier, nor any chat text:* Ada sends text "secret words", then searches "cat" → recorded query keys exactly `{api_key, q, rating, limit, bundle}`, `q == "cat"`; no URL part or header contains "Ada", the invite, the session uuid or "secret words"; no `Referer`, `Cookie`, `X-Forwarded-For`.
  - *FR-9 — Then a "GIF search unavailable" message is shown, And sending a text message still succeeds:* fake refusing / 500 / delayed past 1.5 s → `error gif_unavailable`, then a `chat_send` on the same connection succeeds; with `GIPHY_API_KEY` unset → `gif_unavailable` and the fake recorded nothing.
  - *NFR-4:* fake answering at once → `gif_results` within 2 s; delayed 3 s → `gif_unavailable` within 2 s; a slow search doesn't block an edit frame from the same participant.
  - *NFR-3:* Ada's 21st `gif_search` within a minute → `gif_rate_limited`, `retry_after ≥ 1`, fake received no 21st request; Ben's search at the same moment succeeds; Ada reconnecting under the same name is still limited.
  - *FR-8 — no GIF search control available:* connecting to a stale session is refused with 4410 (no `gif_search` possible).

### 17. `[P]` GIF messages in history, removal and stale reads

- **Plan:** WebSocket flow — History, removal, stale; REST. **Spec:** FR-6, FR-7, FR-8.
- **Files:** `backend/tests/integration/test_chat_api.py`, `backend/app/chat/api.py` (only if a change proves needed)
- **Depends on:** 14
- **Do:** Prove 002's paths carry GIF rows unchanged: `welcome.chat`, `GET /api/sessions/{invite}/chat`, admin `DELETE …/chat/{id}` and `chat_removed`. GIF rows are seeded through `send_gif`.
- **Acceptance:**
  - *FR-6 — When the session is reloaded later, Then the GIF message is still in the chat in its original position:* text, GIF, text → a new app instance on the same DB → `welcome.chat` kinds `text, gif, text` in id order; `GET /chat` the same.
  - *FR-7 — Given a posted GIF message, When an admin removes it, Then it disappears for every participant and is gone after reload:* two WS clients; admin `DELETE` on the GIF → both get `chat_removed`; next `welcome.chat` has no GIF.
  - *FR-8 — Given a stale session with GIF messages, When it is opened, Then the GIFs are shown:* `GET /chat` on a stale session returns the GIF message and `read_only: true`.

### 18. `[P]` `ChatPane`: GIF button and GIF message rows

- **Plan:** Frontend — `components/ChatPane.tsx`. **Spec:** FR-3, FR-7, FR-8, FR-10, FR-11, FR-12, NFR-6.
- **Files:** `frontend/src/components/ChatPane.tsx`, `frontend/src/components/ChatPane.module.css`, `frontend/src/components/ChatPane.test.tsx`
- **Depends on:** 10, 11, 15
- **Do:** Optional GIF props (invite, provider, `sendGif`). When present and not `readOnly`, a *GIF* button beside the input opens `GifPicker`; `onPick` calls `sendGif(id)` and closes; closing returns focus to the button. GIF messages render `GifImage` plus "via GIPHY" in the same row layout, name, time and admin *Remove*. Without the GIF props (Learn chat, 006) no button is rendered.
- **Acceptance:**
  - *FR-3 — When participant "Ada" picks one, Then a chat message from "Ada" … containing that GIF:* `Enter` on a result calls `sendGif(id)` and closes the picker; focus returns to the *GIF* button.
  - *FR-8 — Then the GIFs are shown and no GIF search control is available:* with `readOnly`, a GIF message renders and there is no *GIF* button.
  - *FR-10:* a GIF row's image is named by its title, or "GIF".
  - *FR-11 — Given … a GIF message, When shown, Then the service attribution … is visible:* the row shows "via GIPHY".
  - *FR-12 — … shows "GIF no longer available" with its original author, time and position:* firing `error` on that row's `<img>` shows the placeholder, and the row keeps sender and time between its neighbours.
  - *FR-7:* an admin sees *Remove* on a GIF row and it calls the existing remove handler.
  - Without GIF props: no *GIF* button.

### 19. `[P]` `chat_send_gif` over the session WebSocket

- **Plan:** WebSocket flow — Post. **Spec:** FR-3, FR-4, FR-8, FR-12, NFR-2, NFR-3.
- **Files:** `backend/app/sessions/ws.py`, `backend/tests/integration/test_ws_gifs.py`
- **Depends on:** 14, 16
- **Do:** Dispatch `chat_send_gif`: `gifs.service.resolve_for_post` with key `(session_id, sender name)`, then `chat.service.send_gif`. Errors to the sender only, carrying `client_id`: `gif_rate_limited` (+ `retry_after`), `gif_not_allowed`, `gif_unavailable`, `session_stale`. Only `gif_id` is read from the frame; every stored field comes from the server lookup.
- **Acceptance:**
  - *FR-3:* Ada's `chat_send_gif` → `chat_message` with `kind: "gif"`, `sender_name: "Ada"`, `sent_at` within 1 s of `frozen_clock`, `gif.id` the picked id.
  - *FR-4 — Given three participants in a session, When one posts a GIF, Then the other two see it … after the messages posted before it:* three WS clients, two text messages then a GIF → the other two receive the GIF `chat_message` with an id greater than both.
  - *NFR-2:* `chat_send_gif` with the `r`-rated id or the gone id → `gif_not_allowed` and no row; extra fields in the frame (e.g. a `url`) are ignored.
  - *NFR-3:* Ada's 6th `chat_send_gif` within a minute → `gif_rate_limited` and no row; Ben's post at the same moment succeeds.
  - *FR-8:* session marked stale mid-connection → `session_stale`, no row.
  - *FR-12 — the stored message holds a reference to the GIF and no GIF file:* the fake recorded no media request from the backend after a post.

### 20. `[P]` Wire GIFs into the coding-session page

- **Plan:** Frontend — `ChatPane.tsx` (its caller). **Spec:** FR-1, FR-3, FR-8.
- **Files:** `frontend/src/pages/SessionWindow.tsx`, `frontend/src/pages/SessionWindow.test.tsx`
- **Depends on:** 18
- **Do:** Pass invite, the session's `CollabProvider` and `useChat`'s `sendGif` into `ChatPane`; pass nothing GIF-related when the session is read-only. `LearningSessionWindow.tsx` is not touched.
- **Acceptance:**
  - *FR-1 (support):* an active session page shows the *GIF* button in chat.
  - *FR-8:* a stale session page shows GIF messages and no *GIF* button.

### 21. E2E stack: fake GIPHY as a compose test service

- **Plan:** Test strategy — End to end; Contracts — Configuration (`docker-compose.test.yml`). **Spec:** FR-9, FR-12, NFR-1, NFR-5.
- **Files:** `docker-compose.test.yml`, `backend/tests/fakes/fake_giphy.py`, `e2e/fixtures.ts`
- **Depends on:** 5, 19, 20
- **Do:** Add the fake as a service (stock Python 3.12 image running `fake_giphy.py`, no new dependency) whose fixture media URLs point at itself, reachable from the browser; backend gets `GIPHY_BASE_URL` = the fake and `GIPHY_API_KEY=test-key-not-secret`. Expose the fake's controls (switch off/on, recorded requests) over a small HTTP control path, and add Playwright helpers for them in `e2e/fixtures.ts`.
- **Acceptance:** infrastructure; checked by task 22's first test: on the up stack, the helper can read the fake's recorded requests and switch it off and on.

### 22. E2E: GIF search, post, history, removal, failure

- **Plan:** Test strategy — End to end (`e2e/gifs.spec.ts`). **Spec:** FR-1, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-11, FR-12, NFR-1.
- **Files:** `e2e/gifs.spec.ts`
- **Depends on:** 21
- **Do:** Playwright tests against the compose test stack.
- **Acceptance:**
  - *FR-5:* first open shows the third-party notice before any search request reaches the fake.
  - *FR-1:* type "cat", results visible.
  - *FR-3:* Ada picks one; her row shows name, time and image.
  - *FR-4 — three participants …:* three browser contexts; the GIF appears last in the other two without reload.
  - *FR-6:* after reload the GIF is still in its position.
  - *FR-7:* admin *Remove* → gone in every context and after reload.
  - *FR-8:* a stale session shows its GIF and no *GIF* button.
  - *FR-9:* fake switched off → "GIF search unavailable" shown, and a text message is delivered.
  - *FR-11:* "Powered by GIPHY" with results and "via GIPHY" on the message.
  - *FR-12:* a posted GIF whose media URL is the fake's 404 path shows "GIF no longer available" in its original position after reload.
  - *NFR-1:* media requests captured by Playwright carry no `Referer`.

### 23. E2E: keyboard, axe, reduced motion

- **Plan:** Test strategy — End to end (`keyboard`, `a11y`, reduced motion). **Spec:** NFR-6.
- **Files:** `e2e/gifs.spec.ts`
- **Depends on:** 22
- **Do:** Add to `e2e/gifs.spec.ts`.
- **Acceptance:**
  - *NFR-6 — Given GIF search is open, When a participant uses only the keyboard, Then they can type a term, move through results and post one:* no mouse: open the picker, *Continue*, type, arrows, `Enter` → the GIF is posted; `Escape` returns focus to the *GIF* button.
  - *NFR-6 — WCAG AA:* axe scan of the open picker (notice and results states) reports no WCAG AA violations.
  - *NFR-6 — Given reduced motion is on, When a GIF message is shown, Then it does not animate:* with `reducedMotion: "reduce"`, the image's `currentSrc` is the still URL, in the picker and in chat.
