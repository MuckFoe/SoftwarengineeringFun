# 009 — Plan: self-registration on the hub's shared sign-in

Spec: [spec.md](spec.md) (approved, no open questions).

Amends the hub built by [004's plan](../004-project-hub-shared-ingress/plan.md).
Everything here lands in the hub repository (`~/Desktop/ProjectHub/hub`) except
one optional check of this app's own login theme (§1.6). 004's plan §2.1 line
"Self-registration is off (the Keycloak default)" is superseded by this plan.
Nothing else in 004 changes behaviour for accounts that exist today (NFR-3).

Departures from 004 are listed in §6.

## 1. Architecture

### 1.1 What is touched

```
hub repo
  caddy/Dockerfile               # NEW: stock Caddy + rate-limit plugin (NFR-1)
  caddy/Caddyfile                # CHANGED: `registration-limit` snippet in both listeners;
                                 #          `gated` / `gated-api` snippets take the app name (FR-12)
  caddy/apps/<app>.caddy         # CHANGED for gated apps only: `import gated <app>` (FR-12)
  compose.yaml                   # CHANGED: proxy built from caddy/Dockerfile; NEW service `accounts`
  .env.example                   # CHANGED: + ACCOUNTS_CLIENT_SECRET
  bin/configure-registration     # NEW: idempotent kcadm script applying every realm setting below
  bin/accounts                   # NEW: thin wrapper: docker compose exec accounts python -m accounts "$@"
  accounts/accounts/             # NEW: Python 3.12 stdlib package, the only code this feature adds
    __main__.py                  #   CLI: list | approve | reject | expire | grant | revoke | init-app | run-expiry
    keycloak.py                  #   minimal admin-REST client (urllib, client-credentials token)
    states.py                    #   pure: pending/approved rules, expiry cut-off
  check/static.sh                # CHANGED: gated-snippet rule (§2.4), memory sum incl. `accounts`
  check/smoke.sh                 # CHANGED: on-hub checks of §4.3
  tests/                         # CHANGED: pytest cases of §4.2; stubs `stub-g` (2nd gated app)
  README.md                      # CHANGED: runbook steps (§3.6)

this repo (only if §1.6's check fails)
  the app's login theme          # renders the Register link and the admin note
```

**Dependency direction** is 004's: apps depend on the hub, the hub on no app.
Inside the hub, `accounts` depends only on Keycloak's admin REST API;
`bin/configure-registration` and `bin/accounts` depend on the running stack.
Nothing depends on `accounts` (constitution 9).

### 1.2 Identity-provider configuration (FR-1, FR-2, FR-3, FR-8, FR-9, FR-10)

All of it lives in realm `hub` in `db-auth`, so it survives reboots like every
other account (NFR-4). It is applied by `bin/configure-registration`, never by
editing `keycloak/realm-hub.json`: import only runs on an empty database, and
the live realm on VM 105 already exists (004 §2.1). The script is idempotent,
so it is also the step a fresh install runs after first start.

- **Registration on, no mail.** `registrationAllowed=true`,
  `registrationEmailAsUsername=false`, `verifyEmail=false`,
  `resetPasswordAllowed=false`, `duplicateEmailsAllowed=false`, and no
  `smtpServer` (the script fails if one is set). With no SMTP, Keycloak cannot
  send mail at all (FR-9). Keycloak's default theme then shows the Register link
  on every sign-in page (FR-1). Duplicate usernames and emails are refused by
  Keycloak's own registration form, with the error on the field (FR-3).
- **Password rules** (FR-3): `passwordPolicy = "length(12) and maxLength(128) and
  notUsername and notEmail"`. Keycloak checks a policy only when a password is
  set, never at sign-in, so existing passwords keep working (NFR-3). Hashing
  stays Keycloak's default (`pbkdf2-sha512`) (NFR-2).
- **User profile.** Username, email and password are what the form asks for
  (FR-2). `firstName` / `lastName` lose their `required` rule, so they show as
  optional and never block a registration.
- **No app roles** (FR-8). Self-registered users get only the realm default
  role composite `default-roles-hub`. The script asserts it contains no client
  role of any app client and fails otherwise. App roles stay client roles on
  each app's own client, granted as today (004 §2.1).
- **Forgot-password note** (FR-10). Realm localization override (`en`) of the
  message key `noAccount`, which the default login template prints in front of
  the Register link: `Forgot your password? Ask a hub admin to set a new one.
  New here?`. A hub admin sets a new password in the admin console (tailnet
  listener) or with `kcadm set-password`, as today.

### 1.3 Pending and approval (FR-2, FR-4, FR-5, FR-6, FR-7, NFR-2)

**Pending is group membership.** Group `pending` carries realm role
`hub-pending` and is the realm's only **default group**, so Keycloak puts every
newly created user in it, whatever created it. Accounts that exist when the
script first runs are in no such group, so they stay approved (NFR-3).

| State | Representation |
|---|---|
| pending | user exists, member of `pending` |
| approved | user exists, not a member of `pending` |
| rejected or expired | user deleted; username and email are free again (FR-7, FR-13) |

**Blocking at the identity provider, not in apps.** Three authentication flows
replace Keycloak's built-ins as the realm's bindings (copies, so the built-ins
stay untouched for rollback):

- `hub-browser` (copy of `browser`). Inside its `forms` sub-flow, after
  *Username Password Form*, a CONDITIONAL sub-flow `hub-pending-gate`:
  *Condition – user role* (`hub-pending`) then *Deny access* with message
  `Your account is awaiting approval by a hub admin.` (FR-4). It runs after the
  password check, so a wrong password still gets the normal error and still
  counts for brute-force detection.
- `hub-direct-grant` (copy of `direct grant`). The same conditional sub-flow
  after password validation, so no client with password grant can get a token
  for a pending user (NFR-2).
- `hub-registration` (copy of `registration`). After the *registration form*
  step, an unconditional REQUIRED *Deny access* with message `Thanks — your
  account has been created and is awaiting approval by a hub admin.` Keycloak
  creates the user when the form step succeeds, then stops before any session
  or redirect to the app, so the visitor sees the message and no app session
  exists (FR-2, NFR-2). Proving that the user survives the deny is the first
  test written (§4.2, FR-2). If it fails, the plan goes back to the human.

Every app's sign-in goes through `hub-browser`: gated apps through `hub-gateway`,
ungated apps through their own clients. So FR-4 holds for every app on the hub,
and no app changes (NFR-3).

**Admin operations** are `bin/accounts` (§3.4), run by a hub admin on the hub.
The admin console on the tailnet listener shows the same data under Groups →
`pending` → Members.
- `list` shows members of `pending` with username, email and `createdTimestamp`
  as the registration time (FR-5).
- `approve <user>` removes the user from `pending`. From then on `hub-browser`
  lets them through to every ungated app. Gated apps still check access (§1.4)
  (FR-6).
- `reject <user>` deletes the user. It refuses if the user isn't pending, so
  reject can never delete an approved account (FR-7).

### 1.4 Ungated vs gated apps (FR-6, FR-11, FR-12)

- **Ungated** (004 FR6). Nothing changes in the entry point. An approved user
  completes the OIDC flow with the app's own client. A pending user is stopped
  by `hub-browser` before a code is issued. Pages that need no account,
  including this app's invite links, are never sent to sign in, so they behave
  exactly as before (FR-11).
- **Gated: per-app access group.** Each gated app `<app>` gets a realm group
  `access-<app>`. The client `hub-gateway` gets a *group membership* mapper:
  claim `groups`, `full.path=false`, in ID token, access token and userinfo.
  oauth2-proxy (`keycloak-oidc`) already reads that claim. The `gated` snippet
  asks oauth2-proxy's auth endpoint for the group:
  `forward_auth … uri /oauth2/auth?allowed_groups=access-<app>`. The answers are:
  - 401: no session, redirect to sign in, as today.
  - 403: signed in but not in `access-<app>`. Caddy answers with a 403 page:
    `You don't have access to <app>. Access is granted by <app>'s admin.`, plus
    a "sign in again" link to `/oauth2/sign_out?rd=/<app>/` for after access is
    granted (FR-12).
  - 202: proxied to the app, as today.
- **Granting** is `bin/accounts grant <app> <user>` (or adding the user to the
  group in the admin console). It refuses pending users. Membership in
  `access-a` says nothing about `access-b`, so access to one gated app opens no
  other (FR-12).
- **Existing gated apps keep working** (NFR-3). The first time
  `bin/accounts init-app <app>` creates `access-<app>`, it adds every user who
  exists and isn't pending at that moment. `bin/configure-registration` runs it
  for every gated snippet in `caddy/apps/`. Later runs find the group and add
  nobody. A gated app added after this feature starts with an empty group.

oauth2-proxy reads groups at sign-in. A grant takes effect at the user's next
sign-in at the gateway, which the 403 page's link triggers (Keycloak's SSO
session makes that silent).

### 1.5 Cleanup after 30 days (FR-13)

The compose service `accounts` runs `python -m accounts run-expiry`. Once at
start and then every hour, it deletes every member of `pending` whose
`createdTimestamp` is at least 30 × 86 400 s old. A registration is removed at
most one hour after its 30 days are up. The cut-off is computed by a pure
function `expired(created_ms, now_ms) -> bool` in `states.py`, and `now` can be
injected through `expire --now`, which is how the tests cover it without
waiting 30 days. Users with a `serviceAccountClientLink` are always skipped.
The service talks to `http://auth:8080/auth` on the `hub` network, with
client-credentials of its own confidential client `hub-accounts` (§2.3).
`restart: unless-stopped`, `mem_limit: 48m`.

### 1.6 Sign-up rate limit (NFR-1)

The entry point counts registration **submissions** per source: every `POST` to
`/auth/realms/hub/login-actions/registration`, keyed by `{client_ip}`, 5 per
sliding hour. The 6th answers 429 with `Retry-After` and a short page
(`Too many sign-up attempts from your network. Try again later.`). Keycloak is
never reached. Other sources have their own counters. Failed submissions count
too, which limits username probing (the stated reason for NFR-1).

- **Mechanism.** Caddy core has no rate limiter, so the proxy image is
  `caddy:2.10-alpine` with the `github.com/mholt/caddy-ratelimit` module built
  in by `xcaddy` (pinned commit). Snippet `registration-limit` is imported in
  front of `/auth/*` on both listeners (`:80` public, `:81` tailnet).
- **Source.** `{client_ip}` respects 004's `trusted_proxies 127.0.0.1/32 ::1`,
  so it is the address tailscaled puts in `X-Forwarded-For`. Whether Funnel
  supplies the real public address there is checked on the hub (§4.3). If it
  doesn't, every Funnel visitor counts as one source; see Decisions.
- **State** is in Caddy's memory. A proxy restart resets the counters, which
  NFR-4 doesn't cover (it covers account states).
- **HTTPS only** (NFR-2). There's no new listener: Funnel and Serve only expose
  `:443` and `:8443` with TLS (004), so registration has no plain-HTTP path.

**This app's login theme.** Per-app themes (004 amendment) inherit the
Register link and the `noAccount` note unless they replace the login template.
An on-hub check opens this app's sign-in page. If either is missing, a task
here adds them to this app's theme (FR-1, FR-10).

### 1.7 Requirement → mechanism

| Req | Mechanism |
|---|---|
| FR-1 | `registrationAllowed=true`; default login template's Register link (§1.2, §1.6 theme check) |
| FR-2 | `hub-registration` flow: form creates user in default group `pending`, then *Deny access* with the awaiting-approval message |
| FR-3 | Keycloak's registration form validation; `passwordPolicy` |
| FR-4 | `hub-browser` / `hub-direct-grant` conditional deny on `hub-pending` |
| FR-5 | `bin/accounts list` (and admin console group members) |
| FR-6 | `approve` = leave `pending`; gated apps still need `access-<app>` |
| FR-7 | `reject` = delete user, only if pending |
| FR-8 | Only `default-roles-hub`, checked to hold no app client role |
| FR-9 | `verifyEmail=false`, no `smtpServer` |
| FR-10 | `resetPasswordAllowed=false`; `noAccount` override; admin sets password as today |
| FR-11 | Entry point routing for ungated apps unchanged |
| FR-12 | `access-<app>` group, `allowed_groups` on forward auth, 403 page; `grant` |
| FR-13 | `accounts` service, hourly `expire` |
| NFR-1 | Caddy `rate_limit` zone on registration POSTs, 5/h per `{client_ip}` |
| NFR-2 | Deny before session in all three flows; TLS-only listeners; Keycloak hashing; no request-body logging |
| NFR-3 | Default group affects only new users; `init-app` seeds existing users once; policy not checked at sign-in |
| NFR-4 | All states are Keycloak data in `db-auth` |

## 2. Data model

### 2.1 Keycloak realm `hub` (added objects)

| Object | Name | Settings |
|---|---|---|
| realm role | `hub-pending` | no composites |
| group | `pending` | realm role `hub-pending`; realm default group |
| group | `access-<app>` | one per gated app; no roles |
| flow | `hub-browser` | bound as `browserFlow` |
| flow | `hub-direct-grant` | bound as `directGrantFlow` |
| flow | `hub-registration` | bound as `registrationFlow` |
| authenticator config | `hub-pending-role` | `condUserRole=hub-pending`, `negate=false` |
| authenticator config | `hub-pending-deny` | `denyErrorMessage=Your account is awaiting approval by a hub admin.` |
| authenticator config | `hub-registered-deny` | `denyErrorMessage=Thanks — your account has been created and is awaiting approval by a hub admin.` |
| protocol mapper on `hub-gateway` | `groups` | `oidc-group-membership-mapper`, `claim.name=groups`, `full.path=false`, id/access/userinfo |
| client | `hub-accounts` | confidential, service account only (no standard/implicit/direct flow); service-account user removed from `pending`; roles `realm-management`: `query-users`, `view-users`, `manage-users`, `query-groups` |
| localization (en) | `noAccount` | `Forgot your password? Ask a hub admin to set a new one. New here?` |
| realm attributes | see §1.2 | |

Registration time is Keycloak's `createdTimestamp` (ms since epoch, UTC). This
feature adds no tables of its own.

### 2.2 Entry point state

Caddy rate-limit zone `registration`: key `{client_ip}`, `events 5`,
`window {$HUB_REGISTRATION_WINDOW:1h}`, in memory only.

### 2.3 Memory budget (004 §2.3, updated)

| Service | Limit |
|---|---|
| `auth` | 768m |
| `db-auth` | 256m |
| `ts-hub` | 128m |
| `proxy` | 64m (plugin adds ~1 MB) |
| `authproxy` | 64m |
| `accounts` | 48m |
| **Total** | **1328m** (≤ 1536m static limit; leaves 2768 MB) |

### 2.4 Gated snippet rule (static check)

`caddy/apps/<app>.caddy` either imports no gate (ungated), or `import gated
<app>` / `import gated-api <app>` with `<app>` equal to its filename.

## 3. Contracts

### 3.1 Environment (`.env.example`, names only)

```
ACCOUNTS_CLIENT_SECRET=        # printed once by bin/configure-registration when it creates hub-accounts
HUB_REGISTRATION_WINDOW=       # optional; default 1h. Only the test override sets it
```

### 3.2 Caddyfile snippets

```caddy
# global options (added)
{
	order rate_limit before reverse_proxy
}

(registration-limit) {
	rate_limit {
		zone registration {
			match {
				method POST
				path /auth/realms/hub/login-actions/registration
			}
			key {client_ip}
			events 5
			window {$HUB_REGISTRATION_WINDOW:1h}
		}
	}
}
# :80 and :81: `import registration-limit` inside the /auth/* handle, before reverse_proxy auth:8080.
# handle_errors 429 on both sites: respond with the "Too many sign-up attempts" page, keeping Retry-After.

(gated) {   # args[0] = app name
	import strip-identity
	forward_auth authproxy:4180 {
		uri /oauth2/auth?allowed_groups=access-{args[0]}
		copy_headers X-Auth-Request-User X-Auth-Request-Email X-Auth-Request-Groups X-Auth-Request-Preferred-Username Authorization
		@unauth status 401
		handle_response @unauth {
			redir * /oauth2/start?rd={scheme}://{host}{uri}
		}
		@forbidden status 403
		handle_response @forbidden {
			header Content-Type "text/html; charset=utf-8"
			respond `<!doctype html><title>No access</title><p>You don't have access to {args[0]}. Access is granted by {args[0]}'s admin.</p><p>Already granted? <a href="/oauth2/sign_out?rd=%2F{args[0]}%2F">Sign in again</a>.</p>` 403
		}
	}
}
# (gated-api): same uri; passes 401 and 403 through with a plain-text body.
```

### 3.3 `bin/configure-registration`

`bin/configure-registration` uses kcadm inside `auth` with `KC_ADMIN_*` from
`.env`. It exits 0 when realm `hub` matches §1.2 and §2.1, and changes only
what differs, so re-running it is a no-op. Order:

1. Realm attributes and password policy.
2. User profile change.
3. Role, group, default group.
4. The three flows: create if missing, then bind.
5. Localization.
6. `groups` mapper.
7. `hub-accounts`, printing its secret only when newly created.
8. `bin/accounts init-app` for each gated snippet.

It exits non-zero, before changing anything, if `smtpServer` is set or
`default-roles-hub` holds an app client role.

### 3.4 `bin/accounts` (→ `python -m accounts`, inside the `accounts` container)

```
list                         # TSV to stdout, oldest first: username<TAB>email<TAB>registered_at (ISO-8601 UTC, seconds)
approve <username>           # exit 0; exit 2 "not pending: <username>" if missing or not in `pending`
reject  <username>           # deletes the user; exit 2 as above
expire  [--now <ISO-8601>]   # deletes pending users with created <= now - 30 d; prints one removed username per line
grant   <app> <username>     # adds to access-<app>; exit 2 if user missing or pending; exit 3 if group missing
revoke  <app> <username>     # removes from access-<app>; exit 3 if group missing
init-app <app>               # creates access-<app> seeded with all current non-pending, non-service-account users;
                             # prints "exists" and changes nothing if the group exists
run-expiry [--interval 3600] # the service's entry point: expire now, then every interval; logs counts, never passwords
```

Environment: `KC_URL=http://auth:8080/auth`, `KC_REALM=hub`,
`ACCOUNTS_CLIENT_ID=hub-accounts`, `ACCOUNTS_CLIENT_SECRET`.

Admin REST calls used:
- `POST /realms/hub/protocol/openid-connect/token` (client_credentials)
- `GET /admin/realms/hub/groups?search=` and `GET /admin/realms/hub/groups/{id}/members?briefRepresentation=false&first&max`
- `GET /admin/realms/hub/users?username=<u>&exact=true`
- `PUT|DELETE /admin/realms/hub/users/{id}/groups/{gid}`
- `DELETE /admin/realms/hub/users/{id}`
- `POST /admin/realms/hub/groups`

Members are paged 100 at a time.

`states.py` (pure):

```python
MAX_PENDING_MS = 30 * 86_400_000
def expired(created_ms: int, now_ms: int) -> bool: ...   # created_ms + MAX_PENDING_MS <= now_ms
def pending_rows(members: list[dict]) -> list[tuple[str, str, str]]: ...  # sorted, ISO times, service accounts dropped
```

### 3.5 Compose (`compose.yaml` additions)

```yaml
proxy:
  build: ./caddy            # replaces image: caddy:2-alpine; same namespace, mounts, restart, mem_limit
accounts:
  image: python:3.12-alpine # pinned digest
  command: python -m accounts run-expiry
  working_dir: /app
  volumes: [ "./accounts:/app:ro" ]
  environment: [ KC_URL, KC_REALM, ACCOUNTS_CLIENT_ID, ACCOUNTS_CLIENT_SECRET ]
  networks: [ hub ]
  restart: unless-stopped
  mem_limit: 48m
  depends_on: [ auth ]
```

No `ports:` (004 FR3).

### 3.6 Runbook (README) changes

- **Enable once:**
  1. `docker compose build proxy && docker compose up -d`.
  2. `bin/configure-registration`.
  3. Put the printed secret in `.env` as `ACCOUNTS_CLIENT_SECRET`.
  4. `docker compose up -d accounts`.
- **Adding a gated app** (004 §3.4) gains a step:
  `bin/accounts init-app <app>` before `bin/reload`. Its snippet uses
  `import gated <app>`.
- **Admin-created accounts start pending** (default group). After creating one
  in the console, run `bin/accounts approve <user>`.

## 4. Test strategy

Everything runs in the hub repo's pytest suite from `scripts/check.sh`, with
the real stack from 004 §4.2 (real Keycloak, Postgres, oauth2-proxy, Caddy built
from `caddy/Dockerfile`, and the real `accounts` container). The session
fixture runs `bin/configure-registration` after creating 004's pre-existing
test user `olduser`, who has a 6-character password that breaks the new policy.
That user stands for the accounts that exist today.

**Additions to the test setup:**
- `stub-g` is a second gated `traefik/whoami`, so there are two gated apps
  (`stub-a`, `stub-g`) and one ungated (`stub-b`). `stub-b` gets an OIDC client
  (`bin/add-client stub-b public /cb`) with client roles `editor` and `admin`.
  It stands in for this app's client (FR-8).
- **Source emulation for NFR-1.** In production, tailscaled reaches Caddy from
  127.0.0.1 and sets `X-Forwarded-For`. A `probe` service in
  `compose.test.yaml` (the same `python:3.12-alpine` image,
  `network_mode: service:ts-hub`, profile `probe`) does the same. It posts to
  `127.0.0.1:80` with `X-Forwarded-For: 203.0.113.<n>`. The host test client,
  which comes in through the stand-in's port binding, is a different source.
  The override sets `HUB_REGISTRATION_WINDOW=10s`.
- Sign-in and registration are driven with httpx following Keycloak's forms.
  The forms are parsed with `html.parser`, as in 004.

**Unit tests** (pytest, no containers) cover `states.py`: the expiry boundary
(30 d − 1 ms is kept, 30 d is expired), TSV ordering and formatting, and that
service accounts are dropped.

**Static checks:** the gated-snippet rule (§2.4), the memory sum ≤ 1536m,
`accounts` has `restart: unless-stopped` and no `ports:`, and no `log` directive
captures request bodies.

### 4.1 Acceptance criterion → test

| Criterion | Test |
|---|---|
| FR-1 | Start sign-in at `/stub-a/`. The Keycloak login page has a link whose href is the realm's registration URL, and following it returns a form with `username`, `email`, `password` and `password-confirm` fields. |
| FR-2 | **First test written.** Submit `newuser` / `new@example.com` / a valid password. The response shows the `hub-registered-deny` message and sets no oauth2-proxy cookie. Admin REST shows `newuser` exists and is a member of `pending`. |
| FR-3 | Register `taken` while `taken` exists: the error sits next to the username field (form re-rendered with field error `usernameExists`). Same for a taken email (`emailExists`) and an 8-character password (password-field policy error). No user is created in any case. |
| FR-4 | Pending `newuser` with the correct password: (a) via `/stub-a/` (gated) the `hub-pending-deny` message, no `_hub_auth` cookie; (b) via client `stub-b` the auth-code flow ends on the message, no redirect to `/stub-b/cb?code=`. `GET /users/{id}/sessions` is empty. |
| FR-5 | Register two users. `bin/accounts list` prints both, with the email and an ISO time within ±1 min of registration. `olduser` isn't listed. |
| FR-6 | `bin/accounts approve newuser`. The `stub-b` auth-code flow now yields a code and a token. `/stub-a/` and `/stub-g/` give 403 with the "granted by … admin" page. |
| FR-7 | `bin/accounts reject newuser`. Sign-in fails with Keycloak's invalid-credentials message, and registering `newuser` / `new@example.com` again succeeds (pending). `reject olduser` exits 2 and `olduser` still exists. |
| FR-8 | After approval, `newuser`'s `stub-b` access token has no `resource_access.stub-b` roles. `bin/configure-registration` fails against a realm where `default-roles-hub` was given `stub-b/editor`. On-hub (§4.3): the approved user has no editor/admin in this app. |
| FR-9 | After FR-2's submission: realm `smtpServer` is empty, `newuser` has no `VERIFY_EMAIL` required action, and no response in the flow is Keycloak's verify-email page. `docker compose logs auth` has no mail-send entry. |
| FR-10 | The login page has no `reset-credentials` link and contains the `noAccount` note. `GET …/login-actions/reset-credentials` doesn't offer a reset form. After `kcadm set-password` for approved `newuser`, sign-in with the new password succeeds. |
| FR-11 | With registration on and no cookie, `/stub-b/invite/x` gives 200 from `stub-b` with no redirect (004 FR6 test re-run after configuration). On-hub (§4.3): one of this app's invite links joins a session with no sign-in. |
| FR-12 | Approved `newuser`: `bin/accounts grant stub-a newuser`, then sign in again via the 403 page's link. `/stub-a/` gives 200 from `stub-a` with `X-Auth-Request-User: newuser`. `/stub-g/` gives 403 whose body names `stub-g`'s admin. `grant` for a pending user exits 2. |
| FR-13 | Pending `newuser`: `expire --now <created + 30 d − 1 min>` keeps it, and `expire --now <created + 30 d>` prints and deletes it. Registering `newuser` again succeeds. The `accounts` service's startup run is seen in its log (count line). |
| NFR-1 | The probe sends 5 registration POSTs as 203.0.113.7 (each reaches Keycloak, so not 429), then a 6th gets 429 with `Retry-After`. At the same moment, the host client completes a full registration (different source). After 10 s, the probe's next POST isn't 429. On-hub (§4.3) with real sources. |
| NFR-2 | FR-4's no-session assertions. Plus: the direct-grant token request for pending `newuser` (test client with direct grant on) is refused. The test password appears in neither `docker compose logs` of any hub service nor the `credential` table (`secret_data` is a hash). HTTP: on-hub only (§4.3). |
| NFR-3 | `olduser` (signed in to `/stub-a/` before configuration) still gets 200 with the same cookie afterwards. A fresh sign-in with the 6-character password works for `/stub-a/` and `stub-b`. `olduser` is in `access-stub-a` and not in `pending`. A second `bin/configure-registration` and `init-app stub-a` change nothing (realm export diff empty). |
| NFR-4 | With pending `p1` and approved `a1`: `docker compose down && docker compose up -d` (no `-v`). `p1` is still refused with the pending message, `a1` signs in to `stub-b`. On-hub reboot (§4.3). |

### 4.2 Supporting checks

`bin/configure-registration` refusals (SMTP set, app role in defaults), and that
`bin/accounts` exit codes match §3.4.

### 4.3 On-hub smoke additions (`check/smoke.sh`, logged in `notes.md` at validation)

- **NFR-2 HTTP**: `curl -m5 http://hub.<tailnet>.ts.net/auth/realms/hub/protocol/openid-connect/registrations`
  from off the tailnet fails to connect. The HTTPS URL answers.
- **NFR-1 source**: 6 registration POSTs from an off-tailnet device. The 6th
  gets 429. A registration from a second network (e.g. phone on mobile data)
  still succeeds right after.
- **FR-1 / FR-10 on this app's theme**: this app's sign-in page shows the
  Register link and the admin note.
- **FR-8 / FR-11 with this app**: an approved new account has no editor/admin
  capability in this app, and an invite link works with no account.
- **NFR-4**: `sudo reboot` with one pending and one approved account. Afterwards
  they are in the same states.

## 5. Constitution compliance

| # | Rule | How the plan complies |
|---|---|---|
| 1 | Test-first | Each task starts with its §4.1 case (or static check) failing against the stack without that change. FR-2's survives-the-deny test is first. |
| 2 | Green before done | `scripts/check.sh` runs static checks, unit tests, the full integration suite and lint. |
| 3 | Traceable tests | §4.1 maps every FR and NFR criterion. NFR-2 (HTTP), NFR-1 (real sources) and the this-app parts of FR-1/8/10/11 are additionally on-hub, by necessity. |
| 4 | Real dependencies | Keycloak, Postgres, oauth2-proxy, Caddy (the built image), `accounts` all run for real. Nothing is mocked. The 30-day wait is replaced by an injected `now` argument, not a fake clock or a stub. The only stand-in is 004's justified Tailscale exception. The `probe` emulates the one thing that stand-in drops (tailscaled's `X-Forwarded-For` from 127.0.0.1), and is covered on-hub by §4.3. |
| 5 | Fixed stack | **Departure, as in 004:** the hub carries no application. `accounts` is Python 3.12 (stack language), stdlib only. It serves no HTTP, so FastAPI doesn't apply. No PostgreSQL schema of its own: the state is Keycloak's. Deployment stays docker compose. |
| 6 | Dependency justification | See below. |
| 7 | No secrets | `ACCOUNTS_CLIENT_SECRET` comes from `.env`, printed once by the script and never written to the repo. Test secrets are generated per run. The existing static secret check covers the new files. |
| 8 | Lint and format | `ruff check` / `ruff format --check` on `accounts/` and `tests/`. `shellcheck` on the new `bin/` scripts. `caddy fmt --diff` on the Caddyfile. **Not applicable:** `biome ci` and `tsc --noEmit` in the hub repo, because there's no TypeScript. They do apply if §1.6 leads to a change in this app's theme. |
| 9 | Layout and dependency direction | Stated in §1.1. |

**No conflicts.** The rule-5 departure is the one 004 already stated, extended
to `accounts`.

**New dependencies (constitution 6):**
- `github.com/mholt/caddy-ratelimit` (Caddy module, pinned commit) gives the
  NFR-1 per-source limit at the entry point. Caddy core, Keycloak and
  oauth2-proxy have no registration rate limit. The alternative is a
  hand-written limiter service, which means more code and one more hop on every
  `/auth` request.
- `caddy:2.10-builder` (build-time image, `xcaddy`) is the supported way to add
  a module to Caddy.
- `python:3.12-alpine` (pinned digest) runs `accounts` and the test `probe`.
  It's the stack language. There's no library inside, only stdlib `urllib`,
  `json` and `argparse`.

No new Python packages: tests keep 004's `pytest` and `httpx`.

## 6. Departures from 004's plan

1. **Proxy image is built** (`caddy/Dockerfile`), no longer stock
   `caddy:2-alpine`. This is the only way to get a rate limiter into the one
   entry point (NFR-1).
2. **The gateway authorises per app** (`allowed_groups=access-<app>`). 004 said
   the gateway "doesn't authorise per app", because its spec asked for sign-in
   only. FR-12 now requires it. Gated snippets take the app name.
3. **Realm changes are made by a script on the live realm**, not in
   `realm-hub.json`, because import only runs once (the same reason 004 gives
   for `bin/add-client`).
4. **A sixth hub service** (`accounts`, 48m). The budget stays within 004's
   limit.

## 7. Decisions for the human to confirm

1. **Password rules**: at least 12 and at most 128 characters, and not equal to
   the username or email. 004 defines none. Existing passwords are unaffected.
2. **Pending = default group `pending`.** As a side effect, an account a hub
   admin creates in the console also starts pending and needs
   `bin/accounts approve`. If nobody approves it, the 30-day cleanup removes
   it. The alternative, an explicit "approved" role, would need every
   admin-created and existing account to be tagged.
3. **The limit counts submissions, not only successful registrations.** That
   caps username probing, which is NFR-1's reason. A user who mistypes counts
   against the 5.
4. **Rate-limit counters are in memory**, so a proxy restart resets them.
5. **If Funnel doesn't pass the real client address**, checked on the hub, all
   public sign-ups share one counter of 5 per hour. That's still safe, but
   stricter than the spec. The remedy would go back to the human.
6. **Hub admins and app admins act through `bin/accounts`** on the hub, or the
   admin console on the tailnet listener. Gated-app admins grant access with
   `bin/accounts grant`. Delegating that to app admins who have no hub access
   (Keycloak fine-grained admin permissions) isn't planned.
7. **A grant takes effect at the next gateway sign-in**, through the 403 page's
   "Sign in again" link, rather than by shortening oauth2-proxy's cookie
   refresh.
8. **Existing gated apps**: their access group is seeded once with every
   current account, so nothing changes for them (NFR-3). Gated apps added later
   start with nobody.
9. **The forgot-password note is a realm message override (`noAccount`)**, not
   a hub-wide login theme. It keeps 004's rule that the realm theme stays unset.
   An app theme that replaces the login template must render it itself (on-hub
   check, §4.3).
10. **First and last name become optional** on the registration form, not
    removed.
11. **Cleanup runs hourly.** An expired registration disappears up to one hour
    after its 30 days.
