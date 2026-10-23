# 001 — Collaborative coding sessions: plan

Spec: [spec.md](spec.md) (approved). Constitution: `memory/constitution.md`.

## Stack (constitution rule 5)

| Concern | Choice | Why |
|---|---|---|
| Backend | Python 3.12, FastAPI + uvicorn (one worker) | Same language as solutions (NFR-6), so the signature parsing and the sandbox harness share one toolchain. FastAPI gives HTTP and WebSockets in one async server. |
| Database | PostgreSQL 16, via `asyncpg` and plain SQL | "Store everything" durably (FR-27, NFR-9). It gives a transactional unique index for one run at a time (FR-26), and soft deletes and audit history stay simple. |
| Collaboration | Yjs CRDT: `yjs` in the browser, `pycrdt` (Python bindings of the same Rust core, `yrs`) on the server | Conflict-free merging (FR-19) and cursors through awareness (FR-20). The server holds the authoritative document, so a run always uses the true shared code (FR-21). |
| Frontend | React 18 + TypeScript (strict), Vite, CodeMirror 6 with `y-codemirror.next` | Your choice. CodeMirror has first-class Yjs bindings with remote cursors. |
| Auth | OIDC Authorization Code + PKCE against the existing Keycloak, using `authlib` | Single sign-on and roles come from Keycloak (FR-1, FR-2, FR-2a, FR-2b, NFR-8). |
| Sandbox | One throwaway Docker container per run, started by a separate `runner` service | Docker is available on the server. Container flags give network, filesystem, memory and process isolation (FR-24, FR-25, NFR-2). gVisor (`runsc`) is used when installed. |
| Deploy | `docker compose`: `db`, `api` (also serves the built frontend), `runner`. Keycloak is external. | Your choice. Only `runner` touches the Docker socket. |

## Architecture

```
browser (React SPA)
  │  HTTPS: /api/*            WebSocket: /api/sessions/{invite}/ws
  ▼
api (FastAPI, single process)
  ├─ auth/       OIDC login/callback, signed cookie, role checks ── Keycloak (external)
  ├─ problems/   CRUD, search, signature/test validation (pure)
  ├─ sessions/   REST, WebSocket hub (presence, cap 5), Yjs doc per session,
  │              event log, stale job (hourly)
  ├─ runs/       one-at-a-time lock, grading (pure), runner client
  └─ db.py       asyncpg pool, SQL migrations
        │ internal HTTP (compose network only)
        ▼
runner (stdlib http.server, holds the Docker socket)
        │ docker run --rm … sandbox image
        ▼
sandbox container (python:3.12-slim + harness.py, no network)
```

**Dependency direction:** `api routes → services → repos → db`. `sessions → runs → problems`, never the reverse. `problems/signature.py` and `runs/grading.py` are pure: no I/O and no framework imports. The runner knows nothing about problems, sessions or expected values.

**Module layout (constitution rule 9):**

```
backend/app/
  main.py, config.py, clock.py, db.py
  migrations/0001_init.sql
  auth/      oidc.py, deps.py (current_user, require_role)
  problems/  signature.py, repo.py, service.py, api.py, seed.py
  sessions/  repo.py, collab.py (pycrdt doc load/persist), hub.py (live connections),
             service.py, api.py, ws.py, stale.py
  runs/      grading.py, runner_client.py, repo.py, service.py
backend/tests/  unit/, integration/
runner/      service.py, Dockerfile
sandbox/     harness.py, Dockerfile
seed/problems/NN-slug/  problem.json, reference.py
frontend/src/
  api/ (typed fetch client), auth/, collab/ (Yjs WebSocket provider),
  pages/ (ProblemList, ProblemForm, SessionPage, NotFound), components/
e2e/         Playwright specs
docker-compose.yml, docker-compose.test.yml, scripts/check.sh
```

### Key mechanisms

- **Single sign-on (FR-1, FR-2, FR-2a, FR-2b):**
  - `/api/auth/login` redirects to Keycloak. If the user already has a Keycloak SSO session, Keycloak returns them immediately without a prompt, which covers FR-2b.
  - On callback, the ID token and access token are validated against Keycloak's JWKS. Roles are read from `realm_access.roles` (role names come from config: `ROLE_EDITOR=editor`, `ROLE_ADMIN=admin`).
  - `{sub, name, roles, exp}` is stored in a signed, HttpOnly, SameSite=Lax cookie (Starlette `SessionMiddleware`, key from env). Nothing is stored server-side and no password is ever seen (NFR-8).
  - `exp` is this site's sign-in expiry, not the access token's: sign-in time plus `SESSION_MAX_AGE_SECONDS` (default 3600), also the cookie's signed max age. `current_user` treats a session past `exp` as signed out, so a role removed in Keycloak stops working here within that time. Signing in again is silent while the Keycloak SSO session lasts (FR-2b).
- **Hidden tests (NFR-5, FR-22, FR-25):**
  - Expected values never leave the `api` process. Only the *arguments* are sent to the runner, and grading compares outside the sandbox.
  - Public problem endpoints and every WebSocket message are built from types that have no test fields.
- **Live editing (FR-18, FR-19, FR-20):**
  - Each session has one Yjs doc with one `Y.Text` per problem, keyed `code:{problem_id}`. Switching problems (FR-17) rebinds the editor to another key, so earlier code stays where it was.
  - The server applies every incoming update to its `pycrdt` doc, rebroadcasts it to the other connections, and appends it to `yjs_update`.
  - Awareness (display name and cursor) is relayed and not persisted.
- **Presence and the cap of 5 (FR-12, FR-12a, FR-13, FR-15):**
  - A join reserves its seat in the hub (`try_reserve`) before its first `await`, so concurrent joins can't all pass the cap.
  - The `name` query parameter is trimmed and must be 1–30 characters. Otherwise the server sends `error: invalid_name` and closes with 4422, and the join page shows the reason and lets the user enter another name. The page checks the same rule first.
  - The hub keeps the live connections per session in memory. That is valid because there is one api process; this constraint is recorded in `config.py` and in compose (`--workers 1`).
  - A sixth connection gets an `error: session_full` message and is closed with code 4403.
  - Dropped connections, where a browser goes away without a close frame, are detected with WebSocket pings every 2 s and a 3 s pong timeout (uvicorn `ws_ping_interval` / `ws_ping_timeout`). Presence is then updated within about 5 s (FR-15).
- **One run at a time (FR-26):**
  - An in-memory set of running sessions is checked and claimed with no `await` in between, so concurrent requests can't both start one. A partial unique index on `run(session_id) WHERE status = 'running'` makes the database refuse a second insert as the backstop. The loser gets `error: run_in_progress`.
  - The run itself is a task with its own DB connection, so the participant who started it keeps editing meanwhile (FR-18). `welcome.run_in_progress` tells someone joining mid-run.
  - If the runner fails, everyone gets `run_failed`, because everyone saw `run_started`.
- **Run pipeline (FR-21 to FR-25):**
  1. `runs.service` reads the current `Y.Text` from the server doc and loads the problem's tests.
  2. It sends `{code, function_name, cases: [args…]}` to `runner`.
  3. `runner` executes `docker run --rm -i --network none --read-only --tmpfs /scratch:size=16m,mode=1777 --memory 256m --memory-swap 256m --pids-limit 64 --cpus 1 --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 [--runtime runsc] sandbox:<pinned>`, passing the JSON on stdin with a 20 s outer timeout.
  4. `harness.py` (`python -I`) makes itself non-dumpable (`prctl(PR_SET_DUMPABLE, 0)`), then starts a fresh interpreter per case (`harness.py --case`), given only that case's arguments on stdin. A fork would inherit every case's arguments, which are the tests' inputs. Being non-dumpable keeps the parent's `/proc/<pid>/mem` unreadable (FR-25, NFR-5):
     - The case process points fds 0, 1 and 2 at `/dev/null`, so printed output is discarded (FR-22).
     - It sets `RLIMIT_CPU` 2 s, `RLIMIT_AS` 256 MB, `RLIMIT_FSIZE` 1 MB and `RLIMIT_NPROC`.
     - It `exec`s the code compiled as `solution.py`, calls the function, and writes `{status, value | error_message, traceback}` to a pipe. Tracebacks are trimmed to `solution.py` frames.
     - The parent kills the child after 3 s of wall time (`timeout`). A `MemoryError` or a kill under the memory limit becomes `memory`.
  5. Back in `api`, `grading.py` maps each outcome to `passed | wrong_answer | error | time_limit_exceeded | memory_limit_exceeded`. If every case passed, the problem is marked accepted (FR-23).
- **Signatures and tests (FR-3, FR-4, FR-16):**
  - The signature is a single Python `def` line, parsed with `ast`. Each parameter and the return value need an annotation from a fixed set: `int`, `float`, `str`, `bool`, `list[T]`, `dict[str, T]`, `T | None`.
  - A test is `{args: [JSON…], expected: JSON}`. Its argument count and types are checked against the parsed signature.
  - Values are compared after a JSON round-trip, and floats with a relative tolerance of 1e-9.
  - The starter code is the signature followed by an indented `pass`.
- **Deleted problems (FR-8, FR-10):** deletion is a soft delete (`deleted_at`). Search and session creation exclude deleted problems, and sessions still read their own code from the Yjs doc.
- **Inactivity and stale sessions (FR-27, FR-29 to FR-32):**
  - `session.last_activity_at` is updated on join, run and switch, and on edits at most once per minute per session.
  - An hourly task in `api` runs `UPDATE session SET stale_at = $now WHERE stale_at IS NULL AND last_activity_at < $now - 30 days`.
  - Nothing ever deletes session rows (NFR-9).
  - Time always comes from `clock.now()`, so tests can control it.
- **Invite ID (FR-11, NFR-4):** `secrets.token_urlsafe(16)`, which is 128 bits.
- **Seed (FR-6):**
  - `seed/problems/` holds 20 folders. Each has a `problem.json` (`title`, `description`, `signature`, `topic`, `difficulty`, `tests`) and a `reference.py`.
  - `problems/seed.py` runs at every startup and inserts each folder not loaded before (`is_starter = true`). A starter problem added to `seed/problems/` later therefore appears with the next deploy; the seed is baked into the api image, so a new one always comes with a restart.
  - A problem's folder name is its identity, `problem.seed_key` (migration `0002_seed_key.sql`, unique). A folder whose key is already in the DB is never loaded again, even if editors renamed or deleted that problem (FR-7, FR-8). So seed folders must never be renamed: a renamed folder loads as a new problem.
  - Starter rows seeded before `seed_key` existed are adopted once, by title.
  - Every folder is validated before anything is inserted, and the inserts share one transaction.
  - `topic` and `difficulty` exist only in the seed files, for the FR-6 test and authoring. They aren't stored or shown, because the spec doesn't ask for that.

## Data model (`migrations/0001_init.sql`, `0002_seed_key.sql`)

```
problem(id uuid pk, title text, description text, signature text,
        function_name text, params jsonb, return_type text,
        is_starter bool, created_by_sub text null, created_by_name text null,
        created_at, updated_at, deleted_at null,
        seed_key text null unique)   -- seed folder name; starters only
problem_test(id uuid pk, problem_id fk, position int, args jsonb, expected jsonb)

session(id uuid pk, invite_id text unique, current_problem_id fk,
        created_at, last_activity_at, stale_at null)
session_problem(session_id fk, problem_id fk, accepted bool, accepted_at null,
                pk(session_id, problem_id))
participant(id uuid pk, session_id fk, display_name text, joined_at, left_at null)
yjs_update(id bigserial pk, session_id fk, update bytea, created_at)     -- append-only
run(id uuid pk, session_id fk, problem_id fk, code text, participant_id fk,
    status text check in (running, done, infra_error), started_at, finished_at null)
  unique index run_one_active on run(session_id) where status = 'running'
run_result(run_id fk, test_position int, outcome text, error_message text null,
           traceback text null, pk(run_id, test_position))
session_event(id bigserial pk, session_id fk, kind text, actor text, payload jsonb, created_at)
  -- kinds: joined, left, switched, run_started, run_finished, stale, reactivated
```

`run.code` together with `run_result` covers "every run with the code it ran" (FR-27). Replaying `yjs_update` rebuilds the current code for every problem the session has used.

## Contracts

### HTTP

| Method & path | Auth | Request | Responses |
|---|---|---|---|
| `GET /api/auth/login?next=` | — | — | 302 to Keycloak |
| `GET /api/auth/callback` | — | OIDC code | 302 to `next`; sets cookie |
| `POST /api/auth/logout` | — | — | 204; clears cookie |
| `GET /api/me` | — | — | `{signed_in, name?, roles[]}` |
| `GET /api/problems?q=` | — | — | `[{id, title, is_starter}]`, case-insensitive substring match on title or description, excludes deleted |
| `GET /api/problems/{id}` | — | — | `{id, title, description, signature, deleted}` (**no tests**) |
| `POST /api/problems` | editor | `ProblemInput` | 201 `{id}` · 401 · 403 `{error:"missing_role", role:"editor"}` · 422 `{errors:[{field, test_index?, message}]}` |
| `GET /api/problems/{id}/edit` | editor | — | `ProblemInput & {id}` (with tests) · 401 · 403 · 404 |
| `PUT /api/problems/{id}` | editor | `ProblemInput` | 200 · 401 · 403 · 404 · 422 |
| `DELETE /api/problems/{id}` | editor | — | 204 (soft delete) · 401 · 403 · 404 |
| `POST /api/sessions` | — | `{problem_id}` | 201 `{invite_id}` · 404 if the problem is missing or deleted |
| `GET /api/sessions/{invite_id}` | — | — | 200 `{state:"active"}` · 404 `{error:"not_found"}` · 423 `{error:"stale", can_reactivate: bool}` (`true` only for the admin role) |
| `POST /api/sessions/{invite_id}/reactivate` | admin | — | 200 · 401 · 403 · 404 · 409 if not stale |

`ProblemInput = {title: str, description: str, signature: str, tests: [{args: list, expected: any}]}`

### WebSocket `GET /api/sessions/{invite_id}/ws?name=<display name>`

- Close codes: 4404 not found, 4410 stale, 4403 full, 4422 invalid name.
- **Binary frames** follow the y-websocket protocol (`messageSync = 0`, `messageAwareness = 1`), relayed and applied by the server.
- **Text frames** carry JSON:

```
server → client
  {type:"welcome", participant_id, current_problem: Problem, problems: {pid: {accepted, last_run?: RunResult}},
   presence: [Participant], run_in_progress: bool}
  {type:"presence", participants: [{id, name}]}
  {type:"problem_switched", problem: Problem, by: name, state: {accepted, last_run?: RunResult}}
  {type:"problem_deleted", problem_id}
  {type:"run_started", run_id, by: name}
  {type:"run_finished", run: RunResult}
  {type:"run_failed", run_id, reason: "infra_error"}
  {type:"error", code: "run_in_progress" | "problem_deleted" | "problem_not_found" | "session_full" | "stale" | "invalid_name"}
client → server
  {type:"run"}
  {type:"switch_problem", problem_id}

Problem   = {id, title, description, signature, deleted}            // never tests
RunResult = {run_id, problem_id, accepted, results: [{position, outcome,
             error_message?, traceback?}]}                          // never args/expected/value/stdout
```

### Runner (internal, compose network only)

`POST http://runner:8080/execute` takes `{code: str, function_name: str, cases: [[arg…]…]}` and returns `{cases: [{status: "ok"|"error"|"timeout"|"memory", value?, error_message?, traceback?}]}`. Infrastructure failure returns 503, which the api reports as `infra_error`.

### Pure functions

```python
# problems/signature.py
def parse_signature(src: str) -> Signature                   # raises SignatureError(message)
def validate_tests(sig: Signature, tests: list[TestInput]) -> list[FieldError]
def starter_code(sig: Signature) -> str
# runs/grading.py
def grade(expected: list[Any], outcomes: list[CaseOutcome]) -> list[TestResult]
def is_accepted(results: list[TestResult]) -> bool
```

## Test strategy

**Levels:**
- **Unit (U):** pytest on pure modules, plus Vitest for frontend helpers.
- **Integration (I):** pytest against real services started by `docker-compose.test.yml`:
  - Postgres
  - the runner and the sandbox image
  - a Keycloak container with a test realm imported from `backend/tests/keycloak/realm.json`. The realm defines roles and clients with no credentials. A fixture creates users `editor1`, `plain1` and `admin1` through the admin API, with random passwords generated per run.
  - The helper `login_as(client, user)` drives the real authorization code flow over httpx.
  - WebSockets go through Starlette's `TestClient`.
  - Time goes through `clock.now()`.
- **End-to-end (E):** Playwright with two or three browser contexts against the composed stack. Used only where multiple real browsers matter.

**Order:** test-first per task (rule 1). The suite command is `scripts/check.sh`, which runs `ruff check`, `ruff format --check`, `biome ci`, `tsc --noEmit`, pytest (U and I), vitest and playwright.

| AC | Level | Test |
|---|---|---|
| FR-1 | I, E | unauthenticated `POST /api/problems` → 401; `/api/auth/login` → 302 to Keycloak; E: "new problem" lands on the Keycloak login |
| FR-2 | I | `login_as(editor1)` → `GET /api/me` roles include editor; POST, PUT and DELETE allowed |
| FR-2a | I | `login_as(plain1)` → POST, PUT and DELETE → 403 `missing_role`, no rows changed |
| FR-2b | E | log in to Keycloak's account console, then open `/problems/new` → form shown with no credential prompt |
| FR-3 | U, I | U: parse `def add(a: int, b: int) -> int`; I: POST → 201, search "Sum two" lists it, `created_by_sub` = editor1 |
| FR-4 | U, I | U: zero tests and a 3-argument test produce the right `FieldError`s; I: POST → 422 with `test_index`, no row |
| FR-5 | I | search "reverse" returns "Reverse list" and not "Two targets" |
| FR-6 | I | fresh DB + seed → exactly 20 problems, ≥2 distinct `topic`s in the seed files, each with ≥1 test; each `reference.py` run through the real runner → all passed |
| FR-7 | I | editor1 creates, editor2 adds a test via PUT → `GET …/edit` shows 2; next run executes 2 cases; editing a starter's description is saved |
| FR-8 | I | DELETE → absent from search; `POST /api/sessions` → 404; same for a starter problem |
| FR-9 | I | anonymous and plain1: PUT, DELETE and `GET …/edit` refused; `GET /api/problems/{id}` has no test fields |
| FR-10 | I | session on P with code; editor deletes P → clients get `problem_deleted`; `run` → `error: problem_deleted`; `switch_problem` still works |
| FR-11 | U, I | U: invite ID has ≥128 bits; I: two sessions get distinct IDs, creator is unauthenticated |
| FR-12 | I | second WebSocket with `name=Ada` → both receive presence containing Ada |
| FR-12a | U, I | U: name validation (empty, spaces only, 30 and 31 characters); I: WebSocket with a 31-character name closed with 4422 and no participant row; 30 characters joins |
| FR-13 | I | 5 sockets connected; 6th closed with 4403 `session_full`; presence still 5 |
| FR-14 | I | `GET /api/sessions/doesnotexist` → 404; WebSocket closed with 4404; body has no other session data |
| FR-15 | I | Linus disconnects cleanly, and separately stops answering pings → in both cases Ada receives presence without Linus within 5 s |
| FR-16 | U, I | U: `starter_code`; I: the welcome doc's `code:{pid}` text equals the starter code |
| FR-17 | I | edit P1, switch to P2 → both see P2 starter code; switch back → P1 text and last run restored |
| FR-18 | E | Ada types; Linus's editor shows the text, measured < 500 ms |
| FR-19 | I, E | I: two pycrdt clients send concurrent inserts on different lines → server and both clients identical, containing both; E: same with two browsers |
| FR-20 | E | Linus's cursor on line 3 → Ada sees a remote-cursor widget labelled "Linus" on line 3 |
| FR-21 | I | Ada sends `run` → Ada and Linus both receive the same `run_finished` |
| FR-22 | U, I | U: grading maps outcomes; I: `a * b` on tests (2,3)→5 and (1,1)→2 → two `wrong_answer`, and the serialized message contains none of `2, 3`, `5`, `6`, `1, 1` or the printed text; `ValueError("bad")` → `error` with "bad" and a traceback |
| FR-23 | I | `a + b` → all passed; `session_problem.accepted`; broadcast to both |
| FR-24 | I | `while True: pass` → `time_limit_exceeded`; unbounded list growth → `memory_limit_exceeded` |
| FR-25 | I | socket connect, writing outside `/scratch`, reading a host path, `os.system`, fork bomb → each fails inside the run; tests, other sessions and the host are unchanged afterwards. Reading image files is allowed (spec FR-25) |
| FR-26 | I | two concurrent `run` messages → exactly one `run_started`, the other gets `run_in_progress`; DB has one running row |
| FR-27 | I | the FR-27 scenario, then a fresh app instance on the same DB → both runs with code and results, current code, accepted status, participants Ada and Linus |
| FR-28 | I | clock + 29 days → reconnect → code `return a + b`, accepted |
| FR-29 | I | `last_activity_at` = now − 31 days → stale job → `stale_at` set; row counts unchanged |
| FR-30 | I | stale: anonymous GET → 423 `can_reactivate:false`; WebSocket closed with 4410 |
| FR-31 | I | `login_as(admin1)` GET → 423 `can_reactivate:true` |
| FR-32 | I | admin reactivates → `stale_at` null, `last_activity_at` = now; anonymous WebSocket joins and sees the code |
| NFR-1 | E | covered by FR-18 |
| NFR-2 | I | covered by FR-24 and FR-25, plus checks for the output-size cap and process limit |
| NFR-3 | I | each starter reference solution completes in < 10 s end to end |
| NFR-4 | U | covered by FR-11 |
| NFR-5 | I | every public problem response and every WebSocket message type is checked to have no `tests`, `args` or `expected` keys |
| NFR-7 | check | `gitleaks detect` in `scripts/check.sh` |
| NFR-8 | I | the schema has no password columns; the cookie holds only `sub`, `name`, `roles` and `exp` |
| NFR-9 | I | covered by FR-29: no rows removed |

## Constitution compliance

1. **Test-first.** Every row above is written as a failing test before its implementation task. `/sdd-tasks` orders the test before the code within each task.
2. **Green before done.** `scripts/check.sh` runs the full suite, and a task is ticked only when it exits 0.
3. **Traceable tests.** The table maps every acceptance criterion to a test. Test names carry the ID (`test_fr22_…`).
4. **Real dependencies.** Postgres, Docker, the runner, the sandbox and Keycloak are real in integration tests. Keycloak is a locally run service the project depends on, so it runs as a real container and isn't mocked. Nothing is mocked; no exception is requested.
5. **Stack.** The stack is stated and justified above. Rule 5 was amended on 2026-10-15 to make this stack binding.
6. **Dependency justification.**

   | Dependency | Why existing code isn't enough |
   |---|---|
   | fastapi, uvicorn | the stdlib has no async HTTP or WebSocket server |
   | asyncpg | the stdlib has no PostgreSQL driver |
   | pycrdt | server-side Yjs-compatible CRDT; reimplementing it isn't feasible |
   | authlib | OIDC and JWKS validation; hand-rolled JWT checks are a security risk |
   | itsdangerous (via Starlette) | signed cookies |
   | pytest, pytest-asyncio, httpx | the test runner, async tests, and the ASGI and Keycloak flow client |
   | react, react-dom, react-router | your chosen UI framework and routing |
   | vite, typescript | build and types |
   | codemirror (6), y-codemirror.next | code editor with Yjs binding and remote cursors |
   | yjs, y-protocols, lib0 | browser CRDT and wire protocol matching pycrdt |
   | vitest, @playwright/test | unit tests and multi-browser end-to-end tests |
   | ruff, @biomejs/biome | lint and format (rule 8) |
   | gitleaks (CLI) | secret scanning for NFR-7 and rule 7 |

   The runner and the harness use only the Python stdlib and the `docker` CLI.
7. **No secrets.** The OIDC client secret, the cookie signing key, the DB password and the Keycloak admin credentials for tests all come from the environment. Only a `.env.example` with placeholder names is committed. Test-user passwords are generated at runtime. gitleaks runs in `check.sh`.
8. **Lint and format.** Python uses `ruff check` and `ruff format`. TypeScript uses `biome ci` and `tsc --noEmit`. Rule 8 was amended on 2026-10-15 to name these tools.
9. **Architecture.** The module layout and dependency direction are stated above.

## Constraints

1. **Single api process:** presence, the cap of 5 and Yjs relaying live in one process's memory. That fits one local server. Scaling out would need a shared pub/sub layer, which nothing in the spec requires today.
