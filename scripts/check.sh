#!/usr/bin/env bash
# Full suite: lint, format, type check, secret scan, tests. Stops at the first failure.
# Usage: scripts/check.sh   (from any directory)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITLEAKS="${GITLEAKS:-$(command -v gitleaks || echo "$HOME/.local/bin/gitleaks")}"

step() { printf '\n==> %s\n' "$*"; }

# Python lives in backend/ plus, once they exist, runner/ and sandbox/.
# All of it is held to backend/pyproject.toml's ruff settings.
py_paths=(.)
for d in runner sandbox; do
  [[ -d "$ROOT/$d" ]] && py_paths+=("../$d")
done

step "ruff check"
(cd "$ROOT/backend" && uv run ruff check --config pyproject.toml "${py_paths[@]}")

step "ruff format --check"
(cd "$ROOT/backend" && uv run ruff format --check --config pyproject.toml "${py_paths[@]}")

step "biome ci"
(cd "$ROOT/frontend" && npx --no-install biome ci .)

step "tsc --noEmit"
(cd "$ROOT/frontend" && npx --no-install tsc --noEmit)

step "gitleaks (git history)"
"$GITLEAKS" git --no-banner --redact "$ROOT"

step "gitleaks (working tree: tracked and untracked, minus .gitignore'd)"
# `gitleaks git` only sees commits, and `gitleaks dir` ignores .gitignore and would scan
# node_modules/.venv/dist. So copy exactly the files git would consider into a scratch dir.
scan_dir="$(mktemp -d)"
trap 'rm -rf "$scan_dir"' EXIT
(
  cd "$ROOT"
  git ls-files -z --cached --others --exclude-standard |
    while IFS= read -r -d '' f; do if [[ -f "$f" ]]; then printf '%s\0' "$f"; fi; done |
    tar --null -T - -cf - | tar -xf - -C "$scan_dir"
)
(cd "$scan_dir" && "$GITLEAKS" dir --no-banner --redact .)

step "test services (docker-compose.test.yml)"
# A throwaway password unless the caller supplies one. Never a literal (constitution rule 7).
# If it differs from a running stack's, compose recreates the container (its data is tmpfs).
if [[ -z "${TEST_DB_PASSWORD:-}" ]]; then
  TEST_DB_PASSWORD="$(openssl rand -hex 16)"
fi
export TEST_DB_PASSWORD
if [[ -z "${TEST_KEYCLOAK_ADMIN_PASSWORD:-}" ]]; then
  TEST_KEYCLOAK_ADMIN_PASSWORD="$(openssl rand -hex 16)"
fi
export TEST_KEYCLOAK_ADMIN_PASSWORD
# --build so a changed runner/ is rebuilt rather than a stale image reused.
docker compose -f "$ROOT/docker-compose.test.yml" up -d --build --wait

step "pytest"
(cd "$ROOT/backend" && uv run pytest)

step "vitest"
(cd "$ROOT/frontend" && npx --no-install vitest run)

if [[ -d "$ROOT/e2e" ]]; then
  step "playwright"
  (cd "$ROOT/e2e" && npx --no-install playwright test)
fi

step "all checks passed"
