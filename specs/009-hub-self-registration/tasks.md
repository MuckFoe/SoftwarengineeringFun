# 009 — Self-registration on the hub's shared sign-in: tasks

All paths are in the hub repository (`~/Desktop/ProjectHub/hub`) unless a task says otherwise (plan §1.1). Every task starts with its plan §4.1 case (or static check) failing, and is ticked only when `scripts/check.sh` is green (constitution 1, 2). Lint for new code: `ruff check` / `ruff format --check` on `accounts/` and `tests/`, `shellcheck` on new `bin/` scripts, `caddy fmt --diff` on the Caddyfile (constitution 8).

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3 — all `[P]` | Pure logic, the proxy image and the test-harness additions share no files and depend on nothing in this feature. |
| 2 | 4 | Plan §1.3: proving that a user survives the registration flow's *Deny access* is the first integration test. If it fails, stop and go back to the human before anything else is built on it. |
| 3 | 5 | Remaining realm settings; same script as 4. |
| 4 | 6 | Pending gate in the sign-in flows; same script, needs the `pending` group from 4. |
| 5 | 7 | `hub-accounts` client and its secret; the `accounts` container cannot authenticate without it. |
| 6 | 8 | The `accounts` container and its entry point (`run-expiry`); needs 1's `states.py` and 7's secret. |
| 7 | 9 | Admin commands on top of 8's client and container. |
| 8 | 10 | Access-group commands; reuse 9's user lookup and pending check. |
| 9 | 11 | `configure-registration` calls 10's `init-app` and adds the `groups` mapper; must land before the gateway asks for groups (12), or existing users lose gated access (NFR-3). |
| 10 | 12 | Gateway authorises per app; needs 11's mapper and seeded groups. |
| 11 | 13, 14, 16, 17 — all `[P]` | No shared files: static checks (needs 12's snippet form), rate limit (Caddyfile after 12; needs 2's image and 3's probe), on-hub smoke script, runbook. |
| 12 | 15 | Deploy to VM 105 once everything it ships (1–14, 16, 17) is done. |
| 13 | 18 | Conditional on 16's on-hub check of this app's sign-in page, run after 15's deploy. |

## Checklist

- [x] **1** — `[P]` Pure account-state rules (`states.py`)
- [x] **2** — `[P]` Proxy image with the rate-limit module
- [x] **3** — `[P]` Test-harness additions: `stub-g`, `stub-b` client, `olduser`, `probe`
- [x] **4** — Registration creates a pending user and stops before any session (first test)
- [x] **5** — Realm settings: password rules, profile, no mail, no reset, admin note, refusals
- [x] **6** — Pending gate in the browser and direct-grant flows
- [x] **7** — `hub-accounts` service client and its secret
- [x] **8** — `accounts` container with `expire` and `run-expiry`
- [x] **9** — `list`, `approve`, `reject` and the `bin/accounts` wrapper
- [x] **10** — `grant`, `revoke`, `init-app`
- [x] **11** — `groups` mapper and access-group seeding in `configure-registration`
- [x] **12** — Gateway authorises per app (`allowed_groups`, 403 page)
- [x] **13** — `[P]` Static checks: gated-snippet rule, no request-body logging
- [x] **14** — `[P]` Registration rate limit at the entry point
- [x] **15** — Deploy to VM 105
- [x] **16** — `[P]` On-hub smoke checks
- [x] **17** — `[P]` Runbook (README)
- [x] **18** — This app's login theme shows the Register link and admin note (conditional)

## Tasks

### 1. `[P]` Pure account-state rules (`states.py`)

- **Plan:** §1.5, §3.4 `states.py`, §4 unit tests. **Spec:** FR-5, FR-13.
- **Files:** `accounts/accounts/states.py` (new; plus an empty `accounts/accounts/__init__.py` if the package needs one), `tests/test_states.py` (new)
- **Depends on:** nothing
- **Do:** `MAX_PENDING_MS = 30 * 86_400_000`; `expired(created_ms, now_ms) -> bool` is `created_ms + MAX_PENDING_MS <= now_ms`; `pending_rows(members) -> list[tuple[str, str, str]]` returns `(username, email, registered_at)` sorted oldest first, time as ISO-8601 UTC to the second, members with `serviceAccountClientLink` dropped. Stdlib only. Unit tests, no containers.
- **Acceptance:**
  - *FR-13 — Given account "newuser" registered 30 days ago and still pending, When the 30 days pass, Then "newuser" no longer exists.* Here: `expired(c, c + 30 d − 1 ms)` is False, `expired(c, c + 30 d)` is True.
  - *FR-5 — Given two pending accounts, When a hub admin opens the registrations view, Then both are listed with username, email address and registration time.* Here: two members in reverse order come back oldest first, with username, email and an ISO-8601 UTC time (`…Z`, seconds); a member with `serviceAccountClientLink` is dropped.

### 2. `[P]` Proxy image with the rate-limit module

- **Plan:** §1.6 Mechanism, §3.5 `proxy: build`, §6 departure 1. **Spec:** NFR-1.
- **Files:** `caddy/Dockerfile` (new), `compose.yaml` (`proxy` uses `build: ./caddy` instead of `image: caddy:2-alpine`; namespace, mounts, restart, `mem_limit` unchanged), `tests/test_proxy_image.py` (new)
- **Depends on:** nothing
- **Do:** Multi-stage build: `caddy:2.10-builder` runs `xcaddy build --with github.com/mholt/caddy-ratelimit@<pinned commit>`, copied into `caddy:2.10-alpine`. No Caddyfile change yet.
- **Acceptance:**
  - *NFR-1 (prerequisite)* — the built `proxy` image's `caddy list-modules` includes `http.handlers.rate_limit`.
  - The whole existing 004 suite (routing, gate, gateway, static memory sum) stays green against the built image (NFR-3: nothing changes for existing accounts).

### 3. `[P]` Test-harness additions: `stub-g`, `stub-b` client, `olduser`, `probe`

- **Plan:** §4 "Additions to the test setup", §4.1 NFR-3 setup. **Spec:** FR-8, FR-12, NFR-1, NFR-3 (test infrastructure for them).
- **Files:** `tests/conftest.py`, `tests/stubs.py`, `compose.test.yaml`; checks in `tests/test_harness.py`
- **Depends on:** nothing
- **Do:**
  - `stub-g`: a second gated `traefik/whoami` stub (so `stub-a`, `stub-g` gated; `stub-b` ungated).
  - `stub-b` gets an OIDC client (`bin/add-client stub-b public /cb`) with client roles `editor` and `admin`; it stands in for this app's client.
  - Session fixture creates `olduser` with a 6-character password (stands for today's accounts). Leave a clear hook where task 4 runs `bin/configure-registration` after `olduser` exists.
  - `probe` service in `compose.test.yaml`: `python:3.12-alpine` (pinned digest), `network_mode: service:ts-hub`, profile `probe`; the generated env file sets `HUB_REGISTRATION_WINDOW=10s`.
- **Acceptance:**
  - `stub-g` answers behind the gate like `stub-a`; `stub-b` client exists with roles `editor` and `admin`; `olduser` signs in to `/stub-a/` with the 6-character password; `docker compose --profile probe run probe` can reach `127.0.0.1:80` and Caddy sees its `X-Forwarded-For`.
  - Existing suite stays green.

### 4. Registration creates a pending user and stops before any session (first test)

- **Plan:** §1.2 "Registration on, no mail" (attributes only), §1.3 pending group and `hub-registration` flow, §2.1 (`hub-pending`, `pending`, `hub-registration`, `hub-registered-deny`), §3.3 steps 1, 3, 4 (registration flow only). **Spec:** FR-2, FR-1.
- **Files:** `bin/configure-registration` (new; kcadm inside `auth`, idempotent), `tests/conftest.py` (run it in the session fixture after `olduser` is created), `tests/test_registration.py` (new). Also update `tests/test_realm.py`'s 004 assertion "registration off" if it reads the live realm (plan header: 004 §2.1's line is superseded).
- **Depends on:** 3
- **Do:** Write the FR-2 test first. Script sets `registrationAllowed=true`, `registrationEmailAsUsername=false`, `verifyEmail=false`, `resetPasswordAllowed=false`, `duplicateEmailsAllowed=false`; creates realm role `hub-pending`, group `pending` carrying it, sets `pending` as the only default group; creates flow `hub-registration` (copy of `registration`, then REQUIRED *Deny access* with config `hub-registered-deny`) and binds it as `registrationFlow`. Changes only what differs.
- **Stop condition (plan §1.3):** if the FR-2 test shows the user does **not** survive the deny, stop, do not work around it, and report back to the human; the plan must change.
- **Acceptance:**
  - *FR-2 — Given the registration form, When "newuser", "new@example.com" and a valid password are submitted, Then a pending account "newuser" exists, And the visitor sees that it awaits approval.* Response shows the `hub-registered-deny` message and sets no oauth2-proxy cookie; admin REST shows `newuser` exists and is a member of `pending`.
  - *FR-1 — Given a visitor on the hub's sign-in page, When it loads, Then a "Register" link is visible and leads to a registration form.* Starting sign-in at `/stub-a/`, the login page has a link to the realm's registration URL, and following it gives a form with `username`, `email`, `password`, `password-confirm`.
  - `olduser` is not in `pending`; running the script twice leaves the realm unchanged (NFR-3, partial).

### 5. Realm settings: password rules, profile, no mail, no reset, admin note, refusals

- **Plan:** §1.2 (password rules, user profile, no app roles, forgot-password note, no `smtpServer`), §2.1 localization, §3.3 steps 2, 5 and both refusals, §4.2. **Spec:** FR-3, FR-8, FR-9, FR-10, NFR-3.
- **Files:** `bin/configure-registration`, `tests/test_registration.py`, `tests/test_configure_registration.py` (new)
- **Depends on:** 4
- **Do:** `passwordPolicy = "length(12) and maxLength(128) and notUsername and notEmail"`; `firstName`/`lastName` lose `required`; `en` override of `noAccount` = `Forgot your password? Ask a hub admin to set a new one. New here?`. Before changing anything, exit non-zero if `smtpServer` is set or `default-roles-hub` holds any app client role.
- **Acceptance:**
  - *FR-3 — Given an account "taken" exists, When "taken" is submitted as a new username, Then registration is refused with a message on the username field; Given a password that breaks the rules, Then it is refused with a message on the password field.* Field errors `usernameExists`, `emailExists` (taken email) and the password-policy error for an 8-character password; no user created in any case.
  - *FR-9 — Given a new registration, When it is submitted, Then no email is sent and no verification step is shown.* Realm `smtpServer` empty; `newuser` has no `VERIFY_EMAIL` required action; no response is the verify-email page; `docker compose logs auth` has no mail-send entry.
  - *FR-10 — Given the sign-in page, When it loads, Then there is no "forgot password" self-service flow, And a note says to contact a hub admin; Given a hub admin sets a new password for "newuser", Then "newuser" can sign in with it.* No `reset-credentials` link; `noAccount` note present; `GET …/login-actions/reset-credentials` offers no reset form. (The set-password sign-in half needs an approved user and is asserted in task 9.)
  - *FR-8 (config half)* — `bin/configure-registration` exits non-zero and changes nothing against a realm where `default-roles-hub` was given `stub-b/editor`; same when `smtpServer` is set (§4.2).
  - *NFR-3* — a second run of the script changes nothing (realm export diff empty); `olduser`'s 6-character password still signs in (policy not checked at sign-in).

### 6. Pending gate in the browser and direct-grant flows

- **Plan:** §1.3 `hub-browser`, `hub-direct-grant`, §2.1 (`hub-pending-role`, `hub-pending-deny`), §3.3 step 4, §1.4 Ungated. **Spec:** FR-4, NFR-2, FR-11, NFR-3.
- **Files:** `bin/configure-registration`, `tests/test_pending.py` (new)
- **Depends on:** 5
- **Do:** Flows `hub-browser` (copy of `browser`; in `forms`, after *Username Password Form*, CONDITIONAL sub-flow `hub-pending-gate`: *Condition – user role* `hub-pending` → *Deny access* `hub-pending-deny`) and `hub-direct-grant` (copy of `direct grant`, same sub-flow after password validation); bind as `browserFlow` and `directGrantFlow`. Built-ins stay untouched.
- **Acceptance:**
  - *FR-4 — Given pending account "newuser", When it signs in to any app on the hub, Then sign-in is refused with an "awaiting approval" message, And no app session is created.* (a) via `/stub-a/` the `hub-pending-deny` message and no `_hub_auth` cookie; (b) via client `stub-b` the auth-code flow ends on the message with no redirect to `/stub-b/cb?code=`; `GET /users/{id}/sessions` is empty. A wrong password still gets Keycloak's normal error.
  - *NFR-2 — Given a pending account, When any app's sign-in is attempted with correct credentials, Then no session is issued.* Plus: a direct-grant token request for pending `newuser` (test client with direct grant on) is refused; the test password appears in no hub service's `docker compose logs` and the `credential` table's `secret_data` is a hash. (The plain-HTTP half is on-hub, task 16.)
  - *FR-11 — Given registration is on, When someone without an account opens one of this app's session invite links, Then they join the session as before, without being asked to register or sign in.* With no cookie, `/stub-b/invite/x` gives 200 from `stub-b` with no redirect (004 FR6 test re-run after configuration). (This app's real invite link: on-hub, task 16.)
  - *NFR-3* — `olduser`, signed in to `/stub-a/` before configuration, still gets 200 with the same cookie afterwards, and a fresh sign-in works for `/stub-a/` and `stub-b`.

### 7. `hub-accounts` service client and its secret

- **Plan:** §2.1 client `hub-accounts`, §3.1, §3.3 step 7, constitution 7 (§5). **Spec:** FR-5, FR-7, FR-13 (prerequisite: the account tool's own credentials).
- **Files:** `bin/configure-registration`, `.env.example` (+ `ACCOUNTS_CLIENT_SECRET=`), `tests/conftest.py` (capture the printed secret into the generated env file); checks in `tests/test_configure_registration.py`
- **Depends on:** 6
- **Do:** Confidential client `hub-accounts`, service account only (no standard/implicit/direct flow); its service-account user removed from `pending`; `realm-management` roles `query-users`, `view-users`, `manage-users`, `query-groups`. Print the secret only when the client is newly created.
- **Acceptance:**
  - A client-credentials token for `hub-accounts` can list members of `pending` and cannot use any other flow; its service-account user is not in `pending`.
  - First run prints the secret, a second run prints none and changes nothing; no secret value is committed (the existing static secret check passes on the new files).

### 8. `accounts` container with `expire` and `run-expiry`

- **Plan:** §1.5, §3.4 (`expire`, `run-expiry`, env, REST calls, paging 100), §3.5 `accounts` service, §2.3. **Spec:** FR-13, NFR-4.
- **Files:** `accounts/accounts/keycloak.py` (new: urllib client-credentials token, group lookup, paged members, delete user), `accounts/accounts/__main__.py` (new: argparse with `expire [--now]`, `run-expiry [--interval 3600]`), `compose.yaml` (service `accounts` exactly as §3.5, no `ports:`), and `tests/conftest.py` (start `accounts` after the secret is in the env file); test `tests/test_expiry.py` (new)
- **Depends on:** 1, 7
- **Do:** `expire` deletes members of `pending` for which `states.expired(created, now)` holds, skips service-account users, prints one removed username per line. `run-expiry` runs `expire` at start and then every interval, logging counts only, never passwords. Until task 9 adds `bin/accounts`, tests call `docker compose exec accounts python -m accounts …`. Size exception (accepted by the user, 2026-10-30): this task touches four non-test files because the entry point, its client, its service and the harness cannot be tested apart.
- **Acceptance:**
  - *FR-13 — Given account "newuser" registered 30 days ago and still pending, When the 30 days pass, Then "newuser" no longer exists, And "newuser" can be registered again.* `expire --now <created + 30 d − 1 min>` keeps `newuser`; `expire --now <created + 30 d>` prints and deletes it; registering `newuser` again succeeds (pending). The service's startup run shows its count line in `docker compose logs accounts`.
  - Approved users and `olduser` are never removed by `expire`.
  - Memory sum stays ≤ 1536m with `accounts` at 48m; `accounts` has `restart: unless-stopped` and no `ports:` (existing static checks).

### 9. `list`, `approve`, `reject` and the `bin/accounts` wrapper

- **Plan:** §1.3 Admin operations, §3.4 (`list`, `approve`, `reject`, exit codes), §1.1 `bin/accounts`. **Spec:** FR-5, FR-6, FR-7, FR-8, FR-10, NFR-4.
- **Files:** `accounts/accounts/__main__.py`, `accounts/accounts/keycloak.py` (user lookup by exact username, remove from group), `bin/accounts` (new: `docker compose exec accounts python -m accounts "$@"`); test `tests/test_accounts.py` (new)
- **Depends on:** 8
- **Do:** Size exception (accepted by the user, 2026-10-30): three non-test files plus a test, kept whole for the same reason as task 8. `list` prints TSV via `states.pending_rows`; `approve` removes the user from `pending`; `reject` deletes the user; both exit 2 with `not pending: <username>` if the user is missing or not pending.
- **Acceptance:**
  - *FR-5 — Given two pending accounts, When a hub admin opens the registrations view, Then both are listed with username, email address and registration time.* `bin/accounts list` prints both, with email and an ISO time within ±1 min of registration; `olduser` is not listed.
  - *FR-6 — Given pending account "newuser", When a hub admin approves it, Then "newuser" can sign in to an ungated app, And sign-in to a gated app is still refused.* After `approve`, the `stub-b` auth-code flow yields a code and a token. (The gated half needs task 12 and is asserted there.)
  - *FR-7 — Given pending account "newuser" with "new@example.com", When a hub admin rejects it, Then "newuser" cannot sign in, And a new registration with "newuser" and "new@example.com" is accepted.* Sign-in then gives Keycloak's invalid-credentials message; re-registration succeeds (pending). `reject olduser` exits 2 and `olduser` still exists.
  - *FR-8 — Given "newuser" was approved, When it signs in to this app, Then it has no editor or admin capability.* `newuser`'s `stub-b` access token has no `resource_access.stub-b` roles. (This app itself: on-hub, task 16.)
  - *FR-10 (second half) — Given a hub admin sets a new password for "newuser", Then "newuser" can sign in with it.* After `kcadm set-password` for approved `newuser`, sign-in with the new password succeeds.
  - *NFR-4 — Given one pending and one approved account, When the hub reboots, Then the first is still pending and the second can still sign in.* With pending `p1` and approved `a1`, `docker compose down && docker compose up -d` (no `-v`): `p1` still gets the pending message, `a1` signs in to `stub-b`.
  - Exit codes match §3.4 (§4.2).

### 10. `grant`, `revoke`, `init-app`

- **Plan:** §1.4 Granting and "Existing gated apps keep working", §3.4 (`grant`, `revoke`, `init-app`, exit codes 2/3). **Spec:** FR-12, NFR-3.
- **Files:** `accounts/accounts/__main__.py`, `accounts/accounts/keycloak.py` (add to group, create group); test `tests/test_access_groups.py` (new)
- **Depends on:** 9
- **Do:** `grant <app> <user>` adds to `access-<app>`, exit 2 if user missing or pending, exit 3 if group missing; `revoke` removes, exit 3 if group missing; `init-app <app>` creates `access-<app>` seeded with every current non-pending, non-service-account user, or prints `exists` and changes nothing.
- **Acceptance:**
  - *FR-12 (membership half)* — after `grant stub-a newuser`, `newuser` is in `access-stub-a` and not in `access-stub-g`; `grant` for a pending user exits 2; `grant` to a missing group exits 3; `revoke` removes the membership.
  - *NFR-3* — `init-app stub-a` puts `olduser` (and other approved users) in `access-stub-a`, no pending user and no service account; a second `init-app stub-a` prints `exists` and changes nothing.

### 11. `groups` mapper and access-group seeding in `configure-registration`

- **Plan:** §1.4 (mapper on `hub-gateway`), §2.1 protocol mapper, §3.3 steps 6 and 8. **Spec:** FR-12, NFR-3.
- **Files:** `bin/configure-registration`, `tests/conftest.py` (ordering: gated stub snippets exist and `accounts` is running when the script's step 8 runs); test in `tests/test_access_groups.py`
- **Depends on:** 10
- **Do:** Add `oidc-group-membership-mapper` `groups` on `hub-gateway` (`claim.name=groups`, `full.path=false`, ID/access/userinfo). Step 8: run `bin/accounts init-app <app>` for every gated snippet in the apps directory. On a first install the runbook (plan §3.6) runs the script before `ACCOUNTS_CLIENT_SECRET` is in `.env` and before `accounts` is up, so step 8 cannot run then: when `accounts` isn't running, step 8 is skipped with a printed "run bin/configure-registration again after starting accounts" notice, and task 17's runbook adds that re-run as step 5 (user decision, 2026-10-30).
- **Acceptance:**
  - With `accounts` stopped, the script exits 0, skips step 8 and prints the re-run notice; run again with `accounts` up, it seeds the access groups.
  - *FR-12 (claim half)* — an ID token from `hub-gateway` for `olduser` carries `groups` containing `access-stub-a` and `access-stub-g` (short names).
  - *NFR-3* — after the script runs, `olduser` is in `access-stub-a` and not in `pending`; a second run of the script plus `init-app stub-a` changes nothing (realm export diff empty).

### 12. Gateway authorises per app (`allowed_groups`, 403 page)

- **Plan:** §1.4 Gated, §3.2 `(gated)` / `(gated-api)`, §6 departure 2. **Spec:** FR-12, FR-6.
- **Files:** `caddy/Caddyfile` (`gated` / `gated-api` take the app name: `uri /oauth2/auth?allowed_groups=access-{args[0]}`, 403 page with "Sign in again" link; `gated-api` passes 401/403 through with plain text), `tests/stubs.py` (snippets emit `import gated <app>` / `import gated-api <app>`); test `tests/test_app_access.py` (new). No `caddy/apps/*.caddy` change: the only live snippet (`collab.caddy`) is ungated.
- **Depends on:** 11
- **Acceptance:**
  - *FR-12 — Given approved account "newuser" and gated apps A and B, When A's admin grants it access, Then "newuser" can sign in to A, And sign-in to B is refused with a message to ask B's admin.* `grant stub-a newuser`, then sign in again via the 403 page's link: `/stub-a/` gives 200 from `stub-a` with `X-Auth-Request-User: newuser`; `/stub-g/` gives 403 whose body names `stub-g`'s admin.
  - *FR-6 (gated half) — … And sign-in to a gated app is still refused.* Approved, ungranted `newuser` gets 403 with the "granted by … admin" page on `/stub-a/` and `/stub-g/`.
  - *NFR-3* — 004's existing gate and gateway tests stay green for `olduser` and the existing test user.

### 13. `[P]` Static checks: gated-snippet rule, no request-body logging

- **Plan:** §2.4, §4 Static checks, §1.7 NFR-2. **Spec:** FR-12, NFR-2.
- **Files:** `check/static.sh`, `tests/test_static.py`, new fixture dirs under `tests/fixtures/` (e.g. `apps-gated-good`, `apps-gated-mismatch`, `apps-gated-noarg`)
- **Depends on:** 12
- **Do:** A snippet imports no gate, or `import gated <app>` / `import gated-api <app>` with `<app>` equal to its filename; fail on a missing or mismatched argument. Fail if any `log` directive captures request bodies. (Memory sum, `restart` and no `ports:` are already generic in `static.sh` and covered by task 8.)
- **Acceptance:**
  - Fixture with `import gated alpha` in `alpha.caddy` passes; `import gated beta` in `alpha.caddy` and a bare `import gated` each fail with a finding naming the file.
  - The repo's own `caddy/apps/` and Caddyfile pass.

### 14. `[P]` Registration rate limit at the entry point

- **Plan:** §1.6, §2.2, §3.1 `HUB_REGISTRATION_WINDOW`, §3.2 `(registration-limit)` and `handle_errors 429`. **Spec:** NFR-1.
- **Files:** `caddy/Caddyfile` (global `order rate_limit before reverse_proxy`; snippet imported inside the `/auth/*` handle on `:80` and `:81`; 429 page keeping `Retry-After`), `compose.yaml` (pass `HUB_REGISTRATION_WINDOW` to `proxy`), `.env.example` (+ `HUB_REGISTRATION_WINDOW=`); test `tests/test_rate_limit.py` (new)
- **Depends on:** 2, 3, 4, 12 (Caddyfile edited after 12)
- **Do:** Zone `registration`, key `{client_ip}`, `events 5`, `window {$HUB_REGISTRATION_WINDOW:1h}`, matching `POST /auth/realms/hub/login-actions/registration` only. Check that the rest of the suite, which registers users from the host client, stays under 5 registrations per 10 s or waits out the window.
- **Acceptance:**
  - *NFR-1 — Given one source has made 5 registrations within the last hour, When it submits again, Then the attempt is refused until the limit resets, And registrations from other sources still succeed.* The probe sends 5 registration POSTs as `203.0.113.7` (each reaches Keycloak, none 429), the 6th gets 429 with `Retry-After` and the "Too many sign-up attempts" page; at the same moment the host client completes a full registration; after 10 s the probe's next POST isn't 429.
  - Sign-in POSTs and other `/auth/*` requests are never rate-limited (existing suite green).

### 15. Deploy to VM 105

- **Plan:** none — added by user decision on 2026-10-30 because the plan omits the deploy step (§3.6 gives the enable steps but no task applies them to the live hub). **Spec:** NFR-2, NFR-3, NFR-4 (and every FR, which the on-hub checks of task 16 need live).
- **Files:** none in either repo (operator steps on VM 105). Runbook: the hub repo's `README.md` ("First setup on VM 105" conventions, plus task 17's "Enable once" steps) for the hub changes; this repo's `deploy/hub/RUNBOOK.md` ("Update", and its login-theme note) for anything on this app's side.
- **Depends on:** 1–14, 16, 17
- **Do:** On VM 105: `cd ~/hub && git pull`, `check/static.sh`, then the README's "Enable once" steps 1–5 (build `proxy`, `up -d`, `bin/configure-registration`, put the printed secret in `.env`, `up -d accounts`, re-run `bin/configure-registration`). Never `down -v`. Record the date and commit deployed in `notes.md`.
- **Acceptance:**
  - `docker compose ps` shows all six services up, `accounts` included; `check/static.sh` passes on the hub.
  - *NFR-3* — an account that existed before the deploy still signs in to this app (`/collab/`) with its old password, and this app keeps answering during the deploy.
  - `bin/accounts list` runs on the hub; the hub's sign-in page shows the Register link (FR-1).

### 16. `[P]` On-hub smoke checks

- **Plan:** §4.3. **Spec:** NFR-2, NFR-1, FR-1, FR-10, FR-8, FR-11, NFR-4.
- **Files:** `check/smoke.sh`
- **Depends on:** nothing unfinished in this wave (the script is run against the deployed hub after task 15; results go to `notes.md` at validation)
- **Do:** Add the §4.3 checks, automated where possible and as printed manual steps where a second device or a reboot is needed.
- **Acceptance:**
  - *NFR-2 — Given the registration page, When requested over plain HTTP, Then it is not served.* `curl -m5 http://hub.<tailnet>.ts.net/auth/realms/hub/protocol/openid-connect/registrations` from off the tailnet fails to connect; the HTTPS URL answers.
  - *NFR-1* with real sources: 6 POSTs from one off-tailnet device, the 6th gets 429; a registration from a second network succeeds right after.
  - *FR-1 / FR-10* on this app's theme: this app's sign-in page shows the Register link and the admin note.
  - *FR-8 / FR-11* with this app: an approved new account has no editor/admin capability in this app; an invite link works with no account.
  - *NFR-4*: after `sudo reboot`, one pending and one approved account are in the same states.
  - `shellcheck` clean.

### 17. `[P]` Runbook (README)

- **Plan:** §3.6, §7 decision 2. **Spec:** FR-5, FR-6, FR-7, FR-12, FR-13 (operator steps for them).
- **Files:** `README.md`
- **Depends on:** nothing unfinished in this wave
- **Do:** "Enable once" steps 1–4 from §3.6, plus step 5: once `accounts` is up, run `bin/configure-registration` again so it seeds the access groups (task 11); "Adding a gated app" gains `bin/accounts init-app <app>` before `bin/reload` and `import gated <app>`; "Admin-created accounts start pending — run `bin/accounts approve <user>`"; the `bin/accounts` commands of §3.4.
- **Acceptance:** Every command in §3.4 and every step in §3.6 appears in the README, and following "Enable once" on a fresh test stack produces a realm that passes the suite (checked by reading against the harness order in `tests/conftest.py`).

### 18. This app's login theme shows the Register link and admin note (conditional)

- **Plan:** §1.6 "This app's login theme", §4.3 FR-1 / FR-10 check. **Spec:** FR-1, FR-10.
- **Files:** in this repo (`SoftwareEngineeringFun`), only if needed: `keycloak-theme/collab/login/` (currently `theme.properties`, `resources/css/collab.css`, `resources/js/appearance.js`; no template override, so it should inherit both)
- **Depends on:** 15, and 16 run on the deployed hub
- **Do:** If task 16's check shows the Register link or the `noAccount` note missing on this app's sign-in page, make the theme render them (e.g. undo CSS that hides them) and redeploy the theme per `deploy/hub/RUNBOOK.md`. If the check passes, change nothing: tick this task as done and log the check's result in `notes.md` (user decision, 2026-10-30). `biome ci` / `tsc --noEmit` apply if any TS changes (plan §5 rule 8).
- **Acceptance:**
  - *FR-1 — Given a visitor on the hub's sign-in page, When it loads, Then a "Register" link is visible and leads to a registration form* — on this app's themed sign-in page.
  - *FR-10 — … And a note says to contact a hub admin* — on this app's themed sign-in page.
