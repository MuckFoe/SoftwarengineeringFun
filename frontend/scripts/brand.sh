#!/usr/bin/env bash
# Spec 015 plan 1.6: fill the brand-assets cache on the host, then write brand.css.
# Run before `docker compose up`; the serving image has no Node, so it mounts the result.
# Never fails the deploy: a missing logo just means the app name shows alone.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="${BRAND_DIR:-$here/../../brand-assets}"
mkdir -p "$dir"
if ! ls "$dir"/logo.svg "$dir"/logo.png >/dev/null 2>&1; then
  node "$here/fetch-brand-logo.mjs" --dir "$dir" || echo "warn: brand.sh: logo fetch failed" >&2
fi
node "$here/brand-assets.mjs" --dir "$dir"
