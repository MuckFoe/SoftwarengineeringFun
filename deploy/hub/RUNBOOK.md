# Running collab on the project hub

Operator steps for spec 005: the first deploy on VM 105, updates, and the
checks that need the real hub. The app is served at
`https://hub.<tailnet>.ts.net/collab/` and signs people in through the hub's
Keycloak (realm `hub`, client `collab`). It runs no identity provider of its
own.

Paths used below, on VM 105:

| Path | What |
|---|---|
| `~/hub` | the hub repository, already set up as its `README.md` describes |
| `~/collab` | a clone of this repository |

Commands marked **(hub)** run in `~/hub`. Every other command runs in
`~/collab`.

## Before the first deploy

- The hub is running (`cd ~/hub && docker compose ps`), so the external
  network `hub` exists.
- `~/hub` contains `caddy/apps/collab.caddy` and `keycloak/themes/collab/`
  (spec 005 tasks 8 and 19). If it doesn't, pull or copy them into the hub
  repository first.
- The hub's copy of the login theme matches this repository's:

  ```sh
  diff -r ~/collab/keycloak-theme/collab ~/hub/keycloak/themes/collab   # no output
  ```

## First deploy

### 1. The client in the hub's Keycloak (hub)

```sh
cd ~/hub
bin/add-client collab confidential /api/auth/callback
```

It prints the client secret **once**. Put it straight into
`~/collab/.env.hub` as `OIDC_CLIENT_SECRET` (step 2); don't store it anywhere
else. If the client already exists, the command refuses and changes nothing.

Create the client roles `editor` and `admin` on `collab`. Capabilities are
read only from this client's roles, so the hub's realm roles and other apps'
client roles grant nothing here (FR3). `kcadm` runs inside `auth`, signed in
as the bootstrap admin from the container's own environment:

```sh
hub_kcadm() {
  docker compose exec -T auth bash -c '
    cfg=$(mktemp); trap "rm -f $cfg" EXIT
    KC_CLI_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" /opt/keycloak/bin/kcadm.sh config credentials \
      --config "$cfg" --server http://localhost:8080/auth --realm master \
      --user "$KC_BOOTSTRAP_ADMIN_USERNAME" >/dev/null &&
    /opt/keycloak/bin/kcadm.sh "$@" --config "$cfg"' kcadm "$@"
}
id=$(hub_kcadm get clients -r hub -q clientId=collab --fields id --format csv --noquotes)
hub_kcadm create "clients/$id/roles" -r hub -s name=editor
hub_kcadm create "clients/$id/roles" -r hub -s name=admin
```

Select the app's sign-in page for this client only. Other apps keep the hub's
default page:

```sh
bin/set-login-theme collab
```

### 2. Configuration (`.env.hub`)

```sh
cd ~/collab
cp .env.hub.example .env.hub && chmod 600 .env.hub
```

Fill in `.env.hub`. It's git-ignored, and it's the only place any of these
values go: never on a command line, in a compose file or in a commit.

| Variable | Value |
|---|---|
| `PUBLIC_BASE_URL` | `https://hub.<tailnet>.ts.net/collab` (no trailing slash) |
| `OIDC_ISSUER` | `https://hub.<tailnet>.ts.net/auth/realms/hub` |
| `OIDC_METADATA_URL` | keep the example's `http://auth:8080/...` (the hub network) |
| `OIDC_CLIENT_SECRET` | the secret `bin/add-client` printed in step 1 |
| `SESSION_COOKIE_KEY` | output of `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | output of `openssl rand -hex 32` |
| `DATABASE_URL` | the example's URL with that same password in place of `changeme` |

`APP_BASE_PATH`, `BASE_PATH`, the role names, `SANDBOX_IMAGE` and the rest
keep the example's values. `SANDBOX_RUNTIME` stays empty (plan §7 D4).

### 3. Static checks, build and start

```sh
~/hub/check/static.sh docker-compose.hub.yml
docker compose -f docker-compose.hub.yml --env-file .env.hub build sandbox
docker compose -f docker-compose.hub.yml --env-file .env.hub up -d --build --wait
```

`--wait` returns once `db`, `runner` and `api` are healthy. The first start
loads the 20 starter problems into an empty database; nothing comes from any
local installation (FR9).

### 4. Route `/collab/` (hub)

```sh
cd ~/hub
check/static.sh
bin/reload
```

`bin/reload` validates first and reloads Caddy gracefully. Other apps and
signed-in users aren't touched. On an invalid config it exits non-zero and the
running config stays.

### 5. Smoke check on the fresh deployment

```sh
cd ~/collab
deploy/hub/smoke.sh --fresh
```

All of `cert` (FR1), `services` (FR4) and `fresh` (FR9) must print `PASS`.
`--fresh` is only meaningful now, before anyone creates a session.

### 6. Editors and administrators

Self-registration is off. Create accounts in the hub's admin console
(`https://hub.<tailnet>.ts.net:8443/auth/admin/`, tailnet only), realm `hub`.
Give a person this app's capabilities with the client roles of `collab` (in
the console under *Role mapping → Assign role → Filter by clients*, or **(hub)**
with the `hub_kcadm` function from step 1):

```sh
hub_kcadm add-roles -r hub --uusername <user> --cclientid collab --rolename editor
hub_kcadm add-roles -r hub --uusername <user> --cclientid collab --rolename admin
```

Participants need no account. They join with an invite link (FR2).

## Update

```sh
cd ~/collab
git pull
docker compose -f docker-compose.hub.yml --env-file .env.hub build sandbox
docker compose -f docker-compose.hub.yml --env-file .env.hub up -d --build --wait
deploy/hub/smoke.sh
```

Compose recreates only this project's containers. The database stays on the
named volume `db-data`, so sessions, problems and chat messages survive
(FR7).

**Never** run `docker compose ... down -v`, `docker volume rm` or any prune
that touches volumes: they delete `db-data` and with it every session. To stop
the app without losing data, `docker compose -f docker-compose.hub.yml
--env-file .env.hub down` (no `-v`).

If an update changed `keycloak-theme/collab/`, copy it again into
`~/hub/keycloak/themes/collab/` and follow the hub README's *Changing an
app's login theme*. That needs `docker compose restart auth` in `~/hub`,
which briefly stops sign-in for **every** hub app, so pick a quiet moment.

## Checks on the real hub

`deploy/hub/smoke.sh` covers what a script can (see its header). The checks
below need the real VM, its certificate, a reboot or a public device. Run
them when validating spec 005, and record each result in
`specs/005-deploy-to-project-hub/notes.md`: date, what was run, `PASS` or
`FAIL`, and the observations listed under each check.

### FR2a — joining from the public internet

1. On a laptop on the tailnet, sign in as an editor and start a session. Copy
   its invite link.
2. Take a phone on **mobile data**: Wi-Fi off, Tailscale not installed or
   switched off, so it's on neither the tailnet nor the LAN.
3. Open the invite link in the phone's browser. Join without signing in.
4. Type in the editor on the laptop.

Passes if the phone joins and sees the edit appear without reloading. Record
in `notes.md`: the phone's network (carrier, Wi-Fi off, Tailscale off),
whether the join step came without a sign-in prompt, and whether the edit
appeared live.

### FR7 — data survives a redeploy and a reboot

1. In a session, write some code and send at least two chat messages. Note
   the invite link, the code and the messages.
2. Redeploy with the *Update* commands above (a `git pull` with no changes is
   fine).
3. Reboot the VM: `sudo reboot`. Docker starts at boot and every service has
   `restart: unless-stopped`.
4. When the VM is back, run **(hub)** `check/smoke.sh --after-reboot /collab/`,
   then `deploy/hub/smoke.sh` here.
5. Open the invite link again.

Passes if the session, its code and its chat messages are all still there.
Record in `notes.md`: the session's invite code, how long after the reboot
`/collab/` answered, both smoke outputs, and whether code and messages
matched what you noted.

### FR8 — other apps keep answering during a deploy

1. On another tailnet device, poll another hub app and the hub's Keycloak
   once a second:

   ```sh
   while sleep 1; do
     for u in https://hub.<tailnet>.ts.net/<other-app>/ https://hub.<tailnet>.ts.net/auth/realms/hub; do
       printf '%s %s %s\n' "$(date +%T)" "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"
     done
   done | tee fr8.log
   ```

   With no other app hosted yet, poll only `/auth/realms/hub`.
2. On VM 105, run the *Update* commands.
3. Stop the poll once `up --wait` has returned and the smoke check passed.

Passes if every line in `fr8.log` is a success status (200, or the same
redirect the app gave before the deploy) and none is an error or `000`.
Record in `notes.md`: the URLs polled, the deploy's start and end times, the
number of polls, and any line that wasn't a success.

### Memory — several people running at once

1. Get 5 participants into 3 sessions (for example 2, 2 and 1), each with a
   solution open.
2. On VM 105 start the sampler, which watches this project and every sandbox
   every 500 ms:

   ```sh
   deploy/hub/smoke.sh --sample-memory 120
   ```

3. While it runs, have every participant press *Run* repeatedly for the two
   minutes, so runs overlap. A third run at once waits up to 10 s for a slot,
   then reports "couldn't run" (plan §7 D3); that's expected.

Passes if `memory` prints `PASS`: the peak stayed at or below 1024 MiB.
Record in `notes.md`: the peak and the sample count from the output, the
number of participants and sessions, and how many runs reported "couldn't
run".
