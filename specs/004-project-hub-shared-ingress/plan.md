# 004 — Plan: project hub shared entry point and identity

Starting point: BoarHQ's ingress design (`BoarHQ/compose.yaml`,
`deploy/caddy/Caddyfile`, `deploy/tailscale/cdm.json`, `docs/architecture.md`).
That design is a Tailscale sidecar that terminates TLS, Caddy as the only
container in the sidecar's network namespace doing all routing, Keycloak at
`/auth` on the same hostname, oauth2-proxy as forward auth through a Caddy
snippet, a separate Postgres for Keycloak, and no `ports:` anywhere. This plan
generalises that design from one application to many. Every departure is listed
in §6.

**Amendment 2026-10-29 (per-app login themes).** Requested by spec 005's plan,
§7 D2: a hosted app that signs users in may ship its own Keycloak login theme,
selected per client so every other app keeps the default. Additive only: no
existing file, check or behaviour changes for an app without a theme. Touches
§1 (layout), §2.1, §2.2, §3.2, §3.3, §3.4, §4.1, §4.2 and §7.

## 1. Architecture

### Where it lives

A new repository, `~/Desktop/ProjectHub/hub` (Decision: configuration home).
This spec and plan stay here as the durable record, and the hub repo's README
links back to them. The repo is deployed by cloning it on VM 105 (`projecthub`),
filling in `.env` and running `docker compose up -d`.

### Hub repo layout

```
compose.yaml                  # the hub stack (below); no `ports:`
compose.test.yaml             # test override: swaps the tailscale sidecar for a local stand-in
.env.example                  # variable names only, no values
tailscale/hub.json            # Serve/Funnel config; never edited per app
caddy/Caddyfile               # global options, snippets, both listeners; imports apps/*.caddy
caddy/apps/<app>.caddy        # ONE file per hosted application: its path, gated or ungated, upstream
keycloak/realm-hub.json       # realm "hub" + client "hub-gateway"; imported on first start
keycloak/themes/<app>/        # optional: ONE login theme per hosted app, named after its path (amendment)
bin/reload                    # validate, then gracefully reload Caddy
bin/add-client                # create one application's OIDC client in realm "hub" (kcadm.sh in the auth container)
bin/set-login-theme           # select keycloak/themes/<app> as client <app>'s login theme (amendment)
check/static.sh               # static checks (§4.1)
check/smoke.sh                # on-hub checks against the real hub (§4.3)
tests/                        # pytest integration suite (§4.2)
tests/stubs/                  # stub applications used by the suite (compose projects)
scripts/check.sh              # everything a task must pass (constitution 2, 8)
README.md                     # runbook: first setup, adding/removing an app, admin access
```

### Services (`compose.yaml`, project name `hub`)

| Service | Image (pinned) | Network | Role |
|---|---|---|---|
| `ts-hub` | `tailscale/tailscale:v1.x` (pinned tag) | own namespace | Node `hub` → `hub.<tailnet>.ts.net`. Terminates TLS with the real `*.ts.net` certificate (FR2). Funnel on `:443` (public), Serve only on `:8443` (tailnet only). |
| `proxy` | `caddy:2-alpine` | `network_mode: service:ts-hub`, so it can't join `hub` itself. See note. | The one entry point (FR1). `:80` public listener, `:81` admin listener. |
| `auth` | `quay.io/keycloak/keycloak:26.4` | `hub`, `auth-db` | The one identity provider (FR4). Realm `hub`. |
| `authproxy` | `quay.io/oauth2-proxy/oauth2-proxy:v7.7.1` | `hub` | Forward auth for gated apps (FR5). |
| `db-auth` | `postgres:17-alpine` | `auth-db` only | Keycloak's own database, separate from any application's (FR10). |

**Network note.** Caddy shares `ts-hub`'s namespace, so `ts-hub` is the
service attached to the `hub` network. Caddy then resolves `auth`, `authproxy`
and the application aliases on that network. This is the same mechanism
BoarHQ relies on.

**Networks.**
- `hub` is a bridge created by this stack with the fixed name `hub`
  (`name: hub`). Applications attach to it as `external: true`. It is the only
  path between the entry point and any application.
- `auth-db` is internal to the hub stack. Only `auth` and `db-auth` are on it,
  so no application can reach Keycloak's database.

**Traffic paths.**

```
public device ──Funnel──┐
tailnet device ─────────┴─> ts-hub :443 ─> 127.0.0.1:80  (Caddy public listener)
tailnet device ───────────> ts-hub :8443 ─> 127.0.0.1:81 (Caddy admin listener)   # not funnelled

Caddy :80
  /auth/admin*, /auth/realms/master/*  -> 404              # admin is never public
  /auth/*                              -> auth:8080        # never gated
  /oauth2/*                            -> authproxy:4180   # never gated
  /<app>/*  (one per caddy/apps/*.caddy)
     gated   -> forward_auth authproxy -> <app>-<svc>:<port>
     ungated -> strip identity headers -> <app>-<svc>:<port>
  anything else                        -> 404

Caddy :81
  /auth/*                              -> auth:8080        # admin console and master realm
  anything else                        -> 404
```

**Dependency direction.** Applications depend on the hub: the network name,
the path they are given, the issuer URL and the identity-header contract. The
hub depends on no application except through its single `caddy/apps/<app>.caddy`
file (and its OIDC client and login theme, if it has them). Nothing in the hub repo imports or
builds application code. This is constitution 9.

### Requirement → mechanism

| FR | Mechanism |
|---|---|
| FR1 | One Caddy site, one `handle /<app>/*` block per app, each with a unique prefix. Upstreams use unique per-app aliases on `hub`, so two apps' `web` services can't collide. |
| FR2 | Tailscale issues a Let's Encrypt certificate for `hub.<tailnet>.ts.net`, and Funnel serves it publicly. No private CA. |
| FR3 | No service in any compose file publishes `ports:`. The only ingress is the WireGuard/Funnel path into `ts-hub`. Databases are never on `hub`. |
| FR4 | One `auth` service, one realm `hub`. Gated apps reach it via oauth2-proxy (client `hub-gateway`). Ungated apps that sign users in do OIDC themselves against the same realm, each with its own client. |
| FR5 | `import gated` (forward auth) on the app's block. Caddy answers an unauthenticated request with a redirect before it proxies anything. |
| FR6 | No gate import. Identity headers are still stripped so the app can't be fed a forged identity. |
| FR7 | Adding an app means a new snippet file, an optional new client and `bin/reload`. Caddy's reload is atomic and graceful, and a config that fails validation leaves the running one untouched. oauth2-proxy sessions live in a cookie, and Keycloak SSO sessions live in `db-auth`. A reload touches neither. |
| FR8 | Caddy resolves upstreams per request. A stopped or missing app gives a 502 for that prefix only, and other blocks are unaffected. |
| FR9 | `restart: unless-stopped` on every hub service (and required of every app, §3.3). Docker is enabled at boot on the VM. `ts-hub` state is on a volume with a non-ephemeral auth key, so the node and certificate survive reboots. |
| FR10 | Identity is in `db-auth` (its own volume, its own network). Each app keeps its data in its own compose project's volumes. Resetting an app's project (`down -v`) can't touch either. |
| Memory NFR | `mem_limit` on every hub service (§2.3). The sum is ≤ 1536 MB, which leaves ≥ 2560 MB of 4096 MB. |

## 2. Data model

### 2.1 Identity (Keycloak realm `hub`)

The realm is defined in `keycloak/realm-hub.json` and imported with
`--import-realm` on first start. An existing realm is never overwritten, so a
restart can't reset identities (FR10).

- **Users**: one set for all apps (Decision: accounts). Self-registration is
  off (the Keycloak default). Users are created by the operator.
- **Clients**:
  - `hub-gateway`: confidential, used by oauth2-proxy. Redirect URI
    `${HUB_URL}/oauth2/callback`. Its secret comes from the environment through
    Keycloak's `${ENV}` substitution in import files. An audience mapper
    (`oidc-audience-mapper`, access token only) adds `hub-gateway` to its
    tokens' `aud`; oauth2-proxy rejects tokens without it, and Keycloak's
    default audience is only `account`.
  - One client per application that runs its own sign-in (ungated apps, or a
    gated app's API that verifies tokens). The client ID is the app's path name.
    It's created with `bin/add-client`, never by editing the realm file, because
    import only runs once.
  - **Login theme (amendment).** An app's client may carry the attribute
    `login_theme=<app>`, set with `bin/set-login-theme`. Keycloak then renders
    that client's sign-in pages with `keycloak/themes/<app>/`. The realm's own
    `loginTheme` stays unset, so `hub-gateway` and every client without the
    attribute get Keycloak's default theme.
- **Roles**: client roles on each application's own client (Decision: roles
  kept per application). An app reads them from its tokens. The gateway passes
  realm groups and the token through, and doesn't authorise per app (the spec
  asks for sign-in only, FR5).
- **Brute-force detection**: on in the realm file. Sign-in is publicly reachable
  (Decision: reach). See §7.

### 2.2 Application registration (`caddy/apps/<app>.caddy`)

An app's whole footprint in the hub repo is one file, named after its path:

```caddy
# <app> — gated|ungated — owner repo: <path or URL>
handle /<app>/* {
	import gated            # or `import gated-api` for an XHR-only prefix; omit entirely for ungated
	import strip-identity   # ungated only; gated snippets already include it
	reverse_proxy <app>-<svc>:<port>
}
```

Rules, enforced by `check/static.sh`:
- The filename `<app>` matches the `handle` prefix.
- `<app>` matches `[a-z][a-z0-9-]*`.
- `<app>` isn't a reserved prefix (`auth`, `oauth2`).
- No two files claim the same prefix.
- Upstream hosts start with `<app>-`.
- **Amendment:** every directory `keycloak/themes/<name>/` has a matching
  `caddy/apps/<name>.caddy` (a theme belongs to exactly one hosted app), and
  contains `login/theme.properties`. An app with no theme has no directory.

The theme is a copy of the app's own theme directory, committed in the hub
repo (the hub builds nothing from app repos, §1 dependency direction). Keeping
the copy identical to the app's source is the app's check, not the hub's.

The hub doesn't strip the prefix: the app is served at `/<app>/` and must
generate its own links under that prefix (Decision: addressing). Stripping
would break apps that emit absolute links, and would differ from how BoarHQ
expects to be mounted.

### 2.3 Memory budget (compose `mem_limit`)

| Service | Limit | Notes |
|---|---|---|
| `auth` | 768m | `JAVA_OPTS_KC_HEAP="-Xms256m -Xmx512m"` |
| `db-auth` | 256m | |
| `ts-hub` | 128m | |
| `proxy` | 64m | |
| `authproxy` | 64m | |
| **Total** | **1280m** | Leaves 2816 MB. A static check fails above 1536m. |

## 3. Contracts

### 3.1 Environment (`.env.example`, names only)

```
TS_AUTHKEY=                    # reusable=no, ephemeral=OFF, tagged tag:hub
TS_TAILNET=                    # e.g. tail1234 → hub.tail1234.ts.net
HUB_URL=https://hub.${TS_TAILNET}.ts.net
HUB_ADMIN_URL=https://hub.${TS_TAILNET}.ts.net:8443
POSTGRES_AUTH_PASSWORD=
KC_ADMIN_USER=
KC_ADMIN_PASSWORD=
OAUTH2_PROXY_CLIENT_SECRET=
OAUTH2_PROXY_COOKIE_SECRET=    # 32 random bytes, base64
OAUTH2_PROXY_COOKIE_SECURE=true
```

Every hub-internal URL comes from `HUB_URL` and `HUB_ADMIN_URL`. The test
override only changes these two (plus cookie-secure), so tests run the same
wiring as production.

### 3.2 Hub component configuration

**`tailscale/hub.json`**:

```json
{
  "TCP": { "443": { "HTTPS": true }, "8443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443":  { "Handlers": { "/": { "Proxy": "http://127.0.0.1:80" } } },
    "${TS_CERT_DOMAIN}:8443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:81" } } }
  },
  "AllowFunnel": { "${TS_CERT_DOMAIN}:443": true }
}
```

Prerequisites, from the runbook: MagicDNS and HTTPS certificates are enabled,
and the tailnet policy grants the `funnel` node attribute to `tag:hub`.

**`auth` (Keycloak) environment**:

```
KC_HOSTNAME=${HUB_URL}/auth
KC_HOSTNAME_ADMIN=${HUB_ADMIN_URL}/auth      # admin console lives only on the tailnet-only listener
KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true         # apps on `hub` may call http://auth:8080/auth for tokens/JWKS
KC_HTTP_RELATIVE_PATH=/auth
KC_HTTP_ENABLED=true
KC_PROXY_HEADERS=xforwarded
KC_DB=postgres  KC_DB_URL=jdbc:postgresql://db-auth:5432/keycloak  KC_DB_USERNAME=keycloak  KC_DB_PASSWORD=${POSTGRES_AUTH_PASSWORD}
KC_HEALTH_ENABLED=true
KC_BOOTSTRAP_ADMIN_USERNAME / _PASSWORD from env
command: start --import-realm
volumes:
  ./keycloak:/opt/keycloak/data/import:ro            # unchanged; import reads only top-level *.json
  ./keycloak/themes:/opt/keycloak/themes:ro          # amendment: per-app login themes
```

Keycloak's own themes ship inside its jars, so mounting over
`/opt/keycloak/themes` hides nothing. Theme caching stays on (production
default). Keycloak looks a theme up by name when it's first used, so a theme
directory added while `auth` runs is found without a restart (FR7; proven by a
test, §4.2). **Changing** an already-used theme needs `docker compose restart
auth` (§7).

**`authproxy` (oauth2-proxy) environment** (`OAUTH2_PROXY_*`; env rather than
flags so the test override can change values):

```
PROVIDER=keycloak-oidc
OIDC_ISSUER_URL=${HUB_URL}/auth/realms/hub
SKIP_OIDC_DISCOVERY=true                                         # the public URL isn't resolvable from inside the bridge
LOGIN_URL=${HUB_URL}/auth/realms/hub/protocol/openid-connect/auth   # browser-facing
REDEEM_URL=http://auth:8080/auth/realms/hub/protocol/openid-connect/token
OIDC_JWKS_URL=http://auth:8080/auth/realms/hub/protocol/openid-connect/certs
CLIENT_ID=hub-gateway  CLIENT_SECRET  COOKIE_SECRET  COOKIE_SECURE
COOKIE_NAME=_hub_auth  COOKIE_PATH=/                             # one session for every gated app (sign in once)
REDIRECT_URL=${HUB_URL}/oauth2/callback
WHITELIST_DOMAINS=<host of HUB_URL>
REVERSE_PROXY=true  SET_XAUTHREQUEST=true  SET_AUTHORIZATION_HEADER=true
UPSTREAMS=static://202  HTTP_ADDRESS=0.0.0.0:4180  EMAIL_DOMAINS=*
```

**`caddy/Caddyfile`**:
- Global options: `auto_https off`, `admin localhost:2019` (for `bin/reload`;
  reachable only inside the sidecar namespace), and
  `servers { trusted_proxies static 127.0.0.1/32 ::1 }`.
- Snippets `strip-identity`, `gated` and `gated-api`, as in BoarHQ.
  `gated` redirects to `/oauth2/start?rd=…` on 401. `gated-api` passes the 401
  through.
- `:80` site:
  - Admin/master routes → 404, then `/auth/*` and `/oauth2/*`.
  - `import /etc/caddy/apps/*.caddy`.
  - `handle { respond 404 }`.
- `:81` site: `/auth/*` → `auth:8080`, everything else 404.

### 3.3 Hosted-application contract

An app must meet all of these to be hosted (deploying any particular app is
outside this spec):

1. Its compose file attaches the externally reachable service(s) to the
   external network `hub`, with aliases `<app>-<svc>`. Databases and internal
   services are never attached to `hub`.
2. It declares no `ports:`.
3. It sets `restart: unless-stopped` on every service.
4. It serves everything under `/<app>/`.
5. If gated, it does no sign-in. The user arrives in `X-Auth-Request-User` /
   `-Email` / `-Groups` / `-Preferred-Username`, and the access token in
   `Authorization: Bearer`. Those headers are trustworthy only because the hub
   strips client copies, so an app that can also be reached another way must
   verify the token.
6. If it signs users in itself (ungated): it uses its own client in realm `hub`,
   issuer `${HUB_URL}/auth/realms/hub` for token validation and browser
   redirects, and `http://auth:8080/auth/realms/hub/...` for back-channel calls.
7. It owns its data in its own compose project's volumes.
8. **Amendment, optional:** if it signs users in itself and wants its own
   sign-in look, it provides a Keycloak login theme directory (a `login/`
   theme with `theme.properties`) built for the hub's pinned Keycloak version.
   The operator copies it to `keycloak/themes/<app>/`. It must not set or rely
   on the realm-wide theme.

### 3.4 Operator commands

```
bin/reload                                    # caddy validate && caddy reload (inside proxy); non-zero, running config kept, on invalid config
bin/add-client <app> <confidential|public> <redirect-path>
                                              # creates client <app> in realm hub with redirect ${HUB_URL}/<app><redirect-path>;
                                              # prints the generated secret once (never written to the repo); idempotent: refuses if it exists
bin/set-login-theme <app>                     # amendment: sets attribute login_theme=<app> on client <app> in realm hub;
                                              # refuses (non-zero, nothing changed) if keycloak/themes/<app>/ is missing
                                              # or client <app> doesn't exist; re-running is a no-op
check/static.sh [compose-file]                # §4.1; non-zero on any finding
check/smoke.sh                                # §4.3; run on/against the real hub
```

**Adding an app (FR7)**:
1. Bring up the app's own project, joined to `hub`.
2. Add `caddy/apps/<app>.caddy`.
3. Run `bin/add-client` if the app needs a client.
4. Optionally (amendment): copy its theme to `keycloak/themes/<app>/` and run
   `bin/set-login-theme <app>`.
5. `bin/reload`.

No existing file changes. **Removing an app**: delete its snippet, run
`bin/reload`, then optionally delete its client and its theme directory.

## 4. Test strategy

Tests live in the hub repo. They're Python 3.12 with pytest and httpx, run by
`scripts/check.sh`.

### 4.1 Static checks (`check/static.sh`, also wrapped as pytest tests)

- No `ports:` in `compose.yaml` (FR3). The optional argument lets the check be
  seen failing against a copy with a port added, as in BoarHQ.
- Every hub service has `restart: unless-stopped` (FR9).
- Sum of `mem_limit` ≤ 1536m (memory NFR).
- The app snippet rules from §2.2 hold (FR1), including the theme-directory
  rules (amendment).
- Only `auth` and `db-auth` are on `auth-db`, and `db-auth` isn't on `hub`
  (FR3, FR10).
- `caddy validate` and `caddy fmt --diff` (run in the pinned Caddy image) pass.
- No secret values in tracked files: `.env.example` has names only, and no
  `KEY=`/`SECRET=`/`PASSWORD=` with a value in a tracked file (constitution 7).

### 4.2 Integration suite (pytest, real containers)

`compose.test.yaml` replaces only `ts-hub` (see §5, constitution 4). The
stand-in is a minimal container that holds the namespace and binds
`127.0.0.1:18080→80` and `127.0.0.1:18081→81` (`ports` loopback-only, and only in
the test override). It sets `HUB_URL=http://localhost:18080`,
`HUB_ADMIN_URL=http://localhost:18081` and `OAUTH2_PROXY_COOKIE_SECURE=false`.
A session fixture generates random secrets into a temp env file (none
committed), brings the stack up, waits for Keycloak health, and creates a test
user with kcadm.

Stub applications in `tests/stubs/` are separate compose projects. They're real
containers, not mocks:
- `stub-a` (gated) and `stub-b` (ungated): `traefik/whoami`. Each one answers
  with its own hostname and the request headers it received.
- `stub-c`: added during the run, to test FR7.
- `data-a` and `data-b`: `postgres:17-alpine`, each with one seeded row.

Browser sign-in is driven with an httpx client following Keycloak's login form.
The form is parsed with stdlib `html.parser`.

| Criterion | Test (integration unless stated) |
|---|---|
| FR1 | GET `/stub-a/` (signed in) and `/stub-b/`: each body names its own container. A path outside any prefix gives 404. |
| FR2 | On-hub only (§4.3): TLS and default trust can't be reproduced without the real Tailscale certificate. |
| FR3 | Static `ports:` check. Integration: `db-auth` and `auth` aren't reachable from the test host except via `:18080`. Plus on-hub port scan (§4.3). |
| FR4, FR7 (amendment: login themes) | A test theme `tests/stubs/themes/stub-b/` (marker text in its login template) is copied into a temp copy of `keycloak/themes/` mounted by the test override, **after** `auth` is up. `bin/set-login-theme stub-b` succeeds without restarting `auth`. Starting sign-in for client `stub-b` shows the marker; sign-in via `hub-gateway` (`/stub-a/`) shows Keycloak's default page and no marker, and `stub-a` users stay signed in throughout. `bin/set-login-theme` refuses for an app with no theme directory and for an unknown client. |
| FR4 | Exactly one Keycloak container in `docker ps`. `stub-a`'s redirect chain lands on `/auth/realms/hub`. A second app's client (created with `bin/add-client`) shares the same issuer, checked via discovery and a token issued to it. On-hub check (§4.3) with two real apps. |
| FR5 | No cookie: `/stub-a/x` gives 302 to `/oauth2/start`, and `stub-a`'s request log is empty. After sign-in it gives 200. A forged `X-Auth-Request-User` is replaced by the real one. |
| FR6 | No cookie: `/stub-b/x` gives 200 from `stub-b`, with no redirect. A forged `X-Auth-Request-User` doesn't reach `stub-b`. |
| FR7 | Sign in and record the responses from `/stub-a/`. Bring up `stub-c`, add its snippet, run `bin/reload`. `/stub-a/` answers the same with the same cookie (no re-auth), and `/stub-c/` answers. An invalid snippet makes `bin/reload` fail and leaves `/stub-a/` unaffected. |
| FR8 | `docker stop stub-b`: `/stub-b/` gives 502, and `/stub-a/` (signed in) gives 200. |
| FR9 | Static restart-policy check. On-hub reboot test (§4.3). |
| FR10 | `docker compose -p data-a down -v && up`. The test user can still complete sign-in, and `data-b`'s seeded row is still present. |
| Memory NFR | Static check, plus on-hub `docker stats` (§4.3). |

### 4.3 On-hub smoke checks (`check/smoke.sh`, run by the operator, results logged in `notes.md` at validation)

- **FR2**: from a device off the tailnet, `curl -sf https://hub.<tailnet>.ts.net/auth/realms/hub`
  (no `-k`) succeeds. Repeat from a tailnet device.
- **FR3**: from another LAN machine, a full TCP scan of 192.168.178.106 shows
  only sshd. `docker ps --format '{{.Ports}}'` on the hub shows no host
  bindings in any project.
- **FR4**: exactly one Keycloak container is running. Two real apps send their
  users to `/auth/realms/hub`.
- **FR9**: `sudo reboot`, then poll every hosted app's address until it answers
  (time limit 5 min) with no operator action. `systemctl is-enabled docker`.
- **Memory**: the `docker stats --no-stream` total for project `hub` is
  ≤ 1536 MB.

## 5. Constitution compliance

| # | Rule | How the plan complies |
|---|---|---|
| 1 | Test-first | Each task's static check or pytest case (§4) is written and shown failing first. For config tasks the failing test is the integration case against the stack without that config. |
| 2 | Green before done | `scripts/check.sh` runs static checks, lint and the full integration suite. |
| 3 | Traceable tests | §4.2 maps every FR1–FR10 criterion. FR2 and parts of FR3/FR4/FR9 are on-hub only, by necessity, and are logged at `/sdd-validate`. |
| 4 | Real dependencies | Everything the hub runs (Caddy, Keycloak, oauth2-proxy, Postgres) runs for real in tests. **Exception, justified:** the Tailscale sidecar is swapped for a local namespace stand-in, because Tailscale is a third-party network service the project doesn't control. It needs a real tailnet, auth key and public DNS, so it can't run in a local suite. What it provides (TLS, Funnel) is covered by on-hub checks instead. |
| 5 | Fixed stack | **Departure, stated:** the hub contains no application code, so FastAPI, React and the project Postgres don't apply. Deployment is docker compose, and the tests are Python 3.12, as the stack requires. Keycloak's Postgres is PostgreSQL. |
| 6 | Dependency justification | See below. |
| 7 | No secrets | All credentials come from `.env` (gitignored). `.env.example` has names only. Test secrets are generated at runtime. `bin/add-client` prints secrets instead of writing them. There's a static check for it. |
| 8 | Lint and format | `ruff check` and `ruff format --check` on `tests/`. `caddy fmt --diff`, plus `shellcheck` on `bin/` and `check/`. **Not applicable:** `biome ci` and `tsc --noEmit`, because there's no TypeScript. |
| 9 | Layout and dependency direction | Stated in §1. |

**Dependencies (constitution 6)**:
- `tailscale/tailscale`: TLS with a publicly trusted certificate, plus public
  reach without port forwarding (FR2, Decision: reach). The standard library
  can't provide either.
- `caddy`: the single router and forward-auth point (FR1, FR5–FR8). It's
  BoarHQ's decided choice.
- `keycloak`: the shared identity provider (FR4). BoarHQ's decided choice, and
  already used by this project.
- `oauth2-proxy`: sign-in at the entry point, so gated apps carry no auth code
  (FR5). BoarHQ's decided choice.
- `postgres:17-alpine`: Keycloak's persistent store (FR10).
- `traefik/whoami` (test only): a tiny real HTTP app that reports what reached
  it. That's the only way to assert that a request did or didn't arrive
  (FR1, FR5, FR6).
- `pytest` and `httpx` (test only): HTTP with cookie jars and controllable
  redirects. `urllib` can't drive a multi-step login without hand-rolling a
  cookie and redirect engine.
- `shellcheck` (dev tool): the only lint for the shell scripts in `bin/` and
  `check/`.

## 6. Departures from BoarHQ's ingress design (consistency NFR)

1. **Funnel enabled on `:443`.** BoarHQ is tailnet-only. Here it's the user's
   decision on reach (2026-10-25). BoarHQ's SEC1 names Funnel as an exposure,
   and this hub accepts that exposure on purpose.
2. **A second, tailnet-only listener (`:8443` → Caddy `:81`) for Keycloak's
   admin console.** The public listener 404s `/auth/admin*` and
   `/auth/realms/master/*`. This exists because sign-in is now public and the
   admin console shouldn't be. It costs no extra container.
3. **Caddy `admin localhost:2019` instead of `admin off`.** This enables a
   graceful `caddy reload` when an app is added (FR7). It's bound to loopback
   inside the sidecar namespace, and neither Serve nor Funnel forwards that port.
4. **oauth2-proxy reaches Keycloak over the bridge (`SKIP_OIDC_DISCOVERY` with
   internal redeem/JWKS URLs).** BoarHQ points oauth2-proxy at the public
   issuer URL, which from inside the bridge would resolve to a tailnet or Funnel
   address it can't reach directly.
5. **Many apps, one file each (`caddy/apps/*.caddy`), on a shared external
   network `hub` with `<app>-` aliases.** BoarHQ hosts one app in one compose
   project. The hub has to reach other projects' containers without name
   collisions.
6. **Hostname `hub`, realm `hub`, tag `tag:hub`.** BoarHQ uses `cdm` for its own
   single-app stack.
7. **`start --import-realm` instead of `start --optimized`.** `--optimized`
   needs a pre-built Keycloak image, which BoarHQ doesn't build either.
   `start` builds at boot, which costs startup seconds and no RAM.
8. **Pinned Tailscale tag instead of `latest`.** This makes reboots
   reproducible (FR9).

## 7. Decisions for the reviewer

These are flagged because the spec implies them rather than stating them:

- **The admin console isn't publicly reachable** (§6.2). Spec 004's former open
  question tied reach to "whether the identity provider's sign-in and
  administration pages are publicly reachable". The plan reads the answer
  "public" as applying to sign-in only.
- **Brute-force detection is on in realm `hub`.** That's a consequence of
  public sign-in. Remove it if unwanted.
- **Unknown paths, including `/`, answer 404.** The spec asks for no landing
  page.
- **Per-app login themes (amendment, 2026-10-29).** Asked for by spec 005 §7
  D2 so the hosted coding app keeps its app-styled sign-in page. Selected per
  client, never per realm, so apps can't restyle each other's sign-in. Theme
  caching stays on: adding a theme needs no restart, but changing one that's
  already been served needs `docker compose restart auth`, which briefly stops
  sign-in for every app (existing sessions survive, they're in `db-auth`). The
  alternative, `KC_SPI_THEME__CACHE_THEMES=false`, avoids that restart at the
  cost of re-reading theme files on every sign-in page. A theme is app-supplied
  HTML/CSS/JS served on the shared sign-in origin; the operator reviews it
  before copying it in, the same trust as adding the app's snippet.
