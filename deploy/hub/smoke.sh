#!/usr/bin/env bash
# On-hub smoke checks (spec 005, plan §4.4), run on VM 105 from this repo's root after a deploy.
# Prints PASS/FAIL per check and exits non-zero if any check fails.
#   cert      the app's address answers over HTTPS with a certificate curl trusts   (FR1)
#   services  project collab runs exactly db, runner and api                        (FR4)
#   fresh     problem=20, session=0, chat_message=0; only with --fresh              (FR9)
#   memory    with --sample-memory: the peak total of collab + sandbox containers   (Memory)
#
# Usage: deploy/hub/smoke.sh [options]
#   --url URL              the app's address (default: PUBLIC_BASE_URL from the env file, plus /)
#   --skip-cert            only check that URL answers 200; for the local stand-in, which is http
#   --fresh                also run the fresh-deployment counts
#   --sample-memory SECS   sample `docker stats` every 500 ms for SECS seconds, report the peak
#   --max-memory-mb MB     the peak that fails the memory check (default 1024)
#   --env-file PATH        the deployment's env file (default .env.hub)
set -euo pipefail
# awk reads and prints decimals with a point whatever the operator's locale.
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.hub.yml"
# runner/service.py labels every sandbox container with this.
SANDBOX_LABEL=collab-coding.runner
EXPECTED_SERVICES="api db runner"

url="" skip_cert=0 fresh=0 sample_secs=0 max_mb=1024 env_file="$ROOT/.env.hub"
while (($#)); do
  case "$1" in
    --url) url="$2"; shift 2 ;;
    --skip-cert) skip_cert=1; shift ;;
    --fresh) fresh=1; shift ;;
    --sample-memory) sample_secs="$2"; shift 2 ;;
    --max-memory-mb) max_mb="$2"; shift 2 ;;
    --env-file) env_file="$2"; shift 2 ;;
    *) echo "smoke: unknown argument $1" >&2; exit 2 ;;
  esac
done
[[ -f $env_file ]] || { echo "smoke: no env file $env_file" >&2; exit 2; }
[[ $sample_secs =~ ^[0-9]+$ && $max_mb =~ ^[0-9]+$ ]] || {
  echo "smoke: --sample-memory and --max-memory-mb take whole numbers" >&2
  exit 2
}
if [[ -z $url ]]; then
  url="$(sed -n 's/^PUBLIC_BASE_URL=//p' "$env_file" | tail -n 1)/"
fi

collab() { docker compose -f "$COMPOSE_FILE" --env-file "$env_file" "$@"; }

failed=0
pass() { printf 'PASS  %-9s %s\n' "$1" "$2"; }
fail() { printf 'FAIL  %-9s %s\n' "$1" "$2"; failed=1; }

# FR1: the hub's certificate is valid for the app's address (curl verifies it by default).
if ((skip_cert)); then
  status="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  if [[ $status == 200 ]]; then pass cert "$url answers 200 (certificate check skipped)"
  else fail cert "$url answered ${status:-nothing}"; fi
elif [[ $url != https://* ]]; then
  fail cert "$url is not https"
elif curl -fsS -o /dev/null "$url" 2>/dev/null; then
  pass cert "$url answers with a trusted certificate"
else
  fail cert "$url: $(curl -fsS -o /dev/null "$url" 2>&1 | head -n 1)"
fi

# FR4: the app runs its own db, runner and api, and nothing else (no identity provider).
running="$(collab ps --services --status running | sort | xargs)"
if [[ $running == "$EXPECTED_SERVICES" ]]; then pass services "running: $running"
else fail services "running: ${running:-none}, expected: $EXPECTED_SERVICES"; fi

# FR9: a fresh deployment holds the starter set and nothing participants made.
if ((fresh)); then
  # shellcheck disable=SC2016  # $POSTGRES_* expand inside the db container
  counts="$(collab exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tA -F " " -c \
    "select (select count(*) from problem), (select count(*) from session), (select count(*) from chat_message)"' \
    || true)"
  if [[ $counts == "20 0 0" ]]; then pass fresh "problem=20 session=0 chat_message=0"
  else
    read -r problems sessions messages <<<"${counts:-? ? ?}"
    fail fresh "problem=$problems session=$sessions chat_message=$messages, expected 20 0 0"
  fi
fi

# Memory: every container of project collab plus every sandbox, summed per sample.
to_mib() {
  awk '{ v = $1 + 0; u = $1; sub(/^[0-9.]+/, "", u); f = 1
         if (u == "B") f = 1 / 1048576
         else if (u == "KiB" || u == "kB") f = 1 / 1024
         else if (u == "GiB" || u == "GB") f = 1024
         printf "%.1f\n", v * f }'
}
# One sample: the containers running now (sandboxes come and go), their memory summed.
sample() {
  local ids
  ids="$( (docker ps -q --filter label=com.docker.compose.project=collab
    docker ps -q --filter "label=$SANDBOX_LABEL") | sort -u)"
  [[ -n $ids ]] || return 0
  # shellcheck disable=SC2086  # one argument per container id
  docker stats --no-stream --format '{{.MemUsage}}' $ids 2>/dev/null \
    | awk '{ print $1 }' | to_mib | awk '{ s += $1 } END { if (NR) printf "%.1f\n", s }'
}
if ((sample_secs > 0)); then
  # `docker stats --no-stream` takes longer than 500 ms, so samples overlap: one starts
  # every 500 ms and each appends its total.
  totals="$(mktemp)"
  trap 'rm -f "$totals"' EXIT
  deadline=$((SECONDS + sample_secs))
  while ((SECONDS < deadline)); do
    sample >>"$totals" &
    sleep 0.5
  done
  wait
  samples="$(grep -c . "$totals" || true)"
  peak="$(sort -n "$totals" | tail -n 1)"
  report="peak ${peak:-0} MiB over $samples samples, limit ${max_mb} MiB"
  if ((samples == 0)); then fail memory "no collab containers to sample"
  elif awk -v p="$peak" -v m="$max_mb" 'BEGIN { exit !(p <= m) }'; then pass memory "$report"
  else fail memory "$report"; fi
fi

exit "$failed"
