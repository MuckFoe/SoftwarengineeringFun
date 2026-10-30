# 006 — Notes

## 2026-10-30 — Validation (`/sdd-validate`)

### Task completion

All 31 tasks in `tasks.md` are ticked.

### Test runs

- `scripts/check.sh`: exit 0. ruff, ruff format, biome, tsc, vite build, Apple-asset and theme-token checks, gitleaks (history and working tree) all clean. pytest **731 passed** (3 third-party deprecation warnings: httpx/authlib). Vitest **440 passed** (44 files). Playwright **71 passed**.
- `scripts/check-hub.sh hub-learn`: exit 0. `hub-learn.spec.ts` (AC-30) passed on the **local hub stand-in** (the hub repo's test stack), not on VM 105.

### Acceptance criteria

The automated tests above back every result. The ones marked *(read)* were also checked by reading the code against spec.md.

| AC | Result | Notes |
|---|---|---|
| AC-1 | pass | `AreaNav` Learn entry; e2e `learn.spec.ts` |
| AC-2 | pass | topics/lessons carry title, summary, step count, minutes *(read: lesson.toml metadata)* |
| AC-3 | pass | exact titles and order; all 8 lessons scripted to completion in `test_learn_content.py`; FR-3 subjects present *(read: e.g. logs/exec in Docker Basics, serve/funnel in MagicDNS, multi-stage/push in Building images)* |
| AC-4 | pass | only GET routes for topics/assets; no lesson-writing route *(read: `learn/api.py` route list)* |
| AC-5 | pass | `test_lesson_file.py`, startup refusal in `test_learn_startup.py` |
| AC-6 | pass | |
| AC-7 | pass | 30 chars joins, 31 closes `4422`; UI says "1 to 30 characters" *(read)* |
| AC-8 | pass | seat reserved before awaits; `4403` → "This session is full" *(read)* |
| AC-9 | pass | |
| AC-10 | pass | e2e measured 533 ms locally (threshold 1 s) |
| AC-11 | pass | |
| AC-12 | pass | |
| AC-13 | pass | `views.step_view` leaves out answer, accepted commands and known-mistake responses until the step is passed or revealed *(read)* |
| AC-13a | pass | threshold 3 enforced server-side as well as in the view *(read)* |
| AC-14 | pass | non-current steps rendered read-only; server refuses `not_current_step` |
| AC-15–AC-16 | pass | `checks.py` *(read)* |
| AC-17–AC-21 | pass | whitespace-only normalisation, case and order significant *(read)* |
| AC-22 | pass | `learn/` only compares strings; no process/shell imports *(read)* |
| AC-23 | pass | |
| AC-24 | pass | |
| AC-25 | pass | |
| AC-26 | pass | |
| AC-27 | pass, automated | axe in light/dark at 1024 px plus a keyboard-only terminal test. Axe covers only part of WCAG AA, so a manual check is still needed for a full AA claim. |
| AC-28 | pass | |
| AC-29 | pass, with caveat | the existing suites pass, but two existing test files were edited (see drift) |
| AC-30 | pass on stand-in only | not yet measured on the real hub (VM 105) |
| AC-31 | pass | |
| AC-32 | pass | completed sessions keep chat open (plan review decision); stale makes it read-only |

### Drift

1. **AC-29 "the existing coding-session test suite … passes unchanged"** and the plan's "no existing test file is edited" did not hold. Two existing tests were edited, both additively:
   - `backend/tests/integration/test_schema.py`: the exact list of applied migrations now includes `0004_learning_sessions.sql`. The test asserts the full list, so any new migration has to edit it.
   - `backend/tests/integration/test_secrecy.py`: the route-coverage sweep fails on any route it doesn't hit, so the new `/api/learn/*` routes and the WS were added to it.
   No existing assertion was weakened or removed, and `e2e/a11y.spec.ts` is untouched. The criterion as written can't be met by any feature that adds a migration or a route.
   **spec.md is now stale on: AC-29's "passes unchanged".** Reword it to something like "passes, with only additive changes to tests that enumerate the whole schema or route table." Update it before the next change to this feature.

2. **AC-30 measured on the local hub stand-in, not on the hub.** The spec says "the app on the hub". This is not a spec change, but AC-30 is only fully met after the next deploy to VM 105, by running `hub-learn` or `deploy/hub/smoke.sh --sample-memory` there.

### Learnings / minor observations (no spec change)

- `service._locks` keeps one `asyncio.Lock` per session that has seen an action, and never drops them. This is negligible at the expected scale and well inside NFR-3, but locks for completed or stale sessions could be dropped.
- An empty or whitespace-only command gets the reply `: not available in this exercise` (the first word is empty). It's correct per FR-21 but reads oddly. This is a cosmetic fix for a later change.
- The `httpx`/`authlib.jose` deprecation warnings are shared by the whole backend and were not introduced by this feature.

## 2026-10-30 — Re-validation after deploy (`/sdd-validate 006`)

Since the first validation, no code, test or lesson has changed. The only change is plan.md, which gained a *Diagrams* section (uncommitted). All 31 tasks are still ticked. 006 is deployed on VM 105 at `558d0af`.

### Test runs

- `scripts/check.sh`: exit 0. pytest **731 passed**, Vitest **440 passed** (44 files), Playwright **71 passed**. Lint, format, type check, build, asset/theme checks and gitleaks are all clean. Same counts as the first run.

### Checked on the live hub (read-only; nothing created)

| AC | Result | Observed |
|---|---|---|
| AC-1 | pass | `/collab/learn` and `/collab/learn/s/<invite>` serve the app (200) |
| AC-2, AC-3 (listing) | pass | `GET /api/learn/topics`: Docker (Basics 12 steps/20 min; Ports, volumes and networks 18/25; Building images 13/30; Docker Compose 10/30), Tailscale (Basics 11/20; MagicDNS and sharing 10/20; ACLs and tags 11/25; Exit nodes and subnet routers 12/25). Spec order, each with a summary |
| AC-4 | pass | `POST /api/learn/topics` → 405; no lesson-writing route |
| unknown invite | pass | `GET /api/learn/sessions/does-not-exist` → 404 `{"error":"not_found"}` |
| AC-30 | partial | At idle: api 57 MiB, db 48 MiB, runner 19 MiB (124 MiB total). The compose limits add up to 448 MiB (224 + 160 + 64), under 1 GB. `collab-api-1` runs one process. **Not yet measured on the hub under 3 sessions × 5 participants.** That needs creating sessions in production, and sessions are never deleted (FR-27). |

There is already 1 learning session in the hub database, so it has been used since the deploy.

### Fresh code read (areas not read in the first pass)

- FR-5: `lesson_file.py` refuses a choice quiz with no correct answer ("choice has no correct answer…"), a terminal step with no accepted command, out-of-range or duplicate options, and duplicate commands. Each error names the file. An explanation's check is optional, as the spec's *Step* definition says.
- NFR-4: the only HTML rendered in the browser is `body_html` and `hint_html`, which come from the server's renderer (`DescriptionView`). There is no `dangerouslySetInnerHTML` or `innerHTML` in `src/learn/`.

### Drift

1. **Still open from the first validation: spec.md is now stale on AC-29's "passes unchanged".** Update it before the next change to this feature. See the first entry above.
2. Drawing the plan's lifecycle diagram showed that a **completed** session also goes stale after 30 days without activity, and reactivating it returns it to completed. This is consistent with spec.md: FR-27 applies to any learning session, and stale and completed are both read-only. But the plan's text never said it. Only the plan's diagram records it now. No spec change is needed.
3. AC-30 is unchanged: it passes on the stand-in and is within the limits at idle on the hub, but has not been measured on the hub under load.
