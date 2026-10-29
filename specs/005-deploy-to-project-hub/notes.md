# 005 — Deploy to the project hub: notes

## 2026-10-29 — validation (`/sdd-validate`)

### Tasks

All 21 tasks in `tasks.md` are ticked.

### Test runs

| Run | Result |
|---|---|
| `scripts/check.sh` as is | **Stops at the gitleaks working-tree step.** One finding: `specs/004-project-hub-shared-ingress/plan.md:238`, `generic-api-key` on `db-auth:…`. It's the false positive spec 002's notes already logged (finding 4), still unfixed. |
| `scripts/check.sh` minus that one step (temp copy, every other step unchanged) | Green: ruff, biome, tsc, build, no Apple assets, theme tokens, gitleaks (history), **pytest 484 passed**, **vitest 351 passed**, **Playwright 60 passed** (root project). |
| `scripts/check-hub.sh` | Green: **27 passed** in the `HUB=1` project (hub, hub-lifecycle, hub-sandbox, hub-smoke, and the existing chat, collab, problems, session specs under `/collab/`). It tore everything down and left no `collab`, `hub` or `stub-a` containers. |
| `../hub/check/static.sh docker-compose.hub.yml` | PASS |
| `shellcheck deploy/hub/smoke.sh scripts/check-hub.sh` (via `koalaman/shellcheck` image; not installed locally) | PASS |

Not run: `deploy/hub/smoke.sh` against the stand-in (task 20's acceptance).
`check-hub.sh` doesn't call it, and this pass didn't run it by hand.

The hub repository (`../hub`) has **no commits yet**, and nothing has been
deployed to VM 105. Every criterion below that needs the real hub is therefore
unverified, not failed.

### Acceptance criteria against behaviour

| Criterion | Result | Evidence / gap |
|---|---|---|
| FR1 | **Partial** | On the stand-in, the start page loads at `/collab/`, and every request plus the one WebSocket of a join are under `/collab/` (`hub.spec` FR1, `hub-smoke`). "Loads over HTTPS" isn't verified: the stand-in is plain HTTP on `localhost:18080`. That needs the real hub (smoke `cert` check). |
| FR2 | **Pass** | A cookieless context reaches the join step, and no navigation goes to `/auth/` or `/oauth2/`. `collab.caddy` imports no gate (static check). |
| FR2a | **Not verified** | Needs a public device against the real hub (runbook *FR2a*). The design covers it: the hub's Funnel listener serves the ungated `/collab/` path (hub README, 004 §3.2). |
| FR3 | **Pass** | All four clauses, on the hub and in integration tests. A `collab` editor manages problems. A user with no roles is refused. `other1` (other-app editor/admin plus realm `editor`) gets 403 on create, reactivate and the stale list. `collab` admin-only reactivates. Signed in as that admin, the stub app gets no identity headers and no `collab_session` cookie (cookie path `/collab`). |
| FR4 | **Pass** (static) | The compose service set is {db, sandbox (build-only), runner, api}, with no identity-provider image. The smoke `services` check on the VM hasn't run. |
| FR5 | **Partial** | Live edits, cursors and chat reach the other participant under `HUB=1` (collab, chat specs). **"Both appear in the presence list" isn't asserted on the hub.** `session.spec` AC-11 checks only one participant. Likely fine (cursor labels use the same channel), but untested. |
| FR6 | **Pass** | Run results appear per test under `HUB=1` (`session.spec` AC-3). Sockets to `collab-api:8000`, `auth:8080` and the api's hub IP all fail from a solution (`hub-sandbox.spec`). The runner keeps `--network none`. |
| FR7 | **Partial** | The session, its code and its chat survive `up --force-recreate` and `down`/`up` (`hub-lifecycle` FR7). **The VM reboot** isn't verified (runbook *FR7*). |
| FR8 | **Pass** (stand-in) | The stub app answered 2xx on every 200 ms poll while collab was redeployed. Repeat on the VM per the runbook. |
| FR9 | **Pass** | A fresh deployment shows exactly the 20 starter titles, and the admin stale list is empty. |
| Memory | **Partial** | Budget by configuration: 160 + 224 + 64 + 2 × 256 = 960 MiB ≤ 1024 MiB (mem_limits plus the runner's `--memory 256m` and cap 2). **Measured peak under load not taken** (runbook *Memory*, `smoke.sh --sample-memory`). |
| Isolation NFR | **Pass** | Only `api` is on `hub`, no `ports:`, and the sandbox socket test above. |
| Secrets NFR | **Pass** | `.env.hub` is git-ignored, and the compose file reads every credential from it. gitleaks history is clean. |
| No behaviour change NFR | **Drift**, see 1 below | Existing 001/002/003 E2E specs pass under `/collab/`, and the app-styled sign-in holds on the hub. |

### Drift and findings

1. **The concurrency cap breaks spec 001 NFR-3 under load, on the hub only.**
   Spec 005's Memory NFR led the plan (§7 D3) to cap sandboxes at 2. A third
   concurrent run waits up to 10 s for a slot, then fails as "couldn't run".
   Spec 001 NFR-3 promises a correct solution's full result within 10 s of
   clicking Run. Spec 005's "No behaviour change" NFR says every 001 rule holds
   unchanged on the hub. Locally there's no cap, so the two specs now conflict
   on the hub only. The runbook already calls the refusal "expected". The
   human has to pick one: accept degraded run latency/refusal on the hub as an
   explicit exception, raise the budget, or require queuing instead of
   refusing.
   **spec.md is now stale on: the "No behaviour change" NFR vs. the Memory NFR. With at most 2 runs at once, spec 001 NFR-3 can't hold for a third concurrent run on the hub. Update it before the next change to this feature.**
2. **The full suite still can't run green from `scripts/check.sh`.** The 004
   plan false positive (002 notes, finding 4) blocks it. Fix line 238 of 004's
   plan or allowlist it in gitleaks config.
3. **FR5 presence on the hub has no test.** Add a two-participant presence
   assertion to `collab.spec` (it runs in both projects).
4. **`smoke.sh` isn't exercised by any gate.** Task 20's acceptance (passes on a
   fresh stand-in, `fresh` fails after a session is created, `--sample-memory`
   threshold) was checked when the task was done. Nothing re-runs it. Consider
   calling it from `check-hub.sh`.
5. **Task 3's file list grew after the fact** (`e2e/global-setup.ts`). It's
   already recorded in `tasks.md`. Lesson: changes to role sources need the
   browser test setup in the same task.

### Open before sign-off

On VM 105, after the hub repo's first commit and spec 004's deploy, follow
`deploy/hub/RUNBOOK.md`. Then record here: smoke `--fresh` (FR1 cert, FR4,
FR9), FR2a (public device), FR7 (reboot), FR8 (on the VM), and Memory (peak
under 5 participants / 3 sessions).

## 2026-10-29 — first deploy to VM 105

Hub (`../hub` a814724) and collab (0db55cc) deployed per `deploy/hub/RUNBOOK.md`.
Tailnet `rhinoceros-themis` (shared with Home Assistant); node `hub.rhinoceros-themis.ts.net`, tag `tag:hub`, Funnel on 443, admin on 8443 tailnet-only.

| Check | Result |
|---|---|
| `smoke.sh --fresh` `services` | PASS (api db runner) |
| `smoke.sh --fresh` `fresh` | PASS (problem=20 session=0 chat_message=0) |
| `smoke.sh --fresh` `cert` | FAIL on the VM: the VM host isn't on the tailnet (Tailscale runs in the container), so the host can't reach its own name. From the public internet: `/collab/` 200, Let's Encrypt cert for `hub.rhinoceros-themis.ts.net` verifies. |
| Sign-in | `/collab/api/auth/login` → 302 to hub Keycloak, `client_id=collab` |

Findings:

1. `smoke.sh`'s `cert` check can't pass from the VM host by design; run it from off-VM or through the `ts-hub` container.
2. The hub's `auth` healthcheck reported healthy ~1 min before Keycloak listened on 8080; `bin/add-client` failed on the first try. Tighten the healthcheck (hub repo).
3. `check/static.sh` needs `jq` on the VM; it wasn't installed (now is). Add it to the hub README's VM step.

Still open: FR2a (public device), FR7 (reboot), FR8 (on the VM), Memory (peak under load).
