# 004 — Project hub: shared entry point and identity: notes

## 2026-10-29 — Validation (`/sdd-validate`, fresh context)

**Tasks:** 22/22 ticked in `tasks.md`.

**Suite** (`~/Desktop/ProjectHub/hub`, `scripts/check.sh`, Docker 29.9.2, macOS):

- `ruff check`, `ruff format --check`: clean. `shellcheck` on `bin/`, `check/`,
  `scripts/` (pinned image v0.10.0): clean.
- `check/static.sh` on the real repo: PASS.
- `pytest`: **124 passed, 1 failed** (125 collected, 85 s, integration
  included). The stack was torn down afterwards; no `hub` containers left.
- **Failure:** `tests/test_static.py::test_two_valid_apps_pass` —
  `FAIL FR1: theme keycloak/themes/collab/ has no app snippet collab.caddy`.
  Cause: `run_static_apps()` passes a fixture apps dir but no themes dir, so
  `check/static.sh` falls back to the repo's real `keycloak/themes/`. That
  directory now holds `collab/`, added for 005, and the `apps-good` fixture has
  no `collab.caddy`. This is a test-isolation bug, not a hub defect: the real
  repo passes, because `caddy/apps/collab.caddy` exists. It breaks task 19's
  acceptance line "every fixture that passed task 7's checks still passes", and
  it will recur whenever a real theme is added. Fix: have `run_static_apps`
  pass an empty or fixture themes dir as the third argument.

**Real hub not exercised.** VM 105 (`192.168.178.106`) is reachable over SSH
but runs no containers, and `~` is empty: the hub isn't deployed yet. So
`check/smoke.sh` (all modes) has **not** been run; task 3 deferred that run to
this step. Everything below was checked against the local harness
(`compose.test.yaml`, where the Tailscale sidecar is replaced by a
loopback-bound pause container) and against the config files.

### Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| FR1 — each app's address answered by that app | **pass** (harness) | `test_isolation` (stub-a/stub-b name their own containers), `test_routing` (unknown paths 404). Static snippet rules pass on the real `caddy/apps/`. The one static-test failure above is test isolation, not routing. |
| FR2 — HTTPS, no certificate warning, default trust | **not verified** | Config only: `tailscale/hub.json` serves HTTPS on :443/:8443 with the node's own certificate, and no private CA is in the repo. The harness is plain HTTP by design. Needs `check/smoke.sh --tls` against the deployed hub, from a device off the tailnet. |
| FR3 — nothing answers on any LAN port but the entry point | **partial** | No `ports:` anywhere in `compose.yaml` (static check). In the harness the only host bindings are the stand-in's two loopback ports, and `/auth/admin*` and master give 404 on the public listener. The real LAN scan (`smoke.sh --lan-scan`) has not been run. |
| FR4 — exactly one IdP; two apps both sign in through it | **pass** (harness) | One Keycloak container. Gated stubs sign in via `hub-gateway`; `stub-b` completes an auth-code sign-in on its own client with the same `iss` (`test_add_client`). |
| FR5 — gated: sent to sign in, app gets no request first | **pass** (harness) | `test_gate`: 302 to `/oauth2/start`, empty `stub-a` log, 200 after sign-in, forged `X-Auth-Request-User` replaced; `gated-api` gives 401. |
| FR6 — ungated: answers without a gateway prompt | **pass** (harness) | `test_gate`: `/stub-b/x` gives 200 with no redirect, and forged identity headers are stripped. |
| FR7 — adding an app leaves others and sessions unchanged | **pass** (harness) | `test_add_app` (`stub-c` added, then `bin/reload`; `/stub-a/` unchanged with the same cookie; an invalid snippet keeps the old config). `test_login_theme`: no `auth` restart, and the session survives. |
| FR8 — one app stopped: error for it, others fine | **pass** (harness) | `test_isolation`: stopped `stub-b` gives 502 and `stub-a` gives 200. |
| FR9 — back after reboot, no manual steps | **not verified** | Config only: `restart: unless-stopped` everywhere, pinned Tailscale tag, persistent `ts-hub-state`, and the runbook lists `systemctl enable docker` and the non-ephemeral key. No reboot of the real hub (`smoke.sh --after-reboot`) has been done. |
| FR10 — reset one app's data: sign-in and other data intact | **pass** (harness) | `test_data_isolation`: `data-a` `down -v` and back up; sign-in works, `data-b`'s row is present, `data-a`'s is gone. |
| Memory NFR — ≥2.5 GB of 4 GB left for apps | **pass** (config) | `mem_limit` total 128+64+768+64+256 = 1280 MiB, which leaves 2816 MiB. The static check enforces ≤1536. Real `docker stats` on the hub hasn't been taken. |
| Secrets NFR | **pass** | `.env` git-ignored, `.env.example` has names only, and the secret scan (tracked plus untracked, non-ignored files) passes. |
| Consistency NFR — follows BoarHQ, departures justified | **pass** | Plan §6 lists 8 departures, each with a reason. The config matches them (Funnel on :443 only, admin listener :8443, `admin localhost:2019`, internal redeem/JWKS URLs). |

### Drift and gaps

- **The hub repository has no commits.** `git log` reports no commits on
  `main`; every file is untracked. Spec decision "Configuration home — the hub
  gets a new repository of its own" is met in form only. CLAUDE.md's "keep
  everything under version control" isn't met, and the "`git status` clean
  after a run" acceptance lines (tasks 8, 16, 20, 21) are vacuous while
  everything is untracked: an untracked secret file would not stand out.
  Commit the hub repo before deploying.
- **Hub contents already include 005's app.** `caddy/apps/collab.caddy`
  (ungated, upstream `collab-api:8000`) and `keycloak/themes/collab/` live in
  the hub repo. That matches the hosted-application contract, where snippets
  and themes live in the hub. It is also what exposed the test-isolation bug
  above. No spec change needed.
- No point in `spec.md` changed shape during implementation. The login-theme
  amendment (tasks 19–22) is a plan amendment that sits under FR4 and FR7
  without changing them. **spec.md is not stale.**

### Before sign-off

1. Fix `test_two_valid_apps_pass`'s themes-dir isolation and get the suite
   fully green.
2. Make the hub repo's first commit.
3. Deploy to VM 105 and run `check/smoke.sh` (on the hub, `--tls` off-tailnet,
   `--lan-scan` from another LAN machine, `--after-reboot` after a real reboot).
   Log the output here. FR2, FR3 and FR9 rest on that run.
