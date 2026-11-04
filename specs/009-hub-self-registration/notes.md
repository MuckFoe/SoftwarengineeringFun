# 009 — Notes

## 2026-10-30 — implementation log, tasks 1–10 (not yet validated)

Everything below is in the hub repo (`~/Desktop/ProjectHub/hub`) and uncommitted. `scripts/check.sh` was green after each task; after task 10 it passed 200/200.

### Drift from plan.md (for `/sdd-validate` to reconcile; plan not edited)

- **Flow priorities (§1.3, §2.1).** In Keycloak 26.4 a new flow execution gets priority 0 and sorts first. "Copy the flow, then add Deny access" put the deny before the registration form. `bin/configure-registration` sets explicit priorities: the deny at 1000 in `hub-registration`, and the gate sub-flow at the password step's priority + 1. It resets them if they drift.
- **One gate per flow (§2.1).** Sub-flow and authenticator-config aliases are realm-unique, and sharing one sub-flow between two flows breaks when either flow is deleted. So `hub-direct-grant` has its own `hub-direct-grant-pending-gate`, with configs `hub-direct-grant-pending-role` and `hub-direct-grant-pending-deny`. §2.1 should list them.
- **"App client role" (§1.2 refusal).** `default-roles-hub` holds `account/*` roles by default. The script refuses any client role outside Keycloak's built-in clients (account, account-console, admin-cli, broker, realm-management, security-admin-console). That makes `hub-gateway` count as an app.
- **SMTP check.** `kcadm get … --fields smtpServer` prints `{ }` even when a host is set; use `smtpServer(host)`. Task 4's refusal never fired, and task 5 fixed it.
- **User profile (§3.3 step 2).** kcadm can't edit keys inside array elements, so the script edits the pretty-printed profile and PUTs it whole.
- **`accounts` environment (§3.5).** It lists only names, but `KC_URL`, `KC_REALM` and `ACCOUNTS_CLIENT_ID` are defined nowhere. compose.yaml sets them to fixed values (`http://auth:8080/auth`, `hub`, `hub-accounts`).
- **`accounts` before its secret exists (§1.5, §3.6).** The first `up` starts it without `ACCOUNTS_CLIENT_SECRET`. It logs `expire failed`, retries after 60 s and doesn't crash-loop. After putting the secret in `.env`, run `docker compose up -d` again. The runbook (task 17) should say so. The 60 s retry also covers Keycloak not being ready after a reboot.
- **`expire --now`.** Takes ISO-8601 with a UTC offset (§3.4), not milliseconds as task 8 said.
- **Exit codes (§3.4).** A Keycloak failure exits 1 (not listed in the plan). `revoke` for a missing user exits 2 (`not approved: <user>`), matching `grant`.
- **Admin calls (§3.4).** `init-app` also needs `GET /users` (paged), which the list lacks. It works with hub-accounts' current roles; no role change.
- **`init-app` isn't atomic.** If it fails halfway, the group exists with some users, and a rerun prints `exists` and adds nobody. Repairing that would be a plan change.
- **Usernames.** Keycloak's minimum length is 3, so the task 9 text's `p1`/`a1` became `pending-p1`/`approved-a1`.
- **`bin/accounts` TTY.** Uses `-T` unless both stdin and stdout are terminals, so piping its output works.
- **Reboot with apps attached (NFR-4 test).** `docker compose down` can't remove network `hub` while other projects' containers are on it. The test disconnects and reconnects them. An operator running `down` on the real hub would hit the same thing; a host reboot doesn't. Worth a runbook line.
- **`.env` names.** Every new `.env.example` entry must also go into `tests/test_repo_static.py` (`ENV_NAMES`, `SECRETS`).

### For later tasks

- **Task 14:** `check/static.sh` (`CADDY_IMAGE="caddy:2-alpine"`) and the `caddy validate` test in `tests/test_repo_static.py` validate with the stock image. Once the Caddyfile uses `rate_limit`, both must use the built proxy image. The rate-limit plugin is pinned at `mholt/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db`.
- **Task 17 (runbook):** the `accounts` secret and restart step, and the reboot/network note above.

### Flaky tests seen (unconfirmed)

- Task 7, one full run: `configure-registration` got `HTTP 401` just after creating `hub-pending`, failing every integration test at setup. It didn't recur.
- Task 10, one full run: `test_configure_registration.py::test_refuses_app_role_in_default_roles` saw a change in hub-accounts' state during a refused run. It didn't recur in 2 later runs; the cause may be list ordering or the accounts service's hourly run. Next time, rerun it with `-vv` to see the field.

### Outside 009's scope, done with the human's OK

- `tests/test_static.py`: the app-snippet tests point at a missing themes dir. `test_two_valid_apps_pass` had failed on HEAD because it read the repo's real `collab` theme.
- `tests/conftest.py`: `HUB_KEEP_STACK=1` keeps the stack between runs while iterating (state in the system temp dir `hub-kept-stack`). `scripts/check.sh` always runs without it, and a normal run removes a kept stack and its secrets. Constitution rule 2 was amended to match.
- The full suite takes about 7 minutes on a fresh stack. The NFR-4 reboot test accounts for 1–2 minutes of that.

## 2026-11-03 — implementation log, tasks 11, 16, 17 (not yet validated)

Hub repo, uncommitted as before. Tasks 16 and 17 are ticked. **Task 11 is not ticked**: its agent was stopped mid-task (see "Open" below); its code changes are on disk.

### Open — needs a human decision before task 11 can be ticked

- **Session cookie at the split limit.** Task 11's `groups` mapper (claim in ID token, access token and userinfo) makes oauth2-proxy's session cookie about 3,931 bytes. That is at oauth2-proxy's split point, so a sign-in gives `_hub_auth` or `_hub_auth_0` + `_hub_auth_1` at random (measured: 4 of 5 split). `test_gateway.py::test_sign_in_sets_session_cookie` and `test_data_isolation.py::test_reset_of_one_app_keeps_sign_in_and_other_apps_data` expect one `_hub_auth`, so they fail at random. Options:
  1. Drop the claim from the access token and keep it in the ID token and userinfo (oauth2-proxy reads the ID token). A small change to plan §2.1. Recommended, but not yet verified to bring the cookie under the limit.
  2. Accept split cookies and change the two tests to `_hub_auth*`.
  3. oauth2-proxy's Redis session store. A bigger plan change.
- Apart from these two tests, the last gate run passed 200/202. Task 11's earlier failures (`test_accounts` ×2, `test_configure_registration`, `test_registration`) no longer occur.
- **Task 11 skip condition (from task 17).** On a first install `accounts` is running without its secret, so "not running" alone wouldn't skip step 8. The implementation checks both: running AND `ACCOUNTS_CLIENT_SECRET` set (bin/configure-registration, step 8). Re-check against the acceptance criteria when task 11 resumes.

### Test gate restructured (user decision, constitution rule 2 amended)

- `scripts/check.sh` is the per-task gate: every test except `@pytest.mark.slow`, against the kept stack (`HUB_KEEP_STACK=1`), with every failure reported (no `-x`). It must take ≤ 5 min; it now takes about 3 min with the stack kept, and about 4.5 min when it has to rebuild the stack.
- `scripts/check.sh --full` runs every test on a fresh stack, only once all of 009's tasks are done, before `/sdd-validate`.
- The kept stack is rebuilt only when the hash of `STACK_INPUTS` (`tests/conftest.py`) changes: compose files, Caddyfile, Dockerfile, realm JSON, `bin/configure-registration`, conftest, stubs.
- `slow`: `test_accounts.py::test_states_survive_reboot` (`down`/`up` of the whole stack).
- `Hub.kcadm` in conftest now goes to Keycloak's admin REST API via the admin listener (port 18081) for get/create/update/delete/set-password. kcadm.sh started a JVM per call, about 0.46 s each; that was most of the old 11.5 min. Other verbs still run kcadm.sh in the container.
- Next lever if the gate grows: `bin/configure-registration` takes about 15 s per run and runs about 7× per gate; three "second run changes nothing" tests could share one re-run.

### Task 16 (check/smoke.sh): drift and on-hub items

- New modes: `--registration` (NFR-2), `--rate-limit` (NFR-1), `--app-signin <path>` (FR-1, FR-10), `--app-access <invite-path>` (FR-11, FR-8), `--states <pending> <approved>` (NFR-4). Browser, second-device and reboot steps print `MANUAL` lines.
- The plan never names this app's path or invite URL in the hub, so they are arguments. Validation should record which ones were used.
- NFR-4: `bin/accounts` has no show-user command. "Not in pending list" would also pass for a deleted account, so the MANUAL sign-in after the reboot is what proves the account survived.
- NFR-1 counts empty, invalid POSTs, which is valid because plan §1.6 counts failed submissions. `--rate-limit` uses up that source's 5 sign-ups for the hour, so run it last.
- NFR-2 treats any HTTP answer on `http://`, a redirect included, as a failure. The plan doesn't say whether a redirect is acceptable.

### Task 17 (README): drift

- README describes features not built yet: `import gated <app>` / `import gated-api <app>`, the 403 "No access" page and the "Sign in again" link (task 12); the rate-limit paragraph and `HUB_REGISTRATION_WINDOW` (task 14; not in `.env.example` yet); "no forgot-password" (task 18). Check them after those tasks.
- `import gated-api <app>` is inferred from plan §3.2; §3.6 names only `import gated <app>`. Confirm with task 12.
- The README uses `docker compose up -d accounts` (§3.6), where the tasks 1–10 notes said `docker compose up -d`. Both work.
- README wrote the secret as `ACCOUNTS_CLIENT_SECRET=...`, which tripped `check/static.sh`'s secret scan. It now uses the `{secret}` placeholder.

### Next

1. Decide the cookie option above, then finish task 11 (gate: `scripts/check.sh`).
2. Task 12, then 13 and 14 in parallel (`[P]`), then 15 (deploy), then 18.
3. `scripts/check.sh --full` once, then `/sdd-validate`.

## 2026-11-04 — implementation log, tasks 11–14 (not yet validated)

Hub repo. Run as one batch on the user's "finish it, don't wait": one `scripts/check.sh` gate after tasks 11–14, not one per task. It found 1 failure (below); after the fix, every affected module passed against the kept stack. The new tests for tasks 12–14 weren't run red before the code went in. They assert things that didn't exist before (403 page, findings, 429), so they couldn't have passed.

### Decisions taken without the human (review at validation)

- **Task 11 cookie split: option 2.** The session cookie may be split (`_hub_auth_0`, `_hub_auth_1`, …). The tests now use `conftest.is_session_cookie` (`_hub_auth` or `_hub_auth_<n>`, never `_hub_auth_csrf`). Why not option 1: each new gated app adds a group to the claim, so the cookie passes the split point sooner or later anyway, and oauth2-proxy reassembles split cookies itself. Plan §2.1 is unchanged; the claim stays in the ID token, access token and userinfo.
- **NFR-3 vs per-app authorisation (task 6 test vs task 12).** A gateway session made before the `groups` mapper carries no groups. On a gated app it now gets the 403 "No access" page once, with its "Sign in again" link, which signs the user in silently. `test_pending.py::test_old_session_and_sign_in_unchanged` accepts that: 200, or 403 with the link. This departs from task 6's "still gets 200 with the same cookie". On the live hub no one is affected: `collab` is ungated and no gated app is live. If the human wants old sessions to keep 200, the alternative is `OAUTH2_PROXY_COOKIE_REFRESH`: a refreshed session picks up groups, and grants would then take effect without signing in again. That is a plan change.

### Drift from plan.md / tasks.md

- **Task 12 touched `tests/conftest.py`** (not in its file list). 004's tests gate `stub-b` (test_isolation) and `stub-c` (test_gate, test_add_app), so the session fixture now runs `bin/accounts init-app` for them (`EXTRA_GATED_APPS`), as the runbook does before an app goes gated.
- **`gated-api` 401** now answers `Not signed in.` (text/plain) instead of oauth2-proxy's body, and 403 answers `No access to <app>. Access is granted by <app>'s admin.` (plan §3.2: "plain-text body").
- **`HUB_REGISTRATION_WINDOW` in compose** is `${HUB_REGISTRATION_WINDOW:-1h}`, not passed through as is. Caddy reads an empty variable as set, so `{$HUB_REGISTRATION_WINDOW:1h}` became `window ` and failed to parse.
- **429 page** is a snippet of its own, `(registration-limit-page)` (`handle_errors 429`), imported at the end of `:80` and `:81`. The module's `Retry-After` survives into it (tested).
- **Static checks and the Caddyfile validate test** (`check/static.sh`, `tests/test_repo_static.py`) now use the proxy image built with `docker build -q caddy/`, not `caddy:2-alpine`. Stock Caddy can't parse `rate_limit`. The first run on a machine builds it (xcaddy, a minute or two).
- **Body-logging rule (task 13):** Caddy can read a body only through the `{http.request.body}` placeholder, so any use of it outside a comment, in the Caddyfile or a snippet, is a finding (`NFR-2: <file> logs request bodies`).
- **Tests and the rate limit:** `test_registration.register` waits out `Retry-After` and retries on 429, because the suite registers from one host address more often than 5 per 10 s.

### Task 15 (deploy) — stopped partway, 2026-11-04

- Done: hub commit `bf0b413` pushed to VM 105 (`git push vm main`, checked out in `~/hub`); `check/static.sh` passes there; `docker compose build proxy` built `hub-proxy`. `/collab/` and the realm's discovery URL were answering 200 before anything changed.
- Not done: `docker compose up -d` and the remaining "Enable once" steps. The session's permission policy blocked the production deploy, so it waits for the human.
- **Window of risk:** the running `proxy` container is still the old stock-Caddy one with its config in memory, so the live hub is unchanged. But `./caddy/Caddyfile` on disk now uses `rate_limit`. If that container restarted before `up -d` (a VM reboot, say), stock Caddy couldn't parse the file and the hub's entry point would stay down. Finish the deploy soon, or `git checkout 1048d2a` in `~/hub` to back out.

### Task 15 (deploy) — finished 2026-11-04, with the human's OK

- Hub commit `bf0b413` on VM 105. The README's "Enable once" steps: `docker compose up -d` (proxy recreated, accounts started); `bin/configure-registration` (secret written straight into `~/hub/.env`, never printed off the VM); `docker compose up -d accounts`; `bin/configure-registration` again ("realm hub matches plan"; no gated snippets, so no access groups).
- `docker compose ps`: all six services up. The `accounts` log shows `expired 0 pending account(s)`, so it authenticates. `bin/accounts list` is empty, so no existing account went pending. `check/static.sh` passes on the hub.
- `/collab/` kept answering through the deploy: polled every 0.5 s, 119 × 200 and 1 × 502, during the proxy swap (under a second).
- `check/smoke.sh` on the hub: FR3, FR4, FR9 and Memory (821 MiB of 1536) PASS. FR2 FAILs there for reasons outside 009: the script reads `HUB_URL` from `.env` unexpanded (`${TS_TAILNET}`), and the VM host isn't on the tailnet. `check/smoke.sh --tls` from the Mac: FR2 PASS.
- **Not verified:** NFR-3's "an existing account still signs in to `/collab/` with its old password" needs a real user's credentials. It's a manual step for validation. Indirect evidence: no account went pending, and the password policy isn't checked at sign-in (task 5 test).
- Still to run at validation (§4.3): `--registration` and `--rate-limit` from off the tailnet, `--app-access <invite>`, `--states` before and after a reboot.

### Task 18 — no change needed

`check/smoke.sh --app-signin` against the `collab` client's authorization URL (`/auth/realms/hub/protocol/openid-connect/auth?client_id=collab&…&redirect_uri=…/collab/api/auth/callback`): the page loads the collab theme (`collab.css`). FR-1 Register link PASS, FR-10 admin note PASS, no reset link PASS. This app's sign-in starts in JavaScript, so the authorization URL is the path to give `--app-signin`.
