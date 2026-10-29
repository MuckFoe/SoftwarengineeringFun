#!/usr/bin/env bash
# Spec 003 FR-18: the Keycloak login theme copies the app's design tokens (a different
# origin, so nothing is shared at runtime). Fails when any custom property in
# frontend/src/theme/tokens.css (light :root and dark blocks) differs from the copy between
# "tokens:begin" and "tokens:end" in keycloak-theme/collab/login/resources/css/collab.css.
#
# Usage: scripts/check-theme-tokens.sh [tokens.css collab.css]
#        scripts/check-theme-tokens.sh --self-test
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKENS="$ROOT/frontend/src/theme/tokens.css"
COLLAB="$ROOT/keycloak-theme/collab/login/resources/css/collab.css"

compare() {
  python3 -I - "$1" "$2" <<'PY'
import re, sys

def blocks(css):
    css = re.sub(r"/\*[\s\S]*?\*/", "", css)
    found = {}
    for selector in (":root", ':root[data-appearance="dark"]'):
        m = re.search(r"(^|\})\s*" + re.escape(selector) + r"\s*\{([^}]*)\}", css)
        props = {}
        for decl in (m.group(2) if m else "").split(";"):
            d = re.match(r"\s*(--[\w-]+)\s*:\s*(.+?)\s*$", decl, re.S)
            if d:
                props[d.group(1)] = " ".join(d.group(2).split())
        found[selector] = props
    return found

tokens_css = open(sys.argv[1]).read()
collab_css = open(sys.argv[2]).read()
region = re.search(r"tokens:begin\s*\*/([\s\S]*?)/\*\s*tokens:end", collab_css)
if not region:
    sys.exit(f"{sys.argv[2]}: no tokens:begin / tokens:end region")
want, have = blocks(tokens_css), blocks(region.group(1))
problems = []
for selector in want:
    for name in sorted(set(want[selector]) | set(have[selector])):
        a, b = want[selector].get(name), have[selector].get(name)
        if a != b:
            problems.append(f"  {selector} {name}: tokens.css={a!r} collab.css={b!r}")
if problems:
    print("collab.css tokens differ from tokens.css:")
    print("\n".join(problems))
    sys.exit(1)
PY
}

self_test() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  cp "$TOKENS" "$tmp/tokens.css"
  cp "$COLLAB" "$tmp/collab.css"
  compare "$tmp/tokens.css" "$tmp/collab.css" >/dev/null || {
    echo "self-test: the current files already differ"
    return 1
  }
  # Change one colour in tokens.css only.
  perl -pe 's/--accent: #[0-9a-fA-F]+;/--accent: #123456;/ if !$done && /--accent: #/ && ($done = 1)' \
    "$tmp/tokens.css" >"$tmp/changed.css"
  if cmp -s "$tmp/tokens.css" "$tmp/changed.css"; then
    echo "self-test: could not change --accent in the copy"
    return 1
  fi
  if compare "$tmp/changed.css" "$tmp/collab.css" >/dev/null; then
    echo "self-test: a changed colour was not caught"
    return 1
  fi
  echo "self-test passed"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit
fi

compare "${1:-$TOKENS}" "${2:-$COLLAB}"
echo "theme tokens in sync"
