# 003 — Apple-style UI overhaul: notes

## AC-23 latency baseline (task 8)

AC-23 baseline median p95: 2.60 ms

- **Commit:** `d1815ef` (spec 001 complete, before any 003 change). The plan named `154f84b`, but that commit has no session WebSocket, collaborative editor or session page, so there was nothing to measure there. 001's remaining work was committed as `d1815ef` and measured instead.
- **Browser:** Chromium from Playwright 1.64.1, headless, against the production compose stack (`docker-compose.yml`) and the test Keycloak, on macOS (Apple-silicon laptop, Docker Desktop).
- **Date:** 2026-10-23.
- **Harness:** `e2e/latency.spec.ts`. One participant makes single-character edits, one at a time, and the other's editor is watched with a `MutationObserver`. Each edit is timed from its `keydown` to its arrival, using `performance.timeOrigin + performance.now()`, which the two pages share in one browser. A round is 50 edits and gives one p95. The result is the median of 5 rounds.
- **Why a median of rounds:** across 9 single 50-edit runs on `d1815ef`, p95 ranged from 2.2 to 3.1 ms, so one round alone can't hold a 10 % bound. Decided with the user on 2026-10-23.
- **Runs on `d1815ef`:** the median p95 was 2.60, 2.40 and 2.60 ms. Rounds within those runs went from 1.4 to 3.4 ms. Chromium reports times in 0.1 ms steps.
- **Limit:** median p95 ≤ 2.60 × 1.1 = 2.86 ms. `/sdd-validate` reruns `npx playwright test latency`.
- **Current tree, 2026-10-25:** median p95 2.30 ms (rounds 2.30, 2.40, 2.20, 2.30, 2.20 ms), Chromium headless, same stack. Passes the 2.86 ms limit.

## 2026-10-29 — Validation (`/sdd-validate`, fresh context)

### Tasks

All 41 tasks in `tasks.md` are ticked, including 39–41, which were blocked on spec 002.

### Test run

| Step | Result |
|---|---|
| ruff, ruff format, biome, tsc, vite build | pass |
| No-Apple-assets check (self-test + `dist/` + `keycloak-theme/`) | pass |
| Keycloak theme token sync | pass |
| gitleaks, git history | pass |
| gitleaks, working tree | **fail**: one finding, a false positive. `.gitleaksignore` pins `specs/004-project-hub-shared-ingress/plan.md:generic-api-key:218`, but that JDBC line (no credential) is now line **238**. The fingerprint went stale when 004's plan was edited. Not a 003 defect, but `scripts/check.sh` stops here, so the steps below were run by hand. |
| pytest (real Postgres + Keycloak) | 484 passed (3 Authlib deprecation warnings) |
| vitest | 34 files, 351 tests passed |
| Playwright (default project) | 60 passed, 0 failed |
| AC-23 latency rerun | median p95 **2.10 ms** (rounds 3.30, 2.40, 2.10, 2.10, 2.10). Limit is 2.86 ms. |

### Acceptance criteria

Checked against behaviour (E2E in a real browser where one exists) and against the code, not just test names.

| AC | Result | Evidence / remark |
|---|---|---|
| AC-1 | **not yet verified** (manual) | The HIG checklist needs a human per screen × appearance. Grep pre-check: no raw font sizes, and no colour literals outside `theme/tokens.css` and `theme/materials.css`. Three 2 px insets are off the 4 pt grid (checklist item 2): `SegmentedControl` padding and gap, and the `RunPanel` badge padding. Likely acceptable, but it's the reviewer's call. |
| AC-2 | pass | `problems.spec.ts`: the sheet opens from state, and the URL and scroll position are kept. |
| AC-3 | pass | `session.spec.ts`: spinner within 100 ms, no dialog. |
| AC-4 | pass | `problems.spec.ts`: rejected save keeps the input, and the message shows beside the field. |
| AC-5 | pass | `appearance.spec.ts` (reduced motion → fade only). |
| AC-6, AC-7, AC-8 | pass | `appearance.spec.ts`. |
| AC-9, AC-10c | pass | spec 001 suites `auth.spec.ts` and `collab.spec.ts` pass on the new UI. |
| AC-10 | pass | `session.spec.ts`. `ProblemSwitcher` is deleted. |
| AC-10a | pass | `signin.spec.ts`: round trip from each screen. |
| AC-10b | pass | `stale.spec.ts` + `GET /api/sessions/stale` integration test. The section is in the problems window sidebar, shown to admins only. |
| AC-11 | pass | `session.spec.ts`. |
| AC-12 | pass (component level) | `ProblemsWindow.test.tsx` and `fields.test.tsx`. No E2E. Filtering is client-side over the full list. |
| AC-13 | pass | `session.spec.ts` (participant and admin). |
| AC-14 | pass | `empty-state.spec.ts`. |
| AC-15, AC-16 | pass | `session-002.spec.ts`. |
| AC-17 | pass | `problems-002.spec.ts`. |
| AC-18 | pass | ⌘↩ in WebKit (mac platform), Ctrl+Enter in Chromium, Esc closes sheet and popover (`keyboard.spec.ts`). |
| AC-18a | pass | `keyboard.spec.ts`. The registry has all 14 FR-17 actions. |
| AC-18b | **pass with caveats** | `registry.test.ts` checks `SHORTCUTS` against `reserved.ts`, so the result is only as good as that table. Two combos aren't in it and need a human check in real browsers: (1) **⌘F / Ctrl+F** (focus search) replaces the browser's find-in-page on the problems screen. Pages can intercept it, so it works, but it takes over a browser function. (2) **⇧⌘/** (shortcut list) is macOS's Help-menu search (⌘?). In Safari and Chrome on macOS the menu bar may take it before the page sees it. Neither was tested in a headed Safari. |
| AC-18c | pass | `keyboard.spec.ts` (problems, session, empty state). |
| AC-18d | pass | `signin.spec.ts` (dark, light, override, failed-login page). |
| AC-19 | pass | `scripts/check-no-apple-assets.sh`. The font stack is `system-ui, -apple-system, …`, and no font or icon files are shipped. |
| AC-20, AC-21 | pass, with gaps | `a11y.spec.ts`, axe at 1024×768 in both appearances on: problems, problem sheet, session, stale session, empty state, Keycloak login. **Not covered:** the forbidden page, the shortcut-list sheet, the appearance popover, the pre-join name prompt. |
| AC-22 | **pass in Chromium only** | Test is skipped outside Chromium (CDP emulation). The CSS relies on `@media (prefers-reduced-transparency: reduce)`. As far as I know, Safari and Firefox don't support that query. On a Mac with "Reduce transparency" on, Safari users probably still get translucent sidebars and toolbars. Not verified in a real Safari. |
| AC-23 | pass | 2.10 ms vs a 2.86 ms limit (see above). |

### Drift and gaps

1. **Browser coverage is narrower than the plan says.** `plan.md` (Test strategy) says E2E runs in Chromium, WebKit and Firefox. `e2e/playwright.config.ts` has one project, Chromium by default. Only the ⌘↩ test launches WebKit, and Firefox is never run. NFR-3 (Safari, Chrome, Firefox, Edge) is therefore only evidenced for Chromium. **plan.md is stale on its test-strategy browser matrix.** Either add WebKit and Firefox projects or correct the plan.
2. **Ctrl+Alt shortcuts are layout-dependent (FR-17, FR-20).** Off macOS, six shortcuts use Ctrl+Alt+key (sidebar, run panel, chat, invite link, next and previous problem). `shortcuts/keys.ts` ignores Ctrl+Alt when it types a character (AltGr), which is right for text entry. The cost is that on layouts such as Polish or German, some of these shortcuts don't fire at all (e.g. Ctrl+Alt+S types ś). FR-20 says "every shortcut works in every supported browser".
   **spec.md is now stale on: FR-17/FR-20. Shortcuts that use Ctrl+Alt off macOS are not guaranteed on keyboard layouts where that combo is AltGr. Either accept and state that limitation, or require different combos. Update it before the next change to this feature.**
3. **⌘F and ⇧⌘/ (see AC-18b).** FR-20's examples don't cover find-in-page or the macOS Help menu, so the spec is silent on whether those may be taken. Decide, and if needed state it in FR-20.
4. **Reduce transparency outside Chromium (see AC-22).** NFR-4 and AC-22 have no browser limit in the spec. If Safari can't detect the setting, either the spec should accept "where the browser exposes the setting" or the design needs a different fallback. **spec.md is now stale on: NFR-4/AC-22 browser scope for "reduce transparency". Update it before the next change to this feature.**
5. **Out-of-feature:** the `.gitleaksignore` fingerprint for spec 004's plan (line 218 → 238) blocks `scripts/check.sh`. One-line fix, but in 004's territory.
6. `specs/README.md` still lists 003 as `approved`. Moving it is the human's call.
