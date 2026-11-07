# 015 — Audi UI redesign: tasks

Source: `plan.md` (section numbers below are plan sections) and `spec.md`. File paths marked *(audit)* are resolved by task 1; the implementer records the real paths in `notes.md` and ticks the task only when they are filled in. Every task opens with the failing test named in its acceptance (constitution 1). Where a task lists "roughly 3 files" it counts a component, its CSS and its test as the unit.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1 | Audit: resolves every "audit confirms" in the plan (screens, spec-003 leftovers, serving container, hub prefix, tests to remove). Nothing else starts before it |
| 2 | 2 | Tokens are the single source every other task reads |
| 3 | 3, 4, 5 — all `[P]` | Base CSS, guard tests and contrast harness only need tokens; disjoint files |
| 4 | 6, 7, 8, 9 — all `[P]` | Fonts, icons, brand generator, logo fetcher: independent of each other, each needs only tokens/base |
| 5 | 10, 11 | Logo spike needs the fetcher (9); serving wiring needs the generator (8) and the audit |
| 6 | 12 | E2E harness (axe, matrix helpers) written failing against the old look; needs serving (11) |
| 7 | 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 — all `[P]` | UI primitives: one folder each, no shared files; need base CSS (3) and icons (7) |
| 8 | 23 | Header, logo and appearance toggle compose primitives, icons and brand output |
| 9 | 24, 25, 26, 27, 28, 29, 30, 31, 32, 33 — all `[P]` | Screen restyling: disjoint screen folders; need primitives and header |
| 10 | 34, 37 — 37 is `[P]` | Brand-fixture e2e needs header and serving; the invite-link button needs the restyled Games flow (32) |
| 11 | 35 | Remove the Apple look only after every screen is converted |
| 12 | 36 | Full responsive, accessibility and keyboard pass, then residual fixes |

## Checklist

- [x] **1** — Audit the current frontend, tests, serving and deploy
- [x] **2** — Design tokens and the kit-values contract test
- [x] **3** — `[P]` Base, type and motion CSS with the focus rule
- [x] **4** — `[P]` Raw-value guard tests and the legacy bridge
- [x] **5** — `[P]` Contrast test harness
- [x] **6** — `[P]` Vendored fallback font and font-face wiring
- [x] **7** — `[P]` Icon map, `Icon` component and fallback icon generator
- [x] **8** — `[P]` Brand-assets CSS generator, ignore rules and repository inspection test
- [x] **9** — `[P]` Logo fetcher script with fixture-based tests
- [x] **10** — Logo extraction spike against the live styleguide
- [x] **11** — Serve `brand/` in dev and deploy, with the empty-stylesheet fallback
- [x] **12** — E2E screen-matrix harness (axe, appearance, widths), failing first
- [x] **13** — `[P]` Button and Spinner
- [x] **14** — `[P]` IconButton, Badge and Tag
- [x] **15** — `[P]` TextField and TextArea
- [x] **16** — `[P]` Select and Menu
- [x] **17** — `[P]` Checkbox, Radio and Switch
- [x] **18** — `[P]` Tabs
- [x] **19** — `[P]` Dialog
- [x] **20** — `[P]` Popover (tooltip) and Toast
- [x] **21** — `[P]` ChatBubble and ListItem
- [x] **22** — `[P]` Card and Divider
- [x] **23** — AppHeader, BrandLogo and AppearanceToggle
- [x] **24** — `[P]` Restyle sign-in and landing
- [x] **25** — `[P]` Restyle session list and "my sessions"
- [x] **26** — `[P]` Restyle session window: description and chat
- [x] **27** — `[P]` Code editor theme and run output panel
- [x] **28** — `[P]` Restyle interactive learning sessions
- [x] **29** — `[P]` Restyle GIF search and chat GIF tile
- [x] **30** — `[P]` Restyle HTML presentations stage
- [x] **31** — `[P]` Restyle hub self-registration
- [x] **32** — `[P]` Restyle Games section and invite flow
- [x] **33** — `[P]` Chess board, pieces and clocks
- [x] **34** — Brand-fixture e2e (fonts, icons, logo, empty directory)
- [x] **35** — Remove the Apple look and supersede spec 003
- [x] **36** — Full responsive, accessibility and keyboard pass
- [x] **37** — `[P]` Always show a copy-invite-link button in the invite flow

## Tasks

### 1. Audit the current frontend, tests, serving and deploy

- **Plan:** intro paragraph, §1.1, §1.5, §1.9, §6.8, §7 items 6 and 8. **Spec:** FR-5, FR-8, FR-9.
- **Files:** `specs/015-audi-ui-redesign/notes.md` (written); frontend, compose and hub files are read only.
- **Depends on:** nothing.
- **Do:** Read-only inventory, appended to `notes.md` under "Audit". Record: (a) every screen in FR-5 with its component folder, route and current minimum supported width; (b) spec-003 leftovers: styles, tokens, appearance storage key and `data-theme` handling, pre-paint script, existing equivalents of each `ui/` primitive; (c) test files that assert only the Apple look (traffic lights, vibrancy, SF type), listed for human approval, with a statement that every other test is untouched; (d) chess piece format (SVG, glyph or image); (e) which container serves the built frontend, the hub path prefix, whether the proxy gates `brand/`, where spec 005's deploy script calls compose, how a missing mount can serve an empty `brand.css`; (f) whether Biome checks CSS; (g) the editor library and how its theme is set. No code changes.
- **Acceptance:**
  - *FR-5 — Given each screen listed in FR-5, when opened, then it renders in the Audi look* — the audit lists every FR-5 screen with a real component path and route; none is missing.
  - *FR-8 — Given the finished redesign, when inspected, then no Apple-style theme remains* — the audit lists all spec-003 artefacts so that task 35 can delete them completely.
  - *FR-9 — Given the existing tests, when run after the redesign, then they pass unchanged in what they assert* — the audit names the exact tests proposed for removal under FR-8, each with a one-line reason.

### 2. Design tokens and the kit-values contract test

- **Plan:** §1.2, §1.3, §4 (token contract). **Spec:** FR-1, FR-6, Consistency NFR.
- **Files:** `frontend/src/styles/tokens.css`, `frontend/src/styles/kit-values.json`, `frontend/src/styles/tokens.test.ts`.
- **Depends on:** 1.
- **Do:** Write the failing contract test first. Transcribe the value tables of `docs/research/audi-figma-kit-tokens.md` into `kit-values.json` (values only). Then define every variable group of §1.3 in `tokens.css`: light on `:root`, explicit `[data-theme="light"]`, `[data-theme="dark"]`, and dark under `@media (prefers-color-scheme: dark) { :root:not([data-theme]) }`. Include the radius, stroke, spacing, elevation, type scale, motion and `--page-margin` per-breakpoint values.
- **Acceptance:**
  - *FR-1 — Given any screen, when loaded, then colours, type, spacing and shapes match the kit's values* — the test resolves every variable in light, dark and the media-query path and asserts equality with `kit-values.json`.
  - *FR-6 — Given the system prefers dark, when a screen loads, then the dark palette is used* — the test asserts the media-query path resolves to the same values as `[data-theme="dark"]`, and that `[data-theme="light"]` wins over a dark system preference.
  - *Consistency NFR* — every variable named in §1.3 exists in `tokens.css`; a missing one fails the test.

### 3. Base, type and motion CSS with the focus rule `[P]`

- **Plan:** §1.4, §1.8 (motion, focus). **Spec:** FR-1, FR-3, FR-4, Accessibility NFR, Performance NFR.
- **Files:** `frontend/src/styles/base.css`, `frontend/src/styles/type.css`, `frontend/src/styles/motion.css` (imported by the app entry point *(audit)*).
- **Depends on:** 2.
- **Do:** Failing test first (a vitest that reads the three files and a browser-free check for the rules below; the computed-style versions run in task 12 and later). `base.css`: reset, canvas background and text colour from tokens, the single `:focus-visible` rule (double ring: 2 px canvas, 4 px `--focus`). `type.css`: the font stack `"Audi Type", "Roboto Flex", Verdana, system-ui, sans-serif`, `font-stretch` per §1.4, classes `.type-display-1/2`, `.type-h1`…`.type-h4`, `.type-copy-1..3`, `.type-label-*`, never uppercase, code/run-output monospace exception. `motion.css`: transitions using `--dur-fast` and `--ease-audi`, and `prefers-reduced-motion` setting durations to 0.
- **Acceptance:**
  - *FR-3 — Given any text on any screen, when rendered, then it uses the Audi typeface and type-scale sizes/weights* — the test asserts the stack order, the scale classes and their sizes against `kit-values.json`.
  - *Accessibility NFR — Given keyboard navigation, when tabbing, then the focused element is always visibly indicated* — the test asserts exactly one `:focus-visible` rule exists in `base.css`, uses the 2 px canvas + 4 px focus double ring, and no other stylesheet sets `outline: none` without a replacement indicator.
  - *Performance NFR* — `motion.css` zeroes durations under reduced motion; no CSS file uses `<link rel=preload>` for fonts.

### 4. Raw-value guard tests and the legacy bridge `[P]`

- **Plan:** §1.1, §1.9, §4 (raw-value guard). **Spec:** FR-1, FR-8.
- **Files:** `frontend/src/styles/guard.test.ts`, `frontend/src/styles/legacy.css`.
- **Depends on:** 2.
- **Do:** Write `guard.test.ts` scanning `src/**/*.{css,tsx,ts}` for hex, `rgb(` and `hsl(` literals outside the allowlist (`tokens.css`, `icons-fallback.css`, the presentation-stage `#fff`), and for `backdrop-filter`, `-apple-system`, `SF Pro`, `BlinkMacSystemFont`, `traffic`, and the existence of `styles/legacy.css`. Create `legacy.css` mapping each spec-003 variable *(audit)* to a new token so the app stays green. Until task 35 the guard runs in "report" mode for existing offenders (a checked-in baseline list that may only shrink); new offenders fail immediately. Task 35 removes the baseline and flips the legacy check to failing.
- **Acceptance:**
  - *FR-1 — Given any screen, then its values come from the kit* — a new file containing `#ff0000` fails the guard; the same literal in `tokens.css` passes.
  - *FR-8 — Given the finished redesign, then no Apple-style theme remains* — the forbidden-string scan fails on `backdrop-filter` in a new file; the baseline list can only shrink (test fails if an entry is added).

### 5. Contrast test harness `[P]`

- **Plan:** §4 (contrast), §1.7 (toast deviation), §1.8. **Spec:** Accessibility NFR, FR-10.
- **Files:** `frontend/src/styles/contrast.ts`, `frontend/src/styles/contrast.test.ts`.
- **Depends on:** 2.
- **Do:** Implement a WCAG ratio function and a declared list of (foreground, background, kind) token pairs per appearance: body text, secondary text, form text and captions, action text on action fills, toast text on each signal fill (black or white, whichever passes), focus ring on canvas, chess square/piece pairs (provisional), editor syntax tokens on the editor background (provisional). Pairs that belong to later tasks are added by those tasks to the same list. Disabled states are exempt.
- **Acceptance:**
  - *Accessibility NFR — Given any text/background pair in light or dark, when measured, then the ratio is at least 4.5:1 (3:1 for large text and UI boundaries)* — the test iterates the list in both appearances and asserts the thresholds; the ratio function is checked against known values (black on white = 21).
  - *FR-10 — Given code with syntax highlighting, then it remains legible in both appearances* — the editor syntax pairs are in the list; any pair under 4.5 is moved one ramp step and noted in `notes.md`.

### 6. Vendored fallback font and font-face wiring `[P]`

- **Plan:** §1.4, §5 (Roboto Flex). **Spec:** FR-3, Performance NFR, Licensing NFR.
- **Files:** `frontend/src/assets/fonts/` (woff2 and OFL licence), `frontend/src/brand/fonts-fallback.css`, `frontend/src/brand/fonts.test.ts`.
- **Depends on:** 3.
- **Do:** Failing test first. Obtain the latin-subset wght+wdth Roboto Flex woff2 via `npm pack @fontsource-variable/roboto-flex` once (not added to `package.json`), vendor it with its OFL licence file. Write `fonts-fallback.css` with the `@font-face` for "Roboto Flex", `font-display: swap`, variable weight and stretch ranges.
- **Acceptance:**
  - *FR-3 — Given the font file has not loaded yet, when the page renders, then text is visible in a fallback face and then swaps* — the test asserts `font-display: swap` on every `@font-face` in the repository CSS.
  - *FR-3 — Given the Audi font files were not supplied, then the repository fallback typeface is used* — the test asserts the vendored file exists, the face name matches the second entry of the stack, and the licence file sits beside it.
  - *Performance NFR* — no `<link rel="preload">` for fonts is present in `index.html`.
  - *Licensing NFR* — the vendored file is the only `.woff`/`.woff2` under `frontend/`.

### 7. Icon map, `Icon` component and fallback icon generator `[P]`

- **Plan:** §1.5 (Icons), §3 (Icon), §5 (lucide-static). **Spec:** FR-2.
- **Files:** `frontend/src/brand/iconMap.ts`, `frontend/src/brand/Icon.tsx` (+ test), `frontend/scripts/gen-fallback-icons.mjs` (generates the committed `frontend/src/brand/icons-fallback.css`).
- **Depends on:** 3.
- **Do:** Failing test first. `iconMap.ts` maps every semantic icon name the app uses *(audit lists them)* to its Audi library name (from the research inventory) and a Lucide fallback name. Add `lucide-static` as a dev dependency. The generator emits one `.icon[data-icon="…"]` rule per name with a `mask-image` data URI, stroke width 1, and the ISC notice. `Icon` renders `<span class="icon" data-icon aria-hidden>` at 16/24/48, coloured with `currentColor`.
- **Acceptance:**
  - *FR-2 — Given Audi icons were not supplied, when a screen with icons is shown, then the fallback icons appear with no missing or blank icon* — the test renders `Icon` for every name in `iconMap` and asserts the matching fallback rule exists in `icons-fallback.css`, with a non-empty mask.
  - *FR-2 — Given Audi icons were supplied, then each icon with an Audi equivalent is the Audi one* — the test asserts each map entry has an Audi name, and that a rule later in the cascade (from `brand.css`) overrides the fallback for the same selector.
  - *Licensing NFR* — no Audi icon geometry appears in the repository (generated CSS contains only Lucide-derived paths).

### 8. Brand-assets CSS generator, ignore rules and repository inspection test `[P]`

- **Plan:** §1.5, §3 (Scripts), §4 (generators, repository inspection). **Spec:** FR-2, FR-3, FR-11, Licensing NFR.
- **Files:** `frontend/scripts/brand-assets.mjs` (+ `brand-assets.test.ts`), `.gitignore` and `.dockerignore` (added lines), `frontend/src/brand/repo.test.ts`.
- **Depends on:** 1.
- **Do:** Failing tests first. The generator scans `--dir` (default `BRAND_DIR` or `brand-assets/`) and writes `brand.css` containing only rules for files present: `@font-face "Audi Type"` per font file (ranges from optional `fonts/fonts.json`, else defaults), `.icon[data-icon="<name>"]` per icon, `.brand-logo` mask rules with the file's aspect ratio from its viewBox when a logo exists. Empty directory yields an empty comment. Exit 0 for missing optional files; exit 1 only if the directory is unwritable. Add `brand-assets/` to both ignore files. The repository test uses `git ls-files`.
- **Acceptance:**
  - *FR-3 — Given the Audi font files were not supplied, then no request for a missing font surfaces* — against an empty temp dir the output contains no `@font-face`, `.icon` or `.brand-logo`; against a fonts-only dir only `@font-face` appears.
  - *FR-2 — Given Audi icons were supplied, then they are the Audi ones* — icons-only dir yields one `.icon[data-icon]` rule per file with a relative `url(icons/<name>.svg)`.
  - *FR-11 — Given the logo asset is supplied, then the header shows it* — logo-only dir yields `.brand-logo` rules; no logo means no `.brand-logo` rule.
  - *FR-11 — Given the repository, when inspected, then it contains no copy of the logo file* — repo test: no tracked path under `brand-assets/`, no `.woff`/`.woff2` other than the vendored OFL one, no tracked file named like `audi*logo*` or `rings*`, and both ignore files list `brand-assets/`.

### 9. Logo fetcher script with fixture-based tests `[P]`

- **Plan:** §1.6, §3 (Scripts), §4 (generators). **Spec:** FR-11, Licensing NFR.
- **Files:** `frontend/scripts/fetch-brand-logo.mjs`, `frontend/scripts/fetch-brand-logo.test.ts`, `frontend/scripts/fixtures/fake-styleguide/` (static SPA-like page).
- **Depends on:** 1.
- **Do:** Failing tests first. Implement candidate collection, validation and writing exactly as §1.6 steps 1–5 using the already-present Playwright, with `--url` overridable so tests point at the fixture. Fake third-party site is the single permitted fake. A candidate is accepted only if it is SVG without `<text>`/`<image>` and aspect 2.5–4.5:1, or a non-opaque PNG with alpha in the same range. Always exit 0.
- **Acceptance:**
  - *FR-11 — Given the logo could not be obtained, when the header is shown, then the app name appears and no broken image or gap is visible* — fixture with no logo, a timeout, and a blocked request each exit 0, write nothing and print a warning.
  - *FR-11 — Given the logo asset is supplied, then it is usable* — fixture with a valid SVG writes `logo.svg` and `logo.source.txt` (URL, date).
  - *Plan §1.6 step 3* — an opaque PNG and a wrong-aspect SVG are both rejected.

### 10. Logo extraction spike against the live styleguide

- **Plan:** §1.6 (unverified paragraph), §4 (live smoke), §7 item 1. **Spec:** FR-11.
- **Files:** `specs/015-audi-ui-redesign/notes.md` (written), `frontend/scripts/fetch-brand-logo.mjs` (adjusted if the live DOM requires).
- **Depends on:** 9.
- **Do:** Use Playwright to open `https://styleguide.audi.com/document/2865#/-/ui-introduction` and find the source of the four-rings logo (rendered DOM, inline SVG and network responses). Make `fetch-brand-logo.mjs` cache what it finds at runtime into the gitignored `brand-assets/` (`logo.svg|png` plus `logo.source.txt`); it is never committed and never hot-linked by the browser. Record in `notes.md` the outcome, the candidates found, which one was accepted or why none were, and the file type and size. Keep task 9's tests green. If extraction proves impossible, record that the app-name fallback ships and that the human decides whether to place `logo.svg` by hand; do not revise the spec.
- **Acceptance:**
  - *FR-11 — Given the logo asset is supplied, when the header is shown in light and in dark, then it is visible with sufficient contrast* — `notes.md` states whether a logo was obtained from the live page and that the cached file passes the task 9 validation.
  - *FR-11 — Given the logo could not be obtained, then the fallback applies* — if the live run fails, `notes.md` says so and the exit code was 0.
  - *FR-11 — Given the repository, when inspected, then it contains no copy of the logo file* — the cached file sits under `brand-assets/`, `git status` shows no new tracked file other than `notes.md` and script edits, and the task 8 repository test passes.

### 11. Serve `brand/` in dev and deploy, with the empty-stylesheet fallback

- **Plan:** §1.5, §1.6 (last paragraph), §3 (Served paths), §7 item 8. **Spec:** FR-2, FR-3, FR-11, Licensing NFR.
- **Files:** `frontend/vite.config.ts` (dev plugin serving `BRAND_DIR` at `<BASE>brand/`), `frontend/index.html` (`<link>` to `brand/brand.css`), `frontend/scripts/brand.sh` and the compose/hub deploy files *(audit)*.
- **Depends on:** 1, 8.
- **Do:** Failing test first (below). Dev: plugin serves the directory and runs the generator at server start. Runtime cache: when `logo.*` is absent from `brand-assets/`, the dev server and the serving container run `fetch-brand-logo.mjs` then the generator once at start-up (non-blocking, failures only warn), so the logo is cached on first run and reused afterwards. Deploy: mount `brand-assets/` into the serving container *(audit)* — writable for that cache (read-only if the cache is pre-filled by `brand.sh`), serve it unauthenticated at `<BASE_URL>brand/` so guests get it, return an empty stylesheet for `brand/brand.css` when no mount exists, and call `brand.sh` before `docker compose up` in the deploy script. Keep the pre-paint theme script. The `<link>` is unconditional and uses `BASE_URL`.
- **Acceptance:**
  - *FR-3 — Given no font files supplied, when the page renders, then no request for a missing font error surfaces* — an integration test starts the dev server with an unset/empty `BRAND_DIR` and asserts `brand/brand.css` returns 200 with no `@font-face`, and the page logs no console error and makes no 4xx request.
  - *FR-11 — Given a guest opens a chess invite link, then brand assets are available* — against the real stack, an unauthenticated request to `brand/brand.css` returns 200.
  - *FR-11 — Given the logo is absent at start-up, then it is fetched and cached once, and the header shows it after the generator reruns; given the fetch fails, then start-up still succeeds and the app name shows* — integration test with the task 9 fixture site as `--url`.
  - *Licensing NFR* — the cache lives only in gitignored `brand-assets/`; the repo inspection test (task 8) stays green.

### 12. E2E screen-matrix harness (axe, appearance, widths), failing first

- **Plan:** §4 (integration / e2e), §5 (`@axe-core/playwright`), end of §4 (runtime split). **Spec:** FR-1, FR-5, FR-6, FR-6a, FR-7, Accessibility NFR.
- **Files:** `e2e/audi/matrix.ts` (screen list, width and scheme parametrization, `VISUAL_FULL` split), `e2e/audi/checks.ts` (shared assertions), `e2e/audi/appearance.spec.ts`.
- **Depends on:** 1, 3, 11.
- **Do:** Add `@axe-core/playwright` as a dev dependency. Write the matrix over {light, dark via `emulateMedia`} × widths {1024, 1920, each screen's lower bound}, with `VISUAL_FULL=1` adding 1440. Shared assertions: no horizontal overflow, no overlapping sibling controls, no console errors, no failed/4xx requests, axe colour-contrast and focus rules, computed-style checks (canvas background, first font-family entry, headline `font-stretch`, radius 0 on buttons and inputs, no `backdrop-filter`). Write the appearance spec. Screens are registered from the audit list; screen tasks 24–33 add their own spec files that call these helpers. All of this fails against the current look.
- **Acceptance:**
  - *FR-6 — Given the system prefers dark, when any screen loads, then the dark palette is used; given a flip while open, then the app follows without reload* — appearance spec: dark → dark canvas; flip `emulateMedia` → canvas changes with no navigation.
  - *FR-6a — Given the user picks light in the toggle, then it is shown immediately and after reload; given "system", then the app follows the system again* — appearance spec drives the toggle (added in task 23; marked `test.fixme` here with a reference to task 23 and un-fixme'd there).
  - *FR-7 — Given a viewport at each supported width, then no horizontal scroll and no overlapping controls* — the shared check runs and fails on at least one screen against the current look.

### 13. Button and Spinner `[P]`

- **Plan:** §1.7 (Button, Spinner), §3. **Spec:** FR-4.
- **Files:** `frontend/src/ui/Button.tsx`, `frontend/src/ui/Spinner.tsx`, `frontend/src/ui/button.css` (+ `Button.test.tsx`).
- **Depends on:** 3, 7.
- **Do:** Failing test first. Primary/secondary/tertiary, sizes xs 32 / sm 48 / md 56, radius 0, min width 144 for primary/secondary, loading replaces the icon slot with `Spinner`, disabled has no pointer events. Forward ref, className and native attributes; an existing button component *(audit)* is replaced in place.
- **Acceptance:**
  - *FR-4 — Given a button, when hovered, focused, pressed, disabled, then each state is visually distinct and matches the Audi states* — the test asserts distinct computed colours per state from `--action-*` tokens for primary and secondary, `disabled` blocks `onClick`, and loading renders a spinner and sets `aria-busy`.
  - *FR-9* — role, accessible name and native attributes pass through; existing button call-site tests still pass.

### 14. IconButton, Badge and Tag `[P]`

- **Plan:** §1.7 (Badge/Tag), §3. **Spec:** FR-4.
- **Files:** `frontend/src/ui/IconButton.tsx`, `frontend/src/ui/Badge.tsx`, `frontend/src/ui/Tag.tsx` and one CSS file (+ test).
- **Depends on:** 3, 7.
- **Do:** Failing test first. `IconButton` requires `label` (aria-label), supports `toggled`. `Badge` kinds dot/count/alert, small badge a filled circle. `Tag` with `selected` and optional click.
- **Acceptance:**
  - *FR-4 — Given a badge, when shown, then it follows the Audi badge* — dot is a `--radius-max` filled circle; count shows the value; alert uses `--negative`.
  - *FR-4 — Given a button (icon), when hovered, focused, pressed, disabled, then each state is distinct* — computed colours differ pairwise; the accessible name equals `label`; `toggled` sets `aria-pressed`.
  - *FR-9* — a Tag with `onClick` is keyboard operable (Enter/Space).

### 15. TextField and TextArea `[P]`

- **Plan:** §1.7 (Input, Text area), §3. **Spec:** FR-4.
- **Files:** `frontend/src/ui/TextField.tsx`, `frontend/src/ui/TextArea.tsx`, `frontend/src/ui/field.css` (+ test).
- **Depends on:** 3, 7.
- **Do:** Failing test first. Underline field: 56 px row, 1 px underline, 2 px when active, static label above, `error` sets `aria-invalid` and `aria-describedby`, shows the message and a 16 px alert icon, read-only fill. `TextArea`: 1 px box, 12 px padding, counter when `maxLength` set. Placeholders, labels and roles are preserved so existing tests are unchanged.
- **Acceptance:**
  - *FR-4 — Given an input with invalid content, when validated, then the Audi error state appears with its message* — error prop renders the message, `aria-invalid="true"`, and the underline, label and message use `--negative`.
  - *FR-4 — hover, focus, active, disabled states* — computed underline colour and width differ per state.
  - *FR-9* — `getByPlaceholderText` and `getByLabelText` still find the control.

### 16. Select and Menu `[P]`

- **Plan:** §1.7 (Input/Select, Menu), §3. **Spec:** FR-4.
- **Files:** `frontend/src/ui/Select.tsx`, `frontend/src/ui/Menu.tsx`, `frontend/src/ui/menu.css` (+ test).
- **Depends on:** 3, 7, 15 is not required (shared `field.css` is read only).
- **Do:** Failing test first. `Select` underline style with the options panel on `--surface-2`, `--elev-2`, option radius `--radius-sm`, hover `--neutral-700`; error state as TextField. `Menu` with trigger and items, same panel; keyboard arrows, Esc to close, focus return.
- **Acceptance:**
  - *FR-4 — Given a menu, when shown, then it follows the corresponding Audi component* — panel fill, elevation and option radius asserted; hover colour differs from idle.
  - *FR-4 — Given a select with an error, then the Audi error state appears with its message*.
  - *FR-9* — arrow, Enter and Esc keyboard behaviour is asserted; the focused option is visibly indicated.

### 17. Checkbox, Radio and Switch `[P]`

- **Plan:** §1.7 (Checkbox / Radio / Switch), §3. **Spec:** FR-4.
- **Files:** `frontend/src/ui/Checkbox.tsx`, `frontend/src/ui/Radio.tsx`, `frontend/src/ui/Switch.tsx` and one CSS file.
- **Depends on:** 3.
- **Do:** Failing test first. Checkbox 20 px, radius 2; radio circle; switch 56×32 pill. Native inputs stay in the DOM so role, label and form behaviour are unchanged.
- **Acceptance:**
  - *FR-4 — Given a toggle, when hovered, focused, active, disabled, then each state is distinct and matches the Audi component* — computed sizes and radii match the kit (20/2, circle, 56×32/pill); disabled blocks changes.
  - *FR-9* — `getByRole("checkbox"|"radio"|"switch")` with the label name still works; Space toggles.

### 18. Tabs `[P]`

- **Plan:** §1.7 (Tabs), §3. **Spec:** FR-4.
- **Files:** `frontend/src/ui/Tabs.tsx`, `frontend/src/ui/tabs.css` (+ test).
- **Depends on:** 3, 7.
- **Do:** Failing test first. 56 px bar, active 2 px underline with `--nav-active`, idle `--nav-idle`, `role="tablist"`/`tab`/`aria-selected` preserved, optional icon.
- **Acceptance:**
  - *FR-4 — Given a tab bar, when shown, then it follows the Audi component* — active vs idle colours and the 2 px underline asserted; height 56.
  - *FR-9* — arrow keys move between tabs, Enter/Space selects, `getByRole("tab", {name})` still finds each tab.

### 19. Dialog `[P]`

- **Plan:** §1.7 (Dialog), §3. **Spec:** FR-4, FR-7.
- **Files:** `frontend/src/ui/Dialog.tsx`, `frontend/src/ui/dialog.css` (+ test).
- **Depends on:** 3, 7, 13 (close button uses `Button`/`IconButton` once available; until then a plain native button).
- **Do:** Failing test first. Centred tile, radius 0, `--elev-4`, padding 16, 48 px close button top-right, scrim `--scrim`, full screen below 768 px, focus trap and Esc as today, focus returns to the opener.
- **Acceptance:**
  - *FR-4 — Given a dialog, when shown, then it follows the corresponding Audi component* — scrim, radius 0, elevation and close-button size asserted.
  - *FR-7 — Given a narrow viewport, then no clipped controls* — below 768 px the dialog fills the viewport.
  - *FR-9* — Tab cycles inside the dialog, Esc closes, focus returns to the trigger.
- **Note:** if task 13 has not landed when this runs, use a native `<button>` and mark that in `notes.md`; task 36 re-checks.

### 20. Popover (tooltip) and Toast `[P]`

- **Plan:** §1.7 (Tooltip, Toast), §3. **Spec:** FR-4, Accessibility NFR.
- **Files:** `frontend/src/ui/Popover.tsx`, `frontend/src/ui/Toast.tsx`, `frontend/src/ui/overlay.css`.
- **Depends on:** 3, 5, 7.
- **Do:** Failing test first. Tooltip: `--canvas-inverted` fill, `--canvas` text, 12/16, shown on hover and focus, `role="tooltip"`. Toast tones info/success/notice/negative; text colour black or white, whichever meets 4.5:1 on the fill (recorded deviation); `role="status"` (`alert` for negative); optional close. Add the toast pairs to the task 5 contrast list.
- **Acceptance:**
  - *FR-4 — Given a toast, when shown, then it follows the Audi notification* — tone fills match the signal tokens; each tone's text colour passes 4.5:1 in both appearances (contrast list).
  - *FR-4 — Given a tooltip, when shown, then it follows the Audi popover* — appears on hover and keyboard focus; hidden on Esc.
  - *Accessibility NFR* — `role` values asserted so assistive tech announces them.

### 21. ChatBubble and ListItem `[P]`

- **Plan:** §1.7 (Chat bubble, List). **Spec:** FR-4, FR-10.
- **Files:** `frontend/src/ui/ChatBubble.tsx`, `frontend/src/ui/ListItem.tsx`, `frontend/src/ui/chat.css` (+ test).
- **Depends on:** 3.
- **Do:** Failing test first. Bubble radius 0, no tail; others on `--neutral-700` with `--text`; own on `--action-primary-fill` with `--action-primary-text`; author in label type, time in `--form-caption`. List rows separated by 1 px `--divider`, hover `--neutral-700`, no rounded rows. Content children render unchanged, so GIFs and links inside bubbles are untouched.
- **Acceptance:**
  - *FR-4 — Given a chat bubble, when shown, then it follows the corresponding Audi component* — own vs other fill/text colours and radius 0 asserted.
  - *FR-4 — Given a list, then rows are Audi-styled* — divider and hover colour asserted.
  - *Accessibility NFR* — both bubble pairs are in the contrast list and pass in light and dark.

### 22. Card and Divider `[P]`

- **Plan:** §1.7 (Card). **Spec:** FR-1, FR-4.
- **Files:** `frontend/src/ui/Card.tsx`, `frontend/src/ui/Divider.tsx`, `frontend/src/ui/card.css`.
- **Depends on:** 3.
- **Do:** Failing test first. Card on `--surface-1`, `--elev-card` in light and an outline in dark, no radius, 16 padding, hover effect only when the whole card is a single link. Divider uses `--divider`.
- **Acceptance:**
  - *FR-1 — Given any screen, then shapes match the kit* — radius 0, padding 16, elevation per appearance asserted.
  - *FR-9* — a Card that is a link stays a single focusable link with its accessible name.

### 23. AppHeader, BrandLogo and AppearanceToggle

- **Plan:** §1.2 (FR-6a), §1.5 (Logo), §1.7 (Header), §3. **Spec:** FR-6, FR-6a, FR-11, FR-7.
- **Files:** `frontend/src/ui/AppHeader.tsx`, `frontend/src/ui/AppearanceToggle.tsx`, `frontend/src/brand/BrandLogo.tsx` (+ tests); existing header call site *(audit)*.
- **Depends on:** 7, 8, 11, 12, 13, 14, 16, 18.
- **Do:** Failing tests first (un-fixme the toggle test from task 12). Header 56 px with `--page-margin` padding: logo and app name left, tabs, then appearance toggle and account menu. `BrandLogo` renders `.brand-logo` (role img, label "Audi") plus `.brand-name`; with no logo rule the logo is `display:none` and the name shows with no gap. `AppearanceToggle` restyles the existing system/light/dark preference, keeping its storage key and `data-theme` attribute *(audit)*; "system" clears the stored value.
- **Acceptance:**
  - *FR-11 — Given the logo asset is supplied, when the header is shown in light and in dark, then the logo is visible with sufficient contrast* — rings take `currentColor`; contrast of the header text colour on the canvas is in the contrast list.
  - *FR-11 — Given a narrow viewport, then the logo is not clipped or distorted* — logo height fixed at 24 px and width from the aspect ratio; header does not overflow at the screen's lower bound.
  - *FR-11 — Given the logo could not be obtained, then the app name appears and no broken image or gap is visible* — with no logo rule the name's left edge equals the header padding.
  - *FR-6a — Given the system prefers dark, when the user picks light, then light is shown immediately and after reload; given "system", then the app follows the system* — unit test on the toggle plus the un-fixme'd e2e.

### 24. Restyle sign-in and landing `[P]`

- **Plan:** §1.1, §1.7, §1.9. **Spec:** FR-1, FR-5, FR-7, FR-9.
- **Files:** sign-in and landing components and styles *(audit)*, `e2e/audi/signin-landing.spec.ts`.
- **Depends on:** 12, 13, 15, 23.
- **Do:** Write the e2e spec using the matrix helpers first (fails against the old look). Replace the screen's controls with `ui/` primitives and its CSS with tokens; remove spec-003 styling it carries; use `legacy.css` aliases only for leftovers not yet converted.
- **Acceptance:**
  - *FR-5 — Given the sign-in/landing screen, when opened, then it renders in the Audi look and passes the FR-1 check* — matrix assertions (palette, font, radius 0, no `backdrop-filter`) pass in both appearances at every width.
  - *FR-7 — no horizontal scroll* — shared overflow and overlap checks pass.
  - *FR-9* — existing tests for the screen pass unchanged.

### 25. Restyle session list and "my sessions" `[P]`

- **Plan:** §1.1, §1.7 (Card, List, Badge). **Spec:** FR-1, FR-5, FR-7, FR-9.
- **Files:** session-list components and styles *(audit)*, `e2e/audi/session-list.spec.ts`.
- **Depends on:** 12, 14, 21, 22, 23.
- **Do:** Failing e2e first, then convert the list, cards, tags/badges, empty states and filters to primitives and tokens.
- **Acceptance:**
  - *FR-5 — Given session list and "my sessions", when opened, then each renders in the Audi look and passes the FR-1 check* — matrix assertions on both screens.
  - *FR-7* — overflow and overlap checks pass at every width.
  - *FR-9* — existing tests for these screens pass unchanged.

### 26. Restyle session window: description and chat `[P]`

- **Plan:** §1.7 (Text area, Chat bubble, Tabs), §1.8 (run output / chat). **Spec:** FR-1, FR-4, FR-5, FR-7, FR-9.
- **Files:** session window shell, description and chat components and styles *(audit)*, `e2e/audi/session-window.spec.ts`.
- **Depends on:** 12, 15, 18, 21, 23.
- **Do:** Failing e2e first, then restyle the window layout, description panel, chat list, composer (`TextArea`), send button and panel tabs. Panels use `--surface-1`/`--canvas` with 1 px `--divider`. The editor and run output are task 27.
- **Acceptance:**
  - *FR-5 — Given the session window, when opened, then it renders in the Audi look and passes the FR-1 check*.
  - *FR-4 — Given a chat bubble, then it follows the Audi component* — own and others' messages asserted in the real window.
  - *FR-7* — overflow and overlap checks pass; the chat input stays pinned as today.
  - *FR-9* — existing session-window tests pass unchanged.

### 27. Code editor theme and run output panel `[P]`

- **Plan:** §1.8 (Code editor, run output). **Spec:** FR-1, FR-9, FR-10.
- **Files:** `frontend/src/components/CodeEditor.tsx`, `frontend/src/components/editorTheme.ts` (+ test), run-output styles *(audit)*.
- **Depends on:** 5, 12, 23.
- **Do:** Failing test first. Build the editor theme object from CSS variables so it follows light/dark without re-instantiation; chrome from neutral tokens; cursor and selection `--focus`; syntax: comments `--form-caption`, keywords `--text-interactive` bold, strings `--intelligent`, numbers `--neon-blue`, functions/types `--text`, errors `--negative`. Code and run output keep the monospace stack. Run output stderr in `--negative`. Do not touch Tab-at-cursor behaviour in `editorTab.ts`.
- **Acceptance:**
  - *FR-10 — Given code with syntax highlighting, when shown, then it remains legible in both appearances* — every syntax pair is in the contrast list and passes 4.5:1; any adjusted value is noted in `notes.md`.
  - *FR-9 — Given the code editor, when Tab is pressed at the cursor, then the existing behaviour still applies* — `editorTab.test.ts` and `e2e/editor-tab.spec.ts` pass unchanged.
  - *FR-1* — editor background and gutter come from tokens; the guard finds no raw colour in the files.

### 28. Restyle interactive learning sessions `[P]`

- **Plan:** §1.1, §1.7. **Spec:** FR-1, FR-5, FR-7, FR-9.
- **Files:** learning-session components and styles *(audit)*, `e2e/audi/learning.spec.ts`.
- **Depends on:** 12, 13, 15, 18, 23.
- **Do:** Failing e2e first, then convert controls and layout to primitives and tokens.
- **Acceptance:**
  - *FR-5 — Given an interactive learning session, when opened, then it renders in the Audi look and passes the FR-1 check*.
  - *FR-7* — overflow and overlap checks pass at every width.
  - *FR-9* — existing learning-session tests pass unchanged.

### 29. Restyle GIF search and chat GIF tile `[P]`

- **Plan:** §1.8 (Third-party content). **Spec:** FR-1, FR-5, FR-10.
- **Files:** GIF search components and styles *(audit)*, `e2e/audi/gif.spec.ts`.
- **Depends on:** 12, 15, 19, 21, 23.
- **Do:** Failing e2e first, then restyle the search dialog/panel and result grid. GIFs render in a tile with a `--neutral-700` placeholder background, pixels untouched.
- **Acceptance:**
  - *FR-5 — Given GIF search, when opened, then it renders in the Audi look and passes the FR-1 check*.
  - *FR-10 — Given a chat GIF, when shown, then it remains legible in both appearances* — tile and placeholder visible in light and dark, caption text passes contrast.

### 30. Restyle HTML presentations stage `[P]`

- **Plan:** §1.8 (Third-party content). **Spec:** FR-1, FR-5, FR-10.
- **Files:** presentation components and styles *(audit)*, `e2e/audi/presentations.spec.ts`.
- **Depends on:** 12, 13, 23.
- **Do:** Failing e2e first, then restyle the presentation controls and put the iframe in a stage with `color-scheme: light; background: #fff` in both appearances and a 1 px `--divider` border. The `#fff` is the one allowlisted raw literal (task 4).
- **Acceptance:**
  - *FR-5 — Given HTML presentations, when opened, then they render in the Audi look and pass the FR-1 check*.
  - *FR-10 — Given an HTML presentation with no background, when shown in dark appearance, then it remains legible* — the stage is white and its text contrast is at least 4.5:1.

### 31. Restyle hub self-registration `[P]`

- **Plan:** §1.1, §1.7. **Spec:** FR-1, FR-5, FR-7, FR-9.
- **Files:** self-registration components and styles *(audit)*, `e2e/audi/self-registration.spec.ts`.
- **Depends on:** 12, 13, 15, 23.
- **Do:** Failing e2e first, then convert forms, validation messages and buttons to primitives and tokens.
- **Acceptance:**
  - *FR-5 — Given hub self-registration, when opened, then it renders in the Audi look and passes the FR-1 check*.
  - *FR-4 — Given an input with invalid content, then the Audi error state appears with its message* — an invalid entry on the real form shows the negative underline and message.
  - *FR-9* — existing registration tests pass unchanged.

### 32. Restyle Games section and invite flow `[P]`

- **Plan:** §1.8 (Chess: invite flow), §1.7. **Spec:** FR-1, FR-4, FR-5, FR-7, FR-9.
- **Files:** games lobby and invite components and styles *(audit)*, `e2e/audi/games.spec.ts`.
- **Depends on:** 12, 15, 19, 20, 22, 23.
- **Do:** Failing e2e first, then restyle the games lobby, game cards, and the invite dialog with `Dialog`, `TextField` and `Button`. The chess board itself is task 33.
- **Acceptance:**
  - *FR-5 — Given the Games section and invite flow, including chess as a guest via invite link, when opened, then each renders in the Audi look and passes the FR-1 check*.
  - *FR-4 — Given a dialog or toast in the flow, then it follows the Audi component*.
  - *FR-9* — existing games and invite tests pass unchanged.

### 33. Chess board, pieces and clocks `[P]`

- **Plan:** §1.8 (Chess board). **Spec:** FR-1, FR-5, FR-7, FR-9, Accessibility NFR.
- **Files:** chess board, piece and clock components and styles *(audit)*, `e2e/audi/chess.spec.ts`.
- **Depends on:** 5, 12, 23.
- **Do:** Failing e2e and contrast pairs first. Board squares `--board-light`/`--board-dark` (light #E6E6E6/#999999, dark #B3B3B3/#4D4D4D; adjust per the contrast test), selection and last move from `--focus` via `color-mix`, legal-move markers `--highlight`. White pieces a light fill with a dark 1 px outline, black the inverse. Clocks `type-h3`, `tabular-nums`, low time `--negative`, active side underlined. Only fills/outlines of piece artwork change *(audit says whether pieces are SVG, glyphs or images)*.
- **Acceptance:**
  - *FR-5 — Given the chess board, pieces and clocks, when opened (including as guest via invite link), then they render in the Audi look and pass the FR-1 check*.
  - *Accessibility NFR — Given any piece/square pair, then UI boundaries are at least 3:1 in light and dark* — all four piece-colour × square-colour pairs are in the contrast list per appearance.
  - *FR-7* — the board and clocks fit without horizontal scroll at each width.
  - *FR-9* — existing chess tests pass unchanged.

### 34. Brand-fixture e2e (fonts, icons, logo, empty directory)

- **Plan:** §4 (brand fixtures, font load). **Spec:** FR-2, FR-3, FR-11, Performance NFR.
- **Files:** `e2e/audi/brand.spec.ts`, `e2e/audi/fixtures/` (generated synthetic files only; the vendored fallback woff2 reused as the "Audi" face, a dummy SVG icon and logo, none Audi assets).
- **Depends on:** 11, 23.
- **Do:** Failing spec first. Build a temp `brand-assets/`, run the generator, serve it via the dev server `BRAND_DIR`. Cases: all supplied; empty directory; font file route-delayed 3 s.
- **Acceptance:**
  - *FR-3 — Given the Audi font files were supplied, then `document.fonts.check('16px "Audi Type"')` is true; given not supplied, then no request for `brand/fonts` is made and no error surfaces*.
  - *FR-3 — Given the font file has not loaded yet, then text is visible in a fallback face and then swaps* — during the delay, text has a non-zero box and `visibility: visible`; afterwards the face swaps.
  - *FR-2 — Given a supplied icon and an unsupplied one, then the supplied icon's mask URL is requested and the unsupplied one shows the fallback glyph*.
  - *FR-11 — Given a logo is supplied, then it is visible in light and dark; given none, then `.brand-logo` is hidden, the app name is visible and the header has no gap*.

### 35. Remove the Apple look and supersede spec 003

- **Plan:** §1.9, §4 (raw-value guard). **Spec:** FR-8, FR-9.
- **Files:** `frontend/src/styles/legacy.css` (deleted), spec-003 styles and the tests listed in the audit *(audit)*, `specs/README.md` (003 row marked superseded by 015, 015 row added).
- **Depends on:** 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 37.
- **Do:** Flip the task 4 guard: remove the baseline list and make the `legacy.css` existence check fail. Delete `legacy.css`, any remaining spec-003 styling, traffic-light chrome, vibrancy, SF stacks and large radii. Remove only the tests approved in the audit, citing FR-8 in the commit message. Mark spec 003 superseded in `specs/README.md` and add the 015 index row. Any other test needing a change is a plan violation: stop and raise it.
- **Acceptance:**
  - *FR-8 — Given the finished redesign, when the codebase and UI are inspected, then no Apple-style theme remains in use* — the guard passes with no baseline: no forbidden strings, no `legacy.css`, no raw colours outside the allowlist.
  - *FR-8 — computed* — the e2e screen matrix asserts no `backdrop-filter` on any screen.
  - *FR-9 — Given the existing tests, when run, then they pass unchanged in what they assert* — the full non-slow unit and e2e suites are green with only the approved removals.

### 36. Full responsive, accessibility and keyboard pass

- **Plan:** §4 (accessibility, FR-7, runtime split), §6.2. **Spec:** FR-7, FR-9, Accessibility NFR, Existing-tests NFR.
- **Files:** `e2e/audi/a11y-sweep.spec.ts` plus residual fixes in files named by the failures; results appended to `specs/015-audi-ui-redesign/notes.md`.
- **Depends on:** 35.
- **Do:** Write the keyboard sweep (tab through every focusable element on each screen and assert a visible indicator: non-none box-shadow or outline), then run the whole matrix with `VISUAL_FULL=1` (1024, 1440, 1920 and each screen's lower bound, both appearances) and the full suite once with `--full`. Fix residual failures in the owning files, split the fix into a new task in this list if it exceeds the three-file size. Record contrast adjustments, the monospace exception, the toast text deviation and any icon-fidelity issues at 16/48 px in `notes.md`.
- **Acceptance:**
  - *Accessibility NFR — Given keyboard navigation, when tabbing through any screen, then the focused element is always visibly indicated* — sweep passes for all FR-5 screens.
  - *Accessibility NFR — Given any text/background pair in light or dark, then the ratio meets 4.5:1 (3:1 large/UI)* — contrast unit and axe pass on every screen in both appearances.
  - *FR-7 — Given a viewport at each width supported today, then no horizontal scroll and no clipped or overlapping controls* — passes for the full width set.
  - *FR-9 — Given the existing end-to-end and unit tests, when run after the redesign, then they pass unchanged in what they assert* — full suite green.

### 37. Always show a copy-invite-link button in the invite flow `[P]`

- **Plan:** none — **not covered by plan.md**. **Spec:** FR-12 (added to spec.md at the human's request, 2026-11-06).
- **Files:** the invite-flow component in the Games section and the existing LeetCode problem tab's copy-link button *(audit)*, `e2e/audi/invite-copy.spec.ts`.
- **Depends on:** 14, 20, 32.
- **Do:** Failing e2e first. Wherever an invite link is shown in the invite flow, always render a copy button next to it, reusing the same component/helper the LeetCode problem tab already uses for its copy-link button (extract it to a shared `ui/` piece if it is local to that tab, keeping that tab's behaviour unchanged). Use `IconButton` with a "Copy invite link" label and a `Toast` confirmation. The button is visible whenever the link is, in every state of the flow (not only after hover or after creating the invite).
- **Acceptance:**
  - *Given the invite flow shows an invite link, when the dialog or panel is open, then a copy button is visible without any extra interaction* — asserted in light and dark at each width.
  - *Given the copy button, when activated by mouse or keyboard, then the invite link is on the clipboard and a confirmation toast appears.*
  - *Given the LeetCode problem tab, then its copy-link button behaves exactly as before* — its existing tests pass unchanged (FR-9).
