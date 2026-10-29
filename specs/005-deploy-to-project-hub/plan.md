# 005 — Plan: deploy to the project hub

The hub is what spec 004 defines and its plan builds in `~/Desktop/ProjectHub/hub`.
This plan treats that plan's §3.3 "Hosted-application contract" as the interface
it codes against. In short:

- join the external network `hub` with `<app>-<svc>` aliases
- publish no `ports:`
- `restart: unless-stopped`
- serve everything under `/<app>/`, with no prefix stripping
- if ungated, sign in with your own client in realm `hub`, using the issuer
  `${HUB_URL}/auth/realms/hub` and back-channel calls to
  `http://auth:8080/auth/realms/hub/...`

The app is **ungated** at the hub. Invite links must never meet a sign-in
(FR2), so the app keeps doing its own OIDC sign-in, now against the hub's realm.

App path name: **`collab`** (see §7, D1). The app lives at `${HUB_URL}/collab/`.

## 1. Architecture

### What changes, by component

| Component | Change | For |
|---|---|---|
| **Backend (api)** | Serves under a configurable base path. Session cookie is scoped to that path and gets an app-specific name. Roles are read from this app's own client in the token, not from realm roles. The OIDC back channel goes to an internal metadata URL. The callback URL comes from a configured public base URL. Rendered descriptions get image URLs under the base path. | FR1, FR3 |
| **Frontend** | Built with a base path. Router basename, API calls, the WebSocket URL, the sign-in link and the invite link are all built from it. | FR1 |
| **Runner** | Global cap on concurrently running sandboxes. Excess runs wait for a slot, up to a bounded time. | Memory NFR |
| **Sandbox** | Unchanged: `--network none`, read-only, 256 MB, caps dropped. | FR6, Isolation NFR |
| **New: `docker-compose.hub.yml`** | Standalone compose file for the hub: no `ports:`, no Keycloak, `api` on `hub`, `restart` and `mem_limit` everywhere, fixed project name. | FR1, FR4, FR7, FR8, Memory NFR |
| **New: `.env.hub.example`** | Variable names for the hub deployment, no values. | Secrets NFR |
| **New: `deploy/hub/RUNBOOK.md`** | Operator steps for first deploy, update, and the on-hub checks. | FR7, FR8, FR9 |
| **Hub repo (additive only)** | `caddy/apps/collab.caddy` and the OIDC client `collab` created with `bin/add-client`. The login theme goes into the hub's Keycloak (§7, D2). | FR1, FR3, NFR No behaviour change |
| **Test realm** (`backend/tests/keycloak/realm.json`) | `editor`/`admin` become client roles on the app's client. Adds a decoy client with the same role names, and a decoy realm role. Both places that create test users assign the app-client roles: the pytest fixture (`keycloak_fixtures.py`) and the browser tests' `e2e/global-setup.ts`. | FR3 tests |

Locally nothing changes in behaviour. The base path defaults to the root and the
local compose files keep working. Every new setting has a local default, apart
from the client-role switch, which the test realm adopts.

### Module layout and dependency direction (constitution 9)

```
docker-compose.hub.yml  ──uses──>  hub network `hub` (external), hub Keycloak (via api only)
backend/app/config.py            # + base_path, public_base_url, oidc_metadata_url, cookie_secure
backend/app/asgi.py              # mounts create_app() under base_path
backend/app/main.py              # cookie scope; next-redirect under base; SPA fallback on app-relative path
backend/app/auth/oidc.py         # metadata URL override; roles from resource_access[client_id]
backend/app/problems/markdown.py # render_description(source, base_path)
frontend/vite.config.ts          # base from APP_BASE_PATH
frontend/src/base.ts             # NEW: the one place that knows the base (import.meta.env.BASE_URL)
frontend/src/{main.tsx, api/client.ts, components/AccountControl.tsx, pages/SessionWindow.tsx}
runner/service.py                # slot semaphore
```

Direction: the app depends on the hub (network name, issuer, path). The hub
depends on the app only through `caddy/apps/collab.caddy` and the `collab`
client. Inside the app the existing direction is unchanged. `base.ts` is a leaf
that the frontend modules import. `config.py` stays the only reader of the
environment.

### Runtime topology on the hub

```
public/tailnet device ─> ts-hub (TLS, Funnel) ─> Caddy :80
    handle /collab/*  (ungated: strip-identity) ─> collab-api:8000      [network hub]

project collab (compose name `collab`):
  api     networks: hub (alias collab-api), app     ─> db, runner, http://auth:8080 (hub)
  db      networks: app only
  runner  networks: app only   ── /var/run/docker.sock ──> sandbox containers (--network none)
```

The `app` network is the project's internal bridge. `db` and `runner` are never
on `hub`, which meets contract item 1 and the Isolation NFR. Sandbox containers
have no network at all, so participant code can reach no hub app, no Keycloak
and no database.

### Requirement → mechanism

| Req | Mechanism |
|---|---|
| FR1 | `BASE_PATH=/collab`. The backend is mounted under it. The frontend is built with `base=/collab/` and every URL is derived from `BASE_URL`. `collab.caddy` routes `/collab/*` to `collab-api:8000` without stripping. HTTPS comes from the hub's Funnel certificate. |
| FR2 | `collab.caddy` imports no gate, so session pages and their API/WS are never redirected. The app's own sign-in is reached only from editor/admin routes, as today. |
| FR2a | Ungated path behind the hub's Funnel listener (004 §3.2). Nothing app-side beyond FR1, and no client software needed. |
| FR3 | Sign-in via client `collab` in realm `hub`. Roles come **only** from `resource_access.collab.roles` (the client ID is configurable). Realm roles and other clients' roles are ignored. The session cookie `collab_session` is `Path=/collab`, `Secure`, so the browser never sends it to another hub app. This app's client roles are not readable by other apps (004 §2.1). |
| FR4 | `docker-compose.hub.yml` defines `db`, `runner`, `api` and the build-only `sandbox`, and nothing else. `OIDC_ISSUER` points at the hub. |
| FR5 | WS URL = `wss://<host>/collab/api/sessions/<id>/ws`. Caddy and Tailscale proxy WebSocket upgrades. A single api worker keeps the in-memory session hub valid, as today. |
| FR6 | The runner and sandbox are unchanged, on the hub's Docker. The runner reaches the sandbox image built on the VM. |
| FR7 | Named volume `db-data` in fixed project `collab`. `restart: unless-stopped` on every service. Docker is enabled at boot (004 FR9). Redeploying is `up -d --build` and never uses `-v`. |
| FR8 | A deploy runs only `docker compose -p collab ...` against `docker-compose.hub.yml`. No hub file changes after first registration, so there's no `bin/reload`. During an api restart only `/collab/*` returns 502 (004 FR8). |
| FR9 | An empty `db-data` on first start means the existing migrate-and-seed in `asgi.py` loads the 20 starter problems and creates no sessions. No import path exists. |
| Memory NFR | `mem_limit`: db 160m, api 224m, runner 64m. Sandboxes: `SANDBOX_MAX_CONCURRENT=2` × 256m = 512m. Total 960m ≤ 1024m. Sandboxes are siblings on the host's Docker, not compose services, so the runner's cap is what bounds them. |
| Isolation NFR | Sandbox `--network none`. `runner` and `db` are off `hub`. Only `api` is on `hub`. |
| Secrets NFR | All credentials in `.env.hub` (gitignored). `.env.hub.example` holds names and placeholder text only. The `collab` client secret comes from `bin/add-client`'s one-time output. |

## 2. Data model

No schema change and no migration (FR9: fresh start).

- **Stored description sources keep `/api/images/<uuid>`** as written today, as
  app-relative references. The base path is applied only when rendering
  (§3.2), so stored content is independent of where the app is mounted and the
  spec 002 validation rules don't change.
- **Session cookie payload** is unchanged (`sub`, `name`, `roles`, `exp`).
  Only the source of `roles` changes.
- **Identity, in realm `hub` (hub repo, created by the operator):** client
  `collab`, confidential, redirect URI `${HUB_URL}/collab/api/auth/callback`,
  client roles `editor` and `admin`, client attribute `login_theme=collab`
  (§7, D2). Users get those roles under client `collab`.

## 3. Contracts

### 3.1 Configuration (backend `Settings`; all optional, so local behaviour stays the same)

| Env | Default | Meaning |
|---|---|---|
| `BASE_PATH` | `""` | Mount prefix, no trailing slash (`/collab`). Must match `^(/[a-z][a-z0-9-]*)?$`, otherwise `ConfigError`. |
| `PUBLIC_BASE_URL` | unset | `https://hub.<tailnet>.ts.net/collab`. When set, the OIDC `redirect_uri` is `PUBLIC_BASE_URL + "/api/auth/callback"`. When unset, it is derived from the request, as today. This avoids depending on forwarded-proto headers through Tailscale → Caddy. |
| `OIDC_METADATA_URL` | `${OIDC_ISSUER}/.well-known/openid-configuration` | The hub sets it to `http://auth:8080/auth/realms/hub/.well-known/openid-configuration`. With the hub's `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`, that document advertises the public issuer and authorization endpoint plus internal token and JWKS endpoints. |
| `SESSION_COOKIE_NAME` | `collab_session` | Not `session`, which would collide with other apps on the same host. |
| `COOKIE_SECURE` | `false` | `true` on the hub. |
| `SANDBOX_MAX_CONCURRENT` (runner) | `0` = unlimited | `2` on the hub. |
| `SANDBOX_SLOT_WAIT_SECONDS` (runner) | `10` | How long a run waits for a slot before the runner answers 503. That maps to the existing infra-error outcome (§7, D3). |

Frontend build arg: `APP_BASE_PATH`, default `/`. On the hub it is `/collab/`,
passed by `docker-compose.hub.yml` as a build arg to `backend/Dockerfile`,
which forwards it to `npm run build`. It comes from the same `.env.hub` value
as `BASE_PATH`, which is `APP_BASE_PATH` without its trailing slash.

### 3.2 Backend interfaces

```python
# config.py
@dataclass(frozen=True)
class Settings:
    ...
    base_path: str = ""
    public_base_url: str | None = None
    oidc_metadata_url: str | None = None
    session_cookie_name: str = "collab_session"
    cookie_secure: bool = False

# asgi.py — the ASGI object uvicorn serves
app = create_app(settings) if not settings.base_path else Starlette(routes=[
    Mount(settings.base_path, app=create_app(settings)),
    # "/collab" (no slash) -> 307 "/collab/"
])
# Anything outside base_path -> 404.

# main.py
SessionMiddleware(secret_key=..., max_age=..., session_cookie=settings.session_cookie_name,
                  path=settings.base_path or "/", https_only=settings.cookie_secure)

def app_path(request: Request) -> str:
    """Request path relative to the mount (scope root_path removed). Every in-app path test,
    such as the SPA fallback's `/api/` check, uses this, never `request.url.path`."""

GET  /api/auth/login?next=<app-relative path>&appearance=...
     next must start with "/" and not "//" or "/\\", otherwise it is replaced by "/".
GET  /api/auth/callback  -> 307 to base_path + next

# auth/oidc.py
def build_oauth(settings) -> OAuth          # server_metadata_url = settings.oidc_metadata_url or issuer-derived
def session_claims(claims, client_id, max_age_seconds) -> dict
    roles = sorted(claims.get("resource_access", {}).get(client_id, {}).get("roles", []))
    # realm_access is no longer read.

# problems/markdown.py
def render_description(source: str, base_path: str = "") -> str
    # Each allowed image src "/api/images/<uuid>" is emitted as f"{base_path}/api/images/<uuid>".
    # All other rules are unchanged. Callers pass settings.base_path.
```

The API surface is unchanged apart from the prefix. `POST /api/images` still
returns `url: "/api/images/<id>"`, which is the source form.

### 3.3 Frontend interfaces

```ts
// src/base.ts
export const BASE = import.meta.env.BASE_URL;            // "/" locally, "/collab/" on the hub
export const apiPath = (p: string) => `${BASE}api${p}`;  // p starts with "/"
export const routerBasename = BASE.replace(/\/$/, "") || "/";

// main.tsx      <BrowserRouter basename={routerBasename}>
// client.ts     fetch(apiPath(path)); loginUrl(next) = apiPath(`/auth/login?next=...`)
//               sessionWsUrl(): `${proto}//${loc.host}${apiPath(`/sessions/${id}/ws`)}?name=...`
// AccountControl  href = loginUrl(next); next stays router-relative (basename excluded)
// SessionWindow   inviteLink = new URL(`${BASE}s/${invite}`, window.location.origin)
```

`next` is always the router-relative path, and the server adds `base_path`.
This means the string a user sees is never prefixed twice.

### 3.4 Runner

```
POST /run  (unchanged body/response)
  acquire one of SANDBOX_MAX_CONCURRENT slots (threading.BoundedSemaphore), waiting ≤ SANDBOX_SLOT_WAIT_SECONDS
  timeout -> 503 {"error": "busy"}   # the api already maps runner 503 to the infra-error outcome
  slot held for the whole docker run, released in finally
```

### 3.5 `docker-compose.hub.yml` (shape)

```yaml
name: collab
services:
  db:      image postgres:16, volumes [db-data], networks [app], restart unless-stopped, mem_limit 160m
  sandbox: build sandbox, image ${SANDBOX_IMAGE}, profiles [build-only]
  runner:  build runner, docker.sock, env SANDBOX_MAX_CONCURRENT=2, networks [app], restart, mem_limit 64m
  api:     build {context ., dockerfile backend/Dockerfile, args {APP_BASE_PATH}},
           env: BASE_PATH, PUBLIC_BASE_URL, OIDC_ISSUER, OIDC_METADATA_URL, OIDC_CLIENT_ID=collab,
                OIDC_CLIENT_SECRET, COOKIE_SECURE=true, SESSION_COOKIE_KEY, DATABASE_URL, RUNNER_URL, ROLE_*
           networks: {app: {}, hub: {aliases: [collab-api]}}, restart, mem_limit 224m
           # no ports:
networks: {app: {}, hub: {external: true}}
volumes:  {db-data: {}}
```

The file must pass the hub's `check/static.sh docker-compose.hub.yml`.

### 3.6 Hub registration (`~/Desktop/ProjectHub/hub/caddy/apps/collab.caddy`)

```caddy
# collab — ungated — owner repo: ~/Desktop/ProjectHub/SoftwareEngineeringFun
handle /collab/* {
	import strip-identity
	reverse_proxy collab-api:8000
}
```

Plus `bin/add-client collab confidential /api/auth/callback`, then client roles
`editor` and `admin`, and `login_theme=collab` (runbook, via `kcadm.sh` in
`auth`).

### 3.7 Operator commands (`deploy/hub/RUNBOOK.md`)

```
first deploy:  cp .env.hub.example .env.hub; fill in
               docker compose -f docker-compose.hub.yml --env-file .env.hub build sandbox
               docker compose -f docker-compose.hub.yml --env-file .env.hub up -d --build --wait
               (hub repo) add collab.caddy, add-client, roles, theme; bin/reload
update:        git pull; same build sandbox + up -d --build --wait     # never `down -v`
checks:        deploy/hub/smoke.sh                                    # §4.4
```

## 4. Test strategy

Four levels. All use real Postgres, Keycloak, Docker and Caddy (constitution 4).
Nothing is mocked.

### 4.1 Unit / component (fast, part of `scripts/check.sh`)

- `config`: `BASE_PATH` validation, defaults, `COOKIE_SECURE` parsing.
- `markdown.render_description(source, "/collab")`: image src is prefixed, the
  root default is unchanged, disallowed sources are still rejected.
- `oidc.session_claims`: roles only from `resource_access[client_id]`. Realm
  roles and other clients' roles are ignored.
- Login `next` sanitising: `//evil`, `/\evil`, `https://…` all become `/`.
- Frontend (vitest): `apiPath`, `loginUrl`, `sessionWsUrl` and the invite link
  under `BASE="/collab/"` and `"/"`. The router basename.
- Runner: with the slot cap at 1, a second concurrent run waits, and it gets
  503 once the wait expires. This uses the real `docker run` of the sandbox
  image, as the existing runner tests do.

### 4.2 Backend integration (pytest, `docker-compose.test.yml`, real Keycloak)

The app is built via `asgi`'s mount with `BASE_PATH=/collab`, so tests run
through the same mount as production.

- Every existing route answers under `/collab/api/...`, and `/api/...` returns
  404. The SPA shell is served for `/collab/s/x`, `/collab` redirects to
  `/collab/`, and assets are served under `/collab/assets/`.
- The WebSocket at `/collab/api/sessions/<id>/ws` joins and syncs.
- The `Set-Cookie` header for the session has `Path=/collab`, name
  `collab_session`, and `Secure` when `COOKIE_SECURE=true`.
- Sign-in round trip against the test realm, now with client roles. The users:
  `collab:editor` → can manage problems. No role → 403.
  `other-app:editor` + `other-app:admin` + realm role `editor` → 403 on manage
  and on reactivate. `collab:admin` → can reactivate.
- The callback uses `PUBLIC_BASE_URL` when set, and `OIDC_METADATA_URL` is used
  for discovery.
- Existing 001/002/003 integration tests keep passing at the root base. This is
  the regression guard for NFR No behaviour change.

### 4.3 Hub end-to-end (local, real hub stack)

Brings up the hub repo's `compose.test.yaml` (the local stand-in for
Tailscale), registers `collab.caddy` and the `collab` client in it, and runs
`docker-compose.hub.yml` against it. Playwright then runs with
`baseURL=<stand-in>/collab/`. A new `e2e/hub.spec.ts` covers the hub-specific
criteria. The existing specs `session`, `collab`, `chat` and `problems` are
re-run against that baseURL through a `HUB=1` project in
`playwright.config.ts`.

### 4.4 On-hub smoke (`deploy/hub/smoke.sh` plus manual steps; results go into `notes.md` at validation)

Only criteria that need the real VM, the real certificate, a reboot or a public
device are tested here.

### Acceptance criterion → test

| AC | Test(s) |
|---|---|
| FR1 | 4.2 prefix routing/WS/assets. 4.1 frontend URL builders. 4.3 `hub.spec`: start page loads, and while joining a session every request and the WS URL recorded by Playwright starts with `/collab/`. 4.4 `curl` checks that the cert of `https://hub…/collab/` is valid. |
| FR2 | 4.3 `hub.spec`: a fresh browser context (no cookies) opens the invite and sees the join step, with no navigation to `/auth/` or `/oauth2/`. Hub `check/static.sh` confirms `collab.caddy` has no gate import. |
| FR2a | 4.4 manual: a phone on mobile data (off the tailnet and LAN) opens the invite, joins, and sees an edit made from a laptop. |
| FR3 | 4.2 role matrix (collab/other-app/realm). 4.3 `hub.spec`: signed in to collab as a `collab:admin`-only user, the hub's ungated stub app reports no roles, and collab's cookie is absent from requests to `/<stub>/`. |
| FR4 | 4.1 static test (pytest): parses `docker-compose.hub.yml` and checks that no service image or name matches Keycloak/identity providers, and that the service set is exactly {db, runner, api, sandbox}. 4.4 `docker compose -p collab ps --services`. |
| FR5 | 4.3 the existing `collab` + `chat` specs (two contexts: typing, chat, presence) under the hub baseURL. |
| FR6 | 4.3 the existing `session` run spec under the hub baseURL, plus a `hub.spec` case: a solution opening a socket to `collab-api:8000` and to `auth:8080` gets a failed connection in its test output. |
| FR7 | 4.3: create a session, code and chat, then `up -d --build --force-recreate`, then `down` (no `-v`) + `up`. All the data is still present. 4.4 manual: after a redeploy, then `sudo reboot` of VM 105, the same check. |
| FR8 | 4.3: a poller hits the hub stub app every 200 ms during `docker compose -p collab up -d --build --force-recreate`, and every response is 2xx. 4.4 the same against a real co-hosted app, or the hub's own `/auth/realms/hub` while no other app exists. |
| FR9 | 4.3 against a fresh project: the editor's problem list has exactly the 20 starter titles and the admin's stale list is empty. 4.4 `psql` count: `problems`=20, `sessions`=0, `chat_messages`=0. |
| Memory | 4.1 static test: sum of `mem_limit` + `SANDBOX_MAX_CONCURRENT`×256m ≤ 1024m. 4.1 runner cap test. 4.4: 5 participants in 3 sessions run at once while `smoke.sh` samples `docker stats` for project `collab` + sandbox-labelled containers every 500 ms. The maximum total must be ≤ 1 GB. |
| Isolation NFR | FR6's socket case. 4.1 static test: `db` and `runner` aren't on `hub`, and no service has `ports:`. |

## 5. Constitution compliance

| Rule | How |
|---|---|
| 1 Test-first | Every row in §4 is written from the AC before the change. `/sdd-tasks` will pair each task with its failing test. |
| 2 Green before done | `scripts/check.sh` stays the gate. The hub E2E (4.3) gets its own script, `scripts/check-hub.sh`, which tasks touching hub wiring must also pass. 4.4 is validation-time only. |
| 3 Traceable | §4 table maps every AC in spec.md, both NFRs with ACs, plus the Isolation NFR. |
| 4 Real dependencies | Real Postgres, Keycloak (test realm locally, the hub realm in 4.3), Docker sandbox, and Caddy via the hub's test stack. No mocks. |
| 5 Fixed stack | Unchanged: FastAPI, Postgres, React/Vite, docker compose. Caddy, Tailscale and Keycloak belong to the hub (spec 004), not to this app. |
| 6 Dependencies | **No new third-party dependency.** Starlette `Mount` and `SessionMiddleware(path=…)` and Vite `base` are already in the stack. The runner's semaphore is stdlib `threading`. |
| 7 No secrets | `.env.hub` is gitignored (the `.gitignore` entry is added in the same task as the example). The example uses placeholders like those in `.env.example`. The client secret is printed once by `bin/add-client` and pasted into `.env.hub`. gitleaks in `check.sh` covers the new files. |
| 8 Lint clean | All new Python/TS goes through `check.sh`. YAML and Caddy are checked by the hub's `check/static.sh` and `caddy validate`. |
| 9 Architecture | Layout and dependency direction in §1. |

## 6. Traceability to spec / scope guard

Every change above traces to an FR or NFR in the "for" column. Three things
are deliberately **not** done:

- automated deploy pipeline (out of scope)
- backups (out of scope)
- moving the run queue into the api (not needed: the runner cap alone bounds
  memory)

The runner cap and the cookie scoping aren't new features. They are the
minimum needed to meet the Memory NFR and FR3 on a shared host.

## 7. Decisions

Resolved with the human on 2026-10-25. All four take the proposal below.


- **D1 — path name `collab`.** It gives `${HUB_URL}/collab/s/<invite>`, the
  client ID `collab` and the alias `collab-api`. It matches the existing theme
  and cookie naming. Any `[a-z][a-z0-9-]*` name works, but only one may be
  chosen, because invite links embed it.
- **D2 — login theme needs a hub change. Resolved: amend 004 first.** The NFR "every
  rule of 003 holds" includes 003 FR-18, the app-styled sign-in page. On the
  hub, sign-in pages come from the hub's Keycloak, and 004's plan gives an app
  no way to ship a theme: an app's footprint there is one Caddy file plus a
  client. Proposal: an additive amendment to 004's plan. The hub mounts
  `keycloak/themes/` read-only, the app's theme is copied to
  `keycloak/themes/collab/`, and it is selected **per client**
  (`login_theme=collab`), so other apps keep the hub default. The alternative
  is to accept Keycloak's default page on the hub, which is a spec change to
  005 (an exception to "no behaviour change"). Either way, 004 or 005 changes
  first. **Chosen: amend 004's plan.** That amendment must land before the
  task that installs the theme on the hub.
- **D3 — behaviour when more than 2 runs are wanted at once.** A third
  simultaneous run waits up to 10 s for a slot, then shows the existing
  "couldn't run" infra error. 001's per-case limits are unchanged; only
  contention is new. The alternative is a cap of 3 with a 160m sandbox memory
  limit, but that changes 001's 256 MB run limit, so it isn't proposed.
- **D4 — gVisor stays off.** `--network none`, a read-only rootfs, caps
  dropped, nobody user and a pids limit already meet the Isolation NFR as
  specified, which is about reachability. Installing `runsc` on VM 105 would
  harden against kernel escapes, but that's a hub-host change the spec doesn't
  require. `SANDBOX_RUNTIME` stays available.
- **D5 — the runner holds the host Docker socket on a shared VM.** Same as
  locally. Participant code never touches it, but a compromised runner could
  affect other hub apps. This is accepted, because the alternatives (rootless
  Docker or a socket proxy) are new components the spec doesn't ask for.
