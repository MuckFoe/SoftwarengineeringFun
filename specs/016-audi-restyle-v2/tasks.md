# 016 — Audi restyle v2: tasks

## Plan corrections found while resolving the [CONFIRM] items

Read from the code, not from the spec folder. These are where the plan's guess was wrong. The tasks below follow the code. **Approve or amend plan.md before implementing.**

1. **Tokens and theme already exist.** `frontend/src/styles/tokens.css` (pinned to `kit-values.json` by `tokens.test.ts`, guarded by `guard.test.ts`) is the single source. The theme attribute is `data-appearance` and the storage key is `appearance` (`theme/appearance.ts`, inline script in `index.html`, `theme/useAppearance.ts`). The plan's `data-theme`, `localStorage["theme"]` and new `ThemeProvider` are **not** used: extend and restyle what is there. Task 1 and task 12 edit the tests that pin spec 015 values.
2. **`ui/` already holds Button, Card, ChatBubble, Menu, Popover, InviteLink (with a copy button and toast), AppHeader, AppearanceToggle, Tabs.** Tasks restyle these in place. Only `LiveBadge`, `Dock`, `JumpBar`, `LightLine` and `RunSummaryStrip` are new.
3. **Area label.** The header and `AreaNav.tsx` call the first area **"Problems"** (route `/`). FR-16 and the plan say **"Sessions"**. Task 15 uses "Sessions" as the dock label for the same route and leaves the sidebar `AreaNav` untouched. If you want "Problems" kept, say so.
4. **There is no "live" flag today.** `RecentSession` (`GET /api/me/sessions`) has `stale` and `last_activity_at` only, and `GameInfo` has none. FR-2 and FR-5 cannot be met from existing data, so the plan's "no new requests" does not hold. Task 13 adds one additive boolean `live` to the existing sessions-list rows, taken from the in-memory hubs (at least one connected participant). No new endpoint, no migration. **This is a back-end change the plan did not list; confirm it.**
5. **Run reporting design differs from the plan.** Code runs in a throwaway Docker container started by `runner/service.py`, with each test case in a forked child inside `sandbox/harness.py`. `resource.getrusage(RUSAGE_CHILDREN)` in the API would measure the `docker` client, not the solution. Task 8 measures inside the sandbox harness instead: peak RSS of each case's child via `os.wait4`, and wall time per case. The runner reports them as new optional per-case fields and the API reports the maximum memory and the total time. Still the stdlib only, no new dependency.
6. **"Examples" are the problem's tests.** `grading.py` already gives one outcome per test, and the API never exposes args or expected values. `examples_passed` and `examples_total` are therefore counts over `results` (passed / total), computed in the API. There is no separate "examples" concept to add.
7. **No persistence change.** `runs_repo` stores results; time and memory are **not** stored. The strip is filled from the `run_finished` message; after a reload (`last_run`) it shows only passed/total and omits time and memory. This follows FR-17 "omitted, not shown as zero" and avoids a migration. If you want them kept across reloads, that is a schema change and needs a plan amendment.
8. **FR-13 handling differs from the plan.** The plan wanted one dedicated task listing every edited 015-shape assertion. Doing that last would leave the suite red between tasks (constitution: green before done). Instead each task edits only the 015-shape assertions its change breaks and lists them in its commit message; task 27 audits the whole diff to confirm nothing else was loosened.
9. **⌘K may collide.** `frontend/src/shortcuts/reserved.ts` and `registry.ts` already govern key bindings. Task 18 registers ⌘K / Ctrl+K through that registry and resolves any conflict there.
10. **Hub self-registration and the Keycloak theme.** The hub self-registration UI is covered by `e2e/audi/self-registration.spec.ts`. Its component is not under `frontend/src` by name; task 25 locates it. `keycloak-theme/` is in the repo and gets the same tokens by its own copy.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 8 — all `[P]` | Tokens are the base of every UI task. The sandbox measurement is independent of the front end. |
| 2 | 2, 3, 4, 5, 6, 7, 9, 10, 13, 17 — all `[P]` | Each needs only the tokens (or only task 8), and they touch separate files. |
| 3 | 11, 12, 14, 15, 19 — all `[P]` | Need the primitives or data from wave 2. Different files each. |
| 4 | 16 | Edits the header (as 14 does) and needs the dock from 15, so it follows both. |
| 5 | 18, 20, 21, 22, 23, 24, 25, 26 — all `[P]` | The jump bar, and the per-screen restyle that needs the primitives, the shell and the checks. Separate files. |
| 6 | 27 | Full-suite gate, audit and baselines after everything has landed. |

## Checklist

- [x] **1** — `[P]` v2 design tokens (palette, radii, glow, edge-light, motion, z, dock) and their pinned tests
- [x] **2** — `[P]` Contrast and no-literal guards for the v2 tokens
- [x] **3** — `[P]` E2E v2 check helpers (shape, tone, accent, reduced motion, viewport)
- [x] **4** — `[P]` Button v2 (pill, glow, states)
- [x] **5** — `[P]` Card / tile with edge-light
- [x] **6** — `[P]` Chat bubble v2
- [x] **7** — `[P]` LiveBadge (pulsing dot and "Live")
- [x] **8** — `[P]` Sandbox and runner measure memory and time per case
- [x] **9** — `[P]` API reports time, memory and examples passed/total
- [x] **10** — `[P]` `formatRunSummary` and `RunSummaryStrip`
- [x] **11** — `[P]` Show the run summary strip under the editor
- [x] **12** — `[P]` Appearance menu v2 (floating, icons, keyboard)
- [x] **13** — `[P]` `live` on session rows and `useAnyLive`
- [x] **14** — `[P]` Header vent texture and light line
- [x] **15** — `[P]` Bottom dock component
- [x] **16** — Mount the dock, remove header tabs, reserve space
- [x] **17** — `[P]` Jump index and filter
- [x] **18** — `[P]` Jump bar UI and ⌘K
- [x] **19** — `[P]` Invite link copy button v2
- [x] **20** — `[P]` Screens: session editor, run output, scratch run
- [x] **21** — `[P]` Screens: interactive learning
- [x] **22** — `[P]` Screens: chat pane and GIF search
- [x] **23** — `[P]` Screens: presentation
- [x] **24** — `[P]` Screens: Games and chess
- [x] **25** — `[P]` Screens: problems, profile, sign-in landing, not found, hub self-registration, Keycloak theme
- [x] **26** — `[P]` Brand assets under v2 (FR-12)
- [ ] **27** — Full-suite gate, FR-13 audit, NFR sweeps and baselines

## Tasks

### 1. `[P]` v2 design tokens

- **Plan:** Front end 1 (design tokens). **Spec:** FR-1, FR-10, FR-11, Consistency.
- **Files:** `frontend/src/styles/tokens.css`, `frontend/src/styles/kit-values.json`, `frontend/src/styles/tokens.test.ts`
- **Depends on:** nothing
- **Do:** Replace the spec 015 values with the v2 set in the existing `:root`, `[data-appearance="light"]`, `[data-appearance="dark"]` and the `prefers-color-scheme` block. Add the plan's token names: `--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--accent`, `--accent-hover`, `--accent-press`, `--on-accent`, `--glow`, `--danger`, `--edge-light`, `--radius-pill`, `--radius-card`, `--motion-fast`, `--motion-sweep`, `--z-dock`, `--z-header`, `--z-menu`, `--dock-height`, `--bp-narrow`. Accent is blue; red is `--danger` only. Under `prefers-reduced-motion: reduce` set the `--motion-*` tokens to `0s`. Keep existing token names that components still use, so nothing else breaks yet. Update `kit-values.json` and `tokens.test.ts` for the changed values only.
- **Acceptance:**
  - *FR-1 — Given any screen, when shown, then the only accent colour is the blue.* Test: the accent family is blue-hued in both themes, and `--danger` is the only red.
  - *FR-10 — Given the system prefers dark with no in-app choice, when any screen loads, then the dark palette is used.* Test: with no `data-appearance`, the dark block applies under the media query; an explicit `data-appearance` overrides it.
  - *FR-11 — transitions are skipped for reduced motion.* Test: under reduced motion every `--motion-*` resolves to `0s`.
  - *Consistency — one source of visual values.* Test: every plan token name is defined in both themes where it differs.

### 2. `[P]` Contrast and no-literal guards

- **Plan:** Front end 1; Test strategy (NFR Accessibility, NFR Consistency). **Spec:** FR-4, Accessibility, Consistency.
- **Files:** `frontend/src/styles/contrast.test.ts`, `frontend/src/styles/guard.test.ts`
- **Depends on:** 1
- **Do:** Extend the existing contrast test to the v2 pairs: text on `--bg`, `--surface`, `--surface-2`; `--on-accent` on `--accent`, `--accent-hover`, `--accent-press`; `--accent` as a boundary on its backgrounds; `--danger` on its backgrounds. Light and dark. Extend the existing guard so no colour, radius or duration literal appears in any `*.css`, `*.module.css` or `*.tsx` outside `tokens.css`. Files that still fail the guard are listed in a temporary allowlist in the test that tasks 4–7, 12, 14–16, 18–25 each shrink; task 27 asserts the allowlist is empty.
- **Acceptance:**
  - *FR-4 — its text meets 4.5:1 contrast, in light and dark.* Test: each text/surface pair ≥ 4.5, each boundary ≥ 3.
  - *Consistency.* Test: the guard fails on a planted literal and passes once the allowlist is empty.

### 3. `[P]` E2E v2 check helpers

- **Plan:** Test strategy (FR-1, FR-9, NFR Responsive). **Spec:** FR-1, FR-9, FR-3, Responsive.
- **Files:** `e2e/audi/checks.ts`, `e2e/audi/matrix.ts`
- **Depends on:** 1
- **Do:** Replace the spec 015 shape checks with v2 helpers: `expectV2Look(page)` (primary controls and cards have computed `border-radius` ≥ the token radius; region backgrounds differ by tone; regions carry no border; the only non-neutral hue among computed colours is the accent family, plus danger on error), `expectNoOverflow(page)` (`scrollWidth <= clientWidth`), `expectReducedMotion(page)`. Keep the matrix of screens and widths; add the screens this spec names (editor, run output, learning, GIF search, presentation, hub self-registration, Games with chess as a guest via invite link). The per-screen specs (tasks 20–25) call these helpers.
- **Acceptance:**
  - *FR-1 — pill-shaped controls, rounded cards, tone not outlines, only the blue accent.* Check: the helper has a failing case against a fixture element with a square outlined control, and passes on a v2 element.
  - *FR-9 — each listed screen passes the FR-1 check.* Check: the matrix lists every screen named in FR-9, including the guest chess invite.

### 4. `[P]` Button v2

- **Plan:** Front end 2 (Button). **Spec:** FR-7, FR-11.
- **Files:** `frontend/src/ui/Button.tsx`, `frontend/src/ui/Button.module.css`, `frontend/src/ui/Button.test.tsx`
- **Depends on:** 1
- **Do:** Variants `primary` (solid accent pill with `--glow`), `secondary` (outlined or tonal pill, no glow) and `danger`. Distinct hover, focus-visible, active, disabled and error styles, using `--motion-fast`. Remove this file's allowlist entries from task 2's guard.
- **Acceptance:**
  - *FR-7 — Given a primary action, then it is a solid accent pill with a glow; given a secondary action, then it is outlined or tonal.* Test: computed background is the accent and `box-shadow` is non-empty on primary; secondary has neither.
  - *FR-11 — Given a button hovered, focused, pressed, disabled or in error, then each state is visually distinct and transitions smoothly (instantly under reduced motion).* Test: the five states give different computed styles; transition duration is non-zero normally and zero under reduced motion.

### 5. `[P]` Card / tile with edge-light

- **Plan:** Front end 2 (Card / Tile). **Spec:** FR-1, FR-4.
- **Files:** `frontend/src/ui/Card.tsx`, `frontend/src/ui/card.css`, `frontend/src/ui/card.test.tsx`
- **Depends on:** 1
- **Do:** Large radius (`--radius-card`), tone background, no border. The edge light is a `::before` with a masked `linear-gradient` strongest at the top-left, `pointer-events: none`, under the content. Clear this file's guard allowlist entries.
- **Acceptance:**
  - *FR-4 — Given a tile, when shown in light and dark, then it has an edge-light border strongest at one corner and its text meets 4.5:1 contrast.* Test: `::before` has a gradient whose strongest stop is at one corner; `pointer-events: none`; content is above it; text/surface contrast ≥ 4.5 in both themes.
  - *FR-1 — cards are rounded, separated by tone.* Test: radius ≥ `--radius-card`, background differs from the page background, no border.

### 6. `[P]` Chat bubble v2

- **Plan:** Front end 2 (ChatBubble). **Spec:** FR-8.
- **Files:** `frontend/src/ui/ChatBubble.tsx`, `frontend/src/ui/chat.css`, `frontend/src/ui/chat.test.tsx`
- **Depends on:** 1
- **Do:** Rounded on three corners, one near-zero corner (the pointed one). The user's own bubble uses the accent background and `--on-accent`; others use a neutral tone.
- **Acceptance:**
  - *FR-8 — Given a chat with messages from the user and others, when shown, then bubbles are rounded with one pointed corner and the user's own are accent-coloured.* Test: own bubble has the accent background, three equal radii and one near-zero; another's bubble does not use the accent.

### 7. `[P]` LiveBadge

- **Plan:** Front end 2 (LiveBadge). **Spec:** FR-5, FR-3.
- **Files:** `frontend/src/ui/LiveBadge.tsx`, `frontend/src/ui/LiveBadge.module.css`, `frontend/src/ui/LiveBadge.test.tsx`
- **Depends on:** 1
- **Do:** A dot plus the visible text "Live". The dot pulses with one keyframe whose duration is `--motion-sweep`-based; under reduced motion the animation is `none`. No other animation.
- **Acceptance:**
  - *FR-5 — Given a live session, when listed, then it shows a pulsing dot and a "Live" tag.* Test: badge text is "Live"; the dot has a non-`none` animation.
  - *FR-3 — Given reduced motion is preferred, then no pulse runs.* Test: the dot's `animation-name` is `none` under reduced motion and the text remains.

### 8. `[P]` Sandbox and runner measure memory and time per case

- **Plan:** Back end (memory measurement), as corrected in item 5 above. **Spec:** FR-17.
- **Files:** `sandbox/harness.py`, `runner/service.py` (and the existing runner/sandbox tests next to them)
- **Depends on:** nothing
- **Do:** In `run_case`, wait for the forked child with `os.wait4` and read its `ru_maxrss` (KB on Linux), and time the case with `time.monotonic`. Add optional `memory_kb` and `duration_ms` to a finished case's result line (`ok` and `error` only; absent for `timeout` and `memory`). Pass them through the runner's `/execute` response unchanged. The runner stays ignorant of problems.
- **Acceptance:**
  - *FR-17 — the figures match the run's actual result.* Test (real sandbox image): a case that allocates about 50 MB reports `memory_kb` above 40 000 and a case that does nothing reports far less; `duration_ms` is above 0 and within the case's wall time.
  - *FR-17 — a run that has not finished omits the figures.* Test: a case that times out or exceeds memory has neither field.

### 9. `[P]` API reports time, memory and examples passed/total

- **Plan:** Back end (examples), Contracts (run result). **Spec:** FR-17.
- **Files:** `backend/app/runs/runner_client.py`, `backend/app/runs/service.py`, `backend/app/sessions/ws.py` (plus integration tests)
- **Depends on:** 8
- **Do:** `CaseOutcome` carries optional `memory_kb` and `duration_ms`. `RunResult` gains `duration_ms` (sum), `memory_kb` (maximum), `examples_passed` and `examples_total` (counts over `results`). All are `null` when the run did not finish: status `infra_error`, or any case `time_limit_exceeded` or `memory_limit_exceeded`; examples are `null` when `results` is empty. The `run_finished` message gets the four fields; `last_run` gets only `examples_passed` and `examples_total` (nothing is stored, see item 7). Both example fields are null or both set, with `0 ≤ passed ≤ total`. Existing fields are unchanged.
- **Acceptance:**
  - *FR-17 — Given a finished run of a problem with examples, then the figures match the run's actual result.* Test (real runner): a known fixture gives `memory_kb > 0` and `examples_passed/examples_total` equal to the fixture; one failing example gives passed = total − 1.
  - *FR-17 — Given a run that has not finished, or a problem without examples, then the missing figures are omitted, not zero.* Test: a timeout gives `null` for all four; a problem with no tests gives `null` examples.

### 10. `[P]` `formatRunSummary` and `RunSummaryStrip`

- **Plan:** Front end 7, Front-end interfaces (`RunSummary`). **Spec:** FR-17.
- **Files:** `frontend/src/api/types.ts`, `frontend/src/components/runSummary.ts`, `frontend/src/components/RunSummaryStrip.tsx` (plus `.module.css` and tests)
- **Depends on:** 1
- **Do:** Add the optional fields to the `RunResult` type. Pure `formatRunSummary(r)` returns `{label, value}[]` for time, memory and "passed/total", omitting any missing or null figure and keeping a legitimate `0` passed. `RunSummaryStrip` renders it as a quiet tone strip.
- **Acceptance:**
  - *FR-17 — the missing figures are omitted, not shown as zero.* Test: undefined or null fields yield no entry; `examplesPassed: 0, examplesTotal: 4` yields "0/4".
  - *FR-17 — time, memory use and examples passed out of the total appear in a strip.* Test: with all fields set the strip shows three labelled figures.

### 11. `[P]` Show the run summary strip under the editor

- **Plan:** Front end 7. **Spec:** FR-17.
- **Files:** `frontend/src/pages/SessionWindow.tsx`, `frontend/src/components/RunPanel.tsx`, `e2e/session-002.spec.ts` (or a new e2e spec file)
- **Depends on:** 9, 10
- **Do:** Keep the last `run_finished` figures in the session's run state and render `RunSummaryStrip` beneath the editor, alongside the existing output. No strip before a run. After a reload only the examples count shows.
- **Acceptance:**
  - *FR-17 — Given a finished run of a problem with examples, when shown, then time, memory use and examples passed out of the total appear in a strip under the editor, and the figures match the run's actual result.* Test (E2E): after a run the strip's figures equal the `run_finished` message.
  - *FR-17 — Given a run that has not finished, then the missing figures are omitted.* Test (E2E): before any run no strip is shown; after a timeout no zero figures appear.

### 12. `[P]` Appearance menu v2

- **Plan:** Front end 4 (as corrected in item 1). **Spec:** FR-6, FR-10.
- **Files:** `frontend/src/ui/AppearanceToggle.tsx`, `frontend/src/ui/AppearanceToggle.test.tsx`, `e2e/audi/appearance.spec.ts`
- **Depends on:** 1, 4
- **Do:** Turn the toggle into a trigger plus a floating panel (`role="menu"`, three `menuitemradio` items Light/Dark/System, each with an icon, the current one with a check and `aria-checked`). Render it in a portal on `document.body`, `position: fixed`, placed from the trigger's rect and clamped to the viewport on open and on resize, at `--z-menu`. ArrowDown/ArrowUp move focus with wrap, Enter applies, Escape closes and returns focus to the trigger, an outside click closes. Keep `theme/appearance.ts`, the key and the attribute as they are. Edit only the 015-shape assertions this breaks.
- **Acceptance:**
  - *FR-6 — Given the appearance control, when activated, then the panel lists Light, Dark and System with icons, highlights and checks the current choice, and is entirely within the viewport above all content.* Test: items, icons and `aria-checked`; the bounding box is inside the viewport at several widths with the trigger near the edge; `elementFromPoint` at its centre is the panel.
  - *FR-6 — Given the panel is open, when the user presses ArrowDown, ArrowUp, Enter or Escape, then focus moves, the choice is applied, or the panel closes.* Test: each key.
  - *FR-10 — Given the user picks light in the menu, then light is shown immediately and after reload.* Test (E2E): choose Light under an emulated dark system, check, reload, check; choosing System removes the stored value and the emulated scheme drives the palette without reload.

### 13. `[P]` `live` on session rows and `useAnyLive`

- **Plan:** Front end 3 (`useAnyLive`), corrected in item 4. **Spec:** FR-2, FR-5.
- **Files:** `backend/app/accounts/api.py` (the `/api/me/sessions` row), `frontend/src/api/types.ts`, `frontend/src/pages/useAnyLive.ts`
- **Depends on:** nothing
- **Do:** Add `live: bool` to each `GET /api/me/sessions` row: true when its hub has at least one connected participant (coding, learning, presentation and chess). `RecentSession` gains `live`. `useAnyLive()` returns true when any session in the list the user can see is live. No new endpoint, no migration, no new request beyond the list the app already fetches. Games with no session row cannot be live.
- **Acceptance:**
  - *FR-2 — Given a live session or game is visible to the user.* Test (integration): a row with a connected participant has `live: true`, an idle one `false`.
  - *FR-5 — Given an idle session, then it shows neither.* Test: `useAnyLive` is false for an all-idle list and true when one row is live.

### 14. `[P]` Header vent texture and light line

- **Plan:** Front end 3. **Spec:** FR-2, FR-3, Performance.
- **Files:** `frontend/src/ui/AppHeader.tsx`, `frontend/src/ui/appHeader.css`, `frontend/src/ui/AppHeader.test.tsx`
- **Depends on:** 1, 13
- **Do:** A static vent texture (`repeating-linear-gradient` with a mask-image fade) on the header's pseudo-element. A 1–2 px light line under the header whose gradient child sweeps by `transform: translateX` only, running only when the header has `is-live` (from `useAnyLive()`, toggled after mount). Under `prefers-reduced-motion: reduce` the sweep is `animation: none`. Clear this file's guard allowlist entries.
- **Acceptance:**
  - *FR-2 — Given a live session or game is visible, when the header is shown, then the vent texture fades out behind it and a light line moves across.* Test: with a live session the header has `is-live` and the line's `animation-name` is not `none`; the pseudo-element has a gradient `mask-image`.
  - *FR-2 — Given nothing live is visible, then the light line is static.* Test: `animation-name` is `none`.
  - *FR-3 — Given reduced motion is preferred, then the light line is static and no vent, pulse or sweep animation runs.* Test (E2E, `reducedMotion: "reduce"`): every animation on the page has `animation-name: none` or zero duration.
  - *Performance — no jank.* Test: the keyframes animate only `transform`.

### 15. `[P]` Bottom dock component

- **Plan:** Front end 6. **Spec:** FR-16.
- **Files:** `frontend/src/ui/Dock.tsx`, `frontend/src/ui/Dock.module.css`, `frontend/src/ui/Dock.test.tsx`
- **Depends on:** 1, 4
- **Do:** A fixed, centred pill at the bottom at `--z-dock`, with Sessions (`/`), Learn, Present and Games as links with icon and label, `aria-current="page"` on the current one (reuse `currentArea`). Items given a `disabledReason` render with `aria-disabled="true"`, not as links, with the reason in `aria-describedby` and a title. Under `--bp-narrow` the labels are hidden and each item keeps an `aria-label`. Which items a guest may use is passed in by the caller from today's permissions (task 16 reads them); this task does not decide it.
- **Acceptance:**
  - *FR-16 — Given a signed-in user, when any main area is shown, then a bottom pill dock lists Sessions, Learn, Present and Games with the current one highlighted.* Test: four items, `aria-current` on the current one; activating another navigates.
  - *FR-16 — Given a guest, then areas they cannot use are disabled with an accessible reason.* Test: `aria-disabled` and a described-by reason.
  - *FR-16 — Given a narrow viewport, then it stays at the bottom with icons only, each with an accessible name.* Test: labels hidden, each item has `aria-label`.

### 16. Mount the dock, remove header tabs, reserve space

- **Plan:** Front end 6 (shell padding, full-screen heights). **Spec:** FR-16, FR-13.
- **Files:** `frontend/src/ui/AppHeader.tsx`, `frontend/src/ui/Window.module.css`, `frontend/src/ui/AppHeader.test.tsx` (plus `Window.tsx` if the shell lives there)
- **Depends on:** 14, 15
- **Do:** Remove `Tabs` from the header and mount `Dock` once in the shell for every screen, signed in, guest and chess invitee. Work out the guest and invitee disabled set from the existing role checks (`RequireRole`, `useMe`) without changing permissions. The shell gets `padding-bottom: calc(var(--dock-height) + env(safe-area-inset-bottom) + gap)`, and full-screen layouts use `height: calc(100dvh - header - dock)`. Edit only the header-tab assertions that this breaks.
- **Acceptance:**
  - *FR-16 — Given a long page, when scrolled to the end, then the last content is fully visible above the dock.* Test (E2E): the last element's bottom is at most the dock's top.
  - *FR-16 — Given a guest, then the disabled areas match what they cannot use today.* Test (E2E): as a guest and as a chess invitee the disabled set equals the pre-change permissions.
  - *FR-13 — preserves existing keyboard behaviour.* Test: the existing keyboard specs pass.

### 17. `[P]` Jump index and filter

- **Plan:** Front end 5 (`useJumpIndex`, `filterJump`). **Spec:** FR-15.
- **Files:** `frontend/src/shell/jump.ts`, `frontend/src/shell/useJumpIndex.ts`, `frontend/src/shell/jump.test.ts`
- **Depends on:** nothing
- **Do:** The pure `filterJump(items, query)` (case-insensitive substring; stable order: areas, then sessions, then problems). `useJumpIndex()` assembles `JumpItem[]` from the static areas, the recent-sessions list and the problems list the app already loads; if the problems list is lazy, the first open triggers the same existing fetch. No new endpoint.
- **Acceptance:**
  - *FR-15 — When they type, then matching sessions, problems and app areas are listed (using only what the app already lists).* Test: matching is case-insensitive, areas come before sessions before problems, an empty query lists everything.
  - *FR-15 — no new search data.* Test: `useJumpIndex` makes only the requests the app already makes.

### 18. `[P]` Jump bar UI and ⌘K

- **Plan:** Front end 5 (`JumpBar`). **Spec:** FR-15.
- **Files:** `frontend/src/shell/JumpBar.tsx`, `frontend/src/shell/JumpBar.module.css`, `frontend/src/ui/AppHeader.tsx` (plus tests)
- **Depends on:** 12, 16, 17
- **Do:** A "Jump to anything" trigger in the header and a command-palette dialog (`role="dialog"`, combobox input, `listbox`). Open on ⌘K / Ctrl+K registered through `shortcuts/registry`, resolving any clash in `reserved.ts`, with `preventDefault`. ArrowDown/ArrowUp move the highlight, Enter navigates through the router, Escape closes and returns focus to the previous element.
- **Acceptance:**
  - *FR-15 — Given any screen, when the user presses ⌘K (Ctrl+K), then the jump bar opens focused; when they type, then matches are listed; when they press Enter on one, then it opens; when they press Escape, then the bar closes and focus returns.* Test (E2E): the whole sequence, and that no network request is made for search.

### 19. `[P]` Invite link copy button v2

- **Plan:** Front end 9. **Spec:** FR-14, FR-7.
- **Files:** `frontend/src/ui/InviteLink.tsx`, `frontend/src/ui/InviteLink.module.css`, `frontend/src/ui/InviteLink.test.tsx`, `e2e/audi/invite-copy.spec.ts`
- **Depends on:** 4
- **Do:** Restyle the existing copy button as a primary pill with the label "Copy link", always visible next to the field. Keep the clipboard call and add the `document.execCommand("copy")` fallback on a hidden textarea. Confirm with an `aria-live="polite"` "Copied" status for about 2 s (replacing the toast). Native `<button>`.
- **Acceptance:**
  - *FR-14 — Given an invite link in the Games flow, when the panel is open, then a copy button is visible without extra interaction in light and dark.* Test (E2E): the button is visible in both themes.
  - *FR-14 — When activated by mouse or keyboard, then the link is on the clipboard and a confirmation appears.* Test (E2E, clipboard permission): the clipboard holds the link and the "Copied" status appears after a click and after Enter.

### 20. `[P]` Screens: session editor, run output, scratch run

- **Plan:** Front end 8. **Spec:** FR-9, FR-1, FR-13.
- **Files:** `frontend/src/pages/SessionWindow.module.css`, `frontend/src/components/RunPanel.module.css`, `frontend/src/scratch/ScratchPanel.module.css`
- **Depends on:** 3, 4, 5, 7, 11, 16
- **Do:** Remove literal colours, radii and durations, and use the tokens and primitives only (no screen-specific colour). Live participants use `LiveBadge`. Clear these files' guard allowlist entries. Edit only the 015-shape assertions this breaks.
- **Acceptance:**
  - *FR-9 — Given the code editor and run output, when opened, then it passes the FR-1 check.* Test (E2E, matrix helper): `expectV2Look` on the session, run output and scratch screens, light and dark.
  - *FR-13 — preserves all existing functionality.* Test: the existing session, run and scratch specs pass.

### 21. `[P]` Screens: interactive learning

- **Plan:** Front end 8. **Spec:** FR-9, FR-1, FR-13.
- **Files:** `frontend/src/learn/LearnWindow.module.css`, `frontend/src/learn/LearningSessionWindow.module.css`, `frontend/src/learn/StepView.module.css` (and `Terminal.module.css`, `CompletionSummary.module.css` if two more fit; otherwise split)
- **Depends on:** 3, 4, 5, 7, 16
- **Do:** As task 20, for the learning screens, with `learnAudi.test.ts` and its 015-shape assertions edited only where they break.
- **Acceptance:**
  - *FR-9 — Given interactive learning, when opened, then it passes the FR-1 check.* Test (E2E): `expectV2Look` on the learn list and a learning session.
  - *FR-13.* Test: the existing learn specs pass.

### 22. `[P]` Screens: chat pane and GIF search

- **Plan:** Front end 8. **Spec:** FR-9, FR-8, FR-1.
- **Files:** `frontend/src/components/ChatPane.module.css`, `frontend/src/chat/gifs/GifPicker.module.css`, `frontend/src/chat/gifs/GifImage.module.css`
- **Depends on:** 3, 4, 6, 16
- **Do:** As task 20, for the chat and the GIF search, with `gifAudi.test.ts` edited only where it asserts 015 shapes.
- **Acceptance:**
  - *FR-9 — Given GIF search, when opened, then it passes the FR-1 check.* Test (E2E): `expectV2Look` with the GIF picker open.
  - *FR-8 — the user's own messages are accent-coloured in the real chat.* Test (E2E): own bubble accent, others' not.

### 23. `[P]` Screens: presentation

- **Plan:** Front end 8. **Spec:** FR-9, FR-1.
- **Files:** `frontend/src/present/PresentWindow.module.css`, `frontend/src/present/PresentSessionWindow.module.css`, `frontend/src/present/PresentationEditorSheet.module.css` (and `PresentationFrame.module.css` if it fits)
- **Depends on:** 3, 4, 5, 7, 16
- **Do:** As task 20. The presentation iframe's own content is untouched.
- **Acceptance:**
  - *FR-9 — Given presentation, when opened, then it passes the FR-1 check.* Test (E2E): `expectV2Look` on the library and a session.
  - *FR-13.* Test: the existing present specs pass.

### 24. `[P]` Screens: Games and chess

- **Plan:** Front end 8. **Spec:** FR-9, FR-1, FR-5.
- **Files:** `frontend/src/games/GamesWindow.module.css`, `frontend/src/games/chess/ChessSessionWindow.module.css`, `frontend/src/games/chess/SeatsPanel.module.css` (and `Board`, `GameControls`, `MoveList`, `ResultBanner`, `PromotionPicker` modules: split into 24a/24b at implement time if over three files)
- **Depends on:** 3, 4, 5, 7, 16, 19
- **Do:** As task 20, for the games list, chess board, clocks, move list and invite link. Edit `audiRestyle.test.ts` and `boardStyle.test.ts` only for the 015-shape assertions that break. Board square colours stay in tokens.
- **Acceptance:**
  - *FR-9 — Given Games including the chess board, clocks, move list and invite link, when opened (including chess as a guest via invite link), then it passes the FR-1 check.* Test (E2E): `expectV2Look` as a signed-in user and as a guest invitee.
  - *FR-13.* Test: the existing chess specs, including latency and a11y, pass.

### 25. `[P]` Screens: problems, profile, sign-in landing, not found, hub self-registration, Keycloak theme

- **Plan:** Front end 8. **Spec:** FR-9, FR-1.
- **Files:** `frontend/src/pages/ProblemsWindow.module.css`, `frontend/src/pages/ProfileWindow.module.css`, `frontend/src/pages/NotFound.module.css` (and `ProfileSessions`, `ProblemEditorSheet`, the self-registration screen and `keycloak-theme/`: split into 25a/25b at implement time)
- **Depends on:** 3, 4, 5, 16
- **Do:** As task 20. Locate the hub self-registration component (item 10) and take the tokens into the Keycloak login theme through its own copy, for the same look only.
- **Acceptance:**
  - *FR-9 — Given hub self-registration, when opened, then it passes the FR-1 check.* Test (E2E): `expectV2Look` via `e2e/audi/self-registration.spec.ts` and the sign-in landing.
  - *FR-13.* Test: the existing problems, profile and empty-state specs pass.

### 26. `[P]` Brand assets under v2

- **Plan:** Front end 10. **Spec:** FR-12.
- **Files:** `frontend/src/brand/repo.test.ts`, `frontend/src/brand/BrandLogo.test.tsx`, `e2e/audi/brand.spec.ts`
- **Depends on:** 1
- **Do:** Re-check the existing guards under v2 and edit only what the new look breaks. No font, icon or Audi logo file may be tracked; with no assets supplied the fallback typeface and icons show, no `<img>` or gap for the logo, the app name shows, and there are no failed asset requests.
- **Acceptance:**
  - *FR-12 — Given the repository, when inspected, then it contains no Audi font, icon or logo file.* Test (repo): no tracked font, icon or logo file matches.
  - *FR-12 — Given none supplied, then the fallbacks show with no broken image or missing glyph.* Test (E2E): fallback typeface and icons, no logo `<img>`, no console errors or failed asset requests.

### 27. Full-suite gate, FR-13 audit, NFR sweeps and baselines

- **Plan:** Test strategy (FR-13, NFR rows); Constitution compliance 1–2. **Spec:** FR-13, Accessibility, Performance, Responsive, Consistency, Existing tests.
- **Files:** `e2e/audi/a11y-sweep.spec.ts`, `frontend/src/styles/guard.test.ts`, `specs/016-audi-restyle-v2/notes.md` (the recorded figures)
- **Depends on:** 1–26
- **Do:** Empty task 2's allowlist. Run the fresh full suite once (non-slow and slow), `ruff check`, `ruff format --check`, `biome ci` and `tsc --noEmit`. Audit `git diff` of every test file and list each edited assertion with its old and new form, confirming each is a spec 015 shape (square or outlined controls, header tabs, toggle form, key pinned values) and that no other assertion was loosened. Run the axe sweep on every screen in light and dark. Record the first contentful paint against the pre-016 baseline and one Playwright trace of the live header (compositing only).
- **Acceptance:**
  - *FR-13 — Given the existing unit and end-to-end tests, when run, then they pass with unchanged assertions (except those that assert spec 015 shapes).* Check: the audit list in `notes.md` covers every edited assertion and the suite is green.
  - *Accessibility — WCAG 2.1 AA in light and dark.* Test: axe reports no contrast violations on any screen in both themes.
  - *Performance — must not delay first paint.* Check: first contentful paint is no worse than the recorded baseline.
  - *Responsive — no horizontal scrolling or overlapping controls.* Test: `expectNoOverflow` at every width the suite uses, and the dock, header and menus overlap no controls.
  - *Consistency.* Test: the guard's allowlist is empty.
