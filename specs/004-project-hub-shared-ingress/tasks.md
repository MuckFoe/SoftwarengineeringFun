# 004 — Project hub: shared entry point and identity: tasks

All files are in the hub repository, `~/Desktop/ProjectHub/hub` (plan §1, "Where
it lives"). Paths below are relative to it.

Tasks 19–22 implement the plan's **amendment of 2026-10-29 (per-app login
themes)**, added after tasks 1–18 were done. They are additive: no earlier
task's acceptance changes, and every earlier test must still pass.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1 | Repo, lint and the check runner come first; every later task must pass `scripts/check.sh`. |
| 2 | 2, 3 — all `[P]` | Static compose checks are written before any compose file exists (test-first). The on-hub smoke script depends only on the runner. Disjoint files. |
| 3 | 4 | The identity services start `compose.yaml` and are the first thing the compose checks run against. |
| 4 | 5, 6 — all `[P]` | Entry-point containers and the realm file are independent of each other; both need task 4's `compose.yaml` and networks. |
| 5 | 7, 8 — all `[P]` | Snippet/Caddy static checks need a real `Caddyfile` (task 5). The integration harness needs every hub service and the realm (tasks 5, 6). Disjoint files. |
| 6 | 9, 10 — all `[P]` | Base routing and stub applications both need the harness, and touch disjoint files. |
| 7 | 11 | The gateway service needs `/auth` routing (task 9). |
| 8 | 12 | The sign-in driver needs the gateway to sign in through. |
| 9 | 13 | Gate snippets need stubs (10) and sign-in (12) to be tested. |
| 10 | 14, 15, 16, 17 — all `[P]` | Each verifies one more requirement on top of the complete stack, in its own files. Implement in parallel, but run their integration suites one at a time: they share the harness's loopback ports. |
| 11 | 18 | The runbook documents the commands from tasks 15 and 16. |
| 12 | 19, 20 — all `[P]` | Amendment. The theme-directory static rules and the themes mount touch disjoint files and need only the finished stack. |
| 13 | 21 | `bin/set-login-theme` is tested against the mounted temp themes dir (task 20). |
| 14 | 22 | The runbook documents the command and the restart rule from task 21. |

## Checklist

- [x] **1** — Hub repo skeleton and check runner
- [x] **2** — `[P]` Static checks for compose files
- [x] **3** — `[P]` On-hub smoke script
- [x] **4** — Identity services: Keycloak and its database
- [x] **5** — `[P]` Entry-point containers: Tailscale sidecar and Caddy
- [x] **6** — `[P]` Realm `hub` import file
- [x] **7** — `[P]` Static checks for app snippets, Caddy config and secrets
- [x] **8** — `[P]` Integration test harness
- [x] **9** — `[P]` Base routing on both listeners
- [x] **10** — `[P]` Stub applications
- [x] **11** — Gateway service (oauth2-proxy)
- [x] **12** — Sign-in driver for tests
- [x] **13** — Gated and ungated app snippets
- [x] **14** — `[P]` Per-app routing and failure isolation
- [x] **15** — `[P]` `bin/reload` and adding an app
- [x] **16** — `[P]` `bin/add-client` and a second app on the same identity provider
- [x] **17** — `[P]` Data isolation
- [x] **18** — Runbook
- [x] **19** — `[P]` Static checks for login-theme directories
- [x] **20** — `[P]` Mount login themes into `auth`, in the stack and the test override
- [x] **21** — `bin/set-login-theme` and per-client login themes
- [x] **22** — Runbook: login themes

## Tasks

### 1. Hub repo skeleton and check runner

- **Plan:** §1 hub repo layout (`scripts/check.sh`); §5 constitution 2, 7, 8. **Spec:** Secrets NFR.
- **Files:** `pyproject.toml`, `.gitignore`, `scripts/check.sh`
- **Depends on:** nothing
- **Do:** `git init` the hub repo. `pyproject.toml` for Python 3.12 with test-only deps `pytest` and `httpx`, and `ruff` config; register a pytest marker `integration`. `.gitignore` covers `.env`, virtualenvs and caches. `scripts/check.sh` runs `ruff check`, `ruff format --check` on `tests/`, `shellcheck` on `bin/`, `check/` and `scripts/` (skipping empty directories), then `pytest`; it exits non-zero if any step fails and treats "no tests collected" as success until tests exist.
- **Acceptance:**
  - *Secrets NFR — Every credential comes from configuration outside version control; none is committed.* `git check-ignore .env` succeeds.
  - `scripts/check.sh` exits 0 on the skeleton; adding a deliberately mis-formatted Python file or a shell script with a shellcheck finding makes it exit non-zero.

### 2. `[P]` Static checks for compose files

- **Plan:** §4.1 (compose checks); §1 networks; §2.3 memory budget. **Spec:** FR3, FR9, FR10, Memory NFR.
- **Files:** `check/static.sh`, `tests/test_static.py`, `tests/fixtures/compose/*.yaml`
- **Depends on:** 1
- **Do:** `check/static.sh [compose-file]` (default `compose.yaml`) fails with a message naming the finding when: any service has `ports:`; any service lacks `restart: unless-stopped`; any service lacks `mem_limit` or the sum exceeds 1536m; a service other than `auth`/`db-auth` is on `auth-db`; `db-auth` is on `hub`. Write `tests/test_static.py` first against fixtures: one passing compose file and one copy per violation.
- **Acceptance:**
  - *FR3 — Given the running hub, when a client on the hub's local network connects to the hub machine on any port other than the entry point's, then no application, database or identity provider answers.* The fixture with a `ports:` entry fails the check; the good fixture passes.
  - *FR9 — Given a running hub, when the hub machine is rebooted, then once it is back up every hosted application answers at its address with no operator action.* The fixture with a service missing `restart: unless-stopped` fails.
  - *FR10 — … every user can still sign in and every other application's data is unchanged.* Fixtures with a third service on `auth-db`, or `db-auth` on `hub`, fail.
  - *Memory NFR — The entry point and identity provider together leave at least 2.5 GB of the hub's 4 GB for applications.* Fixtures with a missing `mem_limit`, or a total above 1536m, fail.

### 3. `[P]` On-hub smoke script

- **Plan:** §4.3; §3.4 (`check/smoke.sh`). **Spec:** FR2, FR3, FR4, FR9, Memory NFR.
- **Files:** `check/smoke.sh`
- **Depends on:** 1
- **Do:** A script the operator runs on or against the real hub. Each check prints `PASS`/`FAIL` with its FR id; the script exits non-zero if any check fails. Checks: FR2 `curl -sf` (no `-k`) of `${HUB_URL}/auth/realms/hub`; FR3 `docker ps --format '{{.Ports}}'` shows no host binding in any project, and a `--lan-scan <host>` mode (run from another LAN machine) does a full TCP scan and allows only sshd; FR4 exactly one Keycloak container; FR9 `systemctl is-enabled docker`, and a `--after-reboot <path>...` mode that polls each hosted app's address for up to 5 min; Memory `docker stats --no-stream` total for project `hub` ≤ 1536 MB.
- **Acceptance:**
  - *FR2 — Given a device with default trust settings, when it opens a hosted application's address, then the connection is HTTPS and no certificate warning is shown.* The script's FR2 check uses no flag that skips certificate verification.
  - *FR3, FR4, FR9, Memory NFR* — each has a check in the script, as listed above.
  - `shellcheck` is clean via `scripts/check.sh`. The real run is logged in `notes.md` at `/sdd-validate`, not here.

### 4. Identity services: Keycloak and its database

- **Plan:** §1 services (`auth`, `db-auth`), networks; §2.3; §3.1; §3.2 `auth` environment. **Spec:** FR4, FR10, Memory NFR, Secrets NFR.
- **Files:** `compose.yaml`, `.env.example`, `tests/test_repo_static.py`
- **Depends on:** 2
- **Do:** Start `compose.yaml` (project name `hub`): network `hub` with `name: hub`; internal network `auth-db`; `db-auth` (`postgres:17-alpine`, own volume, `auth-db` only, 256m); `auth` (`quay.io/keycloak/keycloak:26.4`, environment exactly as plan §3.2, `command: start --import-realm`, `keycloak/` mounted as the import directory, `JAVA_OPTS_KC_HEAP`, 768m, on `hub` and `auth-db`). Pass `HUB_URL` and `OAUTH2_PROXY_CLIENT_SECRET` to `auth` so the realm import can substitute them (task 6). `restart: unless-stopped` everywhere, no `ports:`. `.env.example` lists every name in plan §3.1 with no secret values. `tests/test_repo_static.py` runs `check/static.sh` against the real `compose.yaml` and checks `.env.example` holds exactly the §3.1 names with empty secret values.
- **Acceptance:**
  - *FR4 — Given the running hub, when the operator lists running services, then exactly one identity provider is running …* `compose.yaml` defines exactly one Keycloak service.
  - *FR10* — `db-auth` has its own named volume and is on `auth-db` only (enforced by task 2's check, which now passes on the real file).
  - *Secrets NFR* — `.env.example` has names only; `compose.yaml` takes every credential from the environment.

### 5. `[P]` Entry-point containers: Tailscale sidecar and Caddy

- **Plan:** §1 services (`ts-hub`, `proxy`), network note, traffic paths; §3.2 `tailscale/hub.json`, Caddyfile global options; §6 departures 1, 3, 8. **Spec:** FR1, FR2, FR3, FR9, Consistency NFR.
- **Files:** `compose.yaml`, `tailscale/hub.json`, `caddy/Caddyfile` (plus `caddy/apps/.gitkeep`); assertions added to `tests/test_repo_static.py`
- **Depends on:** 4
- **Do:** Add `ts-hub` (pinned `tailscale/tailscale` tag, state volume, `TS_AUTHKEY`, `TS_SERVE_CONFIG` pointing at `tailscale/hub.json`, hostname `hub`, on network `hub`, 128m) and `proxy` (`caddy:2-alpine`, `network_mode: service:ts-hub`, mounts `caddy/Caddyfile` and `caddy/apps/`, 64m). `tailscale/hub.json` exactly as plan §3.2. A minimal `caddy/Caddyfile`: global options from §3.2 (`auto_https off`, `admin localhost:2019`, `trusted_proxies`), a `:80` site that imports `/etc/caddy/apps/*.caddy` and ends in `handle { respond 404 }`, and a `:81` site that answers 404. Routes come in tasks 9, 11 and 13. Add tests that `hub.json` funnels only `:443` and proxies `:443`→`127.0.0.1:80`, `:8443`→`127.0.0.1:81`.
- **Acceptance:**
  - *FR2* — `hub.json` serves HTTPS on `:443` and `:8443` with the node's own certificate (no private CA anywhere in the repo).
  - *FR3* — Static check passes on `compose.yaml`: still no `ports:`. Funnel (`AllowFunnel`) is set for `:443` only, so the admin listener is never public.
  - *FR9* — `ts-hub` uses a pinned tag and a persistent state volume; both services have `restart: unless-stopped`.
  - `caddy validate` in the pinned image passes on the Caddyfile.

### 6. `[P]` Realm `hub` import file

- **Plan:** §2.1 identity; §3.2 `authproxy` (client `hub-gateway`); §7 brute-force decision. **Spec:** FR4, FR5, FR10.
- **Files:** `keycloak/realm-hub.json`, `tests/test_realm.py`
- **Depends on:** 4
- **Do:** Realm `hub`: registration off, brute-force detection on. Confidential client `hub-gateway` with redirect URI `${HUB_URL}/oauth2/callback` and secret `${OAUTH2_PROXY_CLIENT_SECRET}` (Keycloak import substitution). No users and no other clients in the file. `tests/test_realm.py` parses the JSON and asserts each of these.
- **Acceptance:**
  - *FR4 — … exactly one identity provider is running, and two different applications both send their users to it to sign in.* One realm, `hub`, with the gateway client every gated app shares.
  - *FR5* — `hub-gateway`'s only redirect URI is `${HUB_URL}/oauth2/callback`.
  - *FR5* — `hub-gateway` has an audience mapper adding `hub-gateway` to its access tokens' `aud` (oauth2-proxy rejects tokens without it).
  - *FR10* — The file contains no users; identities live only in `db-auth` (import never overwrites an existing realm).
  - No secret value in the file — only the `${…}` placeholder.

### 7. `[P]` Static checks for app snippets, Caddy config and secrets

- **Plan:** §2.2 rules; §4.1 (`caddy validate`, `caddy fmt --diff`, secret scan). **Spec:** FR1, Secrets NFR.
- **Files:** `check/static.sh`, `tests/test_static.py`, `tests/fixtures/apps-*/`
- **Depends on:** 2, 5
- **Do:** Extend `check/static.sh` with: for every `caddy/apps/*.caddy`, filename equals the `handle` prefix, prefix matches `[a-z][a-z0-9-]*`, is not `auth` or `oauth2`, no two files claim the same prefix, and every upstream host starts with `<app>-`; `caddy validate` and `caddy fmt --diff` in the pinned Caddy image; no tracked file contains `KEY=`, `SECRET=` or `PASSWORD=` followed by a value. Add the apps directory as an optional argument so tests can point it at fixtures. Write the failing tests first: one fixture directory per rule violation.
- **Acceptance:**
  - *FR1 — Given two applications hosted on the hub, when a user requests each one's address, then each request is answered by the application it addresses.* Fixtures with a mismatched filename, a reserved prefix, a duplicate prefix, or an upstream outside `<app>-` fail; a fixture with two valid apps passes.
  - *Secrets NFR* — A fixture file with `PASSWORD=hunter2` fails the scan; the real repo passes.
  - The real repo passes the whole `check/static.sh`.

### 8. `[P]` Integration test harness

- **Plan:** §4.2 (`compose.test.yaml`, session fixture); §5 constitution 4 exception. **Spec:** FR3, FR4.
- **Files:** `compose.test.yaml`, `tests/conftest.py`, `tests/test_harness.py`
- **Depends on:** 5, 6
- **Do:** `compose.test.yaml` replaces only `ts-hub` with a minimal stand-in that holds the network namespace, joins `hub`, and binds `127.0.0.1:18080→80` and `127.0.0.1:18081→81`; sets `HUB_URL=http://localhost:18080`, `HUB_ADMIN_URL=http://localhost:18081`, `OAUTH2_PROXY_COOKIE_SECURE=false`; mounts `${HUB_APPS_DIR}` at `/etc/caddy/apps` so tests can add app snippets without touching `caddy/apps/`. `tests/conftest.py` session fixture: generate random secrets into a temp env file, create a temp apps dir, `docker compose up -d`, wait for Keycloak health, create a test user in realm `hub` with `kcadm.sh`, tear down with `down -v`. Integration tests carry the `integration` marker.
- **Acceptance:**
  - *FR4* — With the stack up, exactly one Keycloak container is running and realm `hub` exists with `hub-gateway` imported (the realm import worked).
  - *FR3* — The only host bindings in project `hub` are the two loopback ports of the stand-in; `auth` and `db-auth` have none.
  - No secret written to the repo: `git status` is clean after a run.

### 9. `[P]` Base routing on both listeners

- **Plan:** §1 traffic paths; §3.2 Caddyfile (`:80` admin/master 404, `/auth/*`, catch-all; `:81`); §6 departure 2; §7 (unknown paths 404, admin not public). **Spec:** FR1, FR3, FR4.
- **Files:** `caddy/Caddyfile`, `tests/test_routing.py`
- **Depends on:** 8
- **Do:** Write `tests/test_routing.py` first, then add to `:80`: `/auth/admin*` and `/auth/realms/master/*` → 404, then `/auth/*` → `auth:8080`; to `:81`: `/auth/*` → `auth:8080`. Unknown paths stay 404 on both.
- **Acceptance:**
  - *FR1* — `GET /` and `GET /no-such-app/` on `:18080` give 404.
  - *FR4* — `GET :18080/auth/realms/hub/.well-known/openid-configuration` gives 200 with `issuer` = `${HUB_URL}/auth/realms/hub`.
  - *FR3* — `/auth/admin/` and `/auth/realms/master/` give 404 on `:18080` (public listener) and are served by Keycloak on `:18081` (admin listener). Keycloak and its database answer on no host port other than through the entry point.

### 10. `[P]` Stub applications

- **Plan:** §4.2 stubs; §3.3 hosted-application contract. **Spec:** FR1, FR5, FR6, FR8, FR10.
- **Files:** `tests/stubs/whoami.yaml`, `tests/stubs/data.yaml`, `tests/stubs.py`; `tests/test_stubs.py`
- **Depends on:** 8
- **Do:** `whoami.yaml`: one pinned `traefik/whoami` service with request logging on, parametrised by `APP`, joined to external network `hub` with alias `${APP}-web`, `restart: unless-stopped`, no `ports:` — started as compose project `stub-a`, `stub-b`, `stub-c`. `data.yaml`: `postgres:17-alpine` on its own project network only, with one seeded row — started as `data-a`, `data-b`. `tests/stubs.py`: helpers to start, stop and `down -v` a stub project, read its request log, and write or remove its snippet (`gated`, `gated-api` or ungated) in the harness's apps dir. `tests/test_stubs.py` checks the stubs meet the contract.
- **Acceptance:**
  - *FR1, FR8* — A started whoami stub is resolvable on `hub` as `<app>-web` and its response names its own container.
  - *FR10* — A data stub is on no network shared with the hub or another stub, and its seeded row is readable.
  - Contract §3.3 — no stub declares `ports:`; every stub service has `restart: unless-stopped`.

### 11. Gateway service (oauth2-proxy)

- **Plan:** §1 services (`authproxy`); §3.2 `authproxy` environment, Caddyfile `/oauth2/*`; §6 departure 4. **Spec:** FR4, FR5.
- **Files:** `compose.yaml`, `caddy/Caddyfile`, `tests/test_gateway.py`
- **Depends on:** 9
- **Do:** Write `tests/test_gateway.py` first. Add `authproxy` (`quay.io/oauth2-proxy/oauth2-proxy:v7.7.1`, env exactly as plan §3.2, on `hub`, 64m, `restart: unless-stopped`) and route `/oauth2/*` → `authproxy:4180` on `:80`, never gated.
- **Acceptance:**
  - *FR5 — Given a gated application and a browser with no session, when the browser requests any page of that application, then it is sent to sign in …* `GET /oauth2/auth` with no cookie gives 401; `GET /oauth2/start?rd=/x` gives a redirect to `${HUB_URL}/auth/realms/hub/protocol/openid-connect/auth` with `client_id=hub-gateway` and `redirect_uri=${HUB_URL}/oauth2/callback`.
  - *FR4* — The sign-in redirect lands on the single realm `hub`.
  - Static checks still pass (memory total, restart, no ports).

### 12. Sign-in driver for tests

- **Plan:** §4.2 ("Browser sign-in is driven with an httpx client following Keycloak's login form … stdlib `html.parser`"). **Spec:** FR4, FR5.
- **Files:** `tests/conftest.py`, `tests/test_gateway.py`
- **Depends on:** 11
- **Do:** Add a `sign_in(client, path)` fixture that follows `/oauth2/start`, parses Keycloak's login form with `html.parser`, posts the test user's credentials and follows the callback, leaving the session cookie in the client's jar. Add gateway tests that use it.
- **Acceptance:**
  - *FR5 — … the application receives no request until sign-in succeeds.* After `sign_in`, the client holds cookie `_hub_auth` with path `/`, and `GET /oauth2/auth` gives 202 with `X-Auth-Request-User` naming the test user.
  - With a wrong password the flow ends on Keycloak's login form and no `_hub_auth` cookie is set.

### 13. Gated and ungated app snippets

- **Plan:** §3.2 Caddyfile snippets `strip-identity`, `gated`, `gated-api`; §2.2 snippet shape; §3.3 item 5. **Spec:** FR5, FR6.
- **Files:** `caddy/Caddyfile`, `tests/test_gate.py`
- **Depends on:** 10, 12
- **Do:** Write `tests/test_gate.py` first with `stub-a` gated, `stub-b` ungated and a `gated-api` stub. Add the three snippets as in BoarHQ: `strip-identity` removes client-supplied `X-Auth-Request-*` and `Authorization`-derived identity headers; `gated` does `forward_auth authproxy:4180` and redirects to `/oauth2/start?rd=…` on 401, copying identity headers from the auth response; `gated-api` is the same but passes the 401 through.
- **Acceptance:**
  - *FR5 — Given a gated application and a browser with no session, when the browser requests any page of that application, then it is sent to sign in and the application receives no request until sign-in succeeds.* No cookie: `/stub-a/x` gives 302 to `/oauth2/start` and `stub-a`'s request log is empty; after `sign_in` it gives 200 from `stub-a`. A forged `X-Auth-Request-User` reaches `stub-a` replaced by the real user. A `gated-api` prefix gives 401, not a redirect.
  - *FR6 — Given an ungated application and a browser with no session, when the browser requests one of its pages, then the application answers without a sign-in prompt from the entry point.* No cookie: `/stub-b/x` gives 200 from `stub-b` with no redirect; a forged `X-Auth-Request-User` does not reach `stub-b`.

### 14. `[P]` Per-app routing and failure isolation

- **Plan:** §1 requirement → mechanism (FR1, FR8); §4.2 rows FR1, FR8. **Spec:** FR1, FR8.
- **Files:** `tests/test_isolation.py`
- **Depends on:** 13
- **Do:** Integration tests only; the mechanism is already in place. Show each test failing first by pointing `stub-b`'s snippet upstream at `stub-a-web` (FR1) and by leaving `stub-a` stopped as well (FR8), then restore.
- **Acceptance:**
  - *FR1 — Given two applications hosted on the hub, when a user requests each one's address, then each request is answered by the application it addresses.* Signed in, `/stub-a/` names `stub-a`'s container and `/stub-b/` names `stub-b`'s.
  - *FR8 — Given two hosted applications with one of them stopped, when a user requests the stopped one, then they receive an error; and when they request the other, then it answers normally.* After `docker stop` of `stub-b`, `/stub-b/` gives 502 and `/stub-a/` (signed in) gives 200.

### 15. `[P]` `bin/reload` and adding an app

- **Plan:** §3.4 `bin/reload`, "Adding an app"; §1 requirement → mechanism (FR7); §6 departure 3. **Spec:** FR7.
- **Files:** `bin/reload`, `tests/test_add_app.py`
- **Depends on:** 13
- **Do:** Write `tests/test_add_app.py` first. `bin/reload` runs `caddy validate` and then `caddy reload` inside `proxy` (via `docker compose exec`, honouring `COMPOSE_FILE`/project so the test override works); on invalid config it exits non-zero and the running config is kept.
- **Acceptance:**
  - *FR7 — Given a running hub with one application and a signed-in user, when a second application is added, then the first application's address still answers the same way and the user is still signed in.* Sign in, record `/stub-a/`'s status and body owner; start `stub-c`, add its snippet, run `bin/reload`; `/stub-a/` answers the same with the same cookie and no sign-in redirect, and `/stub-c/` answers.
  - An invalid snippet makes `bin/reload` exit non-zero and `/stub-a/` keeps answering as before.
  - `shellcheck` clean.

### 16. `[P]` `bin/add-client` and a second app on the same identity provider

- **Plan:** §3.4 `bin/add-client`; §2.1 per-app clients and roles; §3.3 item 6. **Spec:** FR4.
- **Files:** `bin/add-client`, `tests/test_add_client.py`
- **Depends on:** 13
- **Do:** Write `tests/test_add_client.py` first. `bin/add-client <app> <confidential|public> <redirect-path>` uses `kcadm.sh` inside `auth` to create client `<app>` in realm `hub` with redirect `${HUB_URL}/<app><redirect-path>`; prints the generated secret once (confidential only) and writes nothing to the repo; refuses with non-zero exit if the client exists.
- **Acceptance:**
  - *FR4 — Given the running hub, when the operator lists running services, then exactly one identity provider is running, and two different applications both send their users to it to sign in.* After `bin/add-client stub-b confidential /callback`, the test user completes an authorization-code sign-in through client `stub-b`, and the issued token's `iss` equals the gateway's issuer `${HUB_URL}/auth/realms/hub`; still exactly one Keycloak container.
  - Running it a second time for the same app exits non-zero and changes nothing.
  - `git status` is clean after the run (secret not written); `shellcheck` clean.

### 17. `[P]` Data isolation

- **Plan:** §1 requirement → mechanism (FR10); §4.2 row FR10. **Spec:** FR10.
- **Files:** `tests/test_data_isolation.py`
- **Depends on:** 13
- **Do:** Integration test using `data-a`, `data-b` and the sign-in driver. Show it failing first by running the reset against a project that shares `data-b`'s volume, then restore.
- **Acceptance:**
  - *FR10 — Given an application with stored data and existing user accounts, when that application's data is reset, then every user can still sign in and every other application's data is unchanged.* After `docker compose -p data-a down -v` and `up`, the test user completes `sign_in`, and `data-b`'s seeded row is still present; `data-a`'s row is gone (the reset happened).

### 18. Runbook

- **Plan:** §1 ("README.md — runbook: first setup, adding/removing an app, admin access", "the hub repo's README links back to them"); §3.2 Tailscale prerequisites; §3.3; §3.4. **Spec:** FR2, FR7, FR9.
- **Files:** `README.md`
- **Depends on:** 15, 16
- **Do:** First setup on VM 105 (tailnet prerequisites: MagicDNS, HTTPS certificates, `funnel` node attribute for `tag:hub`; non-ephemeral tagged auth key; `systemctl enable docker`; fill `.env` from `.env.example`; `docker compose up -d`). Adding and removing an app, step for step as plan §3.4. The hosted-application contract (§3.3). Admin console access via `${HUB_ADMIN_URL}/auth` from the tailnet only. Running `check/smoke.sh`. Link to this repo's `specs/004-project-hub-shared-ingress/`.
- **Acceptance:**
  - *FR2* — The prerequisites that make the certificate publicly trusted are listed.
  - *FR7 — … when a second application is added, then the first application's address still answers the same way …* The add/remove procedure changes no existing file other than adding/removing one snippet and running `bin/reload`.
  - *FR9* — The steps that make the hub come back after reboot (Docker enabled, non-ephemeral key) are listed.
  - Reviewed by the human against plan §3.3 and §3.4.

### 19. `[P]` Static checks for login-theme directories

- **Plan:** §2.2 rules (amendment: theme directories); §4.1 ("including the theme-directory rules"); §1 hub repo layout (`keycloak/themes/<app>/`). **Spec:** FR1.
- **Files:** `check/static.sh`, `tests/test_static.py`, `tests/fixtures/apps-*/` (new theme fixtures)
- **Depends on:** nothing unfinished (extends task 7)
- **Do:** Write the failing tests first. Extend `check/static.sh` with an optional themes-directory argument (default `keycloak/themes`, alongside the existing apps-directory argument) and the rule: every directory `<themes>/<name>/` has a matching `<apps>/<name>.caddy`, and contains `login/theme.properties`. A missing or empty themes directory passes (an app with no theme has no directory). Fixtures: one with a valid theme for an existing app, one with a theme whose name has no snippet, one with a theme lacking `login/theme.properties`.
- **Acceptance:**
  - *FR1 — Given two applications hosted on the hub, when a user requests each one's address, then each request is answered by the application it addresses.* A theme directory with no matching `caddy/apps/<name>.caddy` fails the check, naming the directory; a theme without `login/theme.properties` fails; a valid theme for an existing app passes, as does no themes directory at all.
  - Every fixture that passed task 7's checks still passes; the real repo passes the whole `check/static.sh`.

### 20. `[P]` Mount login themes into `auth`, in the stack and the test override

- **Plan:** §3.2 `auth` volumes (amendment: `./keycloak/themes:/opt/keycloak/themes:ro`, theme caching on); §2.1 login theme (realm `loginTheme` unset); §4.2 (temp copy of `keycloak/themes/` mounted by the test override). **Spec:** FR4, FR7.
- **Files:** `compose.yaml` (plus `keycloak/themes/.gitkeep`), `compose.test.yaml`, `tests/conftest.py`, `tests/test_realm.py`
- **Depends on:** nothing unfinished (extends tasks 4, 6, 8)
- **Do:** Add the read-only `./keycloak/themes:/opt/keycloak/themes` mount to `auth`; leave the import mount and theme caching as they are. In `compose.test.yaml`, override that mount with `${HUB_THEMES_DIR}`. In the session fixture, create a temp directory holding a copy of `keycloak/themes/`, export it as `HUB_THEMES_DIR` before `up`, and expose its path to tests so they can add a theme while `auth` runs. Add a `tests/test_realm.py` assertion that the realm file sets no `loginTheme`.
- **Acceptance:**
  - *FR4 — … exactly one identity provider is running, and two different applications both send their users to it to sign in.* With the stack up, still exactly one Keycloak container, realm `hub` imported, and `/auth/realms/hub/.well-known/openid-configuration` gives 200 (the themes mount neither breaks start nor the import).
  - *FR7 — … the first application's address still answers the same way …* For clients with no theme, sign-in via `hub-gateway` still shows Keycloak's default login page: the existing gateway and gate tests (tasks 11–13) pass unchanged.
  - The realm file has no `loginTheme` key. Static checks still pass on `compose.yaml` (no `ports:`, memory total unchanged). `git status` is clean after a test run (the temp themes dir is outside the repo).

### 21. `bin/set-login-theme` and per-client login themes

- **Plan:** §3.4 `bin/set-login-theme`; §2.1 login theme (client attribute `login_theme=<app>`); §3.2 (a theme added while `auth` runs is found without restart); §4.2 row "FR4, FR7 (amendment: login themes)"; §3.3 item 8. **Spec:** FR4, FR7.
- **Files:** `bin/set-login-theme`, `tests/test_login_theme.py`, `tests/stubs/themes/stub-b/` (`login/theme.properties` and one overridden login template with marker text)
- **Depends on:** 20
- **Do:** Write `tests/test_login_theme.py` first. The test theme extends Keycloak's default login theme and overrides one template to include a unique marker string. `bin/set-login-theme <app>` uses `kcadm.sh` inside `auth` (honouring `COMPOSE_FILE`/project like `bin/reload`) to set attribute `login_theme=<app>` on client `<app>` in realm `hub`. It refuses with non-zero exit and changes nothing if the theme directory is missing from the mounted themes dir or client `<app>` doesn't exist. Re-running it is a no-op that exits 0. It writes nothing to the repo.
- **Acceptance:**
  - *FR4 — … two different applications both send their users to it to sign in.* (amendment) Sign in as the test user via `/stub-a/`. With client `stub-b` created by `bin/add-client`, copy `tests/stubs/themes/stub-b/` into the mounted temp themes dir **after** `auth` is up, then run `bin/set-login-theme stub-b`: it exits 0, and `auth` is not restarted (same container start time). Starting an authorization-code sign-in for client `stub-b` shows the marker. Starting sign-in via `hub-gateway` in a fresh client shows Keycloak's default page with no marker.
  - *FR7 — Given a running hub with one application and a signed-in user, when a second application is added, then the first application's address still answers the same way and the user is still signed in.* After the theme is added and selected, the earlier `/stub-a/` session still gets 200 with the same cookie and no sign-in redirect.
  - `bin/set-login-theme` exits non-zero and leaves the client's attributes unchanged for an app with no theme directory and for an unknown client. Running it twice for `stub-b` exits 0 both times.
  - `shellcheck` clean; `git status` clean after the run.

### 22. Runbook: login themes

- **Plan:** §3.3 item 8; §3.4 "Adding an app" step 4, "Removing an app"; §7 per-app login themes (restart rule, operator review). **Spec:** FR7.
- **Files:** `README.md`
- **Depends on:** 21
- **Do:** Add to the runbook: contract item 8 (an optional login theme, built for the pinned Keycloak version, never relying on the realm-wide theme); adding an app's step 4 (copy to `keycloak/themes/<app>/`, run `bin/set-login-theme <app>`); on removal, also delete the theme directory; changing an already-served theme needs `docker compose restart auth`, which briefly stops sign-in for every app while existing sessions survive; the operator reviews a theme's HTML/CSS/JS before copying it in.
- **Acceptance:**
  - *FR7 — … when a second application is added, then the first application's address still answers the same way and the user is still signed in.* The add procedure with a theme still changes no existing file: it only adds a snippet and a theme directory, then runs commands. The one step that briefly interrupts sign-in for every app (restarting `auth` to change a theme) is stated as such, together with when it's needed.
  - Reviewed by the human against plan §3.3 item 8, §3.4 and §7.
