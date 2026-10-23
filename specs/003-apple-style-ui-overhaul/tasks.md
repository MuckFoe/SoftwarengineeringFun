# 003 — Apple-style UI overhaul: tasks

Every task is test-first: its tests are written failing, then the change makes them pass. Paths are relative to `frontend/src/` unless they start with `backend/`, `e2e/`, `scripts/`, `keycloak-theme/` or `frontend/`. A `ui` component is one `.tsx` plus its `.module.css`, which counts as one file below. AC-1 (the HIG checklist) is a manual review done by `/sdd-validate` and has no task here.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6, 7, 8 — all `[P]` | Foundations with no upstream: tokens, pure appearance and shortcut logic, the two backend changes, icons, the asset guard and the latency baseline (taken before anything changes). |
| 2 | 9, 10, 11, 12, 13, 14, 15, 16 — all `[P]` | Everything that only needs the tokens (1) or the registry (3): materials/motion, key matching, `ui` primitives, the Keycloak theme and the editor theme. |
| 3 | 17, 18, 19, 20, 21, 22, 23 — all `[P]` | Layout `ui` needs the materials (9); the shortcut runtime needs key matching (10) and `Sheet` (13); Keycloak wiring needs the theme (15) and the backend parameter (5); restyled components need the primitives. |
| 4 | 24, 25, 26, 27 — all `[P]` | Components that combine primitives with the shortcut runtime (19), the source list (18) or the stale endpoint (4). |
| 5 | 28, 29, 30 — all `[P]` | The three windows, each needing its sidebar, toolbar and controls. No two touch the same file. |
| 6 | 31, 32 — all `[P]` | Problem routes switch over once `ProblemsWindow` exists (29); the stale banner builds on `SessionWindow` (30). |
| 7 | 33, 34, 35 — all `[P]` | App-wide wiring and end-to-end appearance checks need every window routed (28, 31, 32). Session shortcuts follow the stale banner because both edit `SessionWindow`. |
| 8 | 36, 37, 38 — all `[P]` | Whole-app keyboard, regression and accessibility sweeps run once every screen and shortcut exists. Between waves 4 and 8 the old 001 E2E selectors may fail; 37 restores them. |
| 9 | 39, 41 — all `[P]` | **Blocked on spec 002's implementation tasks.** Spec 002 slots. |
| 10 | 40 | Chat tab shares the inspector that 39 adds to `SessionWindow`. Also blocked on 002. |

## Checklist

- [ ] **1** — `[P]` Theme tokens for light and dark
- [ ] **2** — `[P]` Appearance choice logic and pre-paint script
- [ ] **3** — `[P]` Shortcut registry and reserved-combo table
- [ ] **4** — `[P]` `GET /api/sessions/stale` endpoint
- [ ] **5** — `[P]` Appearance hint on `/api/auth/login`
- [ ] **6** — `[P]` Icon set
- [ ] **7** — `[P]` No-Apple-assets check
- [ ] **8** — `[P]` Collaboration latency harness and baseline
- [ ] **9** — `[P]` Materials and motion
- [ ] **10** — `[P]` Key matching and labels
- [ ] **11** — `[P]` Button and Spinner
- [ ] **12** — `[P]` TextField, SearchField and SegmentedControl
- [ ] **13** — `[P]` Sheet and Popover
- [ ] **14** — `[P]` Banner, InlineMessage, Hud and EmptyState
- [ ] **15** — `[P]` Keycloak login theme
- [ ] **16** — `[P]` CodeMirror token theme
- [ ] **17** — `[P]` Window, Sidebar, Inspector and BottomPanel
- [ ] **18** — `[P]` Toolbar and SourceList keyboard patterns
- [ ] **19** — `[P]` Shortcut dispatcher and shortcut list
- [ ] **20** — `[P]` Keycloak theme wiring in the test stack
- [ ] **21** — `[P]` Theme install docs and token sync check
- [ ] **22** — `[P]` RunPanel and PresenceList restyle
- [ ] **23** — `[P]` AccountControl
- [ ] **24** — `[P]` useAppearance and AppearanceControl
- [ ] **25** — `[P]` ProblemSourceList
- [ ] **26** — `[P]` StaleSessionsList
- [ ] **27** — `[P]` ProblemEditorSheet
- [ ] **28** — `[P]` Not found and forbidden empty states
- [ ] **29** — `[P]` ProblemsWindow
- [ ] **30** — `[P]` SessionWindow layout and route
- [ ] **31** — `[P]` Problem routes switch to ProblemsWindow
- [ ] **32** — `[P]` Stale-session banner
- [ ] **33** — `[P]` App shell and appearance end to end
- [ ] **34** — `[P]` Session shortcuts
- [ ] **35** — `[P]` Sign-in round trip
- [ ] **36** — `[P]` Keyboard-only reach and shortcut coverage
- [ ] **37** — `[P]` Spec 001 regression suite on the new UI
- [ ] **38** — `[P]` Contrast, focus rings and 1024 px width
- [ ] **39** — `[P]` Description inspector tab (after 002)
- [ ] **40** — Chat inspector tab (after 002)
- [ ] **41** — `[P]` Description field in the problem editor sheet (after 002)

## Tasks

### 1. `[P]` Theme tokens for light and dark

- **Plan:** Appearance — Tokens, Type, Accent. **Spec:** FR-1, FR-7.
- **Files:** `theme/tokens.css`, `theme/tokens.test.ts`, `main.tsx` (import `theme/tokens.css`)
- **Depends on:** nothing
- **Do:** Define colour, type-scale (HIG macOS: `--type-body: 13px/16px`, `--type-title2: 17px/22px`, …), 4 px spacing, radius (6 px controls, 10 px sheets/popovers), shadow, `--accent`, `--focus-ring` tokens on `:root`, and redefine every colour token under `:root[data-appearance="dark"]`. Font stacks by family name only (`system-ui, …`; `ui-monospace, …`). Set `accent-color: var(--accent)`.
- **Acceptance:**
  - *FR-7 — dark renders every surface with no light-only leftovers.* Test parses `tokens.css`: every colour custom property defined on `:root` is also defined in the dark block, and vice versa.
  - *FR-1 — one accent, system typeface, HIG type scale.* Test: exactly one accent token family; `font-family` values contain no quoted font file or `@font-face`; every spacing token is a multiple of 4 px.

### 2. `[P]` Appearance choice logic and pre-paint script

- **Plan:** Appearance — `appearance.ts`, inline script. Contracts: `theme/appearance.ts`. **Spec:** FR-5, FR-6.
- **Files:** `theme/appearance.ts`, `theme/appearance.test.ts`, `frontend/index.html`
- **Depends on:** nothing
- **Do:** Implement `Choice`, `resolve`, `loadChoice`, `saveChoice` per the contract, using `localStorage["appearance"]`, try/catch, default `system`. Add an inline script to `index.html` that sets `<html data-appearance>` before first paint with the same rules.
- **Acceptance:**
  - *AC-6 — no stored choice and OS dark → dark.* Unit: `resolve("system", true) === "dark"`, `resolve("system", false) === "light"`; `loadChoice()` with nothing stored or an invalid value returns `"system"`.
  - *AC-7 — choosing Light under a dark OS persists; System follows the OS again.* Unit: `saveChoice("light")` then `loadChoice() === "light"` and `resolve("light", true) === "light"`; `saveChoice("system")` then `resolve(loadChoice(), true) === "dark"`. (Live OS switching and the pre-paint script are covered end to end in 33.)

### 3. `[P]` Shortcut registry and reserved-combo table

- **Plan:** Shortcuts — `registry.ts`, `reserved.ts`, shortcut table. Contracts: `shortcuts/registry.ts`. **Spec:** FR-17, FR-20.
- **Files:** `shortcuts/registry.ts`, `shortcuts/reserved.ts`, `shortcuts/registry.test.ts`
- **Depends on:** nothing
- **Do:** Define `Combo`, `Shortcut`, `Scope`, `ShortcutId` and `SHORTCUTS` with exactly the plan's table. In `reserved.ts`, list the combos Safari, Chrome, Firefox and Edge on macOS and Windows reserve (new tab/window, close, address bar, tab switching, reload, devtools incl. ⌥⌘I and ⇧⌘C, fullscreen ⌃⌘F, OS combos ⌃⌘Q, ⌃⌘D, ⌃⌘Space) plus every binding in the CodeMirror keymaps the editor loads, imported from the real packages.
- **Acceptance:**
  - *AC-18b — Given each shortcut in the list, when checked against the reserved shortcuts of the four browsers on macOS and Windows, then none collides.* Unit: no `SHORTCUTS` combo (mac or other) appears in `reserved.ts` for any browser/OS or in the CodeMirror keymaps; no duplicate combo within a scope (sheet and global combined).
  - *AC-18a (registry part) — the list names every action in FR-17.* Unit: the set of ids equals the FR-17 action list: run, close, default button, focus search, new problem, save problem, sidebar, run panel, chat, next problem, previous problem, copy invite link, appearance, shortcut list.

### 4. `[P]` `GET /api/sessions/stale` endpoint

- **Plan:** Admin "Stale sessions" — Backend; Data model query; Contracts. **Spec:** FR-9, FR-12.
- **Files:** `backend/app/sessions/repo.py`, `backend/app/sessions/api.py`, `backend/tests/integration/test_stale_list.py`
- **Depends on:** nothing
- **Do:** Add `StaleSessionRow` and `list_stale(conn)` with the plan's query. Add `GET /api/sessions/stale` gated by `require_role("admin")`, declared before `GET /{invite}`.
- **Acceptance:**
  - *AC-10b — Given an admin and at least one stale session … that session is no longer stale and leaves the list.* Integration against real Postgres and Keycloak: admin gets 200 with only stale rows ordered by `stale_at desc` with the contract's fields; after `POST /api/sessions/{invite}/reactivate` the row is absent; editor gets 403 `{"error":"forbidden"}`; anonymous gets 401 `{"error":"unauthenticated"}`; `GET /api/sessions/stale` is not routed to the invite handler.

### 5. `[P]` Appearance hint on `/api/auth/login`

- **Plan:** Sign-in — Backend; Contracts. **Spec:** FR-18.
- **Files:** `backend/app/main.py`, `backend/tests/integration/test_auth.py`
- **Depends on:** nothing
- **Do:** Accept optional `appearance` query parameter on `/api/auth/login`; when it is `light` or `dark`, pass it to `authorize_redirect(..., appearance=…)`; drop any other value.
- **Acceptance:**
  - *FR-18 — sign-in page in the app's appearance.* Integration: `?appearance=dark` → 302 Location to Keycloak contains `appearance=dark`; `?appearance=purple` and no parameter → Location has no `appearance`; existing `next` handling is unchanged.

### 6. `[P]` Icon set

- **Plan:** Appearance — Icons. **Spec:** FR-1, NFR-1.
- **Files:** `ui/Icon.tsx`, `ui/Icon.test.tsx`
- **Depends on:** nothing
- **Do:** About 20 hand-drawn inline SVG icons (sidebar, play, stop, person, link, sun/moon, chevrons, search, plus, gear, exclamation, chat, doc) drawn with `currentColor`, `aria-hidden` unless labelled.
- **Acceptance:**
  - *NFR-1 — no Apple-licensed icon sets.* Component test: every icon name renders one inline `<svg>` with no `href`/`xlink:href`/`<image>` and fill/stroke `currentColor`; an icon given a `label` exposes it as its accessible name.

### 7. `[P]` No-Apple-assets check

- **Plan:** Test strategy row AC-19. **Spec:** NFR-1.
- **Files:** `scripts/check-no-apple-assets.sh`, `scripts/check.sh`
- **Depends on:** nothing
- **Do:** Script scans `frontend/dist` and `keycloak-theme/` (if present) for font files (`.otf/.ttf/.woff*`), `apple-touch-icon`, and the words "Apple", "macOS", "SF Pro" in user-visible text; non-zero exit on a match. Call it from `scripts/check.sh` after the frontend build.
- **Acceptance:**
  - *AC-19 — Given the built app and the sign-in page, when inspected, then no Apple logo, trademark as branding, or Apple-licensed font or icon files.* Running the script on a fixture directory containing a `.woff2` and the text "SF Pro" fails; on the current build it passes.

### 8. `[P]` Collaboration latency harness and baseline

- **Plan:** Test strategy row AC-23. **Spec:** NFR-5.
- **Files:** `e2e/latency.spec.ts`, `specs/003-apple-style-ui-overhaul/notes.md`
- **Depends on:** nothing
- **Do:** Playwright spec: two pages in one session, 50 edits, measure p95 propagation latency, selecting the editor through `.cm-content` so it runs on old and new UI. Measure the baseline on commit `154f84b` (a git worktree) against the test stack, and record it in `notes.md`. The spec reads the baseline and asserts p95 ≤ baseline × 1.1.
- **Acceptance:**
  - *AC-23 — Given two participants editing the same session, when one types, then the other sees the change no later than pre-redesign.* The baseline is in `notes.md` with commit, browser and date; the spec passes on the current tree and is rerun by `/sdd-validate`.

### 9. `[P]` Materials and motion

- **Plan:** Appearance — Materials; Motion. **Spec:** FR-1, FR-4, NFR-3, NFR-4, NFR-5.
- **Files:** `theme/materials.css`, `theme/motion.css`, `theme/motion.test.ts` (plus their imports in `main.tsx`)
- **Depends on:** 1
- **Do:** `.material` class: `background: var(--material-bg); backdrop-filter: blur(20px) saturate(180%)`, opaque `--material-bg-opaque` without `@supports (backdrop-filter: …)` and under `prefers-reduced-transparency: reduce`. Motion tokens `--motion-fast: 150ms`, `--motion-base: 250ms`; sheet, panel and list-row keyframes; under `prefers-reduced-motion: reduce` each movement keyframe is swapped for a fade-only `*-reduced` twin. No `pointer-events: none` during animation.
- **Acceptance:**
  - *NFR-5 — animations last no longer than 300 ms.* Test parses `motion.css`: every duration ≤ 300 ms.
  - *AC-5 — with reduce motion on, at most a fade.* Test: every keyframe name has a `-reduced` twin used inside the reduced-motion media query, and each twin animates only `opacity`.
  - *AC-22 — with reduce transparency on, sidebar and toolbar are opaque.* Test: `materials.css` sets `backdrop-filter: none` and the opaque background both in the `@supports not` branch and the reduced-transparency query. (Rendered check in 33.)

### 10. `[P]` Key matching and labels

- **Plan:** Shortcuts — `keys.ts`; known AltGr risk. Contracts: `shortcuts/keys.ts`. **Spec:** FR-17.
- **Files:** `shortcuts/keys.ts`, `shortcuts/keys.test.ts`
- **Depends on:** 3
- **Do:** `isMac()`, `matches(e, combo, mac)` (`mod` = Meta on mac, Ctrl elsewhere), `label(combo, mac)` (⌘⌥⌃⇧ glyphs vs `Ctrl+Alt+…`). Ctrl+Alt combos off-mac only match when the key does not produce a character.
- **Acceptance:**
  - *AC-18 — ⌘+Return on macOS, Ctrl+Return on Windows or Linux.* Unit with real `KeyboardEvent`s: Run matches `metaKey+Enter` with `mac=true` and `ctrlKey+Enter` with `mac=false`, and not the other way round; `label` gives `⌘↩` and `Ctrl+Enter`.
  - *Known risk — AltGr.* Unit: a Ctrl+Alt event whose `key` is `ś` does not match any combo.

### 11. `[P]` Button and Spinner

- **Plan:** Module layout `ui/`; HIG checklist items 3, 4, 8; Feedback. **Spec:** FR-1, FR-3, NFR-4.
- **Files:** `ui/Button.tsx`, `ui/Spinner.tsx`, `ui/controls.test.tsx`
- **Depends on:** 1
- **Do:** `Button` variants `primary` (filled accent), `bordered`, `plain`, `destructive` (red label); optional icon; `busy` prop shows an inline `Spinner` and sets `aria-busy`. `:focus-visible` ring from `--focus-ring`. `Spinner` is `role="progressbar"` with a label.
- **Acceptance:**
  - *AC-3 (component part) — a progress indicator appears inline at once.* Component test: `busy` renders the spinner inside the button and keeps it focusable; `disabled` sets `disabled`.
  - *NFR-4 — visible focus ring.* Covered rendered in 38; here the module CSS uses `:focus-visible` with `--focus-ring` (asserted by reading the CSS module source).

### 12. `[P]` TextField, SearchField and SegmentedControl

- **Plan:** Module layout `ui/`. **Spec:** FR-1, FR-11, FR-6.
- **Files:** `ui/TextField.tsx`, `ui/SearchField.tsx`, `ui/SegmentedControl.tsx` (tests in `ui/fields.test.tsx`)
- **Depends on:** 1
- **Do:** `TextField` with label, error slot (`aria-describedby`) and character counter option. `SearchField` with search icon and clear button, emitting on every keystroke. `SegmentedControl` as a `radiogroup` with arrow-key navigation.
- **Acceptance:**
  - *AC-12 (component part) — the list narrows as they type.* Component test: `SearchField` calls `onChange` once per typed character and Clear resets it.
  - *FR-21 — keyboard only.* Component test: in `SegmentedControl`, Arrow Right moves selection and focus to the next segment.

### 13. `[P]` Sheet and Popover

- **Plan:** Window structure — Sheets; Contracts `ui/Sheet.tsx`. **Spec:** FR-2, FR-17.
- **Files:** `ui/Sheet.tsx`, `ui/Popover.tsx`, `ui/overlays.test.tsx`
- **Depends on:** 1
- **Do:** `Sheet` on native `<dialog>` with `showModal()`, title, sheet animation class, Return triggers `defaultAction` (as form submit), `onClose` on Esc (`cancel` event). `Popover` on the HTML `popover` attribute, anchored to a trigger button.
- **Acceptance:**
  - *AC-2 (component part) — the editor opens as a sheet over the list.* Component test: `open` renders a `dialog` with the title as its accessible name and does not change `location`; closing calls `onClose`.
  - *AC-18 — Esc closes any open sheet or popover.* Where jsdom lacks `showModal`/`popover`, these behaviours are asserted in E2E (34), not stubbed (constitution rule 4).

### 14. `[P]` Banner, InlineMessage, Hud and EmptyState

- **Plan:** Feedback; Module layout `ui/`. **Spec:** FR-3, FR-12, FR-13.
- **Files:** `ui/Banner.tsx`, `ui/InlineMessage.tsx`, `ui/Hud.tsx`, `ui/EmptyState.tsx` (tests in `ui/feedback.test.tsx`)
- **Depends on:** 1
- **Do:** `Banner` (info/warning, actions slot). `InlineMessage` tied to a control via `id` for `aria-describedby`. `Hud` transient `role="status"` overlay that auto-dismisses and never takes focus. `EmptyState` with icon, title, text and an action link.
- **Acceptance:**
  - *AC-4 (component part) — an inline message explains it next to the affected control.* Component test: `InlineMessage` id is referenced by the control's `aria-describedby`.
  - *FR-3 — non-blocking confirmations.* Component test: `Hud` renders `role="status"`, leaves focus where it was and disappears after its timeout.

### 15. `[P]` Keycloak login theme

- **Plan:** Sign-in — Keycloak theme. **Spec:** FR-18, NFR-1.
- **Files:** `keycloak-theme/collab/login/theme.properties`, `keycloak-theme/collab/login/resources/css/collab.css`, `keycloak-theme/collab/login/resources/js/appearance.js`
- **Depends on:** 1
- **Do:** `parent=keycloak.v2`, include the CSS and JS. `collab.css` holds the same token values as `theme/tokens.css` (light and dark) and styles the login form. `appearance.js` reads `appearance` from the URL on first load, keeps it in `sessionStorage`, else falls back to `prefers-color-scheme`, and sets `data-appearance`. No font files.
- **Acceptance:**
  - *AC-18d (theme part).* Biome passes on `appearance.js`; `scripts/check-no-apple-assets.sh` (7) passes over `keycloak-theme/`. Rendered check is in 20.

### 16. `[P]` CodeMirror token theme

- **Plan:** Appearance — CodeMirror; Dependencies. **Spec:** FR-7, NFR-5.
- **Files:** `components/CodeEditor.tsx`, `components/editorTheme.ts`, `frontend/package.json`
- **Depends on:** 1
- **Do:** One `EditorView.theme` and one `HighlightStyle` written against CSS variables; declare `@codemirror/language` and `@lezer/highlight` explicitly. No reconfiguration on appearance change; `y-codemirror.next` remote cursors unchanged.
- **Acceptance:**
  - *FR-7 — the code editor renders in dark.* Unit: every colour in the theme spec and highlight style is a `var(--…)` reference. Existing `components/collab.test.tsx` passes unchanged. (Rendered dark check in 33.)

### 17. `[P]` Window, Sidebar, Inspector and BottomPanel

- **Plan:** Window structure; Widths (NFR-2). **Spec:** FR-1, FR-10, NFR-2.
- **Files:** `ui/Window.tsx`, `ui/Sidebar.tsx`, `ui/Panels.tsx` (`Inspector`, `BottomPanel`; tests in `ui/layout.test.tsx`)
- **Depends on:** 6, 9
- **Do:** `Window` grid with sidebar (220 px), main (≥ 420 px), optional inspector (320 px) and bottom panel; below 1200 px the sidebar overlays the main area. `Sidebar` uses `.material` and is a `nav`/`complementary` landmark with sections. `Inspector` and `BottomPanel` collapse with the panel animation, controlled via `open` props.
- **Acceptance:**
  - *AC-11 (component part) — the run-results panel can be hidden and shown again.* Component test: toggling `open` on `BottomPanel` hides it from the accessibility tree and restores it; `Sidebar` sections are labelled landmarks. (Widths at 1024 px are checked in 38.)

### 18. `[P]` Toolbar and SourceList keyboard patterns

- **Plan:** Keyboard reach (FR-21); Module layout `ui/`. **Spec:** FR-10, FR-21, NFR-4.
- **Files:** `ui/Toolbar.tsx`, `ui/SourceList.tsx`, `ui/keyboard.test.tsx`
- **Depends on:** 9
- **Do:** `Toolbar` uses `.material`, `role="toolbar"`, one tab stop, arrow keys move between items. `SourceList` is a `listbox` with roving tabindex, arrow keys move, Return activates, selection uses the accent; rows animate in/out.
- **Acceptance:**
  - *AC-18c (component part) — every action by keyboard.* Component test: Tab enters the toolbar once and arrow keys move focus between its buttons; in `SourceList`, ArrowDown moves focus and Return calls `onActivate` with that row.

### 19. `[P]` Shortcut dispatcher and shortcut list

- **Plan:** Shortcuts — `useShortcut.ts`, `ShortcutList.tsx`. Contracts. **Spec:** FR-17, FR-19.
- **Files:** `shortcuts/useShortcut.ts`, `shortcuts/ShortcutList.tsx`, `shortcuts/useShortcut.test.tsx`
- **Depends on:** 10, 13
- **Do:** One `keydown` listener on `window`; `useShortcut(id, handler, {enabled})` registers by id; the active scope set is provided by context (`global` always, plus `session`/`problems`/`sheet` from the mounted window or open sheet). On match: `preventDefault()` and run. `ShortcutList` renders every registry entry with `label(…, isMac())` inside a `Sheet`.
- **Acceptance:**
  - *AC-18a — the listed action happens, and the list names every action in FR-17.* Component test: a registered handler runs on its combo and calls `preventDefault`; it does not run when its scope is inactive or `enabled` is false; `ShortcutList` shows one row per `SHORTCUTS` entry with the platform label.

### 20. `[P]` Keycloak theme wiring in the test stack

- **Plan:** Sign-in — Wiring; Test strategy AC-18d. **Spec:** FR-18.
- **Files:** `backend/tests/keycloak/realm.json`, `docker-compose.test.yml`, `e2e/signin.spec.ts`
- **Depends on:** 5, 15
- **Do:** Set `"loginTheme": "collab"` in the realm; mount `./keycloak-theme/collab` at `/opt/keycloak/themes/collab:ro`.
- **Acceptance:**
  - *AC-18d — Given an editor not signed in, OS dark, when they reach the sign-in page, then it renders in dark in the app's visual language, and light renders it in light.* E2E: with `colorScheme` dark and light, `/api/auth/login` lands on the Keycloak page whose body background equals the theme's dark/light value; `appearance=light` under a dark OS renders light, and it persists to a second Keycloak page (failed-login error page).

### 21. `[P]` Theme install docs and token sync check

- **Plan:** Sign-in — Keycloak theme (copied tokens), Wiring (production docs); Constitution compliance 5. **Spec:** FR-18.
- **Files:** `.env.example`, `scripts/check-theme-tokens.sh`, `scripts/check.sh`
- **Depends on:** 15
- **Do:** Document in `.env.example` how to install `keycloak-theme/collab` in the external production Keycloak and select it for the realm. The check script compares every token name and value in `theme/tokens.css` with `collab.css` and fails on a difference; `check.sh` runs it.
- **Acceptance:**
  - *FR-18 — same visual language as the app.* Changing one colour in `tokens.css` only makes the check fail; on the current tree it passes.

### 22. `[P]` RunPanel and PresenceList restyle

- **Plan:** Feedback; Motion; Module layout `components/`. **Spec:** FR-3, FR-4, FR-7.
- **Files:** `components/RunPanel.tsx`, `components/PresenceList.tsx`, `components/run.test.tsx`
- **Depends on:** 11, 14
- **Do:** `RunPanel` renders inside a `BottomPanel` slot: `Spinner` while running, result list replaces it, failures as `InlineMessage`. `PresenceList` as sidebar rows with name and colour dot; join/leave use the list-row animation. Token colours only.
- **Acceptance:**
  - *AC-3 — a progress indicator appears inline at once … the result replaces the indicator.* Component test against the real run flow already used by `run.test.tsx`: spinner present right after start, no `dialog`, result replaces the spinner. Existing run and presence tests keep passing.

### 23. `[P]` AccountControl

- **Plan:** Sign-in — Entry point. **Spec:** FR-9.
- **Files:** `components/AccountControl.tsx`, `components/AccountControl.test.tsx`
- **Depends on:** 2, 5, 11, 13
- **Do:** Signed out: "Sign in" link to `/api/auth/login?next=<current path>&appearance=<resolved>` (resolved read from `<html data-appearance>`). Signed in: the user's name opening a `Popover` with Sign out. Uses `useMe()`.
- **Acceptance:**
  - *AC-10a (component part) — "Sign in" leads to sign-in and back.* Component test: signed out on `/s/abc` in dark, the link `href` is `/api/auth/login?next=%2Fs%2Fabc&appearance=dark`; signed in shows the name and Sign out. (Round trip in 35.)

### 24. `[P]` useAppearance and AppearanceControl

- **Plan:** Appearance — `useAppearance`; Module layout `components/AppearanceControl`. Contracts. **Spec:** FR-5, FR-6.
- **Files:** `theme/useAppearance.ts`, `components/AppearanceControl.tsx`, `components/AppearanceControl.test.tsx`
- **Depends on:** 2, 12, 13, 19
- **Do:** `useAppearance()` returns `{choice, resolved, setChoice}`, writes `data-appearance`, listens to `matchMedia("(prefers-color-scheme: dark)")`. `AppearanceControl` is a toolbar button opening a `Popover` with a Light/Dark/System `SegmentedControl`; registers the appearance shortcut to open it.
- **Acceptance:**
  - *AC-7 — choosing Light applies immediately and is kept.* Component test: choosing Light sets `data-appearance="light"` and `localStorage["appearance"]="light"` at once. (OS listener and persistence across visits in 33, because jsdom lacks `matchMedia`.)
  - *AC-18a — appearance shortcut.* Component test: the appearance combo opens the popover.

### 25. `[P]` ProblemSourceList

- **Plan:** Module layout — `ProblemSourceList`, `ProblemSwitcher` removal. **Spec:** FR-9.
- **Files:** `components/ProblemSourceList.tsx`, `components/ProblemSourceList.test.tsx`
- **Depends on:** 18
- **Do:** Session sidebar "Problems" section built on `SourceList`; the switching logic moves here from `ProblemSwitcher` (same API calls). Current problem shown as selected. `ProblemSwitcher.tsx` itself is deleted in 30, when `SessionPage` goes.
- **Acceptance:**
  - *AC-10 (component part) — picking another problem from the sidebar switches the session.* Component test: activating a row (click or Return) issues the same switch request `ProblemSwitcher` did and marks the new row selected.

### 26. `[P]` StaleSessionsList

- **Plan:** Admin "Stale sessions" — Frontend; Contracts. **Spec:** FR-9, FR-12.
- **Files:** `components/StaleSessionsList.tsx`, `api/client.ts` (+ `StaleSession` in `api/types.ts`), `components/StaleSessionsList.test.tsx`
- **Depends on:** 4, 14, 18
- **Do:** Client method for `GET /api/sessions/stale`. Sidebar section "Stale sessions" listing problem title and how long stale, inline Reactivate button. Success or 409 `not_stale` removes the row (animated) and shows a `Hud`. Row text links to `/s/:invite`.
- **Acceptance:**
  - *AC-10b (component part) — reactivate removes the session from the list.* Component test against the test stack's API: Reactivate removes the row and shows "Session reactivated"; a 409 also removes it.

### 27. `[P]` ProblemEditorSheet

- **Plan:** Module layout `pages/ProblemEditorSheet` (was ProblemForm); Sheets; Feedback. **Spec:** FR-2, FR-3, FR-11.
- **Files:** `pages/ProblemEditorSheet.tsx`, `pages/ProblemEditorSheet.test.tsx`
- **Depends on:** 11, 12, 13, 14, 19
- **Do:** Port `ProblemForm`'s fields and validation into a `Sheet` (`defaultAction` = Save). Save shortcut (⌘S) in `sheet` scope. Server errors as `InlineMessage` beside the field, form state kept. Delete is a destructive button confirmed by an alert dialog. Same API calls and rules as `ProblemForm`.
- **Acceptance:**
  - *AC-4 — Given a save rejected by the server, then an inline message explains it next to the affected control, and the user's input is kept.* Component test: a 422 on save shows the message described-by the field and every input keeps its value.
  - *AC-2 (component part).* Component test: create and edit render inside `dialog`; Save shortcut submits.

### 28. `[P]` Not found and forbidden empty states

- **Plan:** Window structure — Not found / forbidden. **Spec:** FR-13.
- **Files:** `pages/NotFound.tsx`, `pages/Forbidden.tsx`, `auth/RequireRole.tsx`, `e2e/empty-state.spec.ts`
- **Depends on:** 14, 17, 18, 23, 24
- **Do:** Both pages are a `Window` with a toolbar (appearance, account) and an `EmptyState` linking to `/`. `RequireRole` renders `Forbidden` instead of its current fallback.
- **Acceptance:**
  - *AC-14 — Given any unknown URL, when opened, then an empty-state screen in the new visual language is shown with a link back to the start.* E2E: `/nope` shows the empty state with a link to `/`; following it lands on the problems screen. `auth/RequireRole.test.tsx` passes with the new fallback.

### 29. `[P]` ProblemsWindow

- **Plan:** Window structure — Problems; Shortcuts (focus search, new problem, sidebar). **Spec:** FR-2, FR-9, FR-10, FR-11.
- **Files:** `pages/ProblemsWindow.tsx`, `pages/ProblemsWindow.test.tsx`
- **Depends on:** 12, 17, 18, 19, 23, 24, 26, 27
- **Do:** Sidebar "Problems" source list (+ `StaleSessionsList` for admins). Toolbar: sidebar toggle, `SearchField`, New problem (editors), appearance, account. Main: problem table filtered by title as the user types. Create/edit open `ProblemEditorSheet` from local state without navigating; an `initialSheet` prop lets routes open it pre-filled. Registers focus search (⌘F), new problem (⌥⌘N) and sidebar toggle (⌃⌘S) in `problems`/`global` scope.
- **Acceptance:**
  - *AC-12 — Given an editor with more than 10 problems, when they type part of a title into search, then the list narrows as they type.* Component test: 12 problems, type a substring one key at a time → rows narrow after each keystroke.
  - *AC-2 (component part).* Component test: New problem opens the sheet, `location.pathname` unchanged, the list stays mounted.
  - *FR-9 — admin section.* Component test: "Stale sessions" section present for an admin, absent for an editor.

### 30. `[P]` SessionWindow layout and route

- **Plan:** Window structure — Session; Module layout (SessionWindow was SessionPage, ProblemSwitcher removed). **Spec:** FR-3, FR-9, FR-10.
- **Files:** `pages/SessionWindow.tsx`, `pages/SessionWindow.test.tsx`, `App.tsx` (route `/s/:invite`), `e2e/session.spec.ts`; deletes `pages/SessionPage.tsx`, `pages/SessionPage.test.tsx`, `components/ProblemSwitcher.tsx`
- **Depends on:** 16, 17, 18, 19, 22, 23, 24, 25
- **Do:** Port `SessionPage`'s data and collab wiring unchanged. Sidebar: `ProblemSourceList`, "Participants" (`PresenceList`). Toolbar: sidebar toggle, problem title, Run, Invite (copies link, `Hud`), run-panel toggle, appearance, account. Main: `CodeEditor`. `BottomPanel` with `RunPanel`. Sidebar toggle shortcut registered. Join flow (name entry, limits) unchanged apart from styling.
- **Acceptance:**
  - *AC-11 — problems and participants in a sidebar, editor fills the main area, run, invite and appearance in the toolbar, run panel can be hidden and shown.* E2E: landmark and toolbar role queries find each; run-panel toggle hides and shows the panel.
  - *AC-10 — pick another problem from the sidebar → session switches, no other switcher present.* E2E: editor content switches; no `combobox` for problems exists.
  - *AC-3 — inline progress, no blocking dialog, result replaces indicator.* E2E: click Run → spinner visible within 100 ms, no `dialog[open]`, result replaces it.

### 31. `[P]` Problem routes switch to ProblemsWindow

- **Plan:** Sheets (deep links still work, FR-8); Test strategy AC-2, AC-4, AC-10b. **Spec:** FR-2, FR-8, FR-9.
- **Files:** `App.tsx` (routes `/`, `/problems/new`, `/problems/:id/edit`), `e2e/problems.spec.ts`; deletes `pages/ProblemList.tsx`, `pages/ProblemList.test.tsx`, `pages/ProblemForm.tsx`, `pages/ProblemForm.test.tsx`
- **Depends on:** 29
- **Do:** Route all three paths to `ProblemsWindow`; the deep links open it with the sheet already open. Remove the old pages once nothing imports them.
- **Acceptance:**
  - *AC-2 — the editor opens as a sheet over the list, the URL is unchanged, closing returns to the same list position.* E2E: scroll the list, open edit → `dialog[open]`, pathname unchanged, close → same scroll offset.
  - *FR-8 — deep links still work.* E2E: `/problems/new` and `/problems/:id/edit` open the list with the sheet open.
  - *AC-4 (E2E twin).* E2E: a save the server rejects keeps the input and shows the inline message.
  - *AC-10b — reactivate from the sidebar → row gone, session active.* E2E as admin.

### 32. `[P]` Stale-session banner

- **Plan:** Admin "Stale sessions" — In session. **Spec:** FR-12, FR-9.
- **Files:** `pages/SessionWindow.tsx`, `pages/SessionWindow.test.tsx`, `e2e/session.spec.ts`
- **Depends on:** 14, 30
- **Do:** On the existing `423 stale` response, show a `Banner` under the toolbar; editor `readOnly` + `editable` false, Run disabled. When `can_reactivate`, the banner holds Reactivate (same endpoint); success clears the banner and shows a `Hud`.
- **Acceptance:**
  - *AC-13 — Given a stale session, when a participant opens it, then a stale notice is visible without scrolling, and editing and run controls are visibly disabled. When an admin opens it, the reactivate action appears beside that notice.* E2E: banner inside the viewport, `.cm-content` `contenteditable=false`, Run disabled; as admin, Reactivate is inside the banner and reactivating re-enables editing.

### 33. `[P]` App shell and appearance end to end

- **Plan:** Shortcuts — `ShortcutList` (global); Appearance; Test strategy AC-5, AC-6, AC-7, AC-8, AC-22. **Spec:** FR-4, FR-5, FR-6, FR-7, FR-19, NFR-3, NFR-4.
- **Files:** `App.tsx`, `App.test.tsx`, `e2e/appearance.spec.ts`
- **Depends on:** 28, 31, 32
- **Do:** Mount the shortcut scope provider and `ShortcutList` (⇧⌘/ / Ctrl+Shift+/) at the app root; call `useAppearance` once at the root.
- **Acceptance:**
  - *AC-6 — no stored choice, OS dark → dark; OS switches to light → light without reload.* E2E: `colorScheme: "dark"`, empty storage → dark tokens; `emulateMedia({colorScheme:"light"})` → light, same document.
  - *AC-7 — Light under dark OS survives closing the browser; System follows the OS again.* E2E: choose Light, new page in the same context on a session link → light; choose System → dark.
  - *AC-8 — dark: editor, run results, presence list and a confirmation dialog have no light background.* E2E: background luminance of each below the threshold.
  - *AC-5 — reduce motion: sheet open and participant join at most a fade.* E2E with `reducedMotion: "reduce"`: computed `animation-name` ends in `-reduced`.
  - *AC-22 — reduce transparency → sidebar and toolbar opaque.* E2E (Chromium, CDP `prefers-reduced-transparency: reduce`): `backdrop-filter: none`, opaque background.
  - *FR-19.* Component test: the shortcut-list combo opens the list.

### 34. `[P]` Session shortcuts

- **Plan:** Shortcuts table (session scope); Feedback (Hud). **Spec:** FR-17.
- **Files:** `pages/SessionWindow.tsx`, `pages/SessionWindow.test.tsx`, `e2e/keyboard.spec.ts`
- **Depends on:** 32
- **Do:** Register run (⌘↩), run-panel toggle (⌃⌘R), next/previous problem (⌃⌘↓/↑), copy invite link (⌃⌘I, with `Hud`) in `session` scope; all disabled while stale. If a combo cannot be intercepted in a supported browser, choose a replacement here and update the table in `plan.md` and `registry.ts` (3's test must stay green).
- **Acceptance:**
  - *AC-18 — Given a participant on macOS, when they press ⌘+Return, then the code runs. Ctrl+Return on Windows or Linux, and Esc closes any open sheet or popover.* E2E: ⌘↩ in WebKit with a mac platform and Ctrl+Enter in Chromium on Linux both start a run; Esc closes the shortcut-list sheet and the appearance popover.

### 35. `[P]` Sign-in round trip

- **Plan:** Sign-in — Entry point; Test strategy AC-10a. **Spec:** FR-9.
- **Files:** `e2e/signin.spec.ts`
- **Depends on:** 20, 23, 30, 31
- **Do:** Fix anything in `AccountControl` or the `next` handling the test exposes.
- **Acceptance:**
  - *AC-10a — Given a visitor on a screen with the "Sign in" toolbar button, when they sign in successfully, then they return to the screen they started from, signed in.* E2E: signed out on `/s/:invite` and on `/` → Sign in → Keycloak login → back on the same path with the account name in the toolbar.

### 36. `[P]` Keyboard-only reach and shortcut coverage

- **Plan:** Keyboard reach (FR-21); Test strategy AC-18a, AC-18c. **Spec:** FR-17, FR-19, FR-21.
- **Files:** `e2e/keyboard.spec.ts` (plus fixes in the component the test exposes, at most two files)
- **Depends on:** 33, 34
- **Do:** Per screen, a keyboard-only script with no `click`. Tab order sidebar → toolbar → main → panels; Esc then Tab leaves the editor.
- **Acceptance:**
  - *AC-18a — Given a user on any screen, when they press each shortcut in the list, then the listed action happens, and the list names every FR-17 action.* E2E: for each row read from the shortcut list, press its combo and assert its effect.
  - *AC-18c — Given each screen, when a user completes every action on it using only the keyboard, then every action succeeds.* E2E: problems (search, create, edit, save, delete confirm), session (join, switch problem, run, invite, toggles, appearance, sign in), empty state (back link).

### 37. `[P]` Spec 001 regression suite on the new UI

- **Plan:** Test strategy AC-9, AC-10c. **Spec:** FR-8, FR-9, NFR-6.
- **Files:** `e2e/auth.spec.ts`, `e2e/collab.spec.ts`, `e2e/fixtures.ts`
- **Depends on:** 33
- **Do:** Update 001's E2E selectors to roles and labels only. No assertion, step or rule changes.
- **Acceptance:**
  - *AC-9 — when the full acceptance suite of spec 001 runs, every criterion passes.* `backend/tests` and every `e2e/*.spec.ts` pass; `git diff` of the 001 specs shows selector changes only.
  - *AC-10c — joining by invite link takes the same steps and enforces the same rules.* The 001 invite-join spec passes with the same steps.

### 38. `[P]` Contrast, focus rings and 1024 px width

- **Plan:** Test strategy AC-20, AC-21; Dependencies (`@axe-core/playwright`). **Spec:** NFR-2, NFR-4.
- **Files:** `e2e/package.json`, `e2e/a11y.spec.ts` (plus token or CSS fixes the test exposes, at most two files)
- **Depends on:** 20, 33
- **Do:** Add `@axe-core/playwright` as a dev dependency. Loop every screen (problems, problem sheet, session, stale session, empty state, Keycloak login) × light and dark.
- **Acceptance:**
  - *AC-20 — at 1024 px wide, each screen in both appearances, nothing scrolls horizontally and no control is clipped.* E2E at 1024×768: `scrollWidth <= clientWidth`; every button's bounding box is inside the viewport.
  - *AC-21 — every text/control pair meets WCAG 2.2 AA contrast; every interactive element is reachable by Tab with a visible focus ring.* E2E: axe `color-contrast` zero violations per screen × appearance; Tab through all → each focused element has a non-`none` outline.

### 39. `[P]` Description inspector tab (after 002)

- **Plan:** Spec 002 surfaces — Description; Window structure (inspector, inspector toggle). **Spec:** FR-14.
- **Files:** `pages/SessionWindow.tsx`, `components/DescriptionPane.tsx`, `e2e/session-002.spec.ts`
- **Depends on:** 34, and spec 002's tasks for problem descriptions
- **Do:** Inspector with a *Description* tab rendering 002's sanitised description HTML in `.prose` (`img { max-width: 100%; height: auto }`); inspector toggle in the toolbar.
- **Acceptance:**
  - *AC-15 — Given a description with an image wider than the description area, when a participant opens that problem, then description and editor are visible at the same time at 1280 px, and the image is scaled to fit with no horizontal scrolling.* E2E (`test.fixme` until 002 lands).

### 40. Chat inspector tab (after 002)

- **Plan:** Spec 002 surfaces — Chat; Shortcuts (show/hide chat). **Spec:** FR-15, FR-17.
- **Files:** `pages/SessionWindow.tsx`, `components/ChatPane.tsx`, `e2e/session-002.spec.ts`
- **Depends on:** 39, and spec 002's tasks for session chat
- **Do:** *Chat* inspector tab: consecutive messages from one sender within 5 minutes share a header, `n/2000` counter, disabled input with the reason when stale. Register the chat shortcut (⌃⌘C).
- **Acceptance:**
  - *AC-16 — Given chat messages from two participants, when a participant opens the chat panel and types, then consecutive messages from one sender are grouped, the remaining character count is shown, and in a stale session the input is disabled with a visible reason.* E2E (`test.fixme` until 002 lands), including the chat shortcut toggling the panel.

### 41. `[P]` Description field in the problem editor sheet (after 002)

- **Plan:** Spec 002 surfaces — problem editor sheet *Description* field. **Spec:** FR-16.
- **Files:** `pages/ProblemEditorSheet.tsx`, `pages/ProblemEditorSheet.test.tsx`, `e2e/problems-002.spec.ts`
- **Depends on:** 31, and spec 002's tasks for the description editor
- **Do:** Host 002's formatting and image controls in a *Description* field of the sheet.
- **Acceptance:**
  - *AC-17 — Given an editor creating a problem, when they format text and add an image in the description, then they do it inside the problem editor sheet without leaving it.* E2E (`test.fixme` until 002 lands): pathname unchanged and `dialog[open]` throughout.
