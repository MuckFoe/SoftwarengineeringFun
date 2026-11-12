# 020 — Next-step hints from the self-hosted language model: tasks

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6 — all `[P]` | Leaves with no dependency on each other: settings, the fake model, the table and its repo, the pure prompt and guard functions, the frontend contract types. Disjoint files. |
| 2 | 7, 8, 9, 10 — all `[P]` | Each needs one wave-1 piece: the client needs the fake (2), the executed guard needs the pure guard (5), the compose wiring needs settings and the fake (1, 2), the panel needs the types (6). |
| 3 | 11, 12 — all `[P]` | The backend pipeline (needs 1, 3, 4, 7, 8) and the frontend window wiring (needs 6, 10) meet only at the contract in plan.md, so they run side by side. |
| 4 | 13, 14, 15 — all `[P]` | All build on the pipeline of 11 and touch disjoint files: REST read (`api.py`, `main.py`), failure and cold paths (`service.py`), deletion (`deletion/repo.py`, `cancel_runs`). |
| 5 | 16 | Edits the same two files as 14 (`service.py`, `test_ws_hints.py`), so it follows it. |
| 6 | 17, 18 — all `[P]` | Browser-level checks need the whole feature and the E2E stack (9). Both use Playwright and the fake's one-shot cold state: take the Playwright lock. |

## Checklist

- [x] **1** — `[P]` Hint settings in `config.py`
- [x] **2** — `[P]` Fake LLM server and pytest fixture
- [x] **3** — `[P]` `session_hint` migration and `hints/repo.py`
- [x] **4** — `[P]` Prompt builder `hints/prompt.py`
- [x] **5** — `[P]` Guard, pure checks (`hints/guard.py`)
- [x] **6** — `[P]` Frontend contract types and `getHints`
- [x] **7** — `[P]` `LlmClient` (`hints/llm.py`)
- [x] **8** — `[P]` Guard, executed solution check
- [x] **9** — `[P]` Compose and E2E wiring for the model settings and the fake
- [x] **10** — `[P]` `HintsPanel` component
- [x] **11** — `[P]` Hint request pipeline over the session socket
- [x] **12** — `[P]` Session window wiring (active and stale)
- [x] **13** — `[P]` `GET /api/sessions/{invite}/hints`
- [x] **14** — `[P]` Unavailable and cold-model paths
- [x] **15** — `[P]` Delete hints with the session
- [x] **16** — Full hint context, escalation and isolation
- [x] **17** — `[P]` E2E `hints.spec.ts`
- [x] **18** — `[P]` Look matrix entries

## Tasks

### 1. `[P]` Hint settings in `config.py`

- **Plan:** Configuration (settings table); Changes to existing backend modules → `app/config.py`. **Spec:** FR-2, NFR Data stays on the user's network.
- **Files:** `backend/app/config.py`, `backend/tests/unit/test_config.py` (extend)
- **Depends on:** nothing
- **Do:** Add `hint_llm_base_url`, `hint_llm_model`, `hint_llm_api_key` (`repr=False`), `hint_llm_timeout_seconds` (20), `hint_llm_cold_timeout_seconds` (110), `hint_llm_reasoning_effort` (`none`), and the non-env `hint_deadline_seconds` (28) and `hint_cold_deadline_seconds` (118). `load_settings` reads the six `HINTS_LLM_*` variables and validates them. No compose changes here (task 9).
- **Acceptance:**
  - *AC-1 (FR-2) — "Given no model is configured … Then no Hint is shown"*, config half: `HINTS_LLM_BASE_URL` unset or empty → `hint_llm_base_url is None` (hints off).
  - Base URL set without `HINTS_LLM_MODEL` → `ConfigError`.
  - Timeout not positive or not below its deadline → `ConfigError`, for both the loaded and the cold timeout; cold timeout defaults to 110.
  - *NFR Data stays on the user's network / constitution rule 7:* the API key does not appear in `repr(settings)`.

### 2. `[P]` Fake LLM server and pytest fixture

- **Plan:** Fake model for tests. **Spec:** test support for AC-3, AC-8, AC-12, AC-12a, AC-15 (constitution rule 4).
- **Files:** `backend/tests/fakes/fake_llm.py` (new), `backend/tests/conftest.py` (`fake_llm` fixture), `backend/tests/integration/test_fake_llm.py` (new)
- **Depends on:** nothing
- **Do:** Stdlib `ThreadingHTTPServer`, shaped like `fake_giphy.py`. `POST /v1/chat/completions` answers the OpenAI shape and records every request (path, lower-cased headers, JSON body). `GET /api/ps` answers Ollama's shape, loaded or cold. In-process controls: `reply_with(*texts)`, `fail_with(status)`, `delay(seconds)`, `garbage()`, `set_cold(bool)`, `ps_fail_with(status)`, `refuse_connections()`, `accept_connections()`, `reset()`. Note directives when nothing is queued: `fake:slow` (10 s), `fake:error` (500), `fake:solution` (full `def` of the requested function), `fake:markup`, `fake:cold` (answer after about 2 s), otherwise a safe one-step hint cycling through a few fixed texts. `--control-port` with `GET /health`, `GET /requests`, `POST /reset`, `POST /cold` (the next single `/api/ps` call reports cold, then back to loaded). No compose service here (task 9).
- **Acceptance:**
  - A queued reply is returned as `choices[0].message.content`; replies are served in order.
  - Every request is recorded with path, headers and body, both in-process and through `GET /requests`.
  - `delay`, `fail_with`, `garbage` and `refuse_connections` each produce that behaviour; `reset` clears them.
  - `/api/ps` lists the model when loaded, `{"models":[]}` when cold, fails after `ps_fail_with`; `POST /cold` affects exactly one `/api/ps` call.
  - Each note directive gives its answer; two default answers in a row differ.

### 3. `[P]` `session_hint` migration and `hints/repo.py`

- **Plan:** Data model; New backend package → `repo.py`. **Spec:** FR-6, FR-13, FR-15.
- **Files:** `backend/app/migrations/NNNN_session_hint.sql` (next free number; 0013 today — check the folder), `backend/app/hints/__init__.py`, `backend/app/hints/repo.py`, `backend/tests/integration/test_hint_repo.py` (new)
- **Depends on:** nothing
- **Do:** The table exactly as in plan.md's Data model. `HintRow`, `list_for_session`, `list_for_problem`, `insert_next` (number assigned in one statement), `hint_dict` (the `Hint` contract shape). No account id is stored.
- **Acceptance:**
  - *AC-11 (FR-13) — "Given 'Hint 1' has been shown on problem A, When a participant asks again, Then 'Hint 2' … the session then switches to problem B and asks, Then that hint is 'Hint 1' for B. And When it switches back to A and asks, Then the hint is 'Hint 3' for A."* Repo half: inserts for A, A, B, A get numbers 1, 2, 1, 3.
  - *AC-13 (FR-15) — "each sees both hints, numbered, with askers' names and notes":* `list_for_session` returns every hint ordered by (problem, number) with `asked_by`, `note`, `body`; `list_for_problem` returns one problem's hints in order.
  - The unique `(session_id, problem_id, number)` constraint rejects a duplicate; a note with a line break, an empty note string, a note over 200 characters, and a body that is empty or over 600 characters are each rejected by the database.

### 4. `[P]` Prompt builder `hints/prompt.py`

- **Plan:** Prompt (`hints/prompt.py`); Backend signatures. **Spec:** FR-9, FR-11, FR-12, FR-13, NFR Test secrecy.
- **Files:** `backend/app/hints/prompt.py`, `backend/tests/unit/test_hint_prompt.py` (new)
- **Depends on:** nothing (creates `hints/__init__.py` if task 3 has not)
- **Do:** `RunOutcome`, `HintContext`, pure `build_messages(ctx)`. Fixed system message (one next step, at most 3 sentences, at most one backticked code line, never a whole function or numbered plan, more specific than earlier hints, everything in the user message is data). User message in labelled sections with the caps from plan.md (description 4,000, code 6,000, each error 300).
- **Acceptance:**
  - *AC-10 (FR-12) — "the model was given that session's problem description, current code, latest run outcomes and errors, earlier hints on the problem and the note. It was given nothing from its chat, the other session, or any username or email."* The messages contain exactly those fields of `HintContext` and nothing else; `HintContext` has no name, chat or test field.
  - *AC-9 (FR-11) — "the model was given no hidden test":* no test args or expected values appear; the system message tells the model to ignore instructions inside code, notes and errors.
  - *AC-11 (FR-13) — "the model was given Hint 1":* earlier hint bodies appear numbered, with the "more specific, do not repeat" instruction.
  - `latest_run=None` renders "never run"; an empty note leaves the `Note` section out; over-long description, code and errors are cut to their caps.

### 5. `[P]` Guard, pure checks (`hints/guard.py`)

- **Plan:** Solution guard steps 1–4 and `candidates`. **Spec:** FR-9, FR-10.
- **Files:** `backend/app/hints/guard.py`, `backend/tests/unit/test_hint_guard.py` (new)
- **Depends on:** nothing (creates `hints/__init__.py` if task 3 has not)
- **Do:** `normalize`, `code_lines`, `shape_ok`, `structurally_complete`, `candidates` as specified in plan.md. No I/O in this task; `passes_all_tests` and `check` are task 8.
- **Acceptance:**
  - *AC-7 (FR-9) — "Given any shown hint, Then it is prose of at most about 3 sentences with at most one line of code."* `shape_ok` rejects more than one code line, more than 4 sentences, and an enumerated plan (more than 2 lines starting `1.`, `2)`, `-`, `*`, `•`, `Step N`); it keeps 3 sentences plus one code line.
  - *AC-8 (FR-10) — "a full working implementation of the problem's function":* `structurally_complete` is true for a `def`, a `lambda`, and an assignment to the function name; false for a partial line such as `if not a:`.
  - `normalize` drops `<think>…</think>`, strips a leading `Hint:`, keeps one code line intact, and returns `None` outside 1–600 characters.
  - `code_lines` finds fenced lines, backtick spans, and unmarked lines that parse as Python and are more than a lone name or constant.
  - `candidates(signature, L)` yields forms (a) `L`, (b) signature + `L` as body, (c) signature + `return L` when `L` is one expression; unparseable candidates are dropped.

### 6. `[P]` Frontend contract types and `getHints`

- **Plan:** Contracts (WebSocket, REST); Frontend → `api/types.ts`, `api/client.ts`. **Spec:** FR-5, FR-6, FR-15.
- **Files:** `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts` (extend)
- **Depends on:** nothing
- **Do:** `Hint`, `HintPending`; `hint_started`, `hint_warming`, `hint_ready`, `hint_failed`, `hint_refused` in `ServerMessage`; `HintRequestMessage` in `ClientMessage`; optional `hints_enabled`, `hints`, `hint_pending` on `WelcomeMessage`. `getHints(invite): Promise<{ hints: Hint[] }>`.
- **Acceptance:**
  - *AC-13 (FR-15) — "a signed-in participant reopens the session … Then each sees both hints":* client half: `getHints` requests `GET /api/sessions/{invite}/hints` and returns the hints.
  - `getHints` surfaces 404 `not_found` and 410 `session_deleted` as the client's existing error types.
  - `tsc` passes with the new message types; no existing test changes.

### 7. `[P]` `LlmClient` (`hints/llm.py`)

- **Plan:** New backend package → `llm.py`; Prompt → request body. **Spec:** FR-14, FR-14a, NFR Data stays on the user's network.
- **Files:** `backend/app/hints/llm.py`, `backend/tests/integration/test_hint_llm.py` (new)
- **Depends on:** 2
- **Do:** `LlmUnavailable`, `LlmClient(base_url, model, api_key, reasoning_effort)` on `httpx`. `is_loaded()`: `GET {root}/api/ps` (root = base without `/v1`), 3 s, any error → `True`. `complete(messages, timeout_s)`: one POST to `{base}/chat/completions` with `temperature 0.2`, `max_tokens 250`, `stream false`, and `reasoning_effort` only when non-empty. No retries, no fallback. `aclose()`.
- **Acceptance:**
  - *AC-12 (FR-14) — "Given the model is loaded but unreachable, answers with an error, or takes longer than 30 s":* a timeout, a 500, a refused connection and a 200 with no or empty `choices` each raise `LlmUnavailable`.
  - *AC-15 (NFR Data stays on the user's network) — "it goes only to the configured self-hosted model":* the fake records exactly one request per `complete`, to the configured host only, with `model`, `messages`, `max_tokens`, `reasoning_effort`; no `Authorization` header without a key, `Bearer …` with one; `reasoning_effort` absent when configured empty.
  - *AC-12a (FR-14a) — "Given the model is not loaded":* `is_loaded()` is True when the model is listed, False on an empty list, True when `/api/ps` answers 500, garbage, or the connection is refused; the call goes to the root without `/v1`.

### 8. `[P]` Guard, executed solution check

- **Plan:** Solution guard steps 5–6; `check`. **Spec:** FR-10, FR-11, NFR Test secrecy.
- **Files:** `backend/app/hints/guard.py`, `backend/tests/integration/test_hint_guard_runner.py` (new)
- **Depends on:** 5
- **Do:** `passes_all_tests(runner_url, problem, codes)`: every candidate goes to `runner_client.execute` with all of the problem's tests, concurrently, graded with `grading.grade` and `is_accepted`; raises `RunnerUnavailable`. `check(runner_url, problem, raw)`: normalize → shape → structural → executed (skipped without a code line); returns the shown body or `None`. Nothing is written to `run` or `run_result`. Measure the duration these tests add to pytest and report it.
- **Acceptance:**
  - *AC-8 (FR-10) — "Given a model that answers with a full working implementation of the problem's function, or with a single line that passes every test … Then that answer is not shown":* for `add(a, b)`, the answers `return a + b`, `a + b` and a full `def` → `check` returns `None`; a partial line (`if not a:`) → the body is returned.
  - *AC-8 — "Given the starter problems, When the code line of every shown hint is placed alone into the editor and run, Then it does not pass all tests."* For a fixed sample of 6 starter problems, their `reference.py` single-line bodies and the full reference → `passes_all_tests` is true → withheld.
  - *AC-9 (FR-11) — "no test input, expected value or test information beyond the run results reaches any participant":* after the checks, `run` and `run_result` have no new rows.
  - The added test duration is reported in the task's output (plan: measure first).

### 9. `[P]` Compose and E2E wiring for the model settings and the fake

- **Plan:** Configuration → Compose files, E2E env; Fake model → `docker-compose.test.yml`. **Spec:** FR-1, FR-2 (operator configures or removes the model).
- **Files:** `docker-compose.yml`, `docker-compose.hub.yml`, `docker-compose.test.yml`, `e2e/global-setup.ts`
- **Depends on:** 1, 2
- **Do:** Pass the five `HINTS_LLM_*` variables through in both compose files as `${HINTS_LLM_BASE_URL:-}` and so on, like `GIPHY_*`. Add service `llm` to `docker-compose.test.yml`, the same shape as `giphy`, on `${TEST_LLM_PORT:-58380}` and `${TEST_LLM_CONTROL_PORT:-58381}` with a healthcheck on `/health`. `e2e/global-setup.ts` writes `HINTS_LLM_BASE_URL=http://host.docker.internal:${TEST_LLM_PORT:-58380}/v1`, `HINTS_LLM_MODEL=fake-model`, `HINTS_LLM_TIMEOUT_SECONDS=3`, `HINTS_LLM_COLD_TIMEOUT_SECONDS=6`. No real address or model name is committed.
- **Acceptance:**
  - *AC-1 (FR-1, FR-2) — "Given a model is configured … Given no model is configured":* with the variables unset, `docker compose config` renders them empty for the api service and the api starts (hints off).
  - The kept test stack comes up with `llm` healthy, and `GET /health` answers on the control port.
  - The E2E env file carries the four values above; the existing E2E suite still passes.

### 10. `[P]` `HintsPanel` component

- **Plan:** Frontend → New `frontend/src/hints/HintsPanel.tsx`. **Spec:** FR-1, FR-2, FR-3, FR-5, FR-6, FR-8, FR-14, FR-14a, FR-15, NFR Security, NFR Note length, NFR UI rules.
- **Files:** `frontend/src/hints/HintsPanel.tsx`, `frontend/src/hints/HintsPanel.module.css`, `frontend/src/hints/HintsPanel.test.tsx` (all new)
- **Depends on:** 6
- **Do:** The presentational component with the props in plan.md (`hints`, `canAsk`, `pending`, `notice`, `onAsk`). Existing primitives only (Button secondary, Card, TextField, the visually hidden live-region pattern), tokens only, no animation.
- **Acceptance:**
  - *AC-1 / AC-2 (FR-1–FR-3) — "Then no Hint is shown and the earlier hints are still visible":* `canAsk` false → no "Hint" button, hints still listed; `canAsk` false and no hints → renders nothing.
  - *AC-3 (FR-5, FR-6) — "both see 'preparing hint' with the guest's name … a hint labelled as a model hint, numbered 'Hint 1', with the guest's name and the note":* `pending` shows the preparing line with `by`; each hint shows "Model hint", "Hint N", asker and note.
  - *AC-6 (FR-8):* the "Hint" button is disabled while `pending` is set; `notice="in_progress"` shows that a hint is already being prepared.
  - *AC-4 (FR-5) — "leaves the note empty … shown without a note. And … longer than 200 characters or containing a line break … refused or cut":* the field has `maxLength` 200, Enter sends, line breaks are stripped before `onAsk`, a hint with `note: null` shows no note.
  - *AC-12 (FR-14) / AC-8 (FR-10):* `notice` "unavailable" → "Hints are unavailable right now"; "withheld" → "No hint could be given this time".
  - *AC-12a (FR-14a):* `pending.warming` → "Model is warming up. This hint takes longer.", announced once.
  - *AC-15 (NFR Security) — "shown as inert text and nothing runs":* a body with `<img …>` markup renders as text; no `img` element exists.
  - *AC-16 (NFR UI rules) — "Hint has a visible focus ring and an accessible name. 'Preparing' and the hint's arrival are each announced politely once":* role and name queries find the controls; keyboard path Tab to "Hint", Enter, type, Enter sends, Escape cancels and returns focus; the live region announces each state change exactly once.

### 11. `[P]` Hint request pipeline over the session socket

- **Plan:** The request pipeline (`request` steps 1–4, `_produce` steps 1–5 on the loaded path); Changes to existing backend modules → `main.py` lifespan, `sessions/ws.py` (`hint_request`, `welcome`). **Spec:** FR-1, FR-2, FR-3, FR-5, FR-6, FR-7, FR-8, FR-10, FR-15, NFR Security.
- **Files:** `backend/app/hints/service.py` (new), `backend/app/sessions/ws.py`, `backend/app/main.py` (lifespan only), `backend/tests/integration/test_ws_hints.py` (new), `backend/tests/unit/test_hint_guard.py` (note-normalization cases)
- **Depends on:** 1, 3, 4, 7, 8
- **Do:** `normalize_note`, `request` (refuse `disabled` / `stale` / `problem_deleted` / `in_progress` to the sender; reserve `_HINTING` with no `await` between check and add; broadcast `hint_started`; spawn the task), `pending`, `cancel`, `drain`. `_produce` on its own pool connection: context from the problem, current shared code and the note (latest run and earlier hints come in task 16), `llm.complete`, `guard.check`, `repo.insert_next`, broadcast `hint_ready`; `hint_failed unavailable` on `LlmUnavailable`, `hint_failed withheld` on a guard rejection; `finally` releases the reservation. `ws.py`: the `hint_request` branch and `hints_enabled`, `hints`, `hint_pending` in `welcome`. `main.py`: `app.state.hint_llm` when configured else `None`; on shutdown `drain()` then `aclose()` before the pool closes. Deadlines and the cold check are task 14; `cancel_runs` is task 15.
- **Acceptance:**
  - *AC-1 (FR-1, FR-2):* `welcome.hints_enabled` is true with a model configured and false without; a `hint_request` without one gets `hint_refused disabled`.
  - *AC-3 (FR-5, FR-6) — "When the guest activates Hint and enters the note 'stuck on empty input', Then both see 'preparing hint' with the guest's name. Within 30 s both see a hint … numbered 'Hint 1', with the guest's name and the note."* Two clients, one a guest: both get `hint_started` with `by` and note, then `hint_ready` with `number: 1`.
  - *AC-4 (FR-5):* an empty note → `note: null`; `normalize_note` keeps the first line, cuts 201 characters to 200, and turns an empty note into `None`.
  - *AC-5 (FR-7) — "When runs fail repeatedly, Then no hint appears. And Given a session that has never run its code, When a participant asks, Then a hint is given."* Failed runs and no request → no `hint_*` message; a request with no runs → `hint_ready`.
  - *AC-6 (FR-8) — "When any participant, or a direct request to the server, asks for another, Then no second request is made and the asker is told a hint is already being prepared. And When the first hint arrives, Then Hint can be used again at once (no cooldown), and a tenth or later hint on the same problem is still given."* A second request while pending → `hint_refused in_progress` with `by`, to the sender only, and the fake received exactly one request; asking again right after `hint_ready` works; a 10th hint is given.
  - *AC-8 (FR-10) — "that answer is not shown, the session is told no hint could be given this time, no hint number is used, and the shared code is unchanged":* a `fake:solution` answer → `hint_failed withheld` to both, no row, shared code unchanged, and the next hint is still "Hint 1".
  - *AC-13 (FR-15) — "When a participant reloads, a new participant joins … Then each sees both hints … And Given the server restarts, Then they are still there."* A reconnect's `welcome.hints` holds both; a new app instance on the same database still serves them; a late joiner during preparation gets `welcome.hint_pending`.
  - *AC-15 (NFR Security) — "shown as inert text … the shared editor is unchanged":* a markup answer is stored and broadcast verbatim as text; the shared code is unchanged after a hint with a code line.
  - *AC-2 (FR-3):* a request on a stale session or a deleted current problem → `hint_refused stale` / `problem_deleted`, nothing broadcast.

### 12. `[P]` Session window wiring (active and stale)

- **Plan:** Frontend → `components/SessionInspector.tsx`, `pages/SessionWindow.tsx`. **Spec:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-8, FR-13, FR-14, FR-14a, FR-15, NFR UI rules.
- **Files:** `frontend/src/components/SessionInspector.tsx`, `frontend/src/pages/SessionWindow.tsx`, `frontend/src/pages/SessionWindow.test.tsx` (extend)
- **Depends on:** 6, 10
- **Do:** `SessionInspector` gets an optional `hints?: ReactNode`, rendered in the Description section below `DescriptionPane`. `Joined` gains `hints`, `hintsEnabled`, `hintPending`, `hintNotice`; handlers for `hint_started`, `hint_warming`, `hint_ready`, `hint_failed`, `hint_refused`; `problem_switched` clears the notice; `onAsk` sends `{type: "hint_request", note}`. `StaleWindow` calls `getHints(invite)` and renders `HintsPanel` with `canAsk={false}` for its problem. Coding session window only. Take the `/run` visual look that constitution-ui D asks for at the UI tasks.
- **Acceptance:**
  - *AC-1 (FR-1, FR-2, FR-4) — "Then Hint is shown beside the current problem … Given no model is configured … no Hint is shown":* `hints_enabled: true` → the button is in the Description section; `hints_enabled: false` or absent → no button.
  - *AC-2 (FR-3) — "Given a stale coding session with earlier hints, or a coding session whose current problem was deleted … no Hint is shown and the earlier hints are still visible":* the stale window shows `getHints` results read-only; a deleted current problem → no button, hints listed.
  - *AC-3 / AC-6 (FR-5, FR-6, FR-8):* `hint_started` → preparing line with the asker; `hint_ready` → the hint appears; `hint_refused in_progress` → the "already being prepared" notice; asking sends `hint_request` with the note.
  - *AC-11 (FR-13) — "switches to problem B … 'Hint 1' for B … switches back to A":* a welcome with hints for two problems shows only the current problem's; `problem_switched` shows the other problem's hints.
  - *AC-12 / AC-12a (FR-14, FR-14a):* `hint_failed` shows the matching notice and re-enables "Hint"; `hint_warming` switches the pending line to warming-up.

### 13. `[P]` `GET /api/sessions/{invite}/hints`

- **Plan:** Contracts → REST; New backend package → `api.py`; `main.py` `include_router`. **Spec:** FR-3, FR-15.
- **Files:** `backend/app/hints/api.py` (new), `backend/app/main.py` (`include_router`), `backend/tests/integration/test_hints_api.py` (new)
- **Depends on:** 3, 11 (both edit `main.py`)
- **Do:** The route returns `200 {"hints": Hint[]}` for an active or stale session, and 410 `session_deleted` or 404 `not_found` through `sessions.api.missing_invite`. No auth beyond the invite, the same as `GET …/chat`.
- **Acceptance:**
  - *AC-2 (FR-3) — "Given a stale coding session with earlier hints … the earlier hints are still visible":* `GET …/hints` on a stale session returns its hints.
  - *AC-13 (FR-15) — "Given the session later goes stale, Then they are still shown, read-only":* the response has every hint by (problem, number) with asker and note; the route offers no write method.
  - Unknown invite → 404 `not_found`; deleted session → 410 `session_deleted`.

### 14. `[P]` Unavailable and cold-model paths

- **Plan:** The request pipeline → `_produce` step 0 (cold check), deadlines, fail-closed guard. **Spec:** FR-14, FR-14a, NFR Responsiveness, NFR Isolation from failure.
- **Files:** `backend/app/hints/service.py`, `backend/tests/integration/test_ws_hints.py` (extend)
- **Depends on:** 11
- **Do:** `await llm.is_loaded()` first. Loaded (or `/api/ps` failed): `hint_llm_timeout_seconds` inside `asyncio.timeout(hint_deadline_seconds)`. Cold: set `_HINTING[session].warming = True`, broadcast `hint_warming {problem_id}` at once, then `hint_llm_cold_timeout_seconds` inside `asyncio.timeout(hint_cold_deadline_seconds)`. A timeout anywhere → `hint_failed unavailable`; a runner failure or the deadline running out during the guard → `hint_failed withheld` (fail closed). No keep-alive, no warm-up call. Tests shrink the timeouts through `Settings`; none waits 30 s.
- **Acceptance:**
  - *AC-12 (FR-14) — "Given the model is loaded but unreachable, answers with an error, or takes longer than 30 s, When a participant asks for a hint, Then within 30 s everyone in the session sees that hints are unavailable right now. No hint is numbered or stored, Hint can be used again, and editing, runs and chat keep working for everyone."* Fake delay, 500 and refused connection → `hint_failed unavailable` to both clients within the shrunk deadline, no row, a new request is accepted; while a hint is pending, a chat message and a Yjs update from another client round-trip; with the fake loaded, no `hint_warming` is sent.
  - *AC-12a (FR-14a) — "Given the model is not loaded, When a participant asks for a hint, Then within 5 s everyone in the session sees that the model is warming up … When the model answers within 2 minutes, Then everyone sees the hint as usual; And When it does not, Then everyone sees that hints are unavailable right now."* Fake cold: both clients get `hint_warming` before the completion is answered, then `hint_ready` "Hint 1"; cold with a delay beyond the shrunk cold timeout → `hint_warming`, then `hint_failed unavailable`, no row; a delay longer than the loaded timeout but shorter than the cold one still gives a hint; `/api/ps` failing → loaded path, no `hint_warming`; a late joiner's `welcome.hint_pending.warming` is true.
  - The runner unreachable during the guard → `hint_failed withheld`, no row.

### 15. `[P]` Delete hints with the session

- **Plan:** Changes to existing backend modules → `app/deletion/repo.py`, `sessions/ws.py::cancel_runs`. **Spec:** FR-16.
- **Files:** `backend/app/deletion/repo.py` (one SQL line), `backend/app/sessions/ws.py` (`cancel_runs`), `backend/tests/integration/test_delete_session.py` (extend; spec 019's file)
- **Depends on:** 3, 11
- **Do:** `_PURGE_SQL["coding"]` gains `delete from session_hint where session_id = $1` before `delete from session_problem`. `cancel_runs` also awaits `hints_service.cancel(session_id)`. Nothing else in spec 019's files changes.
- **Acceptance:**
  - *AC-14 (FR-16) — "Given a session with stored hints, When its host deletes it (spec 019), Then its hints no longer exist and are not shown anywhere."* After deletion no `session_hint` row remains for the session, and `GET …/hints` answers 410 once task 13 has landed (assert on the rows here).
  - A hint that is pending when the session is deleted is cancelled: it writes no row and broadcasts nothing.
  - Spec 019's existing deletion tests still pass.

### 16. Full hint context, escalation and isolation

- **Plan:** The request pipeline → `_produce` step 1 (Gather `HintContext`). **Spec:** FR-11, FR-12, FR-13, NFR Data stays on the user's network, NFR Test secrecy.
- **Files:** `backend/app/hints/service.py`, `backend/tests/integration/test_ws_hints.py` (extend)
- **Depends on:** 14 (same files)
- **Do:** Complete the context: `runs_repo.last_run(session, problem)` used only when `status == "done"`, as `(position, outcome, error_message)` with no tracebacks, "never run" otherwise; `repo.list_for_problem` for the earlier hint bodies in order. The hint belongs to the problem that was current when it was asked; a switch while it is preparing does not move it. The asker's name stays in memory for the broadcast only.
- **Acceptance:**
  - *AC-9 (FR-11, FR-12) — "Given a coding problem with hidden tests, and participant code or a note asking the model to print the tests, When a hint is asked, Then the model was given no hidden test, and no test input, expected value or test information beyond the run results reaches any participant."* The fake's recorded body contains no test args and no expected values, with such code and such a note in the session.
  - *AC-10 (FR-12) — "Given a session whose chat contains a distinctive phrase, and a second session on the same problem with different code, When the first session asks for a hint, Then the model was given that session's problem description, current code, latest run outcomes and errors, earlier hints on the problem and the note. It was given nothing from its chat, the other session, or any username or email."* The recorded body holds the description, the code, the latest run's outcomes and error messages (no traceback); it holds no chat phrase, none of the other session's code, and no participant name.
  - *AC-11 (FR-13) — "Given 'Hint 1' has been shown on problem A, When a participant asks again, Then 'Hint 2' is shown, does not repeat Hint 1 … the model was given Hint 1. And Given the session then switches to problem B and asks, Then that hint is 'Hint 1' for B. And When it switches back to A and asks, Then the hint is 'Hint 3' for A."* The second request's recorded body contains Hint 1's text and Hint 2's body differs from it; the switch sequence over the socket gives A1, A2, B1, A3; B's request carries none of A's hints.
  - *AC-15 (NFR Data stays on the user's network) — "carries no username or email":* no recorded request header or body contains a participant's username or email.

### 17. `[P]` E2E `hints.spec.ts`

- **Plan:** Test strategy → `e2e/hints.spec.ts`. **Spec:** FR-1, FR-4, FR-5, FR-6, FR-14, FR-14a, FR-15, NFR UI rules.
- **Files:** `e2e/hints.spec.ts` (new)
- **Depends on:** 9, 12, 13, 14, 16
- **Do:** Playwright against the kept E2E stack with the fake model. The cold case calls `POST /cold` on the control port first and runs under the Playwright lock for shared fakes (or in a serial describe). Reuse the existing session, guest and window helpers.
- **Acceptance:**
  - *AC-3 (FR-5, FR-6) — "Given an active coding session with a signed-in participant and a guest who joined by invite link, When the guest activates Hint and enters the note 'stuck on empty input', Then both see 'preparing hint' with the guest's name. Within 30 s both see a hint labelled as a model hint, numbered 'Hint 1', with the guest's name and the note."*
  - *AC-13 (FR-15) — "When a participant reloads … Then each sees both hints":* after a reload the hint is still shown.
  - *AC-12 (FR-14):* note `fake:slow` → "Hints are unavailable right now" within the 3 s E2E timeout, and "Hint" is usable again.
  - *AC-12a (FR-14a):* `POST /cold`, note `fake:cold` → the warming-up line shows, then "Hint N" about 2 s later.
  - *AC-16 (NFR UI rules) — "When a keyboard-only user moves to Hint, enters a note, sends it and a hint arrives … nothing overflows horizontally":* the keyboard-only path works with a visible focus ring; at 390 px the page has no horizontal overflow.
  - *AC-1 (FR-4) — "When they open a learning, presentation or chess session, Then no Hint is shown":* one assertion per window type.

### 18. `[P]` Look matrix entries

- **Plan:** Test strategy → `e2e/audi/matrix.ts`. **Spec:** NFR UI rules (spec UI checklist: look matrix entry).
- **Files:** `e2e/audi/matrix.ts` (extend)
- **Depends on:** 9, 12, 14
- **Do:** Entries "session hints" (two hints shown, note field open), "session hint preparing" (`fake:slow` note), "session hint warming up" (`POST /cold` + note `fake:slow`, captured while the warming-up line shows), "session hint unavailable". The warming-up entry uses the fake's one-shot cold state: take the Playwright lock.
- **Acceptance:**
  - *AC-16 (NFR UI rules) — "Given the coding session window at ≈390 px and at ≥1024 px, in light and dark, with reduced motion … nothing animates under reduced motion, and nothing overflows horizontally."* Each of the four entries is captured in light and dark, at the listed widths plus narrow, and under reduced motion, and the matrix run passes.
