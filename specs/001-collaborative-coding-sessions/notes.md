# 001 — Collaborative coding sessions: notes

## 2026-10-20 — validation (`/sdd-validate`)

### Tasks

All 43 tasks in `tasks.md` are ticked.

### Test run

`scripts/check.sh`, first run: **failed** at the gitleaks working-tree step. It found 4 `generic-api-key` hits, all in `e2e/.keycloak-state.json` (see finding 1).

After moving that file aside (it is regenerated on every run), the second run **exited 0**:

| Step | Result |
|---|---|
| ruff check, ruff format, biome, tsc | pass |
| gitleaks (history, working tree) | pass |
| pytest | 209 passed, 3 warnings (deprecations: starlette/httpx, `authlib.jose`) |
| vitest | 47 passed, 9 files |
| playwright | 5 passed (FR-1, FR-2b, FR-18/NFR-1, FR-19, FR-20) |

Every FR and NFR id has at least one test carrying its id, or (for NFR-3, NFR-4, NFR-6) an assertion that names it.

### Acceptance criteria

I checked each criterion against the code's behaviour as well as its tests. Where the code contradicts the spec, the criterion is marked FAIL or PARTIAL even though its tests pass.

| Criterion | Result | Note |
|---|---|---|
| FR-1, FR-2, FR-2a, FR-2b | PASS | FR-1 and FR-2b exercised end-to-end against Keycloak. |
| FR-3, FR-4, FR-5 | PASS | |
| FR-6 | PASS | 20 starters; reference solutions pass, each under 10 s (NFR-3). |
| FR-7 | **PARTIAL** | The edit is saved. But after renaming a starter problem, the next restart brings the original back (finding 2). |
| FR-8, FR-9, FR-10 | PASS | Deletion is a soft delete, so a deleted starter is not re-seeded. |
| FR-11, FR-12, FR-12a, FR-14, FR-15, FR-16, FR-17 | PASS | |
| FR-13 | **FAIL under concurrency** | Joins that arrive together can exceed 5 (finding 3). The sequential case passes. |
| FR-18 / NFR-1 | **PARTIAL** | Holds in general. It fails for the participant who clicked run, until the run finishes (finding 5). |
| FR-19, FR-20, FR-21, FR-22, FR-23, FR-24, FR-25 | PASS | |
| FR-26 | **PARTIAL** | No second run starts. But a participant who joins mid-run sees no "running" indicator (finding 4). |
| FR-27, FR-28, FR-29, FR-30, FR-31, FR-32 | PASS | Activity is touched on join, edit (throttled to once a minute), switch and run. The stale job runs hourly from the app lifespan. |
| NFR-2, NFR-4, NFR-5, NFR-6, NFR-8, NFR-9 | PASS | Invite id is 128-bit `secrets.token_urlsafe(16)`. |
| NFR-7 | **PARTIAL** | No credentials are committed. But a credentials file is left untracked and not gitignored after every e2e run (finding 1). |

### Findings

1. **`e2e/.keycloak-state.json` is left behind, unignored.** `e2e/global-setup.ts` writes it with the generated test-user passwords. `global-teardown.ts` deletes `.env` but not this file, and no `.gitignore` covers it. Consequences:
   - Every `scripts/check.sh` after the first e2e run fails its own secret scan, so the check that gates task ticking (constitution rules 2 and 8) is not repeatable.
   - `git add .` would commit the file. The passwords are throwaway, but this is the NFR-7 class of problem.

   Fix: delete it in teardown and gitignore it.
2. **Re-seeding is keyed by title (`backend/app/problems/seed.py`), and runs on every startup (`app/asgi.py`).** If an editor renames a starter problem, the next restart inserts a fresh copy under the original title. That undoes the intent of FR-7 (edit any starter problem) and of FR-6 (exactly 20 starters, no duplicates). It is also a plan-level choice: plan.md's "Seed" section picked title as the identity. Options: seed once into an empty catalogue, or key on a stable seed id stored with the problem.
3. **The cap of 5 can be exceeded (FR-13).** In `sessions/ws.py`, `session_hub.is_full()` is checked, then three DB awaits run (`add_participant`, `append_event`, `touch_activity`), then `session_hub.add()` happens. Concurrent joins all pass the check.
   - Reproduced: 6 handlers started concurrently on one session, 6 present, none closed with 4403. The repro was a throwaway test, now deleted.
   - Fix: reserve the hub slot before the first await, the same way `_RUNNING` is guarded for runs.
4. **Joining mid-run shows no running indicator (FR-26).** `welcome` hard-codes `"run_in_progress": False`. Someone who joins during a run missed `run_started`, so they see no "running" state until `run_finished` arrives. It should report `session.id in _RUNNING`.
5. **A run blocks its initiator's connection (FR-18 / NFR-1).** `_handle_run` is awaited inside that participant's receive loop. For the length of the run (up to about 10 s), that participant's own edits and cursor moves are neither applied nor relayed. Everyone else is unaffected. Fix: run it as a separate task.

### Spec / plan drift

- spec.md: nothing found stale. Every finding above is the implementation (or plan) diverging from the spec, not the spec being wrong.
- **plan.md is now stale on: seed identity ("Seed" section — starter problems identified by title). Update it before the next change to this feature.** (Finding 2.)

### Not covered by this pass

- NFR-1 measured only on localhost (Playwright), not "normal network conditions".
- FR-15's "within a few seconds" for a *silently dropped* connection relies on uvicorn's ws ping settings in compose. The e2e tests cover a clean leave, not a dropped one.

## 2026-10-20 — fixes for findings 1 and 3

- **Finding 1 fixed.** `e2e/global-teardown.ts` now deletes `e2e/.keycloak-state.json`, and `.gitignore` lists it. `scripts/check.sh` run twice back to back: both exit 0.
- **Finding 3 fixed.** `SessionHub.try_reserve()` takes a seat in the same synchronous step as the cap check, before the join's DB awaits. `add()` consumes the seat, and a failed join gives it back. `is_full()` is removed. New test `test_fr13_six_concurrent_joins_admit_only_5` failed before the fix (6 admitted) and passes after it. pytest: 210 passed.
- Still open: findings 2, 4, 5 and the plan.md seed-identity drift.

## 2026-10-20 — second review pass

This pass reviewed the code the first pass hadn't read: the REST APIs, the sessions service, `collab.py`, the runs service, the runner, the sandbox harness and the session UI. Findings continue the numbering above, most severe first. Nothing was fixed in this pass.

6. **Switching problems doesn't change the editor (FR-17).** `SessionPage` sets `joined.problemId` only from `welcome`, and nothing handles `problem_switched`. So after a switch, every participant's `CodeEditor` stays bound to the previous problem's `Y.Text`. Related gap: the session page never shows the current problem's title or description, so participants never see the problem statement they are solving. The backend's switch protocol is correct and tested; only the UI is broken. The frontend FR-17 test checks only that `switch_problem` is sent.
7. **User code can read every test's inputs (FR-25, NFR-5).** `sandbox/harness.py` forks each case's child from a parent whose `main()` frame holds the whole request, including all cases. Reproduced in `collab-sandbox:test`: walking `sys._getframe()` up to `request` and raising it put `[[2, 3], [41, 99], [7, 8]]` (every test's inputs) into test 1's error message. NFR-5's accepted leak covers a value from the test being run turning up in its own error message, not reading every test's inputs. FR-25's criterion ("read … the problem's tests → the attempt fails") fails. Clearing references in the child isn't enough, because `gc.get_objects()` still reaches the list. Each case needs a process that never held the other cases, e.g. a fresh interpreter per case fed only its own args.
8. **Accepted status and previous results are never shown on rejoin or switch-back (FR-28, FR-17).** The server sends them in `welcome.problems` and `problem_switched.state`, and the UI drops both. `RunPanel` ignores `welcome`, and on `problem_switched` it does `setResult(null)`. Someone reopening a session sees no "Accepted" until a new run, and "switching back restores … its previous results" doesn't happen. The backend FR-27/FR-28 tests pass because they assert on the protocol, not the UI.
9. **A runner failure leaves everyone stuck on "Running…" (FR-26).** `run_started` is broadcast to all, but on `infra_error` the server sends `{type: "error"}` only to the participant who clicked run, and never sends `run_finished`. Every `RunPanel` keeps `running = true` and Run disabled until a problem switch or a reload, even though the server would accept a new run.
10. **The deleted state is lost on join, and run errors are silent (FR-10).** `welcome.current_problem.deleted` is ignored, so joining a session on a deleted problem shows no notice and an enabled Run button. The server's `error` replies (`problem_deleted`, `run_in_progress`, `infra_error`) aren't handled anywhere in the UI, so clicking Run then does nothing visible.
11. **Signing in lasts 14 days regardless of the token (FR-2, FR-31, NFR-8).** `exp` is stored in the session cookie but never checked (`auth/deps.py`). `SessionMiddleware` uses Starlette's default `max_age` of 14 days and `https_only=False`. So an editor or admin role removed in Keycloak keeps working on this site for up to 14 days.
12. **The invite link appears and then vanishes at once (FR-11).** `ProblemList` sets `inviteUrl` and immediately navigates to `/s/<invite>`, which unmounts it. The session page doesn't show the link, so only the address bar has it.
13. **Switching to an unknown problem id drops the sender's connection.** `service.switch_problem` lets `problems_repo.NotFound` propagate out of the WebSocket loop. Only a hand-crafted message can trigger it, and only the sender is affected.

Why the suite missed 6, 8, 9 and 10: the frontend tests check each component on its own, and the end-to-end tests cover only FR-1, FR-2b, FR-18, FR-19 and FR-20. No end-to-end test switches problems, runs code, or rejoins a session.

Revised criterion results, replacing the first pass where they differ:

| Criterion | Result |
|---|---|
| FR-17 | **FAIL** (6, 8) |
| FR-25 | **FAIL** (7) |
| FR-28 | **FAIL** in the UI (8) |
| FR-10 | **PARTIAL** (10) |
| FR-26 | **PARTIAL** (4, 9) |
| FR-11 | **PARTIAL** (12) |
| NFR-5 | **FAIL** (7) |

Spec drift: none new. Each finding is the implementation diverging from spec.md.

## 2026-10-20 — fixes for findings 2, 4–13

Every fix was test-first: each new test failed before its fix. `scripts/check.sh` exits 0: pytest 220, vitest 58, Playwright 5, no leaks.

| # | Fix | Test(s) |
|---|---|---|
| 2 | `seed.py` seeds once, only while no starter problem has ever existed (deleted ones count). It validates every folder first and inserts in one transaction. | `test_fr7_a_renamed_starter_problem_is_not_re_seeded`, `test_fr8_a_deleted_starter_problem_is_not_re_seeded`, `test_a_seed_with_an_invalid_problem_inserts_nothing` |
| 4 | `welcome.run_in_progress` reports the real state. | `test_fr26_joining_mid_run_reports_run_in_progress`; UI: `FR-26: joining mid-run shows the running indicator` |
| 5 | A run is a task with its own pool connection. `_RUNNING` is still claimed synchronously before the task starts. Shutdown drains in-flight runs (`drain_runs`) before the pool closes. | `test_fr18_the_runners_own_edits_are_relayed_during_a_run` |
| 6 | `SessionPage` follows `problem_switched` (editor, title, description) and shows the problem statement. | `FR-17: shows the current problem, and a switch moves the editor and the problem` |
| 7 | The harness starts a fresh interpreter per case, given only that case's args, and the parent is non-dumpable. Both leaks reproduced before the fix: the other cases' inputs were reachable, and so was the parent's `/proc/<pid>/mem`. | `test_fr25_a_case_cannot_reach_the_other_cases_inputs`, `test_fr25_a_case_cannot_read_the_harness_process_memory` |
| 8 | The UI uses `welcome.problems` and `problem_switched.state`. Accepted is shown as the session's status, which stays once earned. | `FR-17: switching back restores…`, `FR-28: on joining…`, `FR-23: accepted stays shown…` |
| 9 | A runner failure broadcasts `run_failed` to all, and the UI ends the running state with a notice. | `test_fr26_a_runner_failure_ends_the_run_for_everyone`; UI: `FR-26: a failed run…` |
| 10 | The deleted state comes from `welcome`, `problem_deleted` (current problem only) and `error: problem_deleted`. `error` replies show a notice. | `FR-10: joining a session on a deleted problem…`, `FR-10: deletion of the current problem…`, `FR-26: a run refused…` |
| 11 | `exp` is now this site's sign-in expiry: sign-in plus `SESSION_MAX_AGE_SECONDS` (default 3600, added to `.env.example` and compose). `current_user` enforces it, `/api/me` goes through `current_user`, and the cookie's max age matches. | `test_nfr8_a_sign_in_expires_after_the_session_max_age` |
| 12 | The session page shows the invite link, both before and after joining. `ProblemList` no longer sets the link it couldn't show. | `FR-11: shows the invite link…` |
| 13 | Switching to an unknown problem id replies `error: problem_not_found` and keeps the connection. | `test_switching_to_an_unknown_problem_errors_and_keeps_the_connection` |

plan.md updated to match: Single sign-on (`exp`), the cap of 5 (reservation), One run at a time (task, `run_failed`), Run pipeline step 4 (fresh interpreter, non-dumpable), Seed (once), and the WebSocket contract (`problem_switched.state`, `run_failed`, `problem_not_found`; `error: infra_error` removed). That resolves the seed-identity drift flagged above. spec.md is unchanged.

Decisions for the human to confirm:
- A sign-in lasts 1 hour (configurable). Enforcing the access token's own `exp` would sign editors out every few minutes.
- Starter problems added to `seed/problems/` later won't load into an existing catalogue.
- `https_only` is still off on the cookie, since the e2e stack is served over plain http.

Still open:
- No end-to-end test of switching, running or rejoining. The new tests are component-level against a fake socket, plus protocol-level on the backend.
- A run whose task fails unexpectedly (anything but `RunnerUnavailable`) still leaves its `run` row `running`, which blocks later runs for that session. This predates these fixes.

## 2026-10-20 — seed problems load incrementally

At the human's request, starter problems added to `seed/problems/` later now load into an existing catalogue. This supersedes the "seed once" decision above.

- Migration `0002_seed_key.sql` adds `problem.seed_key` (the seed folder name, unique). At every startup the loader inserts each folder whose key is absent. Deleted rows count, so editors' renames and deletions still survive restarts.
- Starter rows seeded before 0002 are adopted once, by title, instead of being duplicated.
- The seed is baked into the api image, so a new seed problem arrives with a deploy, which is a restart. Nothing watches the folder at runtime.
- Constraint: never rename a seed folder. It would load as a new problem.
- Tests: `test_fr6_a_starter_problem_added_later_is_loaded_alongside_edited_ones`, `test_a_starter_seeded_before_seed_keys_is_adopted_by_title_not_duplicated`. Both failed before the change. `test_schema` now expects both migrations.
- plan.md updated (Seed, Data model). `scripts/check.sh` exits 0: pytest 222, vitest 58, Playwright 5.
- **spec.md is now stale on: FR-6 covers only the starter set present "when the system is first made available"; it says nothing about starter problems added later. Update it before the next change to this feature.**

## 2026-10-20 — current state (read this first)

This section supersedes the "Still open" lists in the sections above.

- **Findings 1–13: all fixed**, each with a test. `scripts/check.sh` exits 0: pytest 222, vitest 58, Playwright 5, no leaks.
- **plan.md: up to date.** The seed-identity drift is resolved.
- **spec.md: stale on FR-6.** It doesn't cover starter problems added later (see the previous section). Update it via the spec process.
- **Not committed.** All of this work is in the working tree; `git status` shows it.
- **Decisions awaiting the human:**
  - sign-in lasts 1 hour (`SESSION_MAX_AGE_SECONDS`);
  - `https_only` is off on the cookie (needed on for production);
  - seed folders must never be renamed.
- **Still open:**
  - no end-to-end test of switching, running or rejoining;
  - an unexpected exception during a run leaves its `run` row `running`, which blocks later runs for that session;
  - FR-15 has no end-to-end test of a dropped connection, and NFR-1 was measured only on localhost.
- **Feature status:** not signed off. `specs/README.md` still says `approved`. Only the human moves it.

## 2026-10-20 — third validation pass (`/sdd-validate`, fresh context)

### Tasks and test run

All 43 tasks are ticked. `scripts/check.sh` exits 0: ruff, biome, tsc and gitleaks (history and working tree, no leaks) pass. pytest 222 passed, vitest 58 passed, Playwright 5 passed.

### Method

I re-read spec.md and checked the session WebSocket (`ws.py`, `hub.py`), the sessions service and API, `collab.py`, the runs service and grading, role handling, and the session UI (`SessionPage`, `RunPanel`, `CodeEditor`, `ProblemSwitcher`) against each criterion. One finding was reproduced with a throwaway test, which has since been deleted. The fixes for findings 1–13 hold in the code as described above. New findings continue the numbering, most severe first. Nothing was fixed in this pass.

### Findings

14. **A run row left `running` blocks runs in that session for good (FR-21, FR-26).** This is the "still open" item from the earlier pass, and it is worse than recorded there. Nothing ever finishes or clears an orphaned `running` row: no startup sweep, no timeout. The partial unique index `run_one_active` then refuses every later run for that session, across restarts. A crash, an OOM kill or a `docker stop` that outlasts its grace period during a run (the runner's outer timeout is 20 s) leaves such a row. So does any unexpected exception in `runs.service.finish`, for example `grade(..., strict=True)` getting the wrong number of outcomes.
    - Reproduced: insert a `running` row, then open a fresh app on the same DB. `welcome.run_in_progress` is `false`, and `run` gets `error: run_in_progress`. The UI shows "A run is already in progress." with no running indicator, every time.
    - Fix direction (plan level): at startup, mark leftover `running` rows `infra_error`, since there is one api process. Also finish the row on any exception in the run task, not just on `RunnerUnavailable`.
15. **The stale notice doesn't say that only an admin can reactivate (FR-30).** `SessionPage` shows only "This session has gone stale." FR-30 and its criterion require saying "that the session is stale and only an admin can reactivate it". The FR-30 UI test checks for `/gone stale/` only.
16. **`ROLE_EDITOR` and `ROLE_ADMIN` are read but never used (FR-2, FR-31).** `config.py`, `.env.example` and `docker-compose.yml` expose them, but `problems/api.py` and `sessions/api.py` hard-code `"editor"` and `"admin"`. If a deployment sets either variable to its Keycloak role name, editors get 403 and admins are never offered reactivate. Either honour the settings or remove them.
17. **A full session still asks for a name first (FR-13, FR-12).** `GET /api/sessions/{invite}` doesn't report fullness, so a sixth visitor gets the name prompt and is told "session is full" only after submitting. FR-12 asks for a name only when there are *fewer than 5* participants, and FR-13's criterion says they're told on opening the link. The cap itself holds (finding 3's fix). Showing "full" up front needs a status field. The race between that check and joining stays, and the WebSocket's 4403 still covers it.
18. **Minor: the client counts name length in UTF-16 units (FR-12a).** `SessionPage.nameProblem` uses JS `length`, and the server uses Python `len` (code points). A name of 16–30 characters outside the BMP, such as emoji, is refused by the client but would be accepted by the server.
19. **Minor: a failed reactivate is silent (FR-32).** `reactivate()` swallows the error and shows the name prompt anyway. If the admin's sign-in has expired (now 1 hour, finding 11), the POST returns 401. Joining then closes with 4410 ("has gone stale"), with no hint that signing in again would help.

### Criterion results (this pass)

| Criterion | Result | Note |
|---|---|---|
| FR-1, FR-2, FR-2a, FR-2b | PASS | With default role names only (16). |
| FR-3 – FR-12a, FR-14 – FR-20, FR-22 – FR-25, FR-27 – FR-29, FR-31, FR-32 | PASS | Includes the fixes for findings 6–10 and 12. FR-6 matches spec's day-one wording; see drift below. |
| FR-13 | **PARTIAL** | Cap enforced. Told only after entering a name (17). |
| FR-21, FR-26 | **PARTIAL** | Correct in normal operation. Permanently broken for a session after an interrupted run (14). |
| FR-30 | **FAIL** | Missing "only an admin can reactivate" (15). |
| NFR-1 – NFR-9 | PASS | NFR-1 measured on localhost only. |

### Spec / plan drift

- **spec.md is now stale on: FR-6 covers only the starter set present "when the system is first made available"; it says nothing about starter problems added later. Update it before the next change to this feature.** This was carried over from the section "seed problems load incrementally" and is still unresolved.
- plan.md: no new drift. Finding 14 needs a plan decision (how orphaned runs are recovered) before it is fixed.

### Still open, carried forward

- No end-to-end test of switching, running or rejoining.
- FR-15 has no test of a dropped connection, and NFR-1 was measured only on localhost.
- Decisions awaiting the human from the earlier sections still stand: 1-hour sign-in, `https_only` off, seed folders never renamed.
- Feature status: not signed off. `specs/README.md` still says `approved`.

## 2026-10-20 — closed for now

The human signed off the feature as it stands ("close feature for now"). Status is `validated` in `specs/README.md` and spec.md. It was closed with these still open:

- Findings 14–19 from the third pass, unfixed. 14 (an interrupted run blocks runs in its session for good) and 15 (FR-30 wording) are the ones that fail spec.
- spec.md stale on FR-6 (starter problems added later).
- The pending decisions: 1-hour sign-in, `https_only` off, seed folders never renamed.
- No end-to-end test of switching, running or rejoining.

Reopening the feature starts from this list.
