# 001 — Collaborative coding sessions: tasks

Source: [plan.md](plan.md), [spec.md](spec.md). Every task is test-first (constitution rule 1). A task is ticked only when `scripts/check.sh` exits 0 (rules 2 and 8). Test names carry the requirement id (`test_fr22_…`).

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2 — all `[P]` | Project skeletons. Everything else needs a test runner. |
| 2 | 3, 4, 5, 6, 7, 8 — all `[P]` | Pure modules, the sandbox, the test stack and the frontend client need only the skeletons. |
| 3 | 9, 10, 11, 12, 13, 14 — all `[P]` | The schema, runner and Keycloak realm need the test stack. Frontend pieces need only the API client. |
| 4 | 15, 16, 17, 18, 19, 20, 21 — all `[P]` | Auth, repositories and the runner client need the schema or the runner. |
| 5 | 22, 23, 24, 25, 26, 27, 28 — all `[P]` | Services built on the repositories. |
| 6 | 29, 30, 31, 32 — all `[P]` | HTTP APIs need role checks. Seed content needs the loader and the runner. |
| 7 | 33, 34, 36 — all `[P]` | Edit/delete and WebSocket join build on the create/REST endpoints. Routing needs all pages. |
| 8 | 35, 37 — all `[P]` | Yjs relay needs the WebSocket join. Packaging needs routing and the runner. |
| 9 | 38, 39 — all `[P]` | Problem switching needs the relay and deletion. End-to-end tests need the packaged stack. |
| 10 | 40, 43 — all `[P]` | Running in a session needs switching (both edit `ws.py`). The collaboration end-to-end test needs the relay. |
| 11 | 41, 42 — all `[P]` | Whole-feature checks once every WebSocket message exists. |

Tasks 29 and 30 (wave 6), and 34 and 36 (wave 7), each add one line to `backend/app/main.py` (a router include or a static mount) alongside another task in the same wave. Those edits merge trivially.

## Checklist

- [ ] **1** — `[P]` Backend skeleton: config and clock
- [ ] **2** — `[P]` Frontend skeleton
- [ ] **3** — `[P]` Sandbox image and harness
- [ ] **4** — `[P]` Signature parsing and test validation (pure)
- [ ] **5** — `[P]` Grading (pure)
- [ ] **6** — `[P]` Test stack: Postgres compose and DB fixture
- [ ] **7** — `[P]` `scripts/check.sh` with lint, format, secret scan and tests
- [ ] **8** — `[P]` Frontend typed API client
- [ ] **9** — `[P]` DB pool, migration runner and schema
- [ ] **10** — `[P]` Runner service
- [ ] **11** — `[P]` Keycloak test realm and `login_as` fixture
- [ ] **12** — `[P]` Frontend auth: `useMe` and role guard
- [ ] **13** — `[P]` Problem list page with search and start session
- [ ] **14** — `[P]` Frontend Yjs WebSocket provider
- [ ] **15** — `[P]` OIDC login, callback, logout, `/api/me`
- [ ] **16** — `[P]` Problems repository
- [ ] **17** — `[P]` Runner client
- [ ] **18** — `[P]` Runs repository
- [ ] **19** — `[P]` Sessions repository
- [ ] **20** — `[P]` Problem form page: create, edit, delete
- [ ] **21** — `[P]` Collaborative editor and presence list
- [ ] **22** — `[P]` Role dependencies
- [ ] **23** — `[P]` Server-side collaborative document
- [ ] **24** — `[P]` Runs service: execute, grade, persist
- [ ] **25** — `[P]` Seed loader
- [ ] **26** — `[P]` Stale-session job
- [ ] **27** — `[P]` Session join page: name, not found, full, stale, reactivate
- [ ] **28** — `[P]` Run panel, results and problem switcher
- [ ] **29** — `[P]` Problems API: create, search, public get
- [ ] **30** — `[P]` Sessions REST: create, status, reactivate
- [ ] **31** — `[P]` Starter problems 1–10
- [ ] **32** — `[P]` Starter problems 11–20
- [ ] **33** — `[P]` Problems API: edit, update, delete
- [ ] **34** — `[P]` WebSocket join, presence, cap and name validation
- [ ] **35** — `[P]` WebSocket Yjs sync and awareness relay
- [ ] **36** — `[P]` App routing and serving the built frontend
- [ ] **37** — `[P]` Production compose and Dockerfiles
- [ ] **38** — `[P]` WebSocket problem switching and deleted-problem handling
- [ ] **39** — `[P]` End-to-end setup and sign-in tests
- [ ] **40** — `[P]` WebSocket run
- [ ] **41** — `[P]` Persistence across leave and restart
- [ ] **42** — `[P]` Test-secrecy sweep
- [ ] **43** — `[P]` End-to-end collaboration tests

## Tasks

### 1. `[P]` Backend skeleton: config and clock

- **Plan:** Stack, module layout (`main.py, config.py, clock.py`). **Spec:** NFR-7.
- **Files:** `backend/pyproject.toml`, `backend/app/config.py`, `backend/app/clock.py`, `backend/tests/unit/test_config.py`
- **Depends on:** nothing
- **Do:**
  - Python 3.12 project with the dependencies and dev dependencies from the plan's dependency table, and ruff configured in `pyproject.toml`.
  - `config.py` reads every setting from the environment (OIDC issuer, client id and secret, cookie key, DB URL, runner URL, role names, limits) and fails at startup if a required one is missing.
  - `clock.py` exposes `now()`, which tests can override.
- **Acceptance:**
  - *NFR-7 — no credentials ever appear in the repository.* A test shows config raises a clear error when `OIDC_CLIENT_SECRET` is unset. No default secret values appear in code.
  - A test shows the overridden `clock.now()` is returned.

### 2. `[P]` Frontend skeleton

- **Plan:** Stack (React 18 + TypeScript strict, Vite, Biome). **Spec:** FR-5, FR-18 (the UI they run in).
- **Files:** `frontend/package.json`, `frontend/tsconfig.json` + `frontend/vite.config.ts` + `frontend/biome.json` (config scaffold, counted as one), `frontend/src/main.tsx`
- **Depends on:** nothing
- **Do:**
  - Vite React-TS app with `strict: true`, Biome lint and format, and Vitest.
  - The dev server proxies `/api` to the backend.
- **Acceptance:** `npm run build`, `biome ci`, `tsc --noEmit` and one placeholder Vitest test all pass.

### 3. `[P]` Sandbox image and harness

- **Plan:** Run pipeline, step 4 (`harness.py`). **Spec:** FR-22, FR-24, FR-25, NFR-2.
- **Files:** `sandbox/harness.py`, `sandbox/Dockerfile`, `backend/tests/integration/test_sandbox_harness.py`
- **Depends on:** 1
- **Do:**
  - The harness reads `{code, function_name, cases}` on stdin.
  - It forks one child per case. Each child sends fds 1 and 2 to `/dev/null`, sets `RLIMIT_CPU` 2 s, `RLIMIT_AS` 256 MB, `RLIMIT_FSIZE` 1 MB and `RLIMIT_NPROC`, then runs the code as `solution.py` and calls the function.
  - The parent enforces 3 s of wall time per case and writes one JSON result line.
  - Tracebacks are trimmed to `solution.py` frames. Return values that can't be serialized become `error`.
  - The image is pinned `python:3.12-slim` and runs as user 65534.
  - Tests run the image with the plan's `docker run` flags.
- **Acceptance:**
  - *FR-22 — code that prints `a` and returns `a * b`.* The result has `value` 6 for args (2, 3), and the printed text appears nowhere in the output. *Code raising `ValueError("bad")`* gives `error` with message `bad` and a traceback that has only `solution.py` frames.
  - *FR-24 — an infinite loop* gives `timeout`. *Unbounded allocation* gives `memory`.
  - *FR-25 — network connection, writing outside `/scratch`, reading a host path, `os.system`, a fork bomb.* Each fails inside the case. Reading `/usr/lib/python3.12/os.py` succeeds.

### 4. `[P]` Signature parsing and test validation (pure)

- **Plan:** Signatures and tests; `problems/signature.py` contract. **Spec:** FR-3, FR-4, FR-16.
- **Files:** `backend/app/problems/signature.py`, `backend/tests/unit/test_signature.py`
- **Depends on:** 1
- **Do:**
  - Implement `parse_signature`, `validate_tests` and `starter_code` using `ast`.
  - Allowed annotations are `int`, `float`, `str`, `bool`, `list[T]`, `dict[str, T]` and `T | None`.
  - Values are compared after a JSON round-trip, and floats with a relative tolerance of 1e-9. Expose this as `values_equal` for grading.
- **Acceptance:**
  - *FR-3 —* `def add(a: int, b: int) -> int` parses to name `add`, params `a: int, b: int`, return `int`.
  - *FR-4 — zero tests* gives a `FieldError` on `tests`. *A test with three arguments for a two-parameter signature* gives a `FieldError` with that `test_index`.
  - *FR-16 —* `starter_code` of the `add` signature is that line followed by an indented `pass`.

### 5. `[P]` Grading (pure)

- **Plan:** `runs/grading.py` contract. **Spec:** FR-22, FR-23.
- **Files:** `backend/app/runs/grading.py`, `backend/tests/unit/test_grading.py`
- **Depends on:** 1
- **Do:** Implement `grade(expected, outcomes)` and `is_accepted(results)`. The mapping is: `ok` and equal → `passed`; `ok` and unequal → `wrong_answer`; `error` → `error` (keeping the message and traceback); `timeout` → `time_limit_exceeded`; `memory` → `memory_limit_exceeded`. `TestResult` has no field for args, expected or actual values.
- **Acceptance:**
  - *FR-22 — tests (2, 3) → 5 and (1, 1) → 2, outcomes `ok` 6 and `ok` 1.* Both are `wrong_answer`, and the serialized results contain none of `5`, `6`, `2, 3` or `1, 1`.
  - *FR-23 — all outcomes equal to expected.* All are `passed`, and `is_accepted` is true.

### 6. `[P]` Test stack: Postgres compose and DB fixture

- **Plan:** Test strategy (`docker-compose.test.yml`). **Spec:** FR-27 (durable storage under test).
- **Files:** `docker-compose.test.yml`, `backend/tests/conftest.py`
- **Depends on:** 1
- **Do:**
  - The compose file runs Postgres 16 for tests, with its password taken from env.
  - Fixtures give a clean database per test module and an overridable clock.
- **Acceptance:** A smoke test connects with the fixture and runs `select 1`. The compose file holds no literal password.

### 7. `[P]` `scripts/check.sh` with lint, format, secret scan and tests

- **Plan:** Test strategy (suite command), constitution rules 2, 7 and 8. **Spec:** NFR-7.
- **Files:** `scripts/check.sh`
- **Depends on:** 1, 2
- **Do:**
  - Run, in order: `ruff check`, `ruff format --check`, `biome ci`, `tsc --noEmit`, `gitleaks detect`, pytest, vitest, and playwright when `e2e/` exists.
  - Exit non-zero on the first failure.
- **Acceptance:** *NFR-7 —* a planted dummy secret in a scratch file makes the script fail at gitleaks, and the script passes once it is removed.

### 8. `[P]` Frontend typed API client

- **Plan:** Contracts (HTTP table, WebSocket message types). **Spec:** FR-3, FR-5, FR-11, FR-22.
- **Files:** `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts`
- **Depends on:** 2
- **Do:**
  - TypeScript types for `Problem`, `ProblemInput`, `RunResult` and every server and client WebSocket message, exactly as in the plan. `Problem` and `RunResult` have no test fields.
  - A fetch wrapper that maps 401, 403, 404, 422 and 423 to typed errors.
- **Acceptance:** Unit tests show that a 422 body becomes a `FieldError[]`, a 423 becomes `{stale, canReactivate}`, and a 403 becomes `missing_role`.

### 9. `[P]` DB pool, migration runner and schema

- **Plan:** Data model, `db.py`. **Spec:** FR-26, FR-27, NFR-8, NFR-9.
- **Files:** `backend/app/db.py`, `backend/app/migrations/0001_init.sql`, `backend/tests/integration/test_schema.py`
- **Depends on:** 1, 6
- **Do:**
  - An asyncpg pool.
  - A migration runner that applies numbered `.sql` files once and records them.
  - The full schema from the plan, including the `run_one_active` partial unique index.
- **Acceptance:**
  - *FR-26 —* inserting two `running` runs for one session fails on the second.
  - *NFR-8 —* no column name contains `password`.
  - Running migrations twice applies them once.

### 10. `[P]` Runner service

- **Plan:** Runner contract, run pipeline step 3. **Spec:** FR-24, FR-25, NFR-2.
- **Files:** `runner/service.py`, `runner/Dockerfile`, `backend/tests/integration/test_runner_service.py`
- **Depends on:** 3
- **Do:**
  - A stdlib HTTP server exposing `POST /execute`.
  - It runs `docker run --rm -i --network none --read-only --tmpfs /scratch:size=16m,mode=1777 --memory 256m --memory-swap 256m --pids-limit 64 --cpus 1 --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 [--runtime runsc]`, with a 20 s outer timeout.
  - Infrastructure failures return 503. Add the runner to `docker-compose.test.yml`.
- **Acceptance:**
  - *FR-24 —* an infinite loop through `/execute` gives `timeout` within the outer limit.
  - *FR-25 —* code that tries to open a socket gets `error`.
  - *NFR-2 —* the container is gone after the call (`docker ps -a` shows none).
  - With Docker unreachable, the service returns 503.

### 11. `[P]` Keycloak test realm and `login_as` fixture

- **Plan:** Test strategy (real Keycloak). **Spec:** FR-2, FR-2a, FR-31 (test users with roles).
- **Files:** `backend/tests/keycloak/realm.json`, `backend/tests/integration/keycloak_fixtures.py`, `docker-compose.test.yml` (add Keycloak)
- **Depends on:** 6
- **Do:**
  - The realm has `editor` and `admin` roles and a confidential client, with no credentials in the file.
  - Fixtures create `editor1`, `editor2`, `plain1` and `admin1` through the admin API, with random passwords per run. The admin password comes from env.
  - `login_as(client, user)` drives the real authorization code flow (posting Keycloak's login form).
- **Acceptance:** `login_as(editor1)` ends with a cookie on the test client. The realm file holds no secret, and gitleaks passes.

### 12. `[P]` Frontend auth: `useMe` and role guard

- **Plan:** Single sign-on (frontend side). **Spec:** FR-1, FR-2a.
- **Files:** `frontend/src/auth/useMe.ts`, `frontend/src/auth/RequireRole.tsx`, `frontend/src/auth/RequireRole.test.tsx`
- **Depends on:** 8
- **Do:**
  - `useMe` loads `/api/me`.
  - `RequireRole role="editor"` sends signed-out users to `/api/auth/login?next=…`, shows a "you lack the editor role" message to signed-in users without the role, and renders its children otherwise.
- **Acceptance:**
  - *FR-1 — a visitor who is not signed in opens "new problem".* They are redirected to the login URL.
  - *FR-2a — a user without the editor role.* They see the missing-role message, and the form isn't rendered.

### 13. `[P]` Problem list page with search and start session

- **Plan:** Frontend `pages/ProblemList`. **Spec:** FR-5, FR-11.
- **Files:** `frontend/src/pages/ProblemList.tsx`, `frontend/src/pages/ProblemList.test.tsx`
- **Depends on:** 8
- **Do:**
  - A search box calls `GET /api/problems?q=`.
  - Each problem has a "start session" button that calls `POST /api/sessions` and navigates to `/s/{invite_id}`.
  - The page shows the invite link for copying.
- **Acceptance:**
  - *FR-5 — problems "Two targets" and "Reverse list"; search "reverse".* Only "Reverse list" is rendered (fetch served by a test double of the HTTP boundary).
  - *FR-11 —* clicking "start session" navigates to the returned invite.

### 14. `[P]` Frontend Yjs WebSocket provider

- **Plan:** Live editing; WebSocket contract (binary frames in the y-websocket protocol, JSON text frames). **Spec:** FR-18, FR-19, FR-20.
- **Files:** `frontend/src/collab/provider.ts`, `frontend/src/collab/provider.test.ts`
- **Depends on:** 8
- **Do:**
  - Open `/api/sessions/{invite}/ws?name=`.
  - Route binary frames to the Yjs sync and awareness handlers (`messageSync = 0`, `messageAwareness = 1`), and text frames to a typed event emitter.
  - Expose `doc`, `awareness`, `send(ClientMessage)` and `on(type, handler)`.
  - Map close codes 4403, 4404, 4410 and 4422 to typed errors.
- **Acceptance:**
  - *FR-19 —* two providers on in-memory sockets connected to each other, with concurrent inserts on different lines, end with identical `Y.Text` containing both.
  - *FR-20 —* setting the local awareness cursor is observed by the peer.
  - Close code 4403 is emitted as `session_full`.

### 15. `[P]` OIDC login, callback, logout, `/api/me`

- **Plan:** Single sign-on, auth contracts. **Spec:** FR-1, FR-2b, NFR-8.
- **Files:** `backend/app/auth/oidc.py`, `backend/app/main.py`, `backend/tests/integration/test_auth.py`
- **Depends on:** 9, 11
- **Do:**
  - Use authlib for Authorization Code + PKCE.
  - The callback validates tokens against JWKS and stores `{sub, name, roles, exp}` in a signed HttpOnly SameSite=Lax cookie.
  - Implement `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout` and `/api/me`.
  - `main.py` is the app factory with session middleware.
- **Acceptance:**
  - *FR-1 —* `GET /api/auth/login` redirects (302) to the Keycloak authorize URL.
  - *FR-2b — a user already signed in to Keycloak.* The second `login_as` in the same Keycloak session completes without posting credentials.
  - *NFR-8 —* the decoded cookie holds only `sub`, `name`, `roles` and `exp`.
  - After `login_as(editor1)`, `/api/me` shows `signed_in` and `editor`. After logout it shows `signed_in: false`.

### 16. `[P]` Problems repository

- **Plan:** Data model (`problem`, `problem_test`), soft delete, search. **Spec:** FR-3, FR-5, FR-8.
- **Files:** `backend/app/problems/repo.py`, `backend/tests/integration/test_problems_repo.py`
- **Depends on:** 4, 9
- **Do:** create (with tests), get public (no tests), get with tests, case-insensitive substring search on title or description excluding deleted, update (replacing tests), soft delete, and list tests for grading.
- **Acceptance:**
  - *FR-5 — "Two targets" and "Reverse list" exist; search "reverse".* Only "Reverse list" is returned.
  - *FR-8 —* after a soft delete the problem is absent from search, but its row still exists.
  - *FR-3 —* the creator `sub` is recorded.

### 17. `[P]` Runner client

- **Plan:** Runner contract (api side). **Spec:** FR-21.
- **Files:** `backend/app/runs/runner_client.py`, `backend/tests/integration/test_runner_client.py`
- **Depends on:** 10
- **Do:** `async execute(code, function_name, cases) -> list[CaseOutcome]` over httpx. A 503 or a connection error raises `RunnerUnavailable`.
- **Acceptance:**
  - *FR-21 —* `return a + b` with cases `[[2, 3]]` against the real runner returns `ok` with value 5.
  - With the runner stopped, the call raises `RunnerUnavailable`.

### 18. `[P]` Runs repository

- **Plan:** Data model (`run`, `run_result`, `session_problem.accepted`), one run at a time. **Spec:** FR-23, FR-26, FR-27.
- **Files:** `backend/app/runs/repo.py`, `backend/tests/integration/test_runs_repo.py`
- **Depends on:** 9
- **Do:**
  - `start_run` inserts a `running` row with its code and raises `RunInProgress` on the unique-index violation.
  - `finish_run` stores the results and the status.
  - `mark_accepted` updates `session_problem`.
  - `last_run(session, problem)`.
- **Acceptance:**
  - *FR-26 —* two concurrent `start_run` calls produce one row and one `RunInProgress`.
  - *FR-27 —* two finished runs are both retrievable with their code and results.
  - *FR-23 —* `mark_accepted` sets `accepted` and `accepted_at`.

### 19. `[P]` Sessions repository

- **Plan:** Data model (`session`, `session_problem`, `participant`, `yjs_update`, `session_event`), invite ID. **Spec:** FR-11, FR-27, FR-29, NFR-4.
- **Files:** `backend/app/sessions/repo.py`, `backend/tests/integration/test_sessions_repo.py`
- **Depends on:** 9
- **Do:**
  - create (invite from `secrets.token_urlsafe(16)`), get by invite, set the current problem.
  - Add and leave participants, append events, touch `last_activity_at`.
  - Append and load `yjs_update`, set and clear `stale_at`.
  - No delete functions for session tables.
- **Acceptance:**
  - *FR-11 / NFR-4 —* two sessions get distinct invite IDs of at least 22 characters (128 bits).
  - *FR-27 —* participants "Ada" and "Linus" and the appended updates are all reloadable.
  - The module contains no `DELETE` statement.

### 20. `[P]` Problem form page: create, edit, delete

- **Plan:** Frontend `pages/ProblemForm`. **Spec:** FR-3, FR-4, FR-7, FR-8.
- **Files:** `frontend/src/pages/ProblemForm.tsx`, `frontend/src/pages/ProblemForm.test.tsx`
- **Depends on:** 12
- **Do:**
  - The form has title, description and signature, plus a test list (args as JSON, expected as JSON) that rows can be added to and removed from.
  - Create mode posts. Edit mode loads `/edit`, puts, and offers delete.
  - Each 422 `FieldError` is shown next to its field or test row.
  - The page is wrapped in `RequireRole editor`.
- **Acceptance:**
  - *FR-4 — submitting with zero tests.* A message on the tests section names the missing tests.
  - *FR-4 — a 422 with `test_index` 0* is shown on test row 1.
  - *FR-7 —* edit mode shows the existing tests.
  - *FR-8 —* delete calls `DELETE` and navigates to the list.

### 21. `[P]` Collaborative editor and presence list

- **Plan:** Live editing (frontend), CodeMirror with `y-codemirror.next`. **Spec:** FR-15, FR-16, FR-18, FR-20.
- **Files:** `frontend/src/components/CodeEditor.tsx`, `frontend/src/components/PresenceList.tsx`, `frontend/src/components/collab.test.tsx`
- **Depends on:** 14
- **Do:**
  - `CodeEditor` binds CodeMirror (Python mode) to `doc.getText("code:" + problemId)` with remote cursors labelled by awareness `name`.
  - `PresenceList` renders the latest `presence` message.
- **Acceptance:**
  - *FR-15 — a presence update without "Linus"* removes Linus from the list.
  - *FR-20 — a peer's awareness cursor on line 3 with name "Linus"* renders a labelled remote cursor.
  - *FR-16 —* the editor shows the `Y.Text` content.

### 22. `[P]` Role dependencies

- **Plan:** Single sign-on (`auth/deps.py`). **Spec:** FR-2, FR-2a.
- **Files:** `backend/app/auth/deps.py`, `backend/tests/integration/test_auth_deps.py`
- **Depends on:** 15
- **Do:** `current_user` (optional) and `require_role(name)`. The latter returns 401 when signed out and 403 `{error: "missing_role", role}` when the role is missing.
- **Acceptance:**
  - *FR-2 —* `login_as(editor1)` on a test route behind `require_role("editor")` gives 200.
  - *FR-2a —* `login_as(plain1)` gives 403 `missing_role`. Signed out gives 401.

### 23. `[P]` Server-side collaborative document

- **Plan:** Live editing (`sessions/collab.py`). **Spec:** FR-16, FR-19, FR-27.
- **Files:** `backend/app/sessions/collab.py`, `backend/tests/integration/test_collab.py`
- **Depends on:** 4, 19
- **Do:**
  - Load a pycrdt `Doc` by replaying the session's `yjs_update` rows.
  - `apply_update` applies an update and appends it.
  - `ensure_problem_text(problem)` writes the starter code if `code:{pid}` is empty, recording that as an update too.
  - `get_code(pid)`.
  - Keep one in-memory doc per active session.
- **Acceptance:**
  - *FR-16 —* a new session on `def add(a: int, b: int) -> int` has `get_code` equal to the starter code.
  - *FR-19 — two pycrdt clients send concurrent inserts on different lines.* The server doc and both clients are identical and contain both edits.
  - *FR-27 —* a freshly loaded doc from the DB equals the in-memory one.

### 24. `[P]` Runs service: execute, grade, persist

- **Plan:** Run pipeline steps 1, 2 and 5. **Spec:** FR-21, FR-22, FR-23, FR-24, FR-26.
- **Files:** `backend/app/runs/service.py`, `backend/tests/integration/test_runs_service.py`
- **Depends on:** 5, 16, 17, 18
- **Do:**
  - `run(session_id, problem_id, code, participant_id) -> RunResult`: `start_run`, load the tests, call the runner with args only, grade, `finish_run`, and mark accepted if every test passed.
  - `RunnerUnavailable` gives status `infra_error`.
  - The caller supplies the code, so this service doesn't depend on sessions.
- **Acceptance:**
  - *FR-22 — `a * b` against (2, 3) → 5 and (1, 1) → 2.* Two `wrong_answer` results.
  - *FR-23 — `a + b`.* All `passed`, and `session_problem.accepted`.
  - *FR-24 — an infinite loop* gives `time_limit_exceeded`.
  - *FR-26 —* a concurrent second call raises `RunInProgress`.
  - The runner request body contains no `expected`.

### 25. `[P]` Seed loader

- **Plan:** Seed (`problems/seed.py`). **Spec:** FR-6.
- **Files:** `backend/app/problems/seed.py`, `backend/tests/integration/test_seed_loader.py`
- **Depends on:** 16
- **Do:**
  - At startup, read `seed/problems/*/problem.json` and insert the missing ones with `is_starter = true`, identified by folder name and safe to run more than once.
  - Validate each with `signature.py` and fail loudly if one is invalid.
  - Tests use a two-problem fixture directory.
- **Acceptance:**
  - *FR-6 —* loading the fixture twice gives exactly 2 starter problems, each with at least 1 test.
  - An invalid fixture problem raises an error naming its folder.

### 26. `[P]` Stale-session job

- **Plan:** Inactivity and stale sessions. **Spec:** FR-29, NFR-9.
- **Files:** `backend/app/sessions/stale.py`, `backend/app/main.py` (start the hourly task), `backend/tests/integration/test_stale.py`
- **Depends on:** 19
- **Do:**
  - `mark_stale(now)` sets `stale_at` where `stale_at` is null and `last_activity_at < now - 30 days`, and logs a `stale` event.
  - Schedule it hourly at startup.
- **Acceptance:**
  - *FR-29 — a session whose last activity was 31 days ago.* It is marked stale, and every table's row count is unchanged except `session_event`, which gains one row.
  - A session at 29 days is not marked.
  - *NFR-9 —* nothing is deleted.

### 27. `[P]` Session join page: name, not found, full, stale, reactivate

- **Plan:** Frontend `pages/SessionPage` (join states), `pages/NotFound`. **Spec:** FR-12, FR-12a, FR-13, FR-14, FR-30, FR-31, FR-32.
- **Files:** `frontend/src/pages/SessionPage.tsx`, `frontend/src/pages/NotFound.tsx`, `frontend/src/pages/SessionPage.test.tsx`
- **Depends on:** 12, 14
- **Do:**
  - On load, `GET /api/sessions/{invite}`:
    - 404 shows NotFound.
    - 423 shows the stale notice, plus a reactivate button when `can_reactivate`.
    - 200 shows the name prompt, which trims the name and checks it is 1–30 characters before connecting.
  - Close codes 4403 and 4422 are shown as messages.
  - Once joined, render a slot for the editor and run panel (wired in task 36).
- **Acceptance:**
  - *FR-12a — an empty name, or a name of 31 characters.* Refused with a reason, and no connection is made. 30 characters connects.
  - *FR-13 — close code 4403.* A "session is full" message.
  - *FR-14 — a 404.* "Session not found".
  - *FR-30 — a 423 with `can_reactivate: false`.* The stale notice, and no reactivate button.
  - *FR-31 / FR-32 — `can_reactivate: true`.* Clicking reactivate posts, then shows the name prompt.

### 28. `[P]` Run panel, results and problem switcher

- **Plan:** WebSocket contract (run and switch messages), frontend components. **Spec:** FR-10, FR-17, FR-21, FR-22, FR-23, FR-26.
- **Files:** `frontend/src/components/RunPanel.tsx`, `frontend/src/components/ProblemSwitcher.tsx`, `frontend/src/components/run.test.tsx`
- **Depends on:** 21
- **Do:**
  - `RunPanel` has a run button that sends `{type: "run"}`. It is disabled with a "running" indicator between `run_started` and `run_finished`.
  - Results are listed by test number with their outcome, and the error message and traceback for `error`. An "accepted" badge appears when accepted.
  - A notice appears for `problem_deleted`, with run disabled.
  - `ProblemSwitcher` searches problems and sends `switch_problem`.
- **Acceptance:**
  - *FR-22 — a `run_finished` with two `wrong_answer` results.* "Test 1: wrong answer" and "Test 2: wrong answer" are rendered, with no values.
  - *FR-23 —* all passed shows the accepted badge.
  - *FR-26 —* after `run_started`, the button is disabled and the indicator is shown.
  - *FR-10 —* `problem_deleted` disables run and shows the notice, and the switcher stays usable.
  - *FR-17 —* choosing a problem sends `switch_problem`.

### 29. `[P]` Problems API: create, search, public get

- **Plan:** HTTP contracts (`GET /api/problems`, `GET /api/problems/{id}`, `POST /api/problems`), `problems/service.py`. **Spec:** FR-1, FR-2, FR-2a, FR-3, FR-4, FR-5, FR-9, NFR-5.
- **Files:** `backend/app/problems/service.py`, `backend/app/problems/api.py`, `backend/tests/integration/test_problems_api.py`
- **Depends on:** 16, 22
- **Do:** Implement the three endpoints. POST is behind `require_role("editor")` and validates with `signature.py`, returning 422 `{errors}`. Public responses have no tests. Include the router in `main.py`.
- **Acceptance:**
  - *FR-1 —* signed-out POST gives 401, and no row.
  - *FR-2a — `plain1` POSTs.* 403 `missing_role`, and no row.
  - *FR-3 — `editor1` submits "Sum two" with `def add(a: int, b: int) -> int` and test (2, 3) → 5.* 201, and search "Sum two" lists it.
  - *FR-4 —* zero tests gives 422 naming the tests. A three-argument test gives 422 with `test_index`.
  - *FR-5 —* search "reverse" works as in the spec.
  - *FR-9 / NFR-5 —* `GET /api/problems/{id}` has no `tests` key.

### 30. `[P]` Sessions REST: create, status, reactivate

- **Plan:** HTTP contracts (`/api/sessions…`), `sessions/service.py`. **Spec:** FR-8, FR-11, FR-14, FR-30, FR-31, FR-32.
- **Files:** `backend/app/sessions/service.py`, `backend/app/sessions/api.py`, `backend/tests/integration/test_sessions_api.py`
- **Depends on:** 16, 19, 22
- **Do:**
  - `POST /api/sessions` needs no auth and returns 404 for a deleted or missing problem.
  - `GET /api/sessions/{invite}` returns 200, 404, or 423 with `can_reactivate` true only for admins.
  - `POST /api/sessions/{invite}/reactivate` is admin-only: it clears `stale_at`, sets `last_activity_at = now`, logs a `reactivated` event, and returns 409 if the session isn't stale.
  - Include the router in `main.py`.
- **Acceptance:**
  - *FR-11 — a visitor without an account starts a session.* 201 with an invite, and two calls give distinct IDs.
  - *FR-8 —* a deleted problem gives 404.
  - *FR-14 — `doesnotexist`.* 404 `not_found`, and the body has no other data.
  - *FR-30 —* stale, anonymous: 423 with `can_reactivate: false`.
  - *FR-31 —* `login_as(admin1)` gives 423 with `can_reactivate: true`.
  - *FR-32 —* an admin reactivates, then GET gives 200. Reactivating as `plain1` gives 403.

### 31. `[P]` Starter problems 1–10

- **Plan:** Seed (`seed/problems/NN-slug/`). **Spec:** FR-6, NFR-3.
- **Files:** `seed/problems/01-…` through `10-…` (`problem.json` + `reference.py` each; content only), `backend/tests/integration/test_seed_content.py`
- **Depends on:** 17, 25
- **Do:**
  - Ten mostly easy problems written for this project: original wording, no copied text. Use mixed topics (for example arrays, strings, hash maps, math), with only JSON-type signatures.
  - Each has at least 5 tests, including edge cases, plus `topic` and `difficulty`.
  - The test runs every reference solution through the real runner.
- **Acceptance:**
  - *FR-6 —* each problem validates and its reference solution gets all `ok` with values equal to expected.
  - *NFR-3 —* each completes in under 10 s.

### 32. `[P]` Starter problems 11–20

- **Plan:** Seed. **Spec:** FR-6, NFR-3.
- **Files:** `seed/problems/11-…` through `20-…` (content only); extends `test_seed_content.py`
- **Depends on:** 17, 25
- **Do:** Ten more problems, as in task 31, covering topics not yet used (for example two pointers, stacks, sorting, dynamic programming). Mostly easy, with at most 4 medium across all 20.
- **Acceptance:**
  - *FR-6 — a fresh install lists all problems.* Exactly 20 starter problems, more than one distinct `topic`, every one with at least 1 test, and every reference solution passes.
  - *NFR-3 —* each completes in under 10 s.

### 33. `[P]` Problems API: edit, update, delete

- **Plan:** HTTP contracts (`GET …/edit`, `PUT`, `DELETE`), deletion callback. **Spec:** FR-2, FR-7, FR-8, FR-9.
- **Files:** `backend/app/problems/service.py`, `backend/app/problems/api.py`, `backend/tests/integration/test_problems_edit_api.py`
- **Depends on:** 29
- **Do:**
  - All three endpoints are behind `require_role("editor")`.
  - `DELETE` soft-deletes, then calls the registered `on_problem_deleted` callbacks. `problems` exposes the registry, and `sessions` registers itself in task 38, so `problems` never imports `sessions`.
- **Acceptance:**
  - *FR-7 — `editor1` created "Sum two" with one test; `editor2` adds (0, 0) → 0.* `GET …/edit` shows 2 tests, and editing a starter problem's description is saved.
  - *FR-8 — `editor2` deletes it.* Search no longer lists it, and the callback is invoked once. Deleting a starter problem behaves the same.
  - *FR-9 —* signed out and `plain1`: `PUT`, `DELETE` and `GET …/edit` are refused, and nothing changes.

### 34. `[P]` WebSocket join, presence, cap and name validation

- **Plan:** Presence and the cap of 5, dropped-connection detection, WebSocket close codes (`sessions/hub.py`, `sessions/ws.py`). **Spec:** FR-12, FR-12a, FR-13, FR-14, FR-15, FR-30.
- **Files:** `backend/app/sessions/hub.py`, `backend/app/sessions/ws.py`, `backend/tests/integration/test_ws_presence.py`
- **Depends on:** 30
- **Do:**
  - On connect, look up the session (missing → close 4404, stale → 4410).
  - Validate the trimmed name is 1–30 characters (otherwise close 4422).
  - Enforce the cap of 5 (otherwise close 4403).
  - Record the participant and a `joined` event, touch activity, send `welcome`, and broadcast `presence`.
  - On disconnect, set `left_at`, log `left`, and broadcast presence.
  - Configure uvicorn pings at 2 s with a 3 s timeout.
  - Include the router in `main.py`.
- **Acceptance:**
  - *FR-12 — a second visitor joins as "Ada".* Both receive presence containing Ada.
  - *FR-12a —* a 31-character name closes with 4422 and adds no participant row. 30 characters joins.
  - *FR-13 —* with 5 connected, a sixth closes with 4403, and presence is still 5.
  - *FR-14 —* `doesnotexist` closes with 4404.
  - *FR-15 — Linus disconnects, either cleanly or by stopping ping replies.* Ada's presence drops Linus within 5 s.
  - *FR-30 —* a stale session closes with 4410.

### 35. `[P]` WebSocket Yjs sync and awareness relay

- **Plan:** Live editing (server relay), WebSocket binary frames. **Spec:** FR-16, FR-18, FR-19, FR-20.
- **Files:** `backend/app/sessions/ws.py`, `backend/app/sessions/hub.py`, `backend/tests/integration/test_ws_collab.py`
- **Depends on:** 23, 34
- **Do:**
  - Handle y-websocket sync step 1, sync step 2 and updates through `collab.py`, which persists each update.
  - Broadcast updates to the other connections, and touch activity at most once per minute.
  - Relay awareness frames to the others without persisting them.
  - `ensure_problem_text` runs for the current problem on join.
- **Acceptance:**
  - *FR-16 —* a new client's synced doc has the starter code under `code:{pid}`.
  - *FR-18 — Ada sends an update with `return a + b`.* Linus's client receives it.
  - *FR-19 —* concurrent updates from two clients converge to identical text with both edits.
  - *FR-20 —* Linus's awareness frame reaches Ada.

### 36. `[P]` App routing and serving the built frontend

- **Plan:** Deploy (`api` serves the built frontend). **Spec:** FR-1, FR-11, FR-12.
- **Files:** `frontend/src/App.tsx`, `frontend/src/main.tsx`, `backend/app/main.py` (static mount with SPA fallback)
- **Depends on:** 13, 15, 20, 27, 28
- **Do:**
  - Routes: `/` → ProblemList, `/problems/new` and `/problems/:id/edit` → ProblemForm, `/s/:invite` → SessionPage composed with CodeEditor, PresenceList, RunPanel and ProblemSwitcher.
  - The backend serves `frontend/dist` and falls back to `index.html` for any path not under `/api`.
- **Acceptance:**
  - A router test renders each route with its page.
  - A backend integration test: `GET /s/abc` returns `index.html`, and `GET /api/problems` still returns JSON.

### 37. `[P]` Production compose and Dockerfiles

- **Plan:** Deploy; constitution rule 7. **Spec:** NFR-7, NFR-8.
- **Files:** `docker-compose.yml`, `backend/Dockerfile` (multi-stage: builds the frontend, then the api), `.env.example`
- **Depends on:** 10, 36
- **Do:**
  - Services `db`, `api` (`--workers 1`, with ping settings) and `runner` (the only one with the Docker socket).
  - The sandbox image is built and pinned.
  - Keycloak is external, reached through `OIDC_ISSUER`.
  - `.env.example` lists every variable with placeholder values.
- **Acceptance:**
  - `docker compose config` is valid, and `docker compose up` gives `GET /api/problems` returning the starter problems.
  - Only `runner` mounts `/var/run/docker.sock`.
  - *NFR-7 —* gitleaks passes on all three files.

### 38. `[P]` WebSocket problem switching and deleted-problem handling

- **Plan:** Live editing (one `Y.Text` per problem), deleted problems, deletion callback. **Spec:** FR-10, FR-17.
- **Files:** `backend/app/sessions/ws.py`, `backend/app/sessions/service.py`, `backend/tests/integration/test_ws_switch.py`
- **Depends on:** 33, 35
- **Do:**
  - `switch_problem` sets the current problem, upserts `session_problem`, runs `ensure_problem_text`, logs a `switched` event, touches activity, and broadcasts `problem_switched` with the `Problem` and that problem's state.
  - Register `on_problem_deleted`, which broadcasts `problem_deleted` to sessions on that problem.
  - `welcome` reports `deleted`.
- **Acceptance:**
  - *FR-17 — Ada and Linus on "Sum two" with `return a + b`; Ada switches to "Reverse list".* Both receive `problem_switched` and the starter text. When Linus switches back, both see `return a + b` and the previous last run.
  - *FR-10 — an editor deletes "Sum two" while the session is on it.* Clients receive `problem_deleted`, the code is still `return a + b`, and `switch_problem` still works.

### 39. `[P]` End-to-end setup and sign-in tests

- **Plan:** Test strategy (Playwright against the composed stack, real Keycloak). **Spec:** FR-1, FR-2b.
- **Files:** `e2e/playwright.config.ts`, `e2e/fixtures.ts`, `e2e/auth.spec.ts`
- **Depends on:** 11, 37
- **Do:** Playwright runs against `docker compose` plus the test Keycloak. Fixtures provide test users with runtime passwords, and helpers open N browser contexts.
- **Acceptance:**
  - *FR-1 — a visitor who is not signed in opens "new problem".* They land on the Keycloak login page.
  - *FR-2b — a user already signed in to Keycloak's account console opens `/problems/new`.* The form appears with no credential prompt.

### 40. `[P]` WebSocket run

- **Plan:** Run pipeline, one run at a time, WebSocket `run` messages. **Spec:** FR-10, FR-21, FR-22, FR-23, FR-26.
- **Files:** `backend/app/sessions/ws.py`, `backend/app/sessions/service.py`, `backend/tests/integration/test_ws_run.py`
- **Depends on:** 24, 38
- **Do:**
  - On `run`: refuse with `error: problem_deleted` if the current problem is deleted.
  - Otherwise read `collab.get_code`, broadcast `run_started`, call `runs.service.run`, and broadcast `run_finished`. Log the events and touch activity.
  - Answer `RunInProgress` with `error: run_in_progress` to the sender only, and `infra_error` likewise.
- **Acceptance:**
  - *FR-21 — Ada sends `run`.* Ada and Linus receive the same `run_finished`.
  - *FR-22 — `a * b` with a print.* Two `wrong_answer` results, and the raw WebSocket text contains none of `2, 3`, `5`, `6`, `1, 1` or the printed text. `ValueError("bad")` gives `error` with "bad" and a traceback.
  - *FR-23 — `a + b`.* Every participant sees accepted.
  - *FR-26 — two `run` messages at once.* Exactly one `run_started`, and the other sender gets `run_in_progress`.
  - *FR-10 —* on a deleted problem, `run` gives `error: problem_deleted`.

### 41. `[P]` Persistence across leave and restart

- **Plan:** Data model and the FR-27 notes; test strategy rows FR-27 and FR-28. **Spec:** FR-27, FR-28.
- **Files:** `backend/tests/integration/test_persistence.py` (plus fixes in the module that fails, if any)
- **Depends on:** 40
- **Do:** A scenario test through the WebSocket. If it exposes a gap, fix it in that one module.
- **Acceptance:**
  - *FR-27 — Ada and Linus join, run `return a * b` (fails), then `return a + b` (accepted); everyone leaves and a fresh app instance starts on the same DB.* Both runs are stored with their code and results, along with the current code, the accepted status, and participants Ada and Linus.
  - *FR-28 — the clock moves 29 days ahead and someone reconnects.* The editor doc has `return a + b`, and `welcome` shows accepted.

### 42. `[P]` Test-secrecy sweep

- **Plan:** Hidden tests; test strategy row NFR-5. **Spec:** NFR-5, FR-9, FR-22.
- **Files:** `backend/tests/integration/test_secrecy.py`
- **Depends on:** 33, 40
- **Do:** Create a problem whose test values are unique sentinel strings. Exercise every public HTTP endpoint and every WebSocket message type as an anonymous participant and as `plain1`.
- **Acceptance:**
  - *NFR-5 — tests are never sent to anyone except editors.* No response or message contains a sentinel, or a `tests`, `args` or `expected` key.
  - *FR-9 —* only `editor1` sees the sentinels, through `GET …/edit`.

### 43. `[P]` End-to-end collaboration tests

- **Plan:** Test strategy rows FR-18, FR-19, FR-20 and NFR-1. **Spec:** FR-18, FR-19, FR-20, NFR-1.
- **Files:** `e2e/collab.spec.ts`
- **Depends on:** 35, 39
- **Do:** Two browser contexts, Ada and Linus, join the same session.
- **Acceptance:**
  - *FR-18 / NFR-1 — Ada types `return a + b`.* Linus's editor shows it within 500 ms (measured).
  - *FR-19 — both type on different lines at the same moment.* Both editors end with identical code containing both edits.
  - *FR-20 — Linus places his cursor on line 3.* Ada sees a marker on line 3 labelled "Linus".
