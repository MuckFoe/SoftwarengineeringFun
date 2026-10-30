# 006 — Interactive learning sessions: plan

Spec: [spec.md](spec.md) (approved, no open questions).

## Architecture

A new, self-contained backend module `app/learn/` and frontend area `src/learn/`, with their own tables. Coding-session code is reused only where it is already generic (the in-memory hub, chat rules, the Markdown renderer, UI components), and every such reuse leaves coding-session behaviour unchanged (NFR-5).

```
lessons/                                  # lesson files, kept with the source (FR-4)
  01-docker/topic.toml                    # title = "Docker"
  01-docker/01-basics/lesson.toml         # + any images it references
  ...
  02-tailscale/04-exit-nodes/lesson.toml

backend/app/learn/
  lesson_file.py   # pure: parse + validate one lesson.toml → Lesson; LessonError(file, problem)
  checks.py        # pure: normalise + judge quiz answers and terminal commands
  loader.py        # startup: read lessons/, validate all, store versions and assets
  repo.py          # SQL for every learn table
  service.py       # create/join/submit/continue/hint/show-answer/complete/reactivate
  views.py         # pure: build the wire shapes, incl. what is hidden before a step passes
  stale.py         # mark learning sessions stale after 30 days
  api.py           # REST under /api/learn
  ws.py            # WebSocket /api/learn/sessions/{invite}/ws
  chat.py          # learning-session chat repo + send/remove (rules from app.chat.rules)
backend/app/migrations/0004_learning_sessions.sql
```

Wiring:

- `asgi._migrate_and_seed` calls `learn.loader.load_lessons(conn, LESSONS_DIR)` after the problem seed. A `LessonError` propagates and the process exits with `lessons/<path>/lesson.toml: <problem>` (FR-5). There is no route that writes lessons (FR-4).
- `main.create_app` includes `learn.api.router` and `learn.ws.router`; `lifespan` starts `learn.stale.run_periodically(pool)` beside the existing stale task.
- `learn.ws` uses `app.sessions.hub` as it is (`get_hub`, `peek_hub`, `broadcast`, `MAX_PARTICIPANTS`, `try_reserve`). Hubs are keyed by session UUID, so learning and coding sessions never share one. Same single-process invariant as coding sessions.
- `app.problems.markdown.render_description` gets an optional keyword `image_src` (a function that maps an image URL to a served URL, or refuses it). The default is today's `/api/images/<uuid>` rule, so spec 002 behaviour and tests are unchanged. Lesson bodies pass a resolver that only allows the lesson's own assets.

Dependency direction: `learn` → `sessions.hub`, `chat.rules`, `problems.markdown`, `auth.deps`, `db`, `clock`. Nothing outside `learn` imports from `learn` except `main` and `asgi`.

Frontend:

```
src/learn/
  LearnWindow.tsx            # /learn: topics and lessons (FR-2), start a session (FR-6), admins' stale list
  LearningSessionWindow.tsx  # /learn/s/:invite: join, step list, current step, chat, presence
  StepView.tsx               # explanation / quiz / terminal, current or looked-back (read-only)
  Terminal.tsx               # simulated terminal (FR-18, NFR-1)
  CompletionSummary.tsx      # FR-24
  learnSocket.ts             # WebSocket client and message types
  learnState.ts              # pure reducer: server messages → session state
src/components/AreaNav.tsx   # "Problems" / "Learn" entries, shown in both windows' sidebars (FR-1)
```

- `App.tsx` adds routes `/learn` and `/learn/s/:invite`.
- Reused unchanged: `ChatPane`, `PresenceList`, `ui/*`, theme tokens.
- `StaleSessionsList` gains optional props `endpoint` and `sessionPath` (defaults: `/api/sessions/stale`, `/s/`), so the Learn window can list stale learning sessions for admins (FR-27).
- `useChat` takes, instead of a `CollabProvider`, the minimal interface it uses from it (send a JSON message, subscribe to JSON messages). `CollabProvider` already satisfies it; `learnSocket` implements it too. Coding-session call sites don't change.

## Lesson files

TOML, read with Python's standard `tomllib`. Folder names give identity and order: a lesson's key is `<topic folder>/<lesson folder>` (e.g. `01-docker/01-basics`); topics and lessons are listed in folder-name order.

```toml
title = "Basics"
summary = "Images vs containers, and the commands to run and inspect them."
minutes = 25

[[steps]]
kind = "explanation"                 # explanation | quiz | terminal
title = "Images and containers"
body = """
Markdown. Images: ![diagram](layers.png), a file in this lesson's folder.
"""
hint = "Optional Markdown."           # optional on every step (FR-13)
# an explanation step may also have a [steps.check] of any type; without one it passes on Continue

[[steps]]
kind = "quiz"
title = "Which runs?"
body = "Which of these are running processes?"
[steps.check]
type = "choice"                      # choice | text | terminal
options = ["An image", "A container", "A Dockerfile", "A container started with -d"]
correct = [2, 4]                     # 1-based option numbers
multiple = true                      # false: exactly one correct option (FR-16)

[[steps]]
kind = "quiz"
title = "Name it"
body = "A running instance of an image is called a …"
[steps.check]
type = "text"
accept = ["container"]               # FR-17

[[steps]]
kind = "terminal"
title = "List containers"
body = "Show the running containers."
[steps.check]
type = "terminal"
prompt = "$ "
[[steps.check.accept]]               # first entry is the one Show answer reveals (FR-14a)
command = "docker ps"
output = """CONTAINER ID   IMAGE   ..."""
[[steps.check.responses]]            # optional known mistakes (FR-20)
command = "docker ls"
output = "docker: 'ls' is not a docker command. Did you mean `docker container ls`?"
```

Validation in `lesson_file.py` (each failure is `LessonError(path, problem)`, FR-5): required fields present and of the right type; at least one step; `kind` and `check.type` known; `quiz` has a `choice` or `text` check, `terminal` a `terminal` check; `choice` has ≥2 options, ≥1 `correct`, every number in range, no duplicates, exactly one if `multiple = false`; `text` has ≥1 non-blank `accept`; `terminal` has ≥1 `accept`, each with a non-blank command; no normalised command in both `accept` and `responses` or twice; every image in a body or hint is a file in the lesson folder with a PNG/JPEG/GIF/WebP type; `minutes` ≥ 1; every topic folder has `topic.toml` with a `title`.

## Checks (`checks.py`, pure)

- `normalise_command(s) = " ".join(s.split())`: only whitespace is ignored (FR-22). Case and word order count.
- `judge_command(check, s) → Accepted(output) | KnownMistake(output) | Unavailable`. `Unavailable` produces the fixed text `"<command>: not available in this exercise"`, using the first word of the submission (FR-21).
- `normalise_text(s) = s.strip().casefold()`; text quiz passes if it equals any normalised `accept` (FR-17).
- choice quiz passes iff `set(selected) == set(correct)` (FR-16).
- No function here, or anywhere in `learn`, calls `subprocess`, `os.system`, `eval`, `exec` or a shell (FR-23, NFR-4). A unit test asserts `learn/` imports none of `subprocess`, `os`, `pty`, `shlex`.

## Versioning (FR-28)

At startup the loader turns each lesson into a snapshot: the parsed lesson as canonical JSON, with image references replaced by the SHA-256 of each image file. The snapshot's hash is the SHA-256 of that JSON. If `(lesson_key, content_hash)` is new, a `lesson_version` row is inserted. `lesson.current_version_id` points at it. Lessons whose folder is gone get `current_version_id = null`: no longer listed or startable, but their versions stay. A learning session references the exact `lesson_version` it started on and never moves to another one. Assets are content-addressed, so an old version's images stay served after a file changes. All of this happens in one transaction, after every file has validated.

## Data model — `0004_learning_sessions.sql`

Nothing is deleted. No cascades (matching 0001).

```sql
create table lesson_asset (
    sha256     text primary key,
    media_type text not null check (media_type in ('image/png','image/jpeg','image/gif','image/webp')),
    data       bytea not null
);

create table lesson_version (
    id           uuid primary key default gen_random_uuid(),
    lesson_key   text not null,
    content_hash text not null,
    content      jsonb not null,          -- full snapshot incl. answers; never sent as-is
    created_at   timestamptz not null default now(),
    unique (lesson_key, content_hash)
);

create table lesson (                    -- the current catalogue
    key                text primary key,
    topic_key          text not null,
    topic_title        text not null,
    current_version_id uuid null references lesson_version (id)
);

create table learning_session (
    id                uuid primary key default gen_random_uuid(),
    invite_id         text not null unique,
    lesson_version_id uuid not null references lesson_version (id),
    current_step      int not null default 0,        -- 0-based; = step count once completed
    completed_at      timestamptz null,
    created_at        timestamptz not null default now(),
    last_activity_at  timestamptz not null default now(),
    stale_at          timestamptz null
);

create table learning_participant (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references learning_session (id),
    display_name text not null,
    joined_at    timestamptz not null default now(),
    left_at      timestamptz null
);

create table learning_step (             -- one row per step once it has been current
    session_id          uuid not null references learning_session (id),
    position            int not null,
    hint_revealed_at    timestamptz null,
    answer_revealed_at  timestamptz null,
    passed_at           timestamptz null,
    passed_by_name      text null,
    passed_by           uuid null references learning_participant (id),
    primary key (session_id, position),
    check ((passed_at is null) = (passed_by_name is null))
);
-- "passed after the answer was revealed" (FR-14a) = answer_revealed_at is not null and passed_at is not null

create table learning_attempt (
    id             bigserial primary key,
    session_id     uuid not null references learning_session (id),
    position       int not null,
    participant_id uuid not null references learning_participant (id),
    actor_name     text not null,
    kind           text not null check (kind in ('choice','text','command')),
    submitted      jsonb not null,        -- list of option numbers, or the exact text typed
    correct        boolean not null,
    output         text null,             -- terminal response shown
    created_at     timestamptz not null default now()
);
create index learning_attempt_step on learning_attempt (session_id, position, id);

create table learning_chat_message (     -- same shape and rules as chat_message (spec 002)
    id             bigserial primary key,
    session_id     uuid not null references learning_session (id),
    participant_id uuid not null references learning_participant (id),
    sender_name    text not null,
    body           text not null check (char_length(body) between 1 and 2000),
    sent_at        timestamptz not null,
    removed_at     timestamptz null,
    removed_by_sub text null,
    check ((removed_at is null) = (removed_by_sub is null))
);
create index learning_chat_message_session on learning_chat_message (session_id, id);
```

Wrong-attempt count for FR-14a = `count(*) from learning_attempt where session_id, position = current and not correct`. *Show answer* is available when that count is ≥ 3.

## Contracts

### REST (`/api/learn`, errors use the existing `{error: ...}` body)

| Method, path | Who | Response |
|---|---|---|
| `GET /api/learn/topics` | anyone | `200 [{key, title, lessons: [{key, title, summary, step_count, minutes}]}]` (current versions, folder order) (FR-2) |
| `POST /api/learn/sessions` `{lesson_key}` | same as `POST /api/sessions`: anyone (FR-6) | `201 {invite_id}`; `404 {error:"not_found"}` for an unknown or removed lesson |
| `GET /api/learn/sessions/stale` | admin | `200 [{invite_id, lesson_title, stale_at, last_activity_at}]` |
| `GET /api/learn/sessions/{invite}` | anyone | `200 {state:"active"\|"completed"}`; `423 {error:"stale", can_reactivate}`; `404` |
| `GET /api/learn/sessions/{invite}/record` | anyone | `200 Record` (below): the read-only view a stale session shows (FR-26, FR-27) |
| `POST /api/learn/sessions/{invite}/reactivate` | admin | `200 {}`; `409 {error:"not_stale"}`; `404` (FR-27) |
| `GET /api/learn/sessions/{invite}/chat` | anyone | `200 {messages, read_only}` (same shape as spec 002) |
| `DELETE /api/learn/sessions/{invite}/chat/{id}` | admin | `204`; `404` |
| `GET /api/learn/assets/{sha256}` | anyone | the image, `Cache-Control: immutable` |

Invite ids use the same generator as coding sessions.

### Wire shapes (`views.py`)

```ts
type LessonOutline = { key: string; title: string; topic: string;
                       steps: { position: number; title: string; kind: "explanation"|"quiz"|"terminal" }[] };

type StepView = {
  position: number; title: string; kind: ...; body_html: string;
  check: null
       | { type: "choice"; options: string[]; multiple: boolean }
       | { type: "text" }
       | { type: "terminal"; prompt: string };
  has_hint: boolean; hint_html: string | null;          // hint_html only once revealed
  show_answer_available: boolean;                      // ≥3 wrong attempts and not yet revealed
  answer: Answer | null;                               // only once revealed or passed (FR-14, FR-14a, FR-15)
  attempts: Attempt[];
  passed: null | { by: string; at: string; after_reveal: boolean };
};
type Answer = { type: "choice"; correct: number[] } | { type: "text"; accept: string[] }
            | { type: "terminal"; command: string; output: string };   // first accepted command
type Attempt = { id: number; by: string; kind: "choice"|"text"|"command";
                 submitted: number[] | string; correct: boolean; output: string | null; at: string };
type Summary = { steps: { position: number; title: string; attempts: number; passed_by: string; after_reveal: boolean }[] };
type Record = { lesson: LessonOutline; current_step: number; completed: boolean; stale: boolean;
                steps: StepView[]; summary: Summary | null };   // steps = passed ones + the current one
```

`views.step_view` is the only place a step is turned into wire data. It omits `answer`, `accept` and `responses` unless the step is passed or its answer revealed (AC-13). Attempt text is sent as-is, as data. The client renders it as text, never as HTML (NFR-4). Only `body_html` and `hint_html` are HTML, and they come from the server-side renderer (raw HTML off).

### WebSocket `/api/learn/sessions/{invite}/ws?name=<display name>`

Join: same name rule as coding sessions (strip, 1–30 characters), same seat reservation and close codes: `4404` not found, `4403` full (FR-8), `4410` stale, `4422` invalid name (FR-7). On join: `learning_participant` row, then `welcome`, then `presence` to all.

Client → server (`step` is the position the client believes is current; a mismatch is answered `error {code:"not_current_step"}` and changes nothing):

```
{type:"submit_choice",  step, selected:number[]}
{type:"submit_text",    step, text}
{type:"submit_command", step, command}
{type:"continue",       step}          // explanation without a check only
{type:"reveal_hint",    step}
{type:"show_answer",    step}          // refused unless ≥3 wrong attempts
{type:"chat_send",      text, client_id}
```

Server → client:

```
{type:"welcome", you:{participant_id}, record:Record, chat:ChatMessage[]}
{type:"presence", participants}
{type:"attempt", step, attempt:Attempt, show_answer_available:boolean}
{type:"hint_revealed", step, hint_html}
{type:"answer_revealed", step, answer:Answer}
{type:"step_passed", step, passed, answer, next:StepView|null}
{type:"completed", summary:Summary}
{type:"chat_message", ...} / {type:"chat_removed", id}      // as spec 002
{type:"error", code}   // not_current_step, no_check, no_hint, show_answer_unavailable,
                       // session_completed, session_stale, too_long, chat_empty, chat_too_long
```

### Service flow (`service.py`)

Each session has an `asyncio.Lock` held in a dict beside the hub. A submit, continue, hint or show-answer action: (1) takes the lock; (2) checks that the session isn't stale or completed and that `step == current_step`; (3) in one transaction, inserts the attempt and, if correct, sets `learning_step.passed_*`, advances `current_step` with `where current_step = $step`, inserts the next `learning_step` row, or sets `completed_at` on the last step; touches `last_activity_at`; (4) commits, then broadcasts `attempt` followed by `step_passed`/`completed`. Only committed state is broadcast (NFR-6). Two correct answers in a race: the second finds `step != current_step` and gets `not_current_step` without recording anything. Chat and joins also touch `last_activity_at`.

`learn.stale.mark_stale(conn, now)` mirrors `sessions.stale.mark_stale` on `learning_session`: 30 days, hourly, never deleting.

Text inputs (`submit_text`, `submit_command`) longer than 1000 characters are refused with `too_long`, a guard on stored attempt size (approved at plan review, 2026-10-29).

### Frontend behaviour

- `learnState.ts` is a pure reducer over the server messages. It keeps `current`, `passed[]`, `participants`, and `viewing` (the position being looked at; a looked-back step renders with every control disabled, FR-15). A `step_passed` moves `current` for everyone. If the participant was viewing the current step, `viewing` follows it.
- `Terminal.tsx`: a `role="log"` `aria-live="polite"` history (`<pre>` per entry: `name $ command`, then output), and below it a labelled `<input>` with the prompt. Enter submits and clears the input. The input is local state and is never sent before Enter (FR-18). ↑/↓ recall your own previous commands. Focus order: history (scrollable, `tabIndex=0`), then input (NFR-1, AC-27).
- Quiz: radio group (`multiple=false`) or checkboxes, or a text field. Submit button.
- Hint / *Show answer* buttons appear only when `has_hint` / `show_answer_available` are true.
- Stale: the page fetches `GET …/record` and `…/chat` and renders read-only, with *Reactivate* for admins (same pattern as `SessionWindow`).

## Test strategy

Levels follow the existing suite: `backend/tests/unit` (pure, no DB), `backend/tests/integration` (real PostgreSQL via the existing fixture, real app via ASGI/WebSocket test client; nothing mocked), `frontend` Vitest component tests, `e2e/` Playwright against the compose stack. Fixture lessons live in `backend/tests/integration/fixtures/lessons*/` (valid set, one folder per invalid case).

| AC | Test |
|---|---|
| AC-1 | Vitest `AreaNav` renders a *Learn* link to `/learn`; e2e `learn.spec.ts` clicks it from `/` |
| AC-2 | integration `test_learn_api.py::topics` against the real `lessons/` (fields present, counts match files); Vitest `LearnWindow` renders them |
| AC-3 | integration `test_learn_content.py`: exact topic/lesson titles and order; for each of the 8 lessons, a scripted run through the WebSocket using answers from the stored snapshot reaches `completed`; a per-lesson table of required subjects (e.g. Docker Basics accepts commands starting `docker run`, `docker ps`, `docker stop`, `docker rm`, `docker logs`, `docker exec`, and its bodies mention image/container) is asserted against the snapshot |
| AC-4 | integration loader test: add a fixture folder and reload, the lesson appears; route-table test: no non-GET route under `/api/learn/topics` or for lessons, and none of the app's routes writes `lesson*` tables |
| AC-5 | unit `test_lesson_file.py`: one case per validation rule, asserting the message names the file and the problem; integration: `_migrate_and_seed` on the invalid fixture raises and stores nothing |
| AC-6 | integration: anonymous `POST /api/learn/sessions` → 201, the session is at step 0; parity test that an anonymous user may also `POST /api/sessions` (same rule) |
| AC-7 | integration `test_learn_ws.py`: a 30-character name joins, a 31-character name closes `4422` |
| AC-8 | integration: 5 joined, the 6th closes `4403` |
| AC-9 | integration: session advanced to step 3; new join's `welcome.record` has current = 3, steps 0–2 passed, presence |
| AC-10 | integration: A passes, both sockets receive `step_passed` (Playwright `latency.spec`-style timing < 1 s in e2e); DB `passed_by_name = A` |
| AC-11 | integration: A wrong, B receives `attempt` with A's name, submission, `correct=false` |
| AC-12 | integration: wrong, still current, retry allowed; B `reveal_hint`, A receives `hint_revealed`; Vitest: no hint button when `has_hint=false` |
| AC-13 | unit `test_views.py`: for each check type, the serialised unpassed StepView (as JSON text) contains no accepted answer, option index set or response; integration: the same over the raw `welcome` and `attempt` frames |
| AC-13a | integration: after 2 wrong `show_answer_available=false` and `show_answer` → error; after the 3rd, true for all; B shows, both get `answer_revealed`, still current; A submits it, `passed.after_reveal=true` |
| AC-14 | Vitest `LearningSessionWindow`: open passed step 2, answer and attempts shown, controls disabled, current still 3; integration: a submit with `step=2` → `not_current_step`, nothing stored |
| AC-15 | unit `test_checks.py`: {B,D} passes; {B}, {B,C,D} fail |
| AC-16 | unit: `"  Container "` passes, `"containers"` fails |
| AC-17 | Vitest `Terminal`: typing sends nothing; Enter sends `submit_command`; integration: both sockets receive the `attempt` with name and output |
| AC-18 | integration: `docker ps` → attempt output = lesson output, `step_passed` |
| AC-19 | integration: `docker ls` → known-mistake output, not passed |
| AC-20 | integration: `rm -rf /` → "not available in this exercise", not passed |
| AC-21 | unit: whitespace variant passes; `NGINX` and reordered fail |
| AC-22 | integration: submit `touch /tmp/learn-ac22-<uuid>`, assert the file doesn't exist and the set of PIDs in `/proc` with the test process as parent is the same before and after; unit: `learn/` imports no process/shell modules |
| AC-23 | integration: passing the last step broadcasts `completed` with per-step attempts and passer; `completed_at` set; Vitest `CompletionSummary` |
| AC-24 | integration `test_learn_persistence.py`: pass steps 0–2, build a fresh app on the same DB (restart), rejoin → current 3, attempts intact |
| AC-25 | integration: completed session's submits → `session_completed`; `welcome.record` all passed |
| AC-26 | integration `test_learn_stale.py`: `mark_stale` at +30 days → WS closes `4410`, `GET` 423, `record` available; admin reactivate → join and submit work from the same step |
| AC-27 | new e2e `learn-a11y.spec.ts` (same axe setup as `a11y.spec.ts`, which stays unedited for AC-29) covering `/learn` and a session page, light and dark at 1024 px (axe); e2e keyboard test: Tab to terminal input, type, Enter, output read from the log |
| AC-28 | integration: `<b>hi</b>` stored and sent verbatim; Vitest: rendered as text (no `<b>` element) in attempts and terminal history |
| AC-29 | the existing backend, frontend and e2e suites run unchanged in CI (`scripts/check.sh`); no existing test file is edited |
| AC-30 | e2e `hub-learn.spec.ts` (hub-only, like `hub-smoke`): 3 sessions × 5 sockets, then `docker stats` on the app container ≤ 1 GB and the container's process count unchanged |
| AC-31 | integration: session on version 1 at step 3 (1-based) of 10; loader runs with step 5 removed (fixture swap); old session still has 10 steps and progress, a new one has 9; removed lesson isn't listed but its session still loads |
| AC-32 | integration `test_learn_chat.py`: 2000 delivered, 2001 refused `chat_too_long`, admin DELETE → `chat_removed` to both, stale → chat read-only (REST `read_only`, WS closed) |

Unit tests also cover `render_description` with the new `image_src` resolver (lesson asset allowed, `/api/images/…` and external URLs refused for lessons), while the existing `test_markdown.py` stays as is.

## Dependencies

None added. TOML parsing is `tomllib` (stdlib). Markdown is the existing `markdown-it-py`. Hashing is `hashlib`. The frontend uses existing packages only.

## Constitution compliance

1. **Test-first**: every AC above maps to a named test, written before the code it covers. `/sdd-tasks` pairs each task with its tests.
2. **Green before done**: unchanged. Tasks tick only when `scripts/check.sh` passes.
3. **Traceable tests**: the table above covers AC-1…AC-32 including AC-13a. Each test docstring names its AC.
4. **Real dependencies**: PostgreSQL, filesystem (lesson fixtures), WebSockets and the app are real in every test. Nothing is mocked; there's no third-party service in this feature.
5. **Fixed stack**: Python 3.12/FastAPI, PostgreSQL, React/TS strict/Vite, docker compose. No departure. The `lessons/` folder is copied into the app image beside `seed/` (Dockerfile change).
6. **Dependency justification**: no new dependencies (see above).
7. **No secrets**: lessons and fixtures contain no credentials. Tailscale lessons use made-up auth keys that are visibly fake (`tskey-auth-EXAMPLE…`) and are added to `.gitleaksignore` only if gitleaks flags them.
8. **Lint/format**: new code is under the existing `ruff`/`biome`/`tsc` configs, no rule exclusions.
9. **Module layout and dependency direction**: stated in Architecture. `learn` depends on shared generic modules, never the reverse. The only edits to existing modules are the additive `image_src` keyword, `StaleSessionsList` props, the `useChat` transport interface, the route/nav additions, `main`/`asgi` wiring and the Dockerfile copy.

## Decisions at plan review (2026-10-29)

- **1000-character cap** on quiz text and commands: kept (see Service flow).
- **Completed sessions** keep chat open: they accept WebSocket joins, and presence and chat work, but submissions are refused (FR-26). Stale sessions still make chat read-only and refuse the WebSocket, as FR-29 and AC-32 require.
- **Stale learning sessions** get their own admin list in the Learn window, separate from the coding sessions' list, which stays exactly as it is (NFR-5).
