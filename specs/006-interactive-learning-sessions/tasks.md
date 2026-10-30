# 006 — Interactive learning sessions: tasks

Every task ticks only when `scripts/check.sh` passes with no existing test file edited (AC-29, NFR-5). New tests name their AC in the docstring / test title.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 — all `[P]` | Leaves with no dependencies: schema, pure backend modules, additive edits to shared code, pure/presentational frontend pieces |
| 2 | 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 — all `[P]` | Need only wave-1 pieces: loader (schema + validator), repo (schema), views (validator + checks + renderer), lesson content (validator), socket client (chat transport), StepView (Terminal), LearnWindow (stale list + nav) |
| 3 | 21, 22, 23 — all `[P]` | Startup wiring needs the loader; the service needs repo + views + checks; the session window needs every frontend piece |
| 4 | 24 | REST needs wiring, repo, views and the real lessons |
| 5 | 25 | WebSocket needs the REST router in place and the service |
| 6 | 26, 27, 28 — all `[P]` | Stale handling, restart/versioning tests and the content run-through all drive the session over the WebSocket |
| 7 | 29 | Chat edits `api.py` and `ws.py` after 26 is done with `api.py` |
| 8 | 30, 31 — all `[P]` | End-to-end checks against the whole stack |

## Checklist

- [x] **1** — `[P]` Migration 0004: learning tables
- [x] **2** — `[P]` `lesson_file.py`: parse and validate one lesson file
- [x] **3** — `[P]` `checks.py`: judge quiz answers and terminal commands
- [x] **4** — `[P]` `render_description` gains an `image_src` resolver
- [x] **5** — `[P]` `useChat` takes a minimal transport instead of `CollabProvider`
- [x] **6** — `[P]` `StaleSessionsList` gains `endpoint` and `sessionPath` props
- [x] **7** — `[P]` `AreaNav`: Problems / Learn entries in both windows
- [x] **8** — `[P]` `learnState.ts`: pure reducer over server messages
- [x] **9** — `[P]` `Terminal.tsx`: simulated terminal
- [x] **10** — `[P]` `CompletionSummary.tsx`
- [x] **11** — `[P]` `loader.py`: load, version and store lessons and assets
- [x] **12** — `[P]` `repo.py`: SQL for every learn table
- [x] **13** — `[P]` `views.py`: wire shapes that hide answers before a step passes
- [x] **14** — `[P]` Docker lessons 1–2 (Basics; Ports, volumes and networks)
- [x] **15** — `[P]` Docker lessons 3–4 (Building images; Docker Compose)
- [x] **16** — `[P]` Tailscale lessons 1–2 (Basics; MagicDNS and sharing)
- [x] **17** — `[P]` Tailscale lessons 3–4 (ACLs and tags; Exit nodes and subnet routers)
- [x] **18** — `[P]` `learnSocket.ts`: WebSocket client and message types
- [x] **19** — `[P]` `StepView.tsx`: explanation, quiz, terminal; current or looked-back
- [x] **20** — `[P]` `LearnWindow.tsx` and the `/learn` route
- [x] **21** — `[P]` Startup wiring: load lessons in `_migrate_and_seed`, ship `lessons/` in the image
- [x] **22** — `[P]` `service.py`: create, join, submit, continue, hint, show answer, complete
- [x] **23** — `[P]` `LearningSessionWindow.tsx` and the `/learn/s/:invite` route
- [x] **24** — REST `/api/learn`: topics, start, state, record, assets
- [x] **25** — WebSocket `/api/learn/sessions/{invite}/ws`
- [x] **26** — `[P]` Stale learning sessions: marking, reactivation, admin list
- [x] **27** — `[P]` Restart and lesson-change survival tests
- [x] **28** — `[P]` Starter-set content test: every lesson completable, subjects covered
- [x] **29** — Learning-session chat
- [x] **30** — `[P]` E2E: Learn navigation, group latency, keyboard terminal, accessibility
- [x] **31** — `[P]` E2E (hub only): memory and process budget

## Tasks

### 1. `[P]` Migration 0004: learning tables

- **Plan:** Data model — `0004_learning_sessions.sql`. **Spec:** FR-25, FR-28, NFR-6.
- **Files:** `backend/app/migrations/0004_learning_sessions.sql`, `backend/tests/integration/test_learn_schema.py`
- **Depends on:** nothing
- **Do:** Create `lesson_asset`, `lesson_version`, `lesson`, `learning_session`, `learning_participant`, `learning_step`, `learning_attempt`, `learning_chat_message` and their indexes exactly as in plan.md. No cascades, no deletes.
- **Acceptance:**
  - Migration applies on a fresh DB after 0001–0003 and on a DB already at 0003; existing tables are untouched (NFR-5).
  - Constraints hold: `learning_step` rejects `passed_at` without `passed_by_name`; `learning_chat_message` rejects a 2001-character body and `removed_at` without `removed_by_sub`; `lesson_version (lesson_key, content_hash)` is unique; `lesson_asset.media_type` rejects anything but PNG/JPEG/GIF/WebP.

### 2. `[P]` `lesson_file.py`: parse and validate one lesson file

- **Plan:** Lesson files; Validation. **Spec:** FR-4, FR-5, FR-16, FR-17, FR-19, FR-20.
- **Files:** `backend/app/learn/__init__.py`, `backend/app/learn/lesson_file.py`, `backend/tests/unit/test_lesson_file.py`
- **Depends on:** nothing
- **Do:** Pure `parse_lesson(path) → Lesson` and `parse_topic(path) → Topic` using `tomllib`; dataclasses for lesson, steps (explanation/quiz/terminal) and checks (choice/text/terminal, accept list with outputs, optional responses), optional `hint`. Every rule in plan.md's validation list raises `LessonError(path, problem)`. Image references in body/hint are collected and checked to be files in the lesson folder with a PNG/JPEG/GIF/WebP type.
- **Acceptance:**
  - *AC-5 (FR-5) — Given a lesson file with a quiz that has no correct answer, when it is parsed, then it is refused and the error names that file and the missing answer.* One unit case per validation rule (missing field, wrong type, no steps, unknown kind/check type, quiz without choice/text check, terminal without terminal check, choice <2 options / no correct / out of range / duplicate / several correct with `multiple=false`, blank text accept, terminal without accept or with blank command, a normalised command in both accept and responses or twice, missing or wrong-type image, `minutes` < 1, topic folder without `topic.toml` title), each asserting file path and problem in the message.
  - The plan.md example lesson parses into the expected structure.

### 3. `[P]` `checks.py`: judge quiz answers and terminal commands

- **Plan:** Checks (`checks.py`, pure). **Spec:** FR-16, FR-17, FR-19, FR-20, FR-21, FR-22, FR-23, NFR-4.
- **Files:** `backend/app/learn/checks.py`, `backend/tests/unit/test_checks.py`
- **Depends on:** nothing (takes plain data; does not import `lesson_file`)
- **Do:** `normalise_command`, `judge_command → Accepted(output) | KnownMistake(output) | Unavailable(text)`, `normalise_text`, `judge_text`, `judge_choice`, as in plan.md. Add the unit test that no module under `app/learn/` imports `subprocess`, `os`, `pty` or `shlex` (it scans the package's source, so it keeps guarding later tasks).
- **Acceptance:**
  - *AC-15 (FR-16) — Given correct options B and D, when B and D are submitted, then it passes; only B, or B, C and D, then it doesn't.*
  - *AC-16 (FR-17) — Given a text quiz accepting "container", "  Container " passes; "containers" doesn't.*
  - *AC-18/19/20 (FR-19–21)* — `docker ps` → `Accepted` with the lesson output; `docker ls` listed as a response → `KnownMistake` with its output; `rm -rf /` → `Unavailable` with text `rm: not available in this exercise`.
  - *AC-21 (FR-22) — Given `docker run -p 8080:80 nginx` is accepted, `  docker  run -p 8080:80   nginx ` passes; `docker run -p 8080:80 NGINX` and `docker run nginx -p 8080:80` don't.*
  - *AC-22 (FR-23, NFR-4)* — unit: `learn/` imports no process/shell module.

### 4. `[P]` `render_description` gains an `image_src` resolver

- **Plan:** Wiring — `app.problems.markdown.render_description` optional `image_src`. **Spec:** FR-2 (lesson bodies with images), NFR-4, NFR-5.
- **Files:** `backend/app/problems/markdown.py`, `backend/tests/unit/test_markdown_image_src.py`
- **Depends on:** nothing
- **Do:** Add keyword-only `image_src: Callable[[str], str | None]`; default keeps today's `/api/images/<uuid>` rule. A `None` from the resolver refuses the image the same way an off-rule image is refused today. Raw HTML stays off.
- **Acceptance:**
  - Existing `test_markdown.py` passes unchanged (AC-29, NFR-5).
  - With a lesson resolver: a lesson asset maps to `/api/learn/assets/<sha256>`; `/api/images/…` and external URLs are refused.
  - *AC-28 (NFR-4)* — `<b>hi</b>` in a body is not rendered as a `<b>` element.

### 5. `[P]` `useChat` takes a minimal transport instead of `CollabProvider`

- **Plan:** Frontend — `useChat` transport interface. **Spec:** FR-29, NFR-5.
- **Files:** `frontend/src/chat/useChat.ts`, `frontend/src/chat/useChatTransport.test.tsx`
- **Depends on:** nothing
- **Do:** Define `ChatTransport` (send a JSON message, subscribe to JSON messages) with only what `useChat` uses from `CollabProvider`; `useChat` accepts it. `CollabProvider` satisfies it structurally; no coding-session call site changes.
- **Acceptance:**
  - Existing `useChat.test.tsx`, `ChatPane.test.tsx` and `SessionWindow.test.tsx` pass unchanged; `tsc` passes with the existing call sites untouched.
  - New test: a plain fake transport drives `useChat` (send produces `chat_send`, an incoming `chat_message` appears, `chat_removed` removes it).

### 6. `[P]` `StaleSessionsList` gains `endpoint` and `sessionPath` props

- **Plan:** Frontend — `StaleSessionsList` optional props. **Spec:** FR-27, NFR-5.
- **Files:** `frontend/src/components/StaleSessionsList.tsx`, `frontend/src/components/StaleSessionsList.props.test.tsx`
- **Depends on:** nothing
- **Do:** Optional `endpoint` (default `/api/sessions/stale`) and `sessionPath` (default `/s/`); the list fetches from `endpoint` and links to `sessionPath + invite_id`.
- **Acceptance:**
  - Existing `StaleSessionsList.test.tsx` passes unchanged.
  - With `endpoint="/api/learn/sessions/stale"` and `sessionPath="/learn/s/"`, it fetches that endpoint and links rows to `/learn/s/<invite>`.

### 7. `[P]` `AreaNav`: Problems / Learn entries in both windows

- **Plan:** Frontend — `src/components/AreaNav.tsx`. **Spec:** FR-1, NFR-1.
- **Files:** `frontend/src/components/AreaNav.tsx`, `frontend/src/components/AreaNav.test.tsx`, `frontend/src/pages/ProblemsWindow.tsx`
- **Depends on:** nothing
- **Do:** Sidebar navigation with *Problems* (`/`) and *Learn* (`/learn`), current entry marked (`aria-current`), spec 003 look. Place it in `ProblemsWindow`'s sidebar (the session window's sidebar gets it only if it already has a nav slot; otherwise leave `SessionWindow` untouched, NFR-5). `LearnWindow`/`LearningSessionWindow` use it in tasks 20 and 23.
- **Acceptance:**
  - *AC-1 (FR-1) — Given the app is running, when anyone opens it, then the main navigation has a Learn entry.* Vitest: `AreaNav` renders a *Learn* link to `/learn`; `ProblemsWindow` shows it.
  - Existing `ProblemsWindow.test.tsx` passes unchanged.

### 8. `[P]` `learnState.ts`: pure reducer over server messages

- **Plan:** Frontend behaviour — `learnState.ts`; Wire shapes. **Spec:** FR-9, FR-10, FR-11, FR-12, FR-13, FR-14a, FR-15, FR-24.
- **Files:** `frontend/src/learn/learnTypes.ts`, `frontend/src/learn/learnState.ts`, `frontend/src/learn/learnState.test.ts`
- **Depends on:** nothing
- **Do:** Wire types from plan.md (`LessonOutline`, `StepView`, `Answer`, `Attempt`, `Summary`, `Record`, server messages) in `learnTypes.ts`. Reducer keeps `current`, `passed[]`, `participants`, `viewing`, `completed`, `summary`. Handles `welcome`, `presence`, `attempt`, `hint_revealed`, `answer_revealed`, `step_passed`, `completed`, `error`, plus a local `view_step` action.
- **Acceptance:**
  - *AC-9 (FR-9)* — `welcome` with current = 3 and steps 0–2 passed yields current 3, three passed steps, participants.
  - *AC-10 (FR-10, FR-11)* — `step_passed` moves `current`; `viewing` follows only if it was on the current step.
  - *AC-13a (FR-14a)* — `attempt` with `show_answer_available=true` sets it on the current step; `answer_revealed` stores the answer; step stays current.
  - *AC-14 (FR-15)* — `view_step` to a passed step doesn't change `current`.
  - *AC-23 (FR-24)* — `completed` stores the summary and marks completed.

### 9. `[P]` `Terminal.tsx`: simulated terminal

- **Plan:** Frontend behaviour — `Terminal.tsx`. **Spec:** FR-18, FR-12, NFR-1, NFR-4.
- **Files:** `frontend/src/learn/Terminal.tsx`, `frontend/src/learn/Terminal.module.css`, `frontend/src/learn/Terminal.test.tsx`
- **Depends on:** nothing
- **Do:** Props: prompt, history (attempts), `onSubmit(command)`, `disabled`. `role="log"` `aria-live="polite"` scrollable history with `tabIndex=0`, one `<pre>` per entry (`name $ command`, then output); labelled `<input>` with the prompt; Enter submits and clears; ↑/↓ recall own previous commands; input is local state only. Everything rendered as text.
- **Acceptance:**
  - *AC-17 (FR-18) — when A types without submitting, B doesn't see it; when A submits, it's in the shared history with A's name and output.* Vitest: typing calls nothing; Enter calls `onSubmit` once with the typed text and clears the input; history entries show name, command and output.
  - *AC-27 (NFR-1)* — Vitest: Tab order is history then input; ↑/↓ recall works; `disabled` disables the input.
  - *AC-28 (NFR-4)* — an entry `<b>hi</b>` renders as literal text, no `<b>` element.

### 10. `[P]` `CompletionSummary.tsx`

- **Plan:** Frontend — `CompletionSummary.tsx`. **Spec:** FR-24.
- **Files:** `frontend/src/learn/CompletionSummary.tsx`, `frontend/src/learn/CompletionSummary.test.tsx`
- **Depends on:** nothing (uses the `Summary` shape from plan.md; imports `learnTypes.ts` if task 8 has landed, else defines it there)
- **Do:** Table of steps with title, attempt count, who passed it, and a marker when passed after the answer was revealed.
- **Acceptance:**
  - *AC-23 (FR-24) — every participant sees a completion summary listing each step, its attempt count and who passed it.* Vitest renders all three per step, and the revealed marker when `after_reveal`.

### 11. `[P]` `loader.py`: load, version and store lessons and assets

- **Plan:** Wiring (loader); Versioning (FR-28). **Spec:** FR-2, FR-4, FR-5, FR-28.
- **Files:** `backend/app/learn/loader.py`, `backend/tests/integration/test_learn_loader.py`, `backend/tests/integration/fixtures/lessons*/` (valid set, a changed set, an invalid set)
- **Depends on:** 1, 2
- **Do:** `load_lessons(conn, lessons_dir)`: parse every topic/lesson in folder-name order; if any fails, raise its `LessonError` and write nothing. Otherwise, in one transaction: insert assets by SHA-256 (content-addressed), build each snapshot (canonical JSON, image refs → SHA-256), insert a `lesson_version` when `(lesson_key, content_hash)` is new, upsert `lesson` with `current_version_id`, and set `current_version_id = null` for lessons whose folder is gone.
- **Acceptance:**
  - *AC-4 (FR-4) — Given a lesson file is added and the app reloaded, then the new lesson is listed.* Loading the valid set, then a set with one more lesson, adds it to `lesson` with a version.
  - *AC-5 (FR-5)* — the invalid set raises `LessonError` naming the file and problem, and no `lesson*` row is written.
  - *FR-28* — reloading an unchanged set inserts no new version; changing a step inserts a second version and moves `current_version_id`; the first version and its assets remain; a removed lesson has `current_version_id = null` and its versions remain.

### 12. `[P]` `repo.py`: SQL for every learn table

- **Plan:** Architecture — `repo.py`; Data model. **Spec:** FR-6, FR-11, FR-12, FR-13, FR-14a, FR-24, FR-25.
- **Files:** `backend/app/learn/repo.py`, `backend/tests/integration/test_learn_repo.py`
- **Depends on:** 1
- **Do:** Functions for: list current lessons with topic; fetch a version; insert/fetch session by invite; insert participant, mark left; ensure/fetch `learning_step` rows; insert/list attempts per step; count wrong attempts on a step; set hint/answer revealed; mark passed and advance with `where current_step = $step` (returns whether it advanced); set `completed_at`; touch `last_activity_at`; fetch asset. Chat and stale SQL belong to tasks 29 and 26.
- **Acceptance:**
  - Round-trips for each function against real PostgreSQL.
  - The guarded advance updates once: a second call with the same `step` reports no advance and changes nothing (race rule in Service flow).
  - Wrong-attempt count counts only incorrect attempts on that step (FR-14a).

### 13. `[P]` `views.py`: wire shapes that hide answers before a step passes

- **Plan:** Wire shapes (`views.py`). **Spec:** FR-9, FR-14, FR-14a, FR-15, FR-24, NFR-4.
- **Files:** `backend/app/learn/views.py`, `backend/tests/unit/test_views.py`
- **Depends on:** 2, 3, 4
- **Do:** Pure builders: `lesson_outline`, `step_view` (the only place a step becomes wire data), `answer`, `attempt`, `summary`, `record`. `body_html`/`hint_html` through `render_description` with a resolver allowing only the version's assets. `hint_html` only once revealed; `answer` only once revealed or passed (terminal: first accepted command and output); `show_answer_available` = ≥3 wrong and not revealed; never `accept`/`responses`/`correct` otherwise.
- **Acceptance:**
  - *AC-13 (FR-14) — Given a quiz or terminal step not yet passed, the correct answer and accepted commands are not in what is sent.* For each check type, the serialised unpassed `StepView` JSON contains no accepted text, correct option set, accepted command, its output, or response.
  - *AC-13a (FR-14a)* — with 2 wrong attempts `show_answer_available=false`, with 3 `true`, after reveal `false` and `answer` present; `passed.after_reveal` true when revealed before passing.
  - *AC-14 (FR-15)* — a passed step's view includes the answer and all attempts.
  - *AC-28 (NFR-4)* — attempt text `<b>hi</b>` is carried verbatim as data.

### 14. `[P]` Docker lessons 1–2

- **Plan:** Lesson files (`lessons/01-docker/`). **Spec:** FR-3.
- **Files:** `lessons/01-docker/topic.toml`, `lessons/01-docker/01-basics/lesson.toml`, `lessons/01-docker/02-ports-volumes-networks/lesson.toml` (+ any images in those folders)
- **Depends on:** 2
- **Do:** Topic *Docker*. (1) *Basics*: images vs containers, `run`, `ps`, `stop`, `rm`, `logs`, `exec`. (2) *Ports, volumes and networks*: port publishing, bind mounts and volumes, user-defined networks. Mix explanation, quiz and terminal steps; hints where useful; common mistakes as `responses`. Realistic but static outputs.
- **Acceptance:**
  - Both files pass `parse_lesson` (a unit test that parses every file under `lessons/` is added here if not present: `backend/tests/unit/test_lessons_valid.py`).
  - *AC-3 (FR-3)* subjects: Basics accepts commands starting `docker run`, `docker ps`, `docker stop`, `docker rm`, `docker logs`, `docker exec`, and its bodies mention image and container; lesson 2 has terminal steps with `-p`, a bind mount, a named volume, and `docker network create`. (Asserted for all 8 in task 28.)

### 15. `[P]` Docker lessons 3–4

- **Plan:** Lesson files. **Spec:** FR-3.
- **Files:** `lessons/01-docker/03-building-images/lesson.toml`, `lessons/01-docker/04-compose/lesson.toml` (+ images)
- **Depends on:** 2 (and the `topic.toml` from 14 to load as a set; the files can be written in parallel)
- **Do:** (3) *Building images*: Dockerfile, `build`, layers and cache, multi-stage builds, tags and registries. (4) *Docker Compose*: the compose file, `up` and `down`, services, environment, `depends_on`, volumes.
- **Acceptance:**
  - Both files pass `parse_lesson`.
  - *AC-3 (FR-3)* subjects: lesson 3 accepts a `docker build` with `-t`, covers multi-stage and cache in bodies/quizzes, and a `docker push` or `docker tag`; lesson 4 accepts `docker compose up` and `docker compose down` and covers `depends_on`, `environment`, volumes.

### 16. `[P]` Tailscale lessons 1–2

- **Plan:** Lesson files (`lessons/02-tailscale/`). **Spec:** FR-3.
- **Files:** `lessons/02-tailscale/topic.toml`, `lessons/02-tailscale/01-basics/lesson.toml`, `lessons/02-tailscale/02-magicdns-sharing/lesson.toml` (+ images)
- **Depends on:** 2
- **Do:** Topic *Tailscale*. (1) *Basics*: the tailnet, installing, `tailscale up` and login, `status`, 100.x addresses, `ping`. (2) *MagicDNS and sharing*: MagicDNS names, sharing devices, `serve` and `funnel`. Any auth key is visibly fake (`tskey-auth-EXAMPLE…`).
- **Acceptance:**
  - Both files pass `parse_lesson`; gitleaks (in `scripts/check.sh`) passes.
  - *AC-3 (FR-3)* subjects: lesson 1 accepts `tailscale up`, `tailscale status`, `tailscale ping`, mentions 100.x addresses; lesson 2 accepts `tailscale serve` and `tailscale funnel`, covers MagicDNS names and sharing.

### 17. `[P]` Tailscale lessons 3–4

- **Plan:** Lesson files. **Spec:** FR-3.
- **Files:** `lessons/02-tailscale/03-acls-tags/lesson.toml`, `lessons/02-tailscale/04-exit-nodes/lesson.toml` (+ images)
- **Depends on:** 2 (and `topic.toml` from 16 to load as a set)
- **Do:** (3) *ACLs and tags*: the policy file, groups, tags, tests in the policy. (4) *Exit nodes and subnet routers*: advertising routes and exit nodes, approving them, using them.
- **Acceptance:**
  - Both files pass `parse_lesson`; gitleaks passes.
  - *AC-3 (FR-3)* subjects: lesson 3 covers groups, tags (`tag:`), and policy `tests`; lesson 4 accepts `tailscale up --advertise-routes=…`, `--advertise-exit-node`, `--exit-node=…`, and covers approving in the admin console.

### 18. `[P]` `learnSocket.ts`: WebSocket client and message types

- **Plan:** Frontend — `learnSocket.ts`; WebSocket contract. **Spec:** FR-7, FR-8, FR-10, FR-12, FR-29.
- **Files:** `frontend/src/learn/learnSocket.ts`, `frontend/src/learn/learnSocket.test.ts`
- **Depends on:** 5 (implements `ChatTransport`); uses types from 8 if landed
- **Do:** Connects to `/api/learn/sessions/{invite}/ws?name=…` (base-path aware like the coding socket), typed `send` for every client message, `subscribe` for server messages, maps close codes `4404/4403/4410/4422` to `not_found/full/stale/invalid_name`. Implements `ChatTransport`.
- **Acceptance:**
  - *AC-7 (FR-7), AC-8 (FR-8)* — close `4422` surfaces as invalid name, `4403` as full (Vitest with a fake `WebSocket`).
  - Submit helpers send the exact shapes from plan.md (`submit_command {step, command}` etc.).
  - `useChat` accepts a `LearnSocket` (type-checks).

### 19. `[P]` `StepView.tsx`: explanation, quiz, terminal; current or looked-back

- **Plan:** Frontend — `StepView.tsx`; Frontend behaviour (quiz, hint / Show answer). **Spec:** FR-12, FR-13, FR-14a, FR-15, FR-16, FR-17, FR-18, NFR-1, NFR-4.
- **Files:** `frontend/src/learn/StepView.tsx`, `frontend/src/learn/StepView.module.css`, `frontend/src/learn/StepView.test.tsx`
- **Depends on:** 9
- **Do:** Renders `body_html`; explanation with *Continue* (no check) or its check; quiz as radio group (`multiple=false`), checkboxes, or text field with Submit; terminal via `Terminal`. Attempts list (name, submission, correct/not correct) as text. *Hint* button only when `has_hint` and not revealed; *Show answer* only when `show_answer_available`; revealed answer shown. `readOnly` prop disables every control.
- **Acceptance:**
  - *AC-11 (FR-12)* — an attempt shows its author, submission and "not correct".
  - *AC-12 (FR-13)* — no hint control when `has_hint=false`; revealed `hint_html` shows.
  - *AC-13a (FR-14a)* — *Show answer* absent when `show_answer_available=false`, present when true; revealed answer displayed.
  - *AC-14 (FR-15)* — with `readOnly`, content, answer and attempts show and every control is disabled.
  - *AC-28 (NFR-4)* — attempt `<b>hi</b>` renders as text.

### 20. `[P]` `LearnWindow.tsx` and the `/learn` route

- **Plan:** Frontend — `LearnWindow.tsx`, `App.tsx` routes. **Spec:** FR-1, FR-2, FR-6, FR-27, NFR-1.
- **Files:** `frontend/src/learn/LearnWindow.tsx` (+ `.module.css`), `frontend/src/learn/LearnWindow.test.tsx`, `frontend/src/App.tsx`
- **Depends on:** 6, 7
- **Do:** `/learn` route. Fetches `GET /api/learn/topics`; lists topics with lessons (title, summary, step count, minutes); *Start session* → `POST /api/learn/sessions` → navigate to `/learn/s/<invite>`. Admins see `StaleSessionsList` with the learn endpoint and path. `AreaNav` in the sidebar.
- **Acceptance:**
  - *AC-2 (FR-2)* — Vitest: given a topics response, every lesson shows title, summary, step count and duration.
  - *AC-6 (FR-6)* — Vitest: *Start session* posts `{lesson_key}` and navigates to the returned invite.
  - *FR-27* — admin sees the stale learning list; non-admin doesn't.
  - Existing `App.test.tsx` passes unchanged.

### 21. `[P]` Startup wiring: load lessons, ship `lessons/` in the image

- **Plan:** Wiring — `asgi._migrate_and_seed`; Constitution 5 (Dockerfile). **Spec:** FR-4, FR-5.
- **Files:** `backend/app/asgi.py`, `backend/Dockerfile`, `backend/tests/integration/test_learn_startup.py`
- **Depends on:** 11
- **Do:** `_migrate_and_seed` calls `load_lessons(conn, LESSONS_DIR)` after the problem seed; `LESSONS_DIR` defaults to the repo/image `lessons/` path (overridable for tests via config). A `LessonError` exits the process with `lessons/<path>/lesson.toml: <problem>`. Dockerfile copies `lessons/` beside `seed/`.
- **Acceptance:**
  - *AC-5 (FR-5) — Given a lesson file with a quiz that has no correct answer, when the app starts, then it refuses to start and the error names that file and the missing answer.* `_migrate_and_seed` on the invalid fixture raises with that message and stores nothing.
  - Startup on the valid fixture fills `lesson`/`lesson_version`.
  - The image build (`docker compose build` in `scripts/check.sh`) contains `lessons/`.

### 22. `[P]` `service.py`: create, join, submit, continue, hint, show answer, complete

- **Plan:** Service flow (`service.py`). **Spec:** FR-6, FR-11, FR-12, FR-13, FR-14a, FR-16–FR-24, FR-26, FR-28, NFR-4, NFR-6.
- **Files:** `backend/app/learn/service.py`, `backend/tests/integration/test_learn_service.py`
- **Depends on:** 3, 12, 13
- **Do:** `create_session(lesson_key)` (current version, step 0, invite id from the coding-session generator); `join` (participant row); `submit_choice/text/command`, `continue_`, `reveal_hint`, `show_answer` per Service flow: per-session `asyncio.Lock`, stale/completed/`step == current` checks, one transaction (attempt; on pass: step passed, guarded advance, next `learning_step` row or `completed_at`; touch activity), return the events to broadcast after commit. Errors: `not_current_step`, `no_check`, `no_hint`, `show_answer_unavailable`, `session_completed`, `session_stale`, `too_long` (>1000 chars). Judging always against the session's own `lesson_version` (FR-28).
- **Acceptance:**
  - *AC-6 (FR-6)* — a created session is at step 0 of the lesson's current version.
  - *AC-10 (FR-11) — when A passes step 2, step 2 is recorded as passed by A* and current becomes 3.
  - *AC-12 (FR-13)* — a wrong answer keeps the step and allows retry; `reveal_hint` sets it once, `no_hint` without a hint.
  - *AC-13a (FR-14a)* — `show_answer` refused after 2 wrong, allowed after 3; step stays current; a later correct submit records `after_reveal`.
  - *AC-14 (FR-15)* — submit with `step=2` while current is 3 → `not_current_step`, nothing stored.
  - *AC-18/19/20* — `docker ps` passes with lesson output; `docker ls` known-mistake output, unpassed; `rm -rf /` unavailable, unpassed.
  - *AC-22 (FR-23, NFR-4)* — submit `touch /tmp/learn-ac22-<uuid>`: file doesn't exist afterwards and the set of child PIDs of the test process is unchanged.
  - *AC-23 (FR-24)* — passing the last step sets `completed_at` and returns `completed` with per-step attempts and passer.
  - *AC-25 (FR-26)* — any submit on a completed session → `session_completed`.
  - Race: two concurrent correct submits on one step → one passes, the other gets `not_current_step`, one attempt stored as passing.
  - 1001-character text/command → `too_long`, nothing stored.

### 23. `[P]` `LearningSessionWindow.tsx` and the `/learn/s/:invite` route

- **Plan:** Frontend — `LearningSessionWindow.tsx`; Frontend behaviour (stale). **Spec:** FR-7, FR-8, FR-9, FR-10, FR-15, FR-24, FR-26, FR-27, FR-29, NFR-1.
- **Files:** `frontend/src/learn/LearningSessionWindow.tsx` (+ `.module.css`), `frontend/src/learn/LearningSessionWindow.test.tsx`, `frontend/src/App.tsx`
- **Depends on:** 5, 7, 8, 10, 18, 19, 20 (App.tsx)
- **Do:** Route `/learn/s/:invite`. `GET /api/learn/sessions/{invite}`: active/completed → name prompt (≤30, same as coding join) then `learnSocket`; 423 → fetch `record` + `chat`, render read-only with *Reactivate* for admins (as `SessionWindow`). Layout: step list (passed/current), `StepView` for `viewing` (read-only when not current or completed), `PresenceList`, `ChatPane` via `useChat(learnSocket)`, `AreaNav`, `CompletionSummary` when completed. Full/invalid-name/not-found messages.
- **Acceptance:**
  - *AC-14 (FR-15) — Given step 2 passed and the group on step 3, opening step 2 shows content, answer and attempts, nothing can be submitted, current stays 3.* Vitest.
  - *AC-7/AC-8* — invalid name and full messages shown.
  - *AC-9 (FR-9)* — after `welcome`, current step, passed steps and participants show.
  - *AC-25/26 (FR-26, FR-27)* — completed: every step passed and read-only; stale: read-only with *Reactivate* only for admins.

### 24. REST `/api/learn`: topics, start, state, record, assets

- **Plan:** Contracts — REST (all rows except stale list, reactivate and chat). **Spec:** FR-2, FR-4, FR-6, FR-26, FR-27.
- **Files:** `backend/app/learn/api.py`, `backend/app/main.py`, `backend/tests/integration/test_learn_api.py`
- **Depends on:** 12, 13, 14, 15, 16, 17, 21, 22
- **Do:** `GET /topics`, `POST /sessions` (same access rule as `POST /api/sessions`), `GET /sessions/{invite}` (active/completed/423 stale/404), `GET /sessions/{invite}/record`, `GET /assets/{sha256}` (`Cache-Control: immutable`). Include the router in `main.create_app`.
- **Acceptance:**
  - *AC-2 (FR-2)* — against the real `lessons/`: Docker and Tailscale with their lessons, each with title, summary, step count matching its file, minutes.
  - *AC-4 (FR-4) — no way in the app to create or change a lesson.* Route-table test: no non-GET route under `/api/learn/topics` or `/api/learn/assets`, and no route handler writes `lesson*` tables.
  - *AC-6 (FR-6)* — anonymous `POST /api/learn/sessions` → 201 with invite, session at step 0; unknown or removed lesson → 404; parity: anonymous `POST /api/sessions` is allowed too.
  - `record` for a session returns `LessonOutline`, current step, passed + current `StepView`s, no hidden answers (AC-13).
  - An asset referenced by a lesson is served with its media type and `immutable`.

### 25. WebSocket `/api/learn/sessions/{invite}/ws`

- **Plan:** Contracts — WebSocket; Wiring (`learn.ws` uses `sessions.hub`). **Spec:** FR-7–FR-14a, FR-18–FR-21, FR-24, FR-26, NFR-2, NFR-4.
- **Files:** `backend/app/learn/ws.py`, `backend/app/main.py`, `backend/tests/integration/test_learn_ws.py`
- **Depends on:** 22, 24
- **Do:** Join with the coding-session name rule and seat reservation from `sessions.hub` (hub keyed by learning session UUID); close codes `4404/4403/4410/4422`; participant row, `welcome {you, record, chat: []}` (chat filled in task 29), `presence` to all; dispatch client messages to `service`, broadcast committed events (`attempt`, `hint_revealed`, `answer_revealed`, `step_passed`, `completed`); `error {code}` to the sender only; mark left and `presence` on disconnect. Completed sessions accept joins.
- **Acceptance:**
  - *AC-7 (FR-7)* — 30-character name joins; 31-character closes `4422`.
  - *AC-8 (FR-8)* — 5 joined, the 6th closes `4403`.
  - *AC-9 (FR-9)* — session advanced to step 3: new join's `welcome.record` has current 3, steps 0–2 passed, and `presence` lists everyone.
  - *AC-10 (FR-10, FR-11)* — A passes; both sockets receive `step_passed`.
  - *AC-11 (FR-12)* — A wrong; B receives `attempt` with A's name, submission, `correct=false`.
  - *AC-12 (FR-13)* — B `reveal_hint`; A receives `hint_revealed`.
  - *AC-13 (FR-14)* — raw `welcome` and `attempt` frames for an unpassed step contain no accepted answer/command/response.
  - *AC-13a (FR-14a)* — after the 3rd wrong both get `show_answer_available=true`; B shows; both get `answer_revealed`.
  - *AC-17 (FR-18)* — A's `submit_command` reaches both as `attempt` with name and output.
  - *AC-25 (FR-26)* — completed session: join works, `welcome.record` all passed, submits → `session_completed`.
  - *AC-28 (NFR-4)* — `<b>hi</b>` stored and sent verbatim.

### 26. `[P]` Stale learning sessions: marking, reactivation, admin list

- **Plan:** `stale.py`; REST `GET /sessions/stale`, `POST /sessions/{invite}/reactivate`; `lifespan`. **Spec:** FR-27, NFR-5.
- **Files:** `backend/app/learn/stale.py`, `backend/app/learn/api.py`, `backend/app/main.py`, `backend/tests/integration/test_learn_stale.py`
- **Depends on:** 25
- **Do:** `mark_stale(conn, now)` mirroring `sessions.stale.mark_stale` on `learning_session` (30 days, never deletes); `run_periodically(pool)` started in `lifespan` beside the existing task; admin-only stale list and reactivate (clears `stale_at`, touches activity; `409 not_stale`, `404`). Reactivate also lives in `service` if that's where the coding equivalent is; keep it to these files otherwise.
- **Acceptance:**
  - *AC-26 (FR-27) — Given no activity for 30 days, the link is read-only and marked stale; when an admin reactivates, participants can submit again from the step where the group stopped.* `mark_stale` at +30 days → WS closes `4410`, `GET` 423 with `can_reactivate` for admins, `record` available; admin reactivate → join and submit work on the same step.
  - Non-admin stale list / reactivate → refused as for coding sessions; nothing is ever deleted.
  - Coding-session stale tests pass unchanged (NFR-5).

### 27. `[P]` Restart and lesson-change survival tests

- **Plan:** Versioning (FR-28); Test strategy AC-24, AC-31. **Spec:** FR-25, FR-28, NFR-6.
- **Files:** `backend/tests/integration/test_learn_persistence.py`, `backend/tests/integration/fixtures/lessons-v1/`, `backend/tests/integration/fixtures/lessons-v2/`
- **Depends on:** 25
- **Do:** Tests (and any fix they surface in loader/service/views) using a 10-step fixture lesson and a variant with step 5 removed.
- **Acceptance:**
  - *AC-24 (FR-25, NFR-6) — Given steps 1–3 passed, when the app is restarted and the link opened again, then the session is on step 4 with steps 1–3 and their attempts intact.* Fresh app on the same DB, rejoin, `welcome.record` checked.
  - *AC-31 (FR-28) — Given a session on step 3 of a 10-step lesson, when step 5 is removed and the app redeployed, then that session still has 10 steps with its progress intact, and a session started afterwards has 9.* Also: a removed lesson isn't listed but its existing session still loads and its images are still served.

### 28. `[P]` Starter-set content test

- **Plan:** Test strategy AC-3. **Spec:** FR-3.
- **Files:** `backend/tests/integration/test_learn_content.py`
- **Depends on:** 14, 15, 16, 17, 25
- **Do:** Against the real `lessons/`: exact topic and lesson titles and order; for each of the 8 lessons a scripted WebSocket run using answers from the stored snapshot (first accepted command / correct options / first accepted text, *Continue* on plain explanations) reaches `completed`; the per-lesson required-subjects table from tasks 14–17 asserted against the snapshot. Fix content, not the test, if a lesson fails.
- **Acceptance:**
  - *AC-3 (FR-3) — Docker lists Basics; Ports, volumes and networks; Building images; Docker Compose, and Tailscale lists Basics; MagicDNS and sharing; ACLs and tags; Exit nodes and subnet routers, in that order; each of the eight can be completed from first to last step, covering the subjects FR-3 names for it.*

### 29. Learning-session chat

- **Plan:** `chat.py`; REST chat rows; WebSocket `chat_send` / `chat_message` / `chat_removed`. **Spec:** FR-29, FR-27.
- **Files:** `backend/app/learn/chat.py`, `backend/app/learn/api.py`, `backend/app/learn/ws.py`, `backend/tests/integration/test_learn_chat.py`
- **Depends on:** 26 (`api.py`), 25 (`ws.py`)
- **Do:** Chat repo on `learning_chat_message` with the rules from `app.chat.rules` (plain text, 1–2000 chars); `chat_send` over the WS (touches activity), broadcast `chat_message`; `welcome.chat` filled; `GET /sessions/{invite}/chat` `{messages, read_only}`; admin `DELETE /sessions/{invite}/chat/{id}` → `chat_removed` to all. Completed sessions keep chat open; stale ones are read-only.
- **Acceptance:**
  - *AC-32 (FR-29) — Given two participants, when A sends 2000 characters, B sees it; 2001 is refused; when an admin removes the message, it disappears for both; given the session is stale, the chat is read-only.* 2000 delivered, 2001 → `chat_too_long`, empty → `chat_empty`, admin DELETE → `chat_removed` to both, non-admin DELETE refused, stale → REST `read_only=true` and WS closed `4410`.
  - Messages survive restart (shown in `welcome.chat` after rejoin).
  - Existing chat tests pass unchanged (NFR-5).

### 30. `[P]` E2E: Learn navigation, group latency, keyboard terminal, accessibility

- **Plan:** Test strategy AC-1, AC-10 (timing), AC-27. **Spec:** FR-1, FR-10, NFR-1, NFR-2.
- **Files:** `e2e/learn.spec.ts`, `e2e/learn-a11y.spec.ts`
- **Depends on:** 23, 28, 29
- **Do:** Playwright against the compose stack. The Learn pages go into a new `learn-a11y.spec.ts` with the same axe setup as `a11y.spec.ts`, which stays unedited (AC-29; decided at task review, 2026-10-29).
- **Acceptance:**
  - *AC-1 (FR-1)* — from `/`, clicking *Learn* opens the Learn area.
  - *AC-10 (FR-10, NFR-2) — both participants on step 3 within 1 second*: two browser contexts, A passes a step, B's view advances in < 1 s (as `latency.spec`).
  - *AC-27 (NFR-1) — the Learn area and a session page pass WCAG AA in light and dark at 1024 px; a participant can focus the terminal, type, submit and read the output using only the keyboard.*

### 31. `[P]` E2E (hub only): memory and process budget

- **Plan:** Test strategy AC-30. **Spec:** NFR-3.
- **Files:** `e2e/hub-learn.spec.ts`
- **Depends on:** 25 (and the feature deployed to the hub)
- **Do:** Hub-only spec like `hub-smoke`: open 3 learning sessions with 5 sockets each, submit commands in each, then read `docker stats` and the process count of the app container.
- **Acceptance:**
  - *AC-30 (NFR-3) — with three sessions of 5 participants in progress, the app stays within 1 GB and no container or process was started per learner.*
