#!/usr/bin/env bash
# Spec 003 NFR-1 / AC-19: the built app and the sign-in theme ship no Apple-licensed
# assets and don't present themselves as Apple's. Fails on:
#   - any font file (.otf .ttf .woff .woff2): fonts are referenced by family name only
#   - anything named or referring to apple-touch-icon
#   - the words "Apple", "macOS" or "SF Pro" in shipped text
# Allowed: "Apple Computer", the navigator.vendor string bundled code uses to detect
# Safari. It is a browser check, never shown to the user.
#
# Usage: scripts/check-no-apple-assets.sh [dir ...]   (default: frontend/dist, keycloak-theme)
#        scripts/check-no-apple-assets.sh --self-test
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

scan() {
  local found=0 dir hits
  for dir in "$@"; do
    [[ -d "$dir" ]] || continue
    hits="$(find "$dir" -type f \( -iname '*.otf' -o -iname '*.ttf' -o -iname '*.woff' \
      -o -iname '*.woff2' -o -iname '*apple-touch-icon*' \) -print)"
    if [[ -n "$hits" ]]; then
      printf 'font or apple-touch-icon file:\n%s\n' "$hits"
      found=1
    fi
    hits="$(grep -rInE -o '.{0,40}(\bApple\b|\bmacOS\b|\bSF Pro\b|apple-touch-icon).{0,40}' "$dir" |
      grep -vE 'Apple Computer' || true)"
    if [[ -n "$hits" ]]; then
      printf 'Apple branding in text:\n%s\n' "$hits"
      found=1
    fi
  done
  return "$found"
}

self_test() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  mkdir -p "$tmp/font" "$tmp/text" "$tmp/clean"
  : >"$tmp/font/display.woff2"
  printf '<p>Set in SF Pro</p>\n' >"$tmp/text/index.html"
  printf 'const safari = /Apple Computer/.test(navigator.vendor);\n' >"$tmp/clean/app.js"
  if scan "$tmp/font" >/dev/null; then echo "self-test: a .woff2 was not caught"; return 1; fi
  if scan "$tmp/text" >/dev/null; then echo "self-test: \"SF Pro\" was not caught"; return 1; fi
  if ! scan "$tmp/clean"; then echo "self-test: a clean directory failed"; return 1; fi
  echo "self-test passed"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit
fi

if [[ $# -eq 0 ]]; then
  [[ -d "$ROOT/frontend/dist" ]] || { echo "frontend/dist missing: build the frontend first"; exit 1; }
  set -- "$ROOT/frontend/dist" "$ROOT/keycloak-theme"
fi

if scan "$@"; then
  echo "no Apple assets found"
else
  exit 1
fi
