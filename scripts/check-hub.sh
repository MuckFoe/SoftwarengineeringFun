#!/usr/bin/env bash
# Hub end-to-end gate (spec 005, plan §4.3, §5 rule 2); separate from scripts/check.sh.
# Brings up the hub repo's test stack (compose.test.yaml: the local stand-in for Tailscale) with
# collab.caddy and the collab login theme registered, adds the `collab` client (login_theme=collab),
# its roles and test users to realm `hub`, runs docker-compose.hub.yml against it, runs
# Playwright's HUB=1 project, then tears all of it down (`down -v`), pass or fail. Exits non-zero
# on any failure, and before starting anything if the hub's theme copy has drifted.
# Beside collab it runs the hub's ungated whoami stub as another app (project `stub-a`, at
# /stub-a/) and a decoy client `other-app` whose roles share collab's names (FR3, FR8).
# Usage: scripts/check-hub.sh [playwright args]   e.g. scripts/check-hub.sh hub-smoke
#   HUB_REPO  the hub repository (default: ../hub beside this repo)
# Nothing is written into either repo except e2e/.keycloak-state.json (gitignored, removed at
# exit); every secret is random and lives in a temp dir.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HUB_REPO="$(cd "${HUB_REPO:-$ROOT/../hub}" && pwd)"
HUB_URL="http://localhost:18080"
HUB_ADMIN_URL="http://localhost:18081"
STATE_FILE="$ROOT/e2e/.keycloak-state.json"
KCADM=/opt/keycloak/bin/kcadm.sh
# user:client-role (blank = none); the names the existing e2e specs use.
TEST_USERS=(editor1:editor editor2:editor plain1: admin1:admin)
STUB=stub-a
# Holds only other-app's editor and admin roles and a realm role `editor`: nothing in collab.
OTHER_USER=other1

step() { printf '\n==> %s\n' "$*"; }
rand() { openssl rand -hex 24; }

# Never tear down a stack this script didn't start.
for project in hub collab "$STUB"; do
  if [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]]; then
    echo "check-hub: compose project '$project' already has containers; stop it first" >&2
    exit 2
  fi
done

# The hub serves collab's sign-in page from its own copy of the theme (plan §7 D2); it must be
# this repo's keycloak-theme/collab/ byte for byte.
if ! diff -r "$ROOT/keycloak-theme/collab" "$HUB_REPO/keycloak/themes/collab"; then
  echo "check-hub: $HUB_REPO/keycloak/themes/collab differs from keycloak-theme/collab; copy it again" >&2
  exit 1
fi

work="$(mktemp -d)"
mkdir "$work/apps" "$work/themes"
cp "$HUB_REPO/caddy/apps/collab.caddy" "$work/apps/"
# Another app on the hub, registered the way the hub's own tests register theirs (tests/stubs.py).
cat >"$work/apps/$STUB.caddy" <<EOF
# $STUB — ungated — owner repo: tests/stubs
handle /$STUB/* {
	import strip-identity
	reverse_proxy $STUB-web:80
}
EOF

# The hub's login themes, as the hub's own harness mounts them: a temp copy, never the repo dir.
cp -R "$HUB_REPO/keycloak/themes/." "$work/themes/"

# The hub stack's env, as the hub's own harness (tests/conftest.py) writes it.
cat >"$work/hub.env" <<EOF
TS_AUTHKEY=
TS_TAILNET=test
HUB_URL=$HUB_URL
HUB_ADMIN_URL=$HUB_ADMIN_URL
POSTGRES_AUTH_PASSWORD=$(rand)
KC_ADMIN_USER=admin-$(openssl rand -hex 4)
KC_ADMIN_PASSWORD=$(rand)
OAUTH2_PROXY_CLIENT_SECRET=$(rand)
OAUTH2_PROXY_COOKIE_SECRET=$(openssl rand -base64 32 | tr -- '+/' '-_')
OAUTH2_PROXY_COOKIE_SECURE=false
HUB_APPS_DIR=$work/apps
HUB_THEMES_DIR=$work/themes
EOF
chmod 600 "$work/hub.env"

# The hub's test stack; bin/add-client reaches it through the same two variables.
hub_env() {
  COMPOSE_FILE="$HUB_REPO/compose.yaml:$HUB_REPO/compose.test.yaml" COMPOSE_ENV_FILES="$work/hub.env" "$@"
}
hub() { (cd "$HUB_REPO" && hub_env docker compose "$@"); }
collab() { docker compose -f "$ROOT/docker-compose.hub.yml" --env-file "$work/env.hub" "$@"; }
stub() { APP="$STUB" docker compose -f "$HUB_REPO/tests/stubs/whoami.yaml" -p "$STUB" "$@"; }

teardown() {
  local status=$?
  step "teardown"
  if [[ -f "$work/env.hub" ]]; then
    collab down -v --remove-orphans || status=1
  fi
  stub down -v --remove-orphans || status=1
  hub down -v --remove-orphans || status=1
  rm -rf "$work" "$STATE_FILE"
  exit "$status"
}
trap teardown EXIT

step "hub test stack (compose.test.yaml)"
if ! hub up -d --wait --wait-timeout 300; then
  hub logs --no-color --tail 50
  exit 1
fi

# kcadm inside `auth`, signed in as the bootstrap admin from the container's own environment.
kcadm() {
  hub exec -T auth bash -c "KC_CLI_PASSWORD=\"\$KC_BOOTSTRAP_ADMIN_PASSWORD\" $KCADM config credentials \
    --server http://localhost:8080/auth --realm master --user \"\$KC_BOOTSTRAP_ADMIN_USERNAME\" >/dev/null && \
    $KCADM \"\$@\"" kcadm "$@"
}

step "register the collab client, its login theme, roles and test users in realm hub"
added="$(hub_env "$HUB_REPO/bin/add-client" collab confidential /api/auth/callback)"
client_secret="$(sed -n 's/^secret (shown once, store it with the app): //p' <<<"$added")"
[[ -n $client_secret ]] || { echo "check-hub: no client secret from bin/add-client" >&2; exit 1; }
client_id="$(kcadm get clients -r hub -q clientId=collab --fields id --format csv --noquotes)"
for role in editor admin; do
  kcadm create "clients/$client_id/roles" -r hub -s "name=$role"
done
hub_env "$HUB_REPO/bin/set-login-theme" collab

users_json=""
for entry in "${TEST_USERS[@]}"; do
  user="${entry%%:*}" role="${entry#*:}" password="$(rand)"
  kcadm create users -r hub -s "username=$user" -s enabled=true \
    -s "email=$user@example.test" -s emailVerified=true -s "firstName=$user" -s lastName=Test
  kcadm set-password -r hub --username "$user" --new-password "$password"
  roles="[]"
  if [[ -n $role ]]; then
    kcadm add-roles -r hub --uusername "$user" --cclientid collab --rolename "$role"
    roles="[\"$role\"]"
  fi
  users_json+="${users_json:+,}\"$user\":{\"username\":\"$user\",\"password\":\"$password\",\"roles\":$roles}"
done

# The decoy: same role names on another client and in the realm; collab must ignore all three.
kcadm create clients -r hub -s clientId=other-app -s publicClient=false -s "redirectUris=[\"$HUB_URL/other-app/*\"]"
other_id="$(kcadm get clients -r hub -q clientId=other-app --fields id --format csv --noquotes)"
for role in editor admin; do
  kcadm create "clients/$other_id/roles" -r hub -s "name=$role"
done
kcadm create roles -r hub -s name=editor
password="$(rand)"
kcadm create users -r hub -s "username=$OTHER_USER" -s enabled=true \
  -s "email=$OTHER_USER@example.test" -s emailVerified=true -s "firstName=$OTHER_USER" -s lastName=Test
kcadm set-password -r hub --username "$OTHER_USER" --new-password "$password"
kcadm add-roles -r hub --uusername "$OTHER_USER" --cclientid other-app --rolename editor --rolename admin
kcadm add-roles -r hub --uusername "$OTHER_USER" --rolename editor
users_json+=",\"$OTHER_USER\":{\"username\":\"$OTHER_USER\",\"password\":\"$password\",\"roles\":[]}"
# Read by e2e/fixtures.ts, as global-setup.ts writes it for the default project.
printf '{"issuer":"%s","clientId":"collab","users":{%s}}\n' \
  "$HUB_URL/auth/realms/hub" "$users_json" >"$STATE_FILE"

step "another app on the hub ($STUB)"
stub up -d --wait --wait-timeout 90

step "collab on the hub (docker-compose.hub.yml)"
db_password="$(rand)"
cat >"$work/env.hub" <<EOF
APP_BASE_PATH=/collab/
BASE_PATH=/collab
PUBLIC_BASE_URL=$HUB_URL/collab
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$db_password
POSTGRES_DB=collab
DATABASE_URL=postgresql://postgres:$db_password@db:5432/collab
OIDC_ISSUER=$HUB_URL/auth/realms/hub
OIDC_METADATA_URL=http://auth:8080/auth/realms/hub/.well-known/openid-configuration
OIDC_CLIENT_SECRET=$client_secret
ROLE_EDITOR=editor
ROLE_ADMIN=admin
SESSION_COOKIE_KEY=$(rand)
SESSION_MAX_AGE_SECONDS=3600
SANDBOX_IMAGE=collab-sandbox:hub-e2e
SANDBOX_RUNTIME=
EOF
chmod 600 "$work/env.hub"
collab build sandbox
if ! collab up -d --build --wait; then
  collab logs --no-color --tail 50
  exit 1
fi

# The api has no healthcheck; wait until it answers through the hub's proxy.
deadline=$((SECONDS + 60))
until curl -fsS -o /dev/null "$HUB_URL/collab/api/me"; do
  if ((SECONDS > deadline)); then
    echo "check-hub: $HUB_URL/collab/api/me did not answer within 60s" >&2
    collab logs --no-color --tail 50 api
    exit 1
  fi
  sleep 1
done

step "playwright (HUB=1)"
# The specs reach the stack's database and redeploy it through the same compose file and env.
(cd "$ROOT/e2e" && HUB=1 HUB_URL="$HUB_URL" HUB_COLLAB_ENV_FILE="$work/env.hub" \
  HUB_STUB_PATH="/$STUB/" npx --no-install playwright test "$@")

step "hub end-to-end checks passed"
