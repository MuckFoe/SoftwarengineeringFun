# 005 — Deploy to the project hub: tasks

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6, 7, 8 — all `[P]` | Leaves with no prerequisite: settings, the pure renderer change, the additive test-realm change, the frontend base module, the runner cap, the hub env example, the hub compose file, the hub Caddy snippet. Each touches its own files. |
| 2 | 9, 11, 12 — all `[P]` | Roles from the app's client needs the decoy realm (3). The frontend URL builders and router/link changes need `base.ts` (4); they touch different files. |
| 3 | 10 | The mount needs the settings (1) and edits `main.py`, which 9 also edits, so it follows 9. |
| 4 | 13, 14 — all `[P]` | Cookie/sign-in wiring and description image prefixing both need the mount (10). 13 edits `main.py`/`oidc.py`; 14 edits the description callers. |
| 5 | 15 | The local hub end-to-end harness needs the compose file (7), the Caddy snippet (8) and every app-side change (11–14). |
| 6 | 16, 17, 18, 20 — all `[P]` | Hub end-to-end specs and the smoke script all run on the harness (15), each in its own file. |
| 7 | 19 | Login theme on the hub. Needs the harness (15) **and** the spec 004 plan amendment (plan §7 D2) implemented in the hub repo. |
| 8 | 21 | The runbook describes the finished deploy: env (6), compose (7), registration (8), theme (19), smoke (20). |

## Checklist

- [x] **1** — `[P]` Hub settings in `config.py`
- [x] **2** — `[P]` `render_description` with a base path
- [x] **3** — `[P]` Test realm: client roles and decoys
- [x] **4** — `[P]` Frontend base module and Vite base
- [x] **5** — `[P]` Runner concurrency cap
- [x] **6** — `[P]` `.env.hub.example` and gitignore
- [x] **7** — `[P]` `docker-compose.hub.yml`, Dockerfile build arg and static checks
- [x] **8** — `[P]` Hub registration: `collab.caddy`
- [x] **9** — `[P]` Roles only from this app's client
- [x] **10** — Backend mounted under the base path
- [x] **11** — `[P]` API client, sign-in URL and WebSocket URL under the base
- [x] **12** — `[P]` Router basename, account sign-in link and invite link
- [x] **13** — `[P]` Session cookie scope, safe `next`, public callback and metadata URL
- [x] **14** — `[P]` Description image URLs under the base path
- [x] **15** — Local hub end-to-end harness (`scripts/check-hub.sh`)
- [x] **16** — `[P]` Hub E2E: path, no sign-in for invites, scoped capabilities
- [x] **17** — `[P]` Hub E2E: persistence, other apps unaffected, fresh start
- [x] **18** — `[P]` Hub E2E: existing specs under the hub and sandbox isolation
- [x] **19** — Login theme on the hub's identity provider
- [x] **20** — `[P]` On-hub smoke script
- [x] **21** — Operator runbook

## Tasks

### 1. `[P]` Hub settings in `config.py`

- **Plan:** §3.1 Configuration, §3.2 `Settings`. **Spec:** FR1, FR3.
- **Files:** `backend/app/config.py`, `backend/tests/unit/test_config.py`
- **Depends on:** nothing
- **Do:** Add `base_path` (`BASE_PATH`, default `""`, must match `^(/[a-z][a-z0-9-]*)?$` else `ConfigError`), `public_base_url` (`PUBLIC_BASE_URL`, default unset), `oidc_metadata_url` (`OIDC_METADATA_URL`, default unset → issuer-derived at use), `session_cookie_name` (`SESSION_COOKIE_NAME`, default `collab_session`), `cookie_secure` (`COOKIE_SECURE`, default `false`). No consumer changes here.
- **Acceptance:**
  - With none of the variables set, the settings hold the defaults above, so local behaviour is unchanged (NFR No behaviour change).
  - `BASE_PATH=/collab` is accepted; `collab`, `/collab/`, `/Collab`, `/1x` and `//x` each raise `ConfigError`.
  - `COOKIE_SECURE` parses `true`/`false` and rejects other values the way existing boolean settings do.

### 2. `[P]` `render_description` with a base path

- **Plan:** §2 Data model (stored sources keep `/api/images/<uuid>`), §3.2 `problems/markdown.py`. **Spec:** FR1.
- **Files:** `backend/app/problems/markdown.py`, `backend/tests/unit/test_markdown.py`
- **Depends on:** nothing
- **Do:** Add `base_path: str = ""` to `render_description`; each allowed image src `/api/images/<uuid>` is emitted as `f"{base_path}/api/images/<uuid>"`. All other rules unchanged. Callers are wired in task 14.
- **Acceptance:**
  - *FR1 — every page, API call and live connection served under the app's path.* `render_description(src, "/collab")` emits `src="/collab/api/images/<uuid>"` for an allowed image.
  - With the default `""`, output is byte-identical to today's for the existing test inputs.
  - Image sources that are disallowed today are still rejected/stripped with `"/collab"` (no prefix lets an external or other-path source through).

### 3. `[P]` Test realm: client roles and decoys

- **Plan:** §1 "Test realm" row, §4.2 role matrix. **Spec:** FR3.
- **Files:** `backend/tests/keycloak/realm.json`, `backend/tests/integration/keycloak_fixtures.py`, `backend/tests/integration/test_keycloak_fixtures.py`, `e2e/global-setup.ts` (added after the fact: see the last acceptance item)
- **Depends on:** nothing
- **Do:** Additive only, so current tests stay green: give the app's client the client roles `editor` and `admin`, and assign them to the existing editor/admin test users (their current realm roles stay until task 9 stops reading them). Add a decoy client `other-app` with client roles `editor` and `admin`, and a decoy user holding `other-app:editor`, `other-app:admin` and realm role `editor`. Add a user holding only the app's client role `admin`. Expose the new users through `login_as`.
- **Acceptance:**
  - An access token for each test user carries exactly the expected `resource_access.<app client>.roles`, `resource_access.other-app.roles` and `realm_access.roles` (checked by decoding the real token from the test Keycloak).
  - `scripts/check.sh` stays green: no existing auth test changes behaviour.
  - The browser tests' `e2e/global-setup.ts` gives the editor/admin test users the app client's `editor`/`admin` roles too. Missed at first: once task 9 stopped reading realm roles, every editor/admin browser test failed. That surfaced only during task 15, the first `scripts/check.sh` run to reach Playwright.

### 4. `[P]` Frontend base module and Vite base

- **Plan:** §3.3 `src/base.ts`, §3.1 frontend build arg. **Spec:** FR1.
- **Files:** `frontend/src/base.ts` (new), `frontend/src/base.test.ts` (new), `frontend/vite.config.ts`
- **Depends on:** nothing
- **Do:** `base.ts` exports `BASE = import.meta.env.BASE_URL`, `apiPath(p)` = `` `${BASE}api${p}` ``, `routerBasename` = `BASE` without trailing slash, or `"/"`. Vite's `base` comes from `APP_BASE_PATH`, default `/`.
- **Acceptance:**
  - Under `BASE="/"`: `apiPath("/me")` is `/api/me`, `routerBasename` is `/`.
  - Under `BASE="/collab/"`: `apiPath("/me")` is `/collab/api/me`, `routerBasename` is `/collab`.
  - `APP_BASE_PATH=/collab/ npm run build` emits `index.html` whose asset URLs start with `/collab/assets/`; without it they start with `/assets/`.

### 5. `[P]` Runner concurrency cap

- **Plan:** §3.4 Runner, §7 D3. **Spec:** Memory NFR, FR6.
- **Files:** `runner/service.py`, `backend/tests/integration/test_runner_service.py`
- **Depends on:** nothing
- **Do:** `SANDBOX_MAX_CONCURRENT` (default `0` = unlimited) and `SANDBOX_SLOT_WAIT_SECONDS` (default `10`). With a cap, `POST /run` acquires a `threading.BoundedSemaphore` slot for the whole `docker run`, released in `finally`; if no slot frees within the wait, answer `503 {"error": "busy"}`.
- **Acceptance:**
  - *Memory — total memory never exceeds 1 GB when several participants run at once.* With the cap at 1 and a short wait, a second concurrent run (real sandbox image) waits while the first holds the slot, and answers 503 `busy` once the wait expires.
  - With the cap at 1, a second run started after the first finishes succeeds (the slot is released, also when the first run errors).
  - With the default `0`, two concurrent runs both proceed as today.
  - The api's existing mapping turns the runner's 503 into the infra-error run outcome (asserted through the runner client test or an existing test covering 503).

### 6. `[P]` `.env.hub.example` and gitignore

- **Plan:** §1 `.env.hub.example` row, §5 rule 7. **Spec:** Secrets NFR.
- **Files:** `.env.hub.example` (new), `.gitignore`
- **Depends on:** nothing
- **Do:** List every variable `docker-compose.hub.yml` reads (§3.1, §3.5: `APP_BASE_PATH`, `BASE_PATH`, `PUBLIC_BASE_URL`, `OIDC_ISSUER`, `OIDC_METADATA_URL`, `OIDC_CLIENT_SECRET`, `SESSION_COOKIE_KEY`, database credentials, `SANDBOX_IMAGE`, …) with placeholder text in the style of `.env.example`, no values. Add `.env.hub` to `.gitignore`.
- **Acceptance:**
  - *Secrets — every credential comes from configuration outside version control.* `git check-ignore .env.hub` succeeds; gitleaks in `scripts/check.sh` passes with the new file.
  - Every `${VAR}` in `docker-compose.hub.yml` (once task 7 lands) appears in `.env.hub.example`; task 7's static test asserts this.

### 7. `[P]` `docker-compose.hub.yml`, Dockerfile build arg and static checks

- **Plan:** §3.5 compose shape, §1 Runtime topology, §1 Requirement → mechanism (FR4, FR7, FR8, Memory, Isolation). **Spec:** FR4, FR7, FR8, Memory NFR, Isolation NFR.
- **Files:** `docker-compose.hub.yml` (new), `backend/Dockerfile`, `backend/tests/unit/test_hub_compose.py` (new)
- **Depends on:** nothing
- **Do:** Write the compose file per §3.5: project `name: collab`; services `db`, `sandbox` (profile `build-only`), `runner`, `api`; `restart: unless-stopped` and `mem_limit` (db 160m, api 224m, runner 64m) everywhere; `SANDBOX_MAX_CONCURRENT=2`; `api` on `app` and external `hub` with alias `collab-api`; `db`/`runner` on `app` only; no `ports:`; named volume `db-data`. `backend/Dockerfile` takes build arg `APP_BASE_PATH` (default `/`) and forwards it to `npm run build`.
- **Acceptance:**
  - *FR4 — when the operator lists the services the deployment runs, none is an identity provider.* The static test parses the file: the service set is exactly {db, runner, api, sandbox}, and no service name or image matches keycloak/identity-provider images.
  - *Isolation NFR.* `db` and `runner` are not on `hub`; no service has `ports:`; only `api` is on `hub`.
  - *Memory — never exceeds 1 GB.* Sum of `mem_limit` + `SANDBOX_MAX_CONCURRENT` × 256m ≤ 1024m.
  - *FR7.* Every service has `restart: unless-stopped`; `db` data is on named volume `db-data`; project name is fixed `collab`.
  - Every `${VAR}` used appears in `.env.hub.example` (skipped with a clear message until task 6 lands, if run first).
  - The hub's `check/static.sh docker-compose.hub.yml` passes.
  - Building `backend/Dockerfile` with `APP_BASE_PATH=/collab/` produces an image whose served `index.html` references `/collab/assets/`; without the arg, `/assets/` (local compose unchanged).

### 8. `[P]` Hub registration: `collab.caddy`

- **Plan:** §3.6 Hub registration, §1 FR2/FR2a mechanism. **Spec:** FR1, FR2, FR2a.
- **Files:** `~/Desktop/ProjectHub/hub/caddy/apps/collab.caddy` (new, hub repo)
- **Depends on:** nothing
- **Do:** The snippet from §3.6 exactly: header comment naming owner repo and "ungated", `handle /collab/*`, `import strip-identity`, `reverse_proxy collab-api:8000`, no prefix stripping, no gate import. Additive only; no other hub file changes.
- **Acceptance:**
  - *FR2 — a browser with no cookie and no account reaches the join step without being sent to sign in.* The hub's `check/static.sh` passes and confirms the snippet imports no gate.
  - `caddy validate` of the hub config including the snippet passes.
  - `git -C ~/Desktop/ProjectHub/hub status` shows only the new file.

### 9. `[P]` Roles only from this app's client

- **Plan:** §3.2 `auth/oidc.py` `session_claims`, §1 FR3 mechanism. **Spec:** FR3.
- **Files:** `backend/app/auth/oidc.py`, `backend/app/main.py` (call site only), `backend/tests/integration/test_auth.py`
- **Depends on:** 3
- **Do:** `session_claims(claims, client_id, max_age_seconds)` reads roles only from `resource_access[client_id].roles`; `realm_access` is no longer read. The callback passes `settings.oidc_client_id`.
- **Acceptance:**
  - *FR3 — given a user holding the editor capability, when they sign in, then they can manage problems; given a user without it, then they cannot.* Sign-in round trip against the test realm: the app-client `editor` user can create a problem; a user with no roles gets 403.
  - *FR3 — given a user holding editor or administrator capabilities only for another hub application, they can neither manage problems nor reactivate sessions.* The decoy user (`other-app:editor`, `other-app:admin`, realm `editor`) gets 403 on problem create and on session reactivate.
  - The app-client `admin`-only user can reactivate a stale session.
  - Unit: `session_claims` with realm roles and other clients' roles present returns only the app client's roles.

### 10. Backend mounted under the base path

- **Plan:** §3.2 `asgi.py` mount and `app_path`, §4.2 prefix routing. **Spec:** FR1.
- **Files:** `backend/app/asgi.py`, `backend/app/main.py`, `backend/tests/integration/test_base_path.py` (new)
- **Depends on:** 1, 9 (same file `main.py`)
- **Do:** With `base_path` set, `asgi.app` is a Starlette app that mounts `create_app(settings)` under it, redirects `/collab` → `/collab/` (307), and 404s everything outside. Add `app_path(request)` and use it for every in-app path test (SPA fallback's `/api/` check). The test builds the app through `asgi` with `BASE_PATH=/collab`.
- **Acceptance:**
  - *FR1 — when a participant joins a session, the page, its API calls and its live connection are all served under the app's path.* Under `BASE_PATH=/collab`: existing routes answer under `/collab/api/...`; `/api/...` returns 404; the SPA shell is served for `/collab/s/x`; `/collab` redirects to `/collab/`; assets are served under `/collab/assets/`; unknown `/collab/api/x` is an API 404, not the SPA shell.
  - The WebSocket at `/collab/api/sessions/<id>/ws` joins and syncs.
  - With `BASE_PATH` unset, the existing 001/002/003 integration tests pass unchanged (NFR No behaviour change).

### 11. `[P]` API client, sign-in URL and WebSocket URL under the base

- **Plan:** §3.3 `client.ts`. **Spec:** FR1.
- **Files:** `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts`
- **Depends on:** 4
- **Do:** `fetch(apiPath(path))`; `loginUrl(next)` = `apiPath("/auth/login?next=...")` with `next` router-relative; `sessionWsUrl()` = `` `${proto}//${host}${apiPath(`/sessions/${id}/ws`)}?name=...` ``.
- **Acceptance:**
  - *FR1.* Under `BASE="/collab/"`: requests go to `/collab/api/...`, `loginUrl("/problems")` is `/collab/api/auth/login?next=%2Fproblems` (the `next` value carries no `/collab`), the WS URL is `wss://<host>/collab/api/sessions/<id>/ws?name=...` on https and `ws://` on http.
  - Under `BASE="/"`: all three equal today's values.

### 12. `[P]` Router basename, account sign-in link and invite link

- **Plan:** §3.3 `main.tsx`, `AccountControl`, `SessionWindow`. **Spec:** FR1.
- **Files:** `frontend/src/main.tsx`, `frontend/src/components/AccountControl.tsx` (+ its test), `frontend/src/pages/SessionWindow.tsx` (+ its test)
- **Depends on:** 4
- **Do:** `<BrowserRouter basename={routerBasename}>`; AccountControl's sign-in `href = loginUrl(next)` with router-relative `next` (uses task 11's `loginUrl` if landed, otherwise `apiPath` directly — keep the router-relative rule either way); invite link = `new URL(`${BASE}s/${invite}`, window.location.origin)`.
- **Acceptance:**
  - *FR1.* Under `BASE="/collab/"`: the invite link shown is `<origin>/collab/s/<invite>`; the sign-in link's `next` is the router-relative path (never `/collab/...`, never prefixed twice).
  - Under `BASE="/"`: invite link and sign-in link equal today's; existing AccountControl and SessionWindow tests pass.

### 13. `[P]` Session cookie scope, safe `next`, public callback and metadata URL

- **Plan:** §3.2 `main.py` `SessionMiddleware`, login/callback, `build_oauth`; §3.1 `PUBLIC_BASE_URL`, `OIDC_METADATA_URL`. **Spec:** FR3, FR1.
- **Files:** `backend/app/main.py`, `backend/app/auth/oidc.py`, `backend/tests/integration/test_auth.py`
- **Depends on:** 10
- **Do:** `SessionMiddleware(session_cookie=settings.session_cookie_name, path=settings.base_path or "/", https_only=settings.cookie_secure)`. Login `next` must start with `/` and not `//` or `/\`, else `/`; callback redirects to `base_path + next`. `redirect_uri` = `PUBLIC_BASE_URL + "/api/auth/callback"` when set, request-derived otherwise. `build_oauth` uses `oidc_metadata_url` when set, issuer-derived otherwise.
- **Acceptance:**
  - *FR3 — capabilities held here grant nothing in any other hub application.* Under `BASE_PATH=/collab`, the session `Set-Cookie` is named `collab_session` with `Path=/collab`, and has `Secure` when `COOKIE_SECURE=true` (absent when false).
  - `next` values `//evil`, `/\evil` and `https://evil` all land on `base_path + "/"` after the callback; `/problems` lands on `/collab/problems`.
  - With `PUBLIC_BASE_URL` set, the authorize redirect's `redirect_uri` equals `PUBLIC_BASE_URL/api/auth/callback`.
  - With `OIDC_METADATA_URL` set to the test Keycloak's discovery URL under a different host alias than the issuer, sign-in still completes (discovery goes to the metadata URL).
  - With none set, the existing sign-in tests pass unchanged.

### 14. `[P]` Description image URLs under the base path

- **Plan:** §3.2 `render_description` callers pass `settings.base_path`; §2 stored sources unchanged. **Spec:** FR1.
- **Files:** `backend/app/problems/api.py`, `backend/app/sessions/ws.py`, `backend/tests/integration/test_base_path.py`
- **Depends on:** 2, 10
- **Do:** Every `render_description` call passes `settings.base_path` (problem get, preview, WS `description_html`). `POST /api/images` still returns `url: "/api/images/<id>"`; stored sources are unchanged.
- **Acceptance:**
  - *FR1.* Under `BASE_PATH=/collab`, a problem whose description has an uploaded image returns `description_html` with `src="/collab/api/images/<id>"` from the problem API, the preview API and the session WebSocket; fetching that src returns the image.
  - The stored description source and `POST /api/images`' `url` still read `/api/images/<id>`.
  - With `BASE_PATH` unset, existing description tests pass unchanged.

### 15. Local hub end-to-end harness (`scripts/check-hub.sh`)

- **Plan:** §4.3 Hub end-to-end, §5 rule 2. **Spec:** FR1, FR2, FR3, FR5–FR9 (enables their hub tests).
- **Files:** `scripts/check-hub.sh` (new), `e2e/playwright.config.ts`
- **Depends on:** 7, 8, 11, 12, 13, 14
- **Do:** Script brings up the hub repo's `compose.test.yaml` (local stand-in for Tailscale) including `collab.caddy`, registers the `collab` client and its `editor`/`admin` roles plus test users in the stand-in's realm `hub`, builds and starts `docker-compose.hub.yml` against it with a test `.env.hub`, runs Playwright's `HUB=1` project, tears down. `playwright.config.ts` gains a `HUB=1` project with `baseURL=<stand-in>/collab/` that runs `hub*.spec.ts` plus the existing `session`, `collab`, `chat`, `problems` specs.
- **Acceptance:**
  - *FR1 — given the app deployed on the hub, when a user opens its address, then the start page loads.* A first smoke test in the HUB project opens `<stand-in>/collab/` and sees the app's start page.
  - The script exits non-zero on any failure and leaves no `collab` or hub test containers or volumes behind.
  - `scripts/check.sh` is unchanged and still green (the hub E2E is its own gate).

### 16. `[P]` Hub E2E: path, no sign-in for invites, scoped capabilities

- **Plan:** §4.3 `hub.spec`, §4 AC table rows FR1, FR2, FR3. **Spec:** FR1, FR2, FR3.
- **Files:** `e2e/hub.spec.ts` (new)
- **Depends on:** 15
- **Acceptance:**
  - *FR1 — when a participant joins a session, then the page, its API calls and its live connection are all served under the app's path on the hub address.* Every request and the WS URL Playwright records while joining start with `/collab/`.
  - *FR2 — given an active session and a browser with no session cookie and no account, when the browser opens the invite link, then it reaches the join step without being sent to sign in.* Fresh context opens the invite, sees the join step, and no navigation went to `/auth/` or `/oauth2/`.
  - *FR3 — given a user holding the editor capability, they can manage problems; without it, they cannot; with capabilities only for another hub application, neither manage nor reactivate.* Through the hub, a `collab:editor` user can open the problem editor, a user holding the other app's roles cannot manage problems or reactivate.
  - *FR3 — given a user holding only this app's administrator capability, when they open another hub application, then it grants them nothing there.* Signed in to collab as `collab:admin`-only, the hub's ungated stub app reports no roles, and the `collab_session` cookie is absent from requests to the stub's path.

### 17. `[P]` Hub E2E: persistence, other apps unaffected, fresh start

- **Plan:** §4.3, §4 AC table rows FR7, FR8, FR9. **Spec:** FR7, FR8, FR9.
- **Files:** `e2e/hub-lifecycle.spec.ts` (new), `scripts/check-hub.sh` (fresh-project and redeploy hooks only, if the spec needs them)
- **Depends on:** 15
- **Acceptance:**
  - *FR9 — given a fresh deployment, when an editor lists the problems and an administrator lists the sessions, then there are exactly the 20 starter problems and no sessions.* Against a fresh `collab` project: the editor's list has exactly the 20 starter titles; the admin's stale list is empty.
  - *FR7 — given a session with code and chat messages, when the app is redeployed, then the session, its code and its messages are all still there.* After `up -d --build --force-recreate`, then `down` (no `-v`) and `up`, the session, its code and its chat messages are present.
  - *FR8 — given another application running on the hub, when the operator deploys a new version of this app, then the other application keeps answering throughout.* A poller hits the hub stub app every 200 ms during `docker compose -p collab up -d --build --force-recreate`; every response is 2xx.

### 18. `[P]` Hub E2E: existing specs under the hub and sandbox isolation

- **Plan:** §4.3 re-run of existing specs under `HUB=1`, §4 AC table rows FR5, FR6, Isolation. **Spec:** FR5, FR6, Isolation NFR, NFR No behaviour change.
- **Files:** `e2e/hub-sandbox.spec.ts` (new), `e2e/fixtures.ts` (only where it hard-codes root paths)
- **Depends on:** 15
- **Do:** Make the existing `session`, `collab`, `chat`, `problems` specs pass under the `HUB=1` baseURL, fixing only root-path assumptions in shared fixtures. Add the socket isolation case.
- **Acceptance:**
  - *FR5 — given two participants in one session on the hub, when one types or sends a chat message, then the other sees it without reloading, and both appear in the presence list.* The existing `collab` and `chat` specs pass under `HUB=1`.
  - *FR6 — when a participant runs a solution, then they see per-test results.* The existing `session` run spec passes under `HUB=1`.
  - *FR6 / Isolation — a solution attempting a network connection fails to make one.* A solution opening sockets to `collab-api:8000` and `auth:8080` shows a failed connection in its test output.
  - The existing specs still pass in the default (root) project.

### 19. Login theme on the hub's identity provider

- **Plan:** §7 D2, §2 client attribute `login_theme=collab`. **Spec:** NFR No behaviour change (003's app-styled sign-in page), FR3.
- **Files:** `~/Desktop/ProjectHub/hub/keycloak/themes/collab/` (copy of `keycloak-theme/collab/`, hub repo), `scripts/check-hub.sh` (set `login_theme=collab` on the test client), `e2e/hub.spec.ts` (one case)
- **Depends on:** 15, 16. **Blocked until** the spec 004 plan amendment from plan §7 D2 (hub mounts `keycloak/themes/` read-only; theme selected per client) is written and implemented in the hub repo. If it isn't, stop and say so; don't change the hub's compose here.
- **Acceptance:**
  - Signing in through the hub via client `collab` shows the app-styled sign-in page (the same check 003's sign-in E2E uses).
  - Signing in to the hub's other stub client still shows the hub default theme.
  - The theme copy matches `keycloak-theme/collab/` byte for byte (the check fails if they drift).

### 20. `[P]` On-hub smoke script

- **Plan:** §4.4 On-hub smoke, §3.7 checks, §4 AC table 4.4 entries. **Spec:** FR1, FR4, FR9, Memory NFR.
- **Files:** `deploy/hub/smoke.sh` (new)
- **Depends on:** 15
- **Do:** Checks run on VM 105: `curl` verifies the certificate of `https://hub…/collab/` is valid (FR1); `docker compose -p collab ps --services` is exactly {db, runner, api} running (FR4); `psql` counts `problems`=20, `sessions`=0, `chat_messages`=0 (FR9, only with `--fresh`); a `--sample-memory` mode samples `docker stats` for project `collab` plus sandbox-labelled containers every 500 ms and reports the maximum total, failing above 1 GB (Memory). Prints pass/fail per check; exits non-zero on any failure.
- **Acceptance:**
  - Run against the task-15 stand-in (with the cert check pointed at the stand-in or skipped by flag), every check passes on a fresh deployment, and the FR9 check fails after a session is created.
  - `--sample-memory` reports a maximum and fails when a threshold flag is set below the observed usage.
  - `shellcheck` passes.

### 21. Operator runbook

- **Plan:** §3.7 Operator commands, §1 `deploy/hub/RUNBOOK.md` row, §3.6 registration. **Spec:** FR7, FR8, FR9, FR2a, Secrets NFR.
- **Files:** `deploy/hub/RUNBOOK.md` (new)
- **Depends on:** 6, 7, 8, 19, 20
- **Do:** First deploy (copy and fill `.env.hub`, `build sandbox`, `up -d --build --wait`; in the hub repo: add `collab.caddy`, `bin/add-client collab confidential /api/auth/callback`, client roles `editor`/`admin`, `login_theme=collab`, `bin/reload`; paste the client secret into `.env.hub`). Update (`git pull`, same build + up; never `down -v`). Checks: `deploy/hub/smoke.sh`, plus the manual steps for FR2a (phone on mobile data, off tailnet and LAN, joins and sees an edit), FR7 (redeploy, then `sudo reboot` VM 105, data still there), FR8 (co-hosted app or `/auth/realms/hub` keeps answering during a deploy) and the Memory sampling run (5 participants in 3 sessions running at once).
- **Acceptance:**
  - Every command in the runbook is one that tasks 7, 8, 19 and 20 provide; each named file and flag exists.
  - It never instructs `down -v` or any step that deletes `db-data`, and every credential step points to `.env.hub` (Secrets NFR).
  - Each on-hub manual check names the spec criterion it covers (FR2a, FR7, FR8, Memory) and what to record in `notes.md` at validation.
