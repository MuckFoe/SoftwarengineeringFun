# 002 — Problem descriptions and session chat: plan

HOW for [spec.md](spec.md). Builds on 001's backend (`backend/app/`), schema (`backend/app/migrations/`), session WebSocket (`sessions/ws.py`, `sessions/hub.py`) and on the redesigned frontend from 003. Paths are relative to the repository root.

## Architecture

### Descriptions

- **Format.** A description is stored as Markdown source (CommonMark) in the existing `problem.description` column. Markdown covers every FR2 element; the editor writes it through toolbar buttons and can also type it.
- **Rendering happens once, on the server** (`backend/app/problems/markdown.py`, pure). `render_description(source) -> str` uses `markdown-it-py`'s `commonmark` preset with **raw HTML disabled**, so anything that looks like a tag is escaped text. Link targets are limited to `http`, `https` and `mailto`; image sources to `/api/images/<uuid>`. Anything else is dropped from the output: the link keeps its text, an image shows its alt text. Links get `rel="noopener noreferrer nofollow"`. This one function produces the participant view (FR6), the preview (FR5, so the preview matches by construction) and the security guarantee (NFR Security). Nothing is sanitised on the client.
- **Where it is shown.** Public problem reads (`GET /api/problems/{id}`) and the WebSocket `welcome` / `problem_switched` problem dicts gain `description_html`. It is rendered on every read, not stored: there are about 20 problems and at most 5 participants, and rendering on read means a renderer fix applies everywhere with no data migration. The Markdown source stays in the editor-only `GET /api/problems/{id}/edit`. FR7 (new description on refresh, code and chat untouched) needs nothing more: the description belongs to the problem, and code and chat belong to the session.
- **Validation on save** (`problems/service.py`, create and update): the description is refused if it is empty after stripping whitespace (FR1). It is also refused if it references more than 10 distinct images, an image id that doesn't exist, or any image source other than `/api/images/<uuid>` (FR3, FR4). The ids are read from the parsed Markdown tokens by `markdown.image_ids(source)`.
- **Images** (`backend/app/problems/images.py` pure, `images_repo.py`, `images_api.py`):
  - Upload: `POST /api/images`, editor role, raw request body (no multipart, so no new dependency). The body is read in chunks and stops at 2 MiB + 1 byte. The format comes from the file's magic bytes (PNG, JPEG, GIF, WebP); the declared `Content-Type` and file name are ignored. A refused image never touches the description: the client only inserts `![alt](/api/images/<id>)` after a successful upload (FR4).
  - Storage: in Postgres (`problem_image`, below). An image is immutable and addressed by its id. It isn't tied to one problem, so a description can be created before its problem exists. An image uploaded and then never saved into a description stays as an unreferenced row; the spec asks for no cleanup, and there is none.
  - Serving: `GET /api/images/{id}`, public, like the problem text participants already read without an account. The response has the stored media type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Content-Disposition: inline` and `Cache-Control: public, max-age=31536000, immutable`. SVG is never accepted, so an image can't carry script (NFR "served only as images").
- **Hidden tests (FR9).** Nothing in the description path reads `problem_test`. Rendering takes only the Markdown string. The existing secrecy sweep (`backend/tests/integration/test_secrecy.py`) is extended to cover `description_html` and the preview response.
- **Starter set (FR8).** The 20 `seed/problems/*/problem.json` files get Markdown descriptions with *Task*, *Input*, *Output*, *Example* and *Constraints* sections. Their examples must not reuse a hidden test's arguments; `test_seed_content.py` checks that. The seed loader only inserts problems whose `seed_key` isn't present yet, so a fresh system gets the new text. An existing database keeps its current one-line descriptions, which are non-empty and still satisfy FR1/FR8; there is no data migration.

### Chat

- **Transport.** Live chat travels over the session's existing WebSocket, as JSON text frames next to `run` / `switch_problem`. History reaches a joining or reconnecting participant inside `welcome`. A stale session refuses the WebSocket (close 4410, from 001), so its read-only history comes from REST instead.
- **Modules.** `backend/app/chat/rules.py` (pure: `validate_body(text) -> str | ChatError`), `chat/repo.py` (asyncpg), `chat/service.py` (`send`, `remove`, `history`: persist, then broadcast through `sessions/hub.py`), `chat/api.py` (REST). `sessions/ws.py` dispatches `chat_send` to `chat.service.send` and adds `chat` to `welcome`.
- **Order (FR11, FR12, FR18).** The order is the `chat_message.id` (bigserial) assigned on insert, i.e. the order the server received the messages. The broadcast happens after the insert commits, so a message anyone sees is durable (NFR Durability). Two concurrent sends can be broadcast in the opposite order to their ids, so the client keeps its list **sorted by id and deduplicated by id**. A reconnect replaces the list with `welcome.chat`, which gives no duplicates and no gaps (FR18).
- **Validation (FR13, FR14).** `rules.validate_body` refuses an empty or whitespace-only text with `chat_empty`, and more than 2000 characters with `chat_too_long`. A character is a Unicode code point: Python `len`, matched on the client by `[...text].length`. The text is stored exactly as typed; only the emptiness check uses the stripped text. The client applies the same checks before sending and keeps the input on refusal. The server answers a refused send only to the sender.
- **Stale (FR16).** `send` re-reads `session.stale_at` before inserting and refuses with `session_stale`, which covers a session going stale while someone is connected. When a session is stale, the session window still loads the history through `GET /api/sessions/{invite}/chat` and disables the input. After reactivation (001's endpoint), the next join works as normal.
- **Isolation (FR17).** Every chat query is scoped by `session_id`, which is resolved from the invite. Neither the REST endpoints nor the WebSocket accept a session or message id without the invite. An unknown invite gets 404.
- **Admin removal (FR19).** `DELETE /api/sessions/{invite}/chat/{message_id}`, `require_role("admin")` (001's dependency). It sets `removed_at` and `removed_by_sub`; the row is hidden, not erased (spec Decisions). Every history query filters out `removed_at is not null`. After the update commits, the server broadcasts `chat_removed` to whoever is connected to that session's hub, and does nothing if no one is. The message must belong to the invite's session; otherwise 404. There is no WebSocket message for removal, so a participant cannot remove anything.
- **Sender label and time (FR10).** `sender_name` is copied from the participant's session name at send time. `sent_at` comes from `app/clock.py` (server receive time, UTC) and the client shows it in local time (`Intl.DateTimeFormat`, hours and minutes).
- **Plain text (FR15).** The server never interprets the body. The client renders it as a React text node with `white-space: pre-wrap` and never with `dangerouslySetInnerHTML`.

### Frontend, and the seam with spec 003

003 (approved, tasks 1–38 done) owns where these appear: its task 39 adds the *Description* inspector tab (`components/DescriptionPane.tsx`), 40 the *Chat* inspector tab (`components/ChatPane.tsx`) and 41 the *Description* field in `pages/ProblemEditorSheet.tsx`. 002 provides what they host:

- `frontend/src/api/types.ts`, `api/client.ts`: `description_html` on problem types; `ChatMessage`; `uploadImage(file)`, `previewDescription(source)`, `getChat(invite)`, `removeChatMessage(invite, id)`.
- `frontend/src/description/DescriptionView.tsx`: renders the server's `description_html` into a container. This is the only `dangerouslySetInnerHTML` in the feature, and it is safe because of the server renderer.
- `frontend/src/description/DescriptionEditor.tsx`: a Markdown `textarea`, a formatting toolbar and a Preview toggle. The toolbar has *Heading*, *Bold*, *Italic*, *Bulleted list*, *Numbered list*, *Inline code*, *Code block*, *Link* and *Image*. Preview calls `previewDescription` (FR5) and saves nothing. Image picks a file, pre-checks its type, size and the image count to refuse instantly with the limit in the message (FR4), uploads it, and inserts the reference at the cursor (FR3). The pure text transforms are in `description/markdownCommands.ts`; the client pre-checks are in `description/imageChecks.ts` and the server re-checks everything.
- `frontend/src/chat/chatState.ts` (pure reducer: `welcome`/history replace, add, remove, sort and dedupe by id), `chat/chatRules.ts` (pure: emptiness, code-point length), `chat/useChat.ts` (hook over 001's `CollabProvider` events `welcome`, `chat_message`, `chat_removed`, `error`. Its state is `messages` and `readOnly`, plus `send(text)` that resolves to `ok` or an error code so the caller keeps the input on refusal, and `remove(id)` with `canRemove` from `useMe` having the admin role).
- **Gap in 003:** 003's task 40 predates FR19 and does not mention a *Remove* action. 002 adds it to `components/ChatPane.tsx` itself, in a task that runs after 003's task 40.

Build order across the two specs: 002's backend, client and the components above come first, then 003's tasks 39–41, then 002's remove action and end-to-end tests.

### Dependency direction

`sessions.ws → chat.service → chat.repo, sessions.hub`; `chat.api → sessions.repo` (invite lookup), `chat.service`, `auth.deps`. `problems.service → problems.markdown, problems.images_repo`; `problems.images_api → problems.images, problems.images_repo, auth.deps`. `chat` never imports `problems`, and `problems` never imports `chat` or `sessions`. Frontend: `chat/*` and `description/*` depend on `api/*` and `collab/provider.ts`; 003's panes depend on them, never the reverse.

## Data model

Migration `backend/app/migrations/0003_descriptions_and_chat.sql`:

```sql
create table problem_image (
    id              uuid primary key default gen_random_uuid(),
    media_type      text not null
                    check (media_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
    data            bytea not null check (octet_length(data) between 1 and 2097152),
    uploaded_by_sub text not null,
    created_at      timestamptz not null default now()
);

create table chat_message (
    id             bigserial primary key,
    session_id     uuid not null references session (id),
    participant_id uuid not null references participant (id),
    sender_name    text not null,
    body           text not null check (char_length(body) between 1 and 2000),
    sent_at        timestamptz not null,
    removed_at     timestamptz null,
    removed_by_sub text null,
    check ((removed_at is null) = (removed_by_sub is null))
);

create index chat_message_session_id_idx on chat_message (session_id, id);
```

`problem.description` is unchanged in type (`text not null`). The non-empty rule is enforced in `problems/service.py` with a message naming the field, not as a DB constraint, because existing rows aren't migrated (see Starter set).

## Contracts

### REST

| Method and path | Auth | Request | Success | Refusals |
|---|---|---|---|---|
| `POST /api/problems`, `PUT /api/problems/{id}` (001, extended) | editor | 001 body; `description` is Markdown | 001 | 422 `{"error": "description_required"}`; 422 `{"error": "too_many_images", "limit": 10}`; 422 `{"error": "image_not_found", "id"}`; 422 `{"error": "image_source_not_allowed"}` |
| `GET /api/problems/{id}` (001, extended) | none | — | 001 body + `"description_html": str` | 001 |
| `POST /api/problems/preview` | editor | `{"description": str}` | 200 `{"html": str}` | — (preview renders even an invalid draft; save is where it is refused) |
| `POST /api/images` | editor | raw image bytes | 201 `{"id": uuid, "url": "/api/images/<id>"}` | 413 `{"error": "image_too_large", "limit_bytes": 2097152}`; 415 `{"error": "image_format", "accepted": ["png", "jpeg", "gif", "webp"]}` |
| `GET /api/images/{id}` | none | — | 200 image bytes, headers as above | 404 |
| `GET /api/sessions/{invite}/chat` | invite | — | 200 `{"messages": [ChatMessage], "read_only": bool}` | 404 `{"error": "not_found"}` |
| `DELETE /api/sessions/{invite}/chat/{message_id}` | admin | — | 204 | 401/403 (001's `require_role`); 404 if the message doesn't exist in that session or is already removed |

`ChatMessage = {"id": int, "sender_name": str, "text": str, "sent_at": ISO-8601 UTC str}`.

### WebSocket (001's session socket, JSON text frames)

Client → server:

- `{"type": "chat_send", "client_id": str, "text": str}`. `client_id` is a client-generated id, echoed back so the sender can match the result to its input.

Server → client:

- `welcome` (001) gains `"chat": [ChatMessage]`, the full non-removed history in id order.
- `{"type": "chat_message", "message": ChatMessage, "client_id": str}` to everyone in the session, the sender included.
- `{"type": "chat_removed", "id": int}` to everyone connected.
- `{"type": "error", "code": "chat_empty" | "chat_too_long" | "session_stale", "client_id": str}` to the sender only; `chat_too_long` also carries `"limit": 2000`.
- `welcome.current_problem` and `problem_switched.problem` (001) gain `description_html`.

### Python signatures

```python
# problems/markdown.py
def render_description(source: str) -> str: ...
def image_ids(source: str) -> list[uuid.UUID]: ...            # distinct, in order of appearance
def disallowed_image_sources(source: str) -> list[str]: ...

# problems/images.py
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGES_PER_DESCRIPTION = 10
def sniff_media_type(data: bytes) -> str | None: ...           # 'image/png' | ... | None

# chat/rules.py
MAX_CHAT_CHARS = 2000
class ChatError(StrEnum): EMPTY = "chat_empty"; TOO_LONG = "chat_too_long"; STALE = "session_stale"
def validate_body(text: str) -> ChatError | None: ...

# chat/service.py
async def send(conn, hub, session_id, participant_id, sender_name, text, client_id) -> ChatError | None: ...
async def history(conn, session_id) -> list[ChatMessage]: ...
async def remove(conn, hub, session_id, message_id, admin_sub) -> bool: ...  # False → 404
```

### TypeScript signatures

```ts
// chat/chatState.ts
type ChatState = { messages: ChatMessage[] };          // sorted by id, unique ids
function replaceHistory(s: ChatState, messages: ChatMessage[]): ChatState;
function addMessage(s: ChatState, m: ChatMessage): ChatState;
function removeMessage(s: ChatState, id: number): ChatState;

// chat/chatRules.ts
const MAX_CHAT_CHARS = 2000;
function charCount(text: string): number;               // code points
function chatError(text: string): "chat_empty" | "chat_too_long" | null;

// chat/useChat.ts
function useChat(opts: { invite: string; provider: CollabProvider | null; stale: boolean }): {
  messages: ChatMessage[]; readOnly: boolean; canRemove: boolean;
  send(text: string): Promise<"ok" | "chat_empty" | "chat_too_long" | "session_stale">;
  remove(id: number): Promise<void>;
};

// description/*
function DescriptionView(props: { html: string }): JSX.Element;
function DescriptionEditor(props: { value: string; onChange(v: string): void }): JSX.Element;
```

## Test strategy

Levels, per the constitution's real-dependencies rule:

- **Backend unit** (`backend/tests/unit/`): `markdown.py` (every FR2 element, the FR15-style injection vectors against descriptions, link and image source filtering), `images.py` sniffing, `chat/rules.py`.
- **Backend integration** (`backend/tests/integration/`, real Postgres from 001's test stack, FastAPI `TestClient` including its WebSocket client, the real Keycloak test realm via 001's `login_as`): every endpoint and WebSocket message above. Nothing is mocked.
- **Frontend unit** (Vitest + Testing Library, `frontend/src/**`): the pure modules, `useChat` against a fake `SocketLike` (the same seam 001's `provider.test.ts` uses; it's the browser WebSocket boundary, not an owned dependency), `DescriptionEditor`, `DescriptionView`.
- **End to end** (Playwright, `e2e/descriptions.spec.ts`, `e2e/chat.spec.ts`, against the production compose stack and the test Keycloak, as 001/003). These run after 003's tasks 39–41.

| Acceptance criterion | Test |
|---|---|
| FR1 empty description refused, nothing created | integration `test_problems_api`: POST with `""` and `"  \n"` → 422 `description_required`, problem count unchanged |
| FR2 heading, numbered list, inline code, fenced block keep formatting and whitespace | unit `test_markdown`: each element → expected HTML, code-block whitespace byte-exact; E2E `descriptions.spec`: elements visible in the session |
| FR3 PNG between paragraphs 2 and 3 shows there | integration: upload PNG → save description with the reference → `description_html` has `<img>` between the 2nd and 3rd `<p>`; E2E: image visible at that position in the session |
| FR4 3 MB image refused, description unchanged | integration: 413 `image_too_large`; Vitest `DescriptionEditor`: message names 2 MB, textarea value unchanged |
| FR4 PDF refused with accepted formats | unit `sniff_media_type(pdf) is None`; integration 415 `image_format`; Vitest message lists the formats |
| FR4 11th image refused | Vitest `DescriptionEditor` with 10 references: message states the limit, no upload call; integration: save with 11 → 422 `too_many_images` |
| FR5 preview matches participant view, nothing saved | integration: `POST /preview` html == `GET /api/problems/{id}` `description_html` for the same source, and the problem is unchanged after preview; Vitest: Preview shows the returned html, no save call |
| FR6 description and images visible beside editor | integration `test_ws_*`: `welcome.current_problem.description_html` present; E2E `descriptions.spec` (after 003 task 39) |
| FR7 new description in both sessions, code and chat unchanged | integration: two sessions with code and chat → PUT description → each new `welcome` has the new html; each session's doc text and chat history are unchanged |
| FR8 20 starter problems have non-empty descriptions | integration `test_seed_content`: fresh DB → seed → 20 problems, each `description.strip()` non-empty and rendering to non-empty html; each description contains no hidden test's JSON-encoded arguments |
| FR9 hidden tests never revealed | integration `test_secrecy` extended: `description_html`, `/preview` and `/edit` payloads for every starter problem contain no hidden test args or expected values that aren't in the source text |
| FR10 Ana's message reaches Ben labelled, ≤1 s | integration `test_ws_chat`: two WS clients, `chat_message` received by both with `sender_name == "Ana"` and `sent_at`, within 1 s; E2E `chat.spec` |
| FR11 order survives restart | integration: send three → new app instance on the same DB → `welcome.chat` texts are `one, two, three` |
| FR12 joiner sees 50, then new message after | integration: 50 messages → new WS join → `welcome.chat` has 50 in order → next send arrives as `chat_message` with a larger id |
| FR13 whitespace not sent | unit `chat/rules`; integration: `chat_send "  \n"` → `error chat_empty` to sender, the other client receives nothing, no row; Vitest `useChat` sends no frame |
| FR14 2001 refused and input kept; 2000 delivered | unit `rules` at 2000/2001 code points (including astral characters); integration both cases; Vitest: 2001 → no frame, input value kept, message states 2000 |
| FR15 markup shown as text, no script | integration: body stored byte-exact; Vitest `ChatPane`/message rendering: text content equals the input, no `<b>`/`<script>` element created; E2E: no dialog fires |
| FR16 stale read-only, reactivated writable | integration: stale session → `GET /chat` returns history with `read_only: true`, WS refused 4410; `send` on a session marked stale mid-connection → `session_stale`; reactivate → join and send succeed; Vitest `useChat({stale: true})`: `readOnly`, `send` disabled |
| FR17 no mixing; no access without invite | integration: messages in A never arrive on B's socket and aren't in B's history; `GET /api/sessions/<wrong>/chat` → 404; `DELETE` with A's invite and B's message id → 404 |
| FR18 reconnect shows missed messages once, in order | integration: Ana disconnects, Ben sends two, Ana rejoins → `welcome.chat` contains them once, in order; Vitest `chatState`: replace after add yields no duplicates and stays sorted |
| FR19 admin removes, gone live and for later joiners | integration: Ana and Ben connected, admin `DELETE` → both receive `chat_removed` within 1 s; a new join's `welcome.chat` is `one, three`; the row still exists with `removed_at` set; E2E (after 003 task 40) via the Remove action |
| FR19 non-admins can't remove | integration: anonymous → 401, `plain1` and `editor1` → 403, message still in history; a WS frame `{"type": "chat_remove"}` is ignored |
| NFR Latency ≤1 s | covered by FR10 and FR19 integration timing; E2E `chat.spec` asserts arrival within 1 s |
| NFR Readability at narrowest width | E2E at 1024 px (003's minimum width): a wide image is scaled to fit with no horizontal scroll (shared with 003's AC-15) |

## Constitution compliance

1. **Test-first.** Every row above is written as a failing test in the task that implements it. E2E rows that need 003's panes land in tasks after 003's tasks 39–41.
2. **Green before done.** No change: `scripts/check.sh` runs the full suite.
3. **Traceable tests.** The table maps every acceptance criterion in spec.md (FR1–FR19, all 24 Given/When/Then lines) to at least one test; `/sdd-tasks` names them per task.
4. **Real dependencies.** Postgres, Keycloak and the app run for real in integration and E2E. The only fake is the browser `WebSocket` in Vitest, behind the `SocketLike` seam 001 already uses. That fake stands in for the browser API, not an owned service, and the same paths are covered for real in integration and E2E.
5. **Fixed stack.** Python 3.12/FastAPI, PostgreSQL, React/TS strict/Vite, docker compose. No departure. Images live in PostgreSQL rather than on a volume, so compose and backups don't change.
6. **Dependency justification.** One new dependency: **`markdown-it-py`** (backend), a CommonMark parser. The standard library has no Markdown parser, and a hand-written one would be the riskiest code in the feature, since it is the XSS boundary. With raw HTML disabled it emits only its own tags, which is why no separate HTML sanitiser (e.g. `nh3`) is added. No new frontend dependencies: the editor is a `textarea` with text transforms and the preview comes from the server.
7. **No secrets in the repo.** Nothing new is configured. Tests use 001's generated Keycloak credentials.
8. **Lint and format clean.** New code goes through `ruff check`, `ruff format --check`, `biome ci` and `tsc --noEmit` via `scripts/check.sh`.
9. **Module layout and dependency direction.** Stated under *Dependency direction* above.

### For the human reviewer

- **Seam with 003.** 002 builds the backend, client and reusable parts; 003's tasks 39–41 place them; then 002 adds the admin *Remove* action to 003's `ChatPane.tsx` and the end-to-end tests. If you'd rather 002 own the panes, 003's tasks 39–41 need rewriting first.
- **External images are refused on save.** An `![](https://…)` reference is refused (`image_source_not_allowed`). The spec says images are stored with the problem (FR3) and served only as images (NFR Security). Allowing hot-linked images would also expose participants' IP addresses to third parties.
- **Existing databases keep their old one-line starter descriptions.** Only a fresh setup gets the new Markdown ones. This matches FR8's acceptance criterion; say so if you want existing databases updated too.
