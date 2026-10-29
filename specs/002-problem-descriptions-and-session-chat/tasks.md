# 002 — Problem descriptions and session chat: tasks

Every task is test-first: its tests are written failing, then the change makes them pass. Paths are relative to the repository root. `backend/app/...` modules and `backend/tests/...` tests use 001's layout; frontend paths start with `frontend/src/`.

Three tasks here depend on spec 003's tasks 39–41, which host this feature's parts in the session window and the problem editor sheet (plan.md, "Frontend, and the seam with spec 003"). Those 003 tasks in turn depend on waves 1–4 here. The order is: 002 waves 1–4, then 003 tasks 39–41, then 002 waves 5–6.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6, 7, 8 — all `[P]` | Foundations with no upstream: schema, the pure backend modules (Markdown, image sniffing, chat rules), the frontend client and pure modules, and the first half of the starter descriptions. |
| 2 | 9, 10, 11, 13, 14, 16 — all `[P]` | Each needs one wave-1 piece: the second half of the starter descriptions extends 8's test; the image API and chat repo need the schema (1) and sniffing (3); the description components and `useChat` need the client (5) and pure modules (6, 7); `description_html` on the WebSocket needs the renderer (2). No two touch the same file. |
| 3 | 12, 15 — all `[P]` | Description validation needs the image repo (10); the chat service and `chat_send` need the chat repo (11) and rules (4). 12 is in `problems/`, 15 in `chat/` and `sessions/ws.py`. |
| 4 | 17, 18 — all `[P]` | The chat REST endpoints use the chat service (15); the secrecy and description-change sweeps need descriptions (12, 16) and chat (15) to exist. **003's tasks 39–41 can start after this wave.** |
| 5 | 19, 20 — all `[P]` | **Blocked on 003:** the Remove action goes into 003's `ChatPane.tsx` (003 task 40); the descriptions E2E needs 003's Description tab (39) and editor sheet field (41). |
| 6 | 21 | The chat E2E covers removal, so it follows 19. |

## Checklist

- [x] **1** — `[P]` Migration: `problem_image` and `chat_message`
- [x] **2** — `[P]` Markdown renderer
- [x] **3** — `[P]` Image format sniffing and limits
- [x] **4** — `[P]` Chat message rules
- [x] **5** — `[P]` Frontend types and API client
- [x] **6** — `[P]` Frontend chat state and rules
- [x] **7** — `[P]` Frontend Markdown commands and image pre-checks
- [x] **8** — `[P]` Starter descriptions 1–10 and their content test
- [x] **9** — `[P]` Starter descriptions 11–20
- [x] **10** — `[P]` Image upload and serving API
- [x] **11** — `[P]` Chat repository
- [x] **12** — `[P]` Description validation, `description_html` and preview
- [x] **13** — `[P]` DescriptionView and DescriptionEditor
- [x] **14** — `[P]` `useChat` hook
- [x] **15** — `[P]` Chat service and WebSocket `chat_send`
- [x] **16** — `[P]` `description_html` on the session WebSocket
- [x] **17** — `[P]` Chat REST: history and admin removal
- [x] **18** — `[P]` Secrecy sweep and description-change isolation
- [x] **19** — `[P]` Admin Remove action and plain-text rendering in ChatPane (after 003 task 40)
- [x] **20** — `[P]` Descriptions end to end (after 003 tasks 39, 41)
- [x] **21** — Chat end to end

## Tasks

### 1. `[P]` Migration: `problem_image` and `chat_message`

- **Plan:** Data model. **Spec:** FR3, FR11, FR19.
- **Files:** `backend/app/migrations/0003_descriptions_and_chat.sql`, `backend/tests/integration/test_schema.py`
- **Depends on:** nothing
- **Do:** Add both tables and the index exactly as in plan.md's Data model, including the checks (media type list, 1..2097152 bytes, body 1..2000 characters, `removed_at`/`removed_by_sub` both null or both set).
- **Acceptance:**
  - Schema test: after migrating, both tables and `chat_message_session_id_idx` exist; inserting a 2001-character body, a `image/svg+xml` row, a 2097153-byte image, or `removed_at` without `removed_by_sub` each raises a check violation.
  - *FR11 — Given messages "one", "two", "three" sent in that order, …* Ids assigned by `bigserial` increase in insert order (`select … order by id` returns one, two, three).

### 2. `[P]` Markdown renderer

- **Plan:** Descriptions — Rendering. **Spec:** FR2, FR3, NFR Security.
- **Files:** `backend/app/problems/markdown.py`, `backend/tests/unit/test_markdown.py`, `backend/pyproject.toml` (+ `backend/uv.lock`)
- **Depends on:** nothing
- **Do:** Add `markdown-it-py`. Implement `render_description`, `image_ids` and `disallowed_image_sources` per plan.md's Contracts: `commonmark` preset, raw HTML off, links limited to `http`/`https`/`mailto` with `rel="noopener noreferrer nofollow"`, images limited to `/api/images/<uuid>` (others render as their alt text).
- **Acceptance:**
  - *FR2 — Given a description containing a heading, a numbered list, inline code and a fenced code block, When a participant views it in a session, Then each element renders with its formatting and the code block keeps its whitespace.* Each element maps to its HTML tag (`h1`–`h6`, `ol`/`li`, `code`, `pre><code`); code-block content including leading spaces and blank lines is byte-exact. Also bulleted lists, emphasis, paragraphs and links (FR2's full list).
  - *FR3 — … the image is shown between those two paragraphs.* `![a](/api/images/<uuid>)` placed between paragraphs 2 and 3 yields `<img>` between the second and third `<p>`.
  - NFR Security: `<script>alert(1)</script>`, `<img src=x onerror=…>`, `[x](javascript:alert(1))`, `[x](data:text/html,…)` and `![x](https://example.com/a.png)` produce no `<script>`, no event attribute, no `javascript:`/`data:` URL and no external `<img>`; the text is escaped or the alt text shown.
  - `image_ids` returns distinct ids in order of appearance; `disallowed_image_sources` lists every non-`/api/images/<uuid>` image source.

### 3. `[P]` Image format sniffing and limits

- **Plan:** Descriptions — Images. **Spec:** FR4.
- **Files:** `backend/app/problems/images.py`, `backend/tests/unit/test_images.py`
- **Depends on:** nothing
- **Do:** `MAX_IMAGE_BYTES`, `MAX_IMAGES_PER_DESCRIPTION`, `sniff_media_type(data)` from magic bytes for PNG, JPEG, GIF (87a/89a) and WebP (`RIFF….WEBP`).
- **Acceptance:**
  - *FR4 — Given an editor adding a PDF as an image, When they add it, Then it is refused with a message stating the accepted formats.* `sniff_media_type(<%PDF bytes>)` is `None`; so are SVG, empty bytes and a PNG header truncated to 4 bytes.
  - Real minimal PNG, JPEG, GIF and WebP files map to their media types, whatever their file name.

### 4. `[P]` Chat message rules

- **Plan:** Chat — Validation. **Spec:** FR13, FR14.
- **Files:** `backend/app/chat/__init__.py`, `backend/app/chat/rules.py`, `backend/tests/unit/test_chat_rules.py`
- **Depends on:** nothing
- **Do:** `MAX_CHAT_CHARS`, `ChatError`, `validate_body` per plan.md: emptiness on the stripped text, length in code points on the text as typed.
- **Acceptance:**
  - *FR13 — Given a participant whose input contains only spaces and line breaks, When they try to send, Then nothing is sent and no one sees a new message.* `"  \n \n"` and `""` → `chat_empty`.
  - *FR14 — Given a participant who typed 2001 characters, When they send, Then the message is refused …* 2001 code points → `chat_too_long`.
  - *FR14 — Given a participant who typed exactly 2000 characters, When they send, Then the message is delivered.* 2000 code points → `None`, including a text of 2000 astral characters (e.g. emoji), which is 4000 UTF-16 units.

### 5. `[P]` Frontend types and API client

- **Plan:** Frontend — `api/types.ts`, `api/client.ts`; Contracts — REST. **Spec:** FR3, FR4, FR5, FR16, FR19.
- **Files:** `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts`
- **Depends on:** nothing
- **Do:** Add `description_html` to the problem types, `ChatMessage`, and `uploadImage(file)`, `previewDescription(source)`, `getChat(invite)`, `removeChatMessage(invite, id)` with the request shapes and error bodies in plan.md's REST table, typed as results the callers can branch on (`image_too_large`, `image_format`, `not_found`, …).
- **Acceptance:**
  - Client tests (existing fetch seam in `client.test.ts`): each function calls the documented method and path with the documented body; `uploadImage` sends the raw file bytes; 413 and 415 bodies come back as `image_too_large` (with `limit_bytes`) and `image_format` (with `accepted`); `getChat` returns `messages` and `read_only`; `removeChatMessage` 204 resolves, 403 and 404 are distinguishable.

### 6. `[P]` Frontend chat state and rules

- **Plan:** Frontend — `chat/chatState.ts`, `chat/chatRules.ts`. **Spec:** FR13, FR14, FR18, FR19.
- **Files:** `frontend/src/chat/chatState.ts`, `frontend/src/chat/chatRules.ts`, `frontend/src/chat/chatState.test.ts`
- **Depends on:** nothing
- **Do:** Pure functions per plan.md's TypeScript signatures. The state stays sorted by id with unique ids.
- **Acceptance:**
  - *FR18 — Given Ana disconnected while Ben sends two messages, When Ana reconnects, Then Ana sees both messages once each, in order, after the messages already seen before the drop.* `replaceHistory` with a history overlapping the current list gives each id once, sorted; `addMessage` of an already-present id is a no-op; messages added out of id order end up sorted.
  - *FR19 — … Ana and Ben see "one" and "three" only …* `removeMessage(state, id)` drops it; removing an unknown id is a no-op.
  - *FR13* `chatError("  \n")` is `chat_empty`. *FR14* `charCount` counts code points (an emoji is 1); `chatError` of 2000 is `null`, of 2001 is `chat_too_long`.

### 7. `[P]` Frontend Markdown commands and image pre-checks

- **Plan:** Frontend — `description/markdownCommands.ts`, `description/imageChecks.ts`. **Spec:** FR2, FR3, FR4.
- **Files:** `frontend/src/description/markdownCommands.ts`, `frontend/src/description/imageChecks.ts`, `frontend/src/description/description.test.ts`
- **Depends on:** nothing
- **Do:** Pure text transforms over `(value, selectionStart, selectionEnd)` for each toolbar button (*Heading*, *Bold*, *Italic*, *Bulleted list*, *Numbered list*, *Inline code*, *Code block*, *Link*, *Image*), returning the new value and selection. `imageChecks`: accepted types, 2 MB size, and the count of distinct `/api/images/<uuid>` references in a source.
- **Acceptance:**
  - Each command wraps or prefixes the selection as CommonMark (e.g. *Bold* on `x` → `**x**`; *Numbered list* on two lines → `1. ` / `2. `; *Code block* fences the selection on its own lines); *Image* inserts `![alt](/api/images/<id>)` at the cursor and leaves the rest of the text unchanged.
  - *FR4 — Given an editor adding a 3 MB image …* a 3 MB file → refusal naming 2 MB. *FR4 — … a PDF …* `application/pdf` → refusal listing PNG, JPEG, GIF, WebP. *FR4 — Given a description that already has 10 images, When the editor adds an 11th …* a source with 10 distinct references → refusal stating the limit of 10.

### 8. `[P]` Starter descriptions 1–10 and their content test

- **Plan:** Descriptions — Starter set. **Spec:** FR8, FR9.
- **Files:** `seed/problems/01-sum-two` … `seed/problems/10-shift-letters` (`problem.json` only), `backend/tests/integration/test_seed_content.py`
- **Depends on:** nothing
- **Do:** Extend the test first, over a `DESCRIBED` range that covers folders 01–10; then rewrite those ten descriptions as Markdown with *Task*, *Input*, *Output*, *Example* and *Constraints* sections, with examples that don't reuse a hidden test's arguments.
- **Acceptance:**
  - *FR8 — Given a freshly set-up system, When an editor lists the 20 starter problems, Then each one has a non-empty description.* For folders 01–10: non-empty after stripping, and `render_description` of it contains the five section headings. (Uses `render_description` from task 2 if it has landed; otherwise asserts the `## ` headings in the source and is switched to the renderer in task 9.)
  - *FR9 — … none of the hidden tests' inputs or expected outputs appear unless the editor wrote them into the description text themselves.* For folders 01–10: no test's JSON-encoded argument list appears in the description.

### 9. `[P]` Starter descriptions 11–20

- **Plan:** Descriptions — Starter set. **Spec:** FR8, FR9.
- **Files:** `seed/problems/11-pair-sum-indices` … `seed/problems/20-count-set-bits` (`problem.json` only), `backend/tests/integration/test_seed_content.py`
- **Depends on:** 8 (and 2 for the renderer-based check)
- **Do:** Widen `DESCRIBED` to all 20 (failing), then rewrite descriptions 11–20 the same way. Make the heading check use `render_description` if task 8 didn't.
- **Acceptance:**
  - *FR8* and *FR9* as in task 8, for all 20 folders; a fresh DB seeded by the loader has 20 starter problems with non-empty descriptions.

### 10. `[P]` Image upload and serving API

- **Plan:** Descriptions — Images; Contracts — `POST /api/images`, `GET /api/images/{id}`. **Spec:** FR3, FR4, NFR Security.
- **Files:** `backend/app/problems/images_repo.py`, `backend/app/problems/images_api.py`, `backend/app/main.py` (mount the router), `backend/tests/integration/test_images_api.py`
- **Depends on:** 1, 3
- **Do:** Upload: editor role, raw body read in chunks with a 2 MiB + 1 cap, sniffed type, insert, 201 `{id, url}`. Serve: public, stored media type, the four response headers in plan.md, 404 for unknown ids.
- **Acceptance:**
  - *FR4 — Given an editor adding a 3 MB image, When they add it, Then it is refused with a message stating the 2 MB limit …* 413 `image_too_large` with `limit_bytes: 2097152`; no row inserted.
  - *FR4 — Given an editor adding a PDF as an image …* 415 `image_format` listing png, jpeg, gif, webp; a PNG uploaded with `Content-Type: application/pdf` is accepted as `image/png`, and a PDF sent as `image/png` is refused.
  - *FR3* a PNG upload returns an id; `GET` returns the same bytes, `Content-Type: image/png`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`.
  - Anonymous upload → 401; `plain1` → 403 (001's `login_as`).

### 11. `[P]` Chat repository

- **Plan:** Chat — Modules, Order, Isolation, Admin removal. **Spec:** FR11, FR12, FR17, FR19.
- **Files:** `backend/app/chat/repo.py`, `backend/tests/integration/test_chat_repo.py`
- **Depends on:** 1
- **Do:** `insert(conn, session_id, participant_id, sender_name, body, sent_at) -> ChatMessage`, `history(conn, session_id)` (non-removed, id order), `mark_removed(conn, session_id, message_id, admin_sub) -> bool` (False when the message isn't in that session or is already removed).
- **Acceptance:**
  - *FR11 — Given messages "one", "two", "three" sent in that order, When the system is restarted and a participant reopens the session, Then all three are shown in that order.* Insert three, open a new connection from the pool, `history` → one, two, three.
  - *FR17 — Given sessions A and B, When a participant in A sends a message, Then it appears in A's chat and never in B's …* `history(B)` excludes A's message; `mark_removed(B, <A's id>)` is False and A's message is untouched.
  - *FR19 — … a participant who joins afterwards sees "one" and "three" in that order.* After `mark_removed`, `history` is one, three; the row still exists with `removed_at` and `removed_by_sub` set.

### 12. `[P]` Description validation, `description_html` and preview

- **Plan:** Descriptions — Validation on save, Where it is shown; Contracts — problems rows, `POST /api/problems/preview`. **Spec:** FR1, FR3, FR4, FR5, FR6.
- **Files:** `backend/app/problems/service.py`, `backend/app/problems/api.py`, `backend/tests/integration/test_problem_descriptions_api.py`
- **Depends on:** 2, 10
- **Do:** On create and update, refuse `description_required`, `too_many_images` (limit 10), `image_not_found`, `image_source_not_allowed` as 422s per the REST table. Add `description_html` to `GET /api/problems/{id}`. Add `POST /api/problems/preview` (editor) returning `{html}` without writing anything.
- **Acceptance:**
  - *FR1 — Given an editor creating a problem with title and tests but an empty description, When they save, Then the save is refused, the message names the description, and no problem is created.* `""` and `"  \n"` → 422 `description_required`; problem count unchanged. Same refusal on update, leaving the stored problem unchanged.
  - *FR4 — Given a description that already has 10 images, When the editor adds an 11th, Then it is refused with a message stating the limit.* Saving with 11 distinct uploaded ids → 422 `too_many_images`, `limit: 10`; with 10 → saved.
  - *FR3 — Given an editor who places a PNG image between the second and third paragraphs and saves, When a participant opens a session on that problem, Then the image is shown between those two paragraphs.* Upload, save, then `GET /api/problems/{id}` `description_html` has the `<img>` between the 2nd and 3rd `<p>`.
  - *FR5 — Given an editor with unsaved description changes, When they open the preview, Then they see the description rendered exactly as a participant would, and nothing is saved.* Preview html equals the `description_html` served after saving the same source; before saving, `GET` still returns the old description.
  - An external image source → 422 `image_source_not_allowed`; an unknown image id → 422 `image_not_found`. Preview as `plain1` → 403.

### 13. `[P]` DescriptionView and DescriptionEditor

- **Plan:** Frontend — `description/DescriptionView.tsx`, `description/DescriptionEditor.tsx`. **Spec:** FR2, FR3, FR4, FR5.
- **Files:** `frontend/src/description/DescriptionView.tsx`, `frontend/src/description/DescriptionEditor.tsx` (+ `.module.css`), `frontend/src/description/DescriptionEditor.test.tsx`
- **Depends on:** 5, 7
- **Do:** `DescriptionView` renders the server html into a container. `DescriptionEditor`: a labelled `textarea`, the toolbar wired to task 7's commands, *Image* (pick, pre-check, upload, insert at the cursor), and a *Preview* toggle showing `previewDescription`'s html through `DescriptionView`. Built from 003's `ui` primitives (`Button`, `Toolbar`, `InlineMessage`, `SegmentedControl`) so it fits the sheet.
- **Acceptance:**
  - *FR4 — Given an editor adding a 3 MB image, When they add it, Then it is refused with a message stating the 2 MB limit, and the description's existing text and images are unchanged.* The message names 2 MB, `uploadImage` is never called, and the textarea value is unchanged. Same for a PDF (message lists the formats) and for an 11th image (message states the limit of 10).
  - *FR3* A successful upload inserts the reference at the cursor position.
  - *FR5 — … they see the description rendered exactly as a participant would, and nothing is saved.* *Preview* shows the html returned by `previewDescription` and calls no save; switching back keeps the source.
  - *FR2* Each toolbar button is reachable by keyboard and applies its command to the selection.

### 14. `[P]` `useChat` hook

- **Plan:** Frontend — `chat/useChat.ts`. **Spec:** FR10, FR13, FR14, FR16, FR18, FR19.
- **Files:** `frontend/src/chat/useChat.ts`, `frontend/src/chat/useChat.test.tsx`
- **Depends on:** 5, 6
- **Do:** Subscribe to `welcome`, `chat_message`, `chat_removed` and `error` on the `CollabProvider`. `send` generates a `client_id`, pre-checks with `chatError`, and resolves when the matching `chat_message` or `error` arrives. When `stale`, load `getChat` and set `readOnly`. `canRemove` comes from `useMe` having the admin role; `remove` calls `removeChatMessage`.
- **Acceptance (fake `SocketLike`, the seam `provider.test.ts` uses):**
  - *FR10* A `chat_message` frame appears in `messages` with `sender_name` and `sent_at`.
  - *FR13* `send("  \n")` resolves `chat_empty` and sends no frame. *FR14* `send` of 2001 characters resolves `chat_too_long` and sends no frame; a server `error chat_too_long` with the matching `client_id` also resolves `chat_too_long`.
  - *FR16 — Given a stale session with chat history, When a participant opens it, Then the history is shown and sending is unavailable …* With `stale: true`, `messages` is `getChat`'s list and `readOnly` is true.
  - *FR18* A second `welcome` after reconnect replaces the list with no duplicates.
  - *FR19* A `chat_removed` frame drops the message; `canRemove` is true only for a `useMe` with the admin role.

### 15. `[P]` Chat service and WebSocket `chat_send`

- **Plan:** Chat — Transport, Modules, Order, Validation, Stale, Plain text. **Spec:** FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR18.
- **Files:** `backend/app/chat/service.py`, `backend/app/sessions/ws.py`, `backend/tests/integration/test_ws_chat.py`
- **Depends on:** 4, 11
- **Do:** `chat.service.send` re-reads stale state, validates, inserts with `clock` time, then broadcasts `chat_message` (with `client_id`) to the hub; refusals go to the sender only as `error` with `client_id`. `history` for `welcome.chat`. In `ws.py`, dispatch `chat_send` and add `chat` to `welcome`.
- **Acceptance (two `TestClient` WebSocket clients, real Postgres):**
  - *FR10 — Given a session with participants "Ana" and "Ben" connected, When Ana sends "try a hashmap", Then Ben sees "try a hashmap" labelled "Ana" with its send time, within 1 second.* Both receive `chat_message` with `sender_name: "Ana"` and `sent_at`, within 1 s.
  - *FR11 — … When the system is restarted and a participant reopens the session, Then all three are shown in that order.* Send three, build a fresh app on the same DB, join → `welcome.chat` is one, two, three.
  - *FR12 — Given a session with 50 earlier messages, When a new participant joins through the invite link, Then they see all 50 in order, and then a message sent afterwards appears after them.*
  - *FR13 — … nothing is sent and no one sees a new message.* `"  \n"` → sender gets `error chat_empty`; the other client gets nothing; no row.
  - *FR14 — … refused with a message stating the 2000-character limit, nobody receives it …* 2001 → sender gets `error chat_too_long` with `limit: 2000`; 2000 → delivered to both.
  - *FR15 — Given a participant who sends `<script>alert(1)</script> **bold** <b>x</b>`, When others see it, Then they see exactly those characters as text …* The other client's `chat_message.text` and the stored `body` are byte-exact to what was sent, including leading and trailing whitespace.
  - *FR16* A session marked stale while both are connected → the next `chat_send` gets `error session_stale`, no row.
  - *FR17 — … it appears in A's chat and never in B's …* A client in session B receives nothing when A sends.
  - *FR18 — Given Ana disconnected while Ben sends two messages, When Ana reconnects, Then Ana sees both messages once each, in order …* Ana's new `welcome.chat` has both, once each, after the earlier ones.

### 16. `[P]` `description_html` on the session WebSocket

- **Plan:** Descriptions — Where it is shown; Contracts — WebSocket. **Spec:** FR6, FR7.
- **Files:** `backend/app/sessions/ws.py`, `backend/tests/integration/test_ws_switch.py`
- **Depends on:** 2
- **Do:** `_problem_dict` adds `description_html: render_description(problem.description)`, so it appears in `welcome.current_problem` and `problem_switched.problem`.
- **Acceptance:**
  - *FR6 — Given a session on a problem with a description, When a participant opens the session, Then the formatted description and its images are visible alongside the shared editor.* `welcome.current_problem.description_html` is the rendered description; after a switch, `problem_switched` carries the new problem's.
  - *FR7* (description half) After the problem's description is updated, a new join's `welcome` carries the new html.

### 17. `[P]` Chat REST: history and admin removal

- **Plan:** Chat — Stale, Isolation, Admin removal; Contracts — chat rows. **Spec:** FR16, FR17, FR19.
- **Files:** `backend/app/chat/api.py`, `backend/app/main.py` (mount the router), `backend/tests/integration/test_chat_api.py`
- **Depends on:** 15
- **Do:** `GET /api/sessions/{invite}/chat` → `{messages, read_only}`; `DELETE /api/sessions/{invite}/chat/{message_id}` with `require_role("admin")` → `chat.service.remove`, which marks the message removed and broadcasts `chat_removed` to the session's hub if anyone is connected.
- **Acceptance:**
  - *FR16 — Given a stale session with chat history, When a participant opens it, Then the history is shown and sending is unavailable; When an admin reactivates the session, Then the participant can send again.* For a stale session, `GET` returns the history with `read_only: true` and the WebSocket is refused (4410); after 001's reactivate, a join and `chat_send` succeed and `GET` shows `read_only: false`.
  - *FR17 — … and a request for A's chat without A's invite link is refused.* `GET` with an unknown invite → 404; `DELETE` with A's invite and B's message id → 404.
  - *FR19 — Given Ana and Ben connected to a session where Ben sent "one", "abuse", "three", When an admin removes "abuse", Then within 1 second Ana and Ben see "one" and "three" only, and a participant who joins afterwards sees "one" and "three" in that order.* Admin `DELETE` → 204; both sockets receive `chat_removed` within 1 s; a new join's `welcome.chat` and `GET` are one, three.
  - *FR19 — Given a participant (the sender or anyone else) or an editor without the admin role, When they try to remove a message, Then it is refused and the message stays visible to everyone.* Anonymous → 401, `plain1` and `editor1` → 403; a WebSocket frame `{"type": "chat_remove", "id": …}` is ignored; the message is still in `GET`.

### 18. `[P]` Secrecy sweep and description-change isolation

- **Plan:** Descriptions — Hidden tests (FR9), Where it is shown (FR7). **Spec:** FR7, FR9.
- **Files:** `backend/tests/integration/test_secrecy.py`, `backend/tests/integration/test_description_change.py`
- **Depends on:** 12, 15, 16
- **Do:** Tests only; they guard the behaviour 12, 15 and 16 build. Write them, confirm each fails when its guard is broken on purpose (e.g. a test argument added to `description_html`; a session's code changed by the save), then restore.
- **Acceptance:**
  - *FR9 — Given a problem with hidden tests, When a participant views its description in a session, Then none of the hidden tests' inputs or expected outputs appear unless the editor wrote them into the description text themselves.* For every starter problem, `GET /api/problems/{id}`, `welcome`, `problem_switched` and `/preview` contain no hidden test argument or expected value that isn't in the description source.
  - *FR7 — Given two sessions on the same problem, each with code and chat messages, When an editor saves a new description and a participant refreshes each session, Then both show the new description and both sessions' code and chat are unchanged.*

### 19. `[P]` Admin Remove action and plain-text rendering in ChatPane (after 003 task 40)

- **Plan:** Frontend — Gap in 003; Chat — Plain text. **Spec:** FR15, FR19.
- **Files:** `frontend/src/components/ChatPane.tsx`, `frontend/src/components/ChatPane.test.tsx`
- **Depends on:** 14, 17, and spec 003's task 40
- **Do:** When `useChat().canRemove`, each message gets a *Remove* action (a toolbar-style `Button` with an accessible name naming the sender and time) calling `remove(id)`. Confirm the body is rendered as a text node with `white-space: pre-wrap`.
- **Acceptance:**
  - *FR15 — Given a participant who sends `<script>alert(1)</script> **bold** <b>x</b>`, When others see it, Then they see exactly those characters as text, nothing is bold, and no script runs.* The rendered text content equals the input; the pane contains no `script`, `b` or `strong` element from it.
  - *FR19* An admin sees *Remove* on each message and using it calls `removeChatMessage`; a participant without the admin role sees no *Remove* action.

### 20. `[P]` Descriptions end to end (after 003 tasks 39, 41)

- **Plan:** Test strategy — E2E. **Spec:** FR2, FR3, FR4, FR5, FR6, NFR Readability.
- **Files:** `e2e/descriptions.spec.ts`
- **Depends on:** 9, 12, 13, 16, and spec 003's tasks 39 and 41
- **Do:** Playwright against the production stack and test Keycloak, as 001/003.
- **Acceptance:**
  - *FR2* An editor writes a heading, numbered list, inline code and a fenced code block in the sheet and saves; in a session, each renders with its formatting and the code block keeps its whitespace.
  - *FR3* An editor adds a PNG between paragraphs 2 and 3 and saves; in a session the image is shown between them.
  - *FR4* Adding a 3 MB image and a PDF each shows the refusal with the limit or formats, and the description text is unchanged.
  - *FR5* *Preview* with unsaved changes shows the rendered description; closing without saving leaves the problem unchanged.
  - *FR6* In a session, the description and its image are visible beside the shared editor.
  - NFR Readability: at 1024 px, an image wider than the description area is scaled to fit with no horizontal scrolling.

### 21. Chat end to end

- **Plan:** Test strategy — E2E. **Spec:** FR10, FR15, FR16, FR19.
- **Files:** `e2e/chat.spec.ts`
- **Depends on:** 17, 19, and spec 003's task 40
- **Do:** Playwright with two (and for FR19 three) browser contexts.
- **Acceptance:**
  - *FR10* Ana sends "try a hashmap"; Ben sees it labelled "Ana" with its time, within 1 second.
  - *FR15* The markup message shows as literal text and no dialog fires.
  - *FR16* In a stale session the history is shown and the input is disabled with its reason; after an admin reactivates, sending works.
  - *FR19* Ben sends "one", "abuse", "three"; a signed-in admin removes "abuse"; within 1 second Ana and Ben see "one" and "three" only, and a participant who joins afterwards sees the same.
