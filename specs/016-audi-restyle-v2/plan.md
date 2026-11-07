# 016 — Audi restyle v2: plan

Inputs: `spec.md`, `memory/constitution.md` only. Per the skill's context rule no code and no other feature's artifacts were read. Where a decision depends on existing code (file names, existing endpoints, existing tests) it is marked **[CONFIRM]**. `/sdd-tasks` must resolve each one by reading the code before it writes the task, and flag any that contradict this plan.

## Architecture

Two kinds of change: a front-end-wide visual layer (FR-1 to FR-16) and one small back-end addition (FR-17). No new services.

### Front end (React, TypeScript strict, Vite; stack unchanged)

**1. Design tokens: single source of visual values (NFR Consistency, FR-1, FR-10).**
- One stylesheet of CSS custom properties, `tokens.css`, is the only place colour, radius, spacing, shadow, glow, motion duration and z-index values are defined.
- It defines the palette twice: `:root` (light) and `[data-theme="dark"]` (dark). Dark also applies under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme])`. That gives FR-10: follow the system with no reload when no choice is stored, and an explicit choice overrides it.
- Every other stylesheet and component uses `var(--…)` only. No literal colours, radii or durations remain outside `tokens.css`. A lint-style test enforces this (see Test strategy).
- Accent is a single `--accent` family (base, hover, pressed, on-accent text, glow). Red is `--danger` only, for errors and destructive actions (spec open-questions resolution).
- Token pairs for text and surface are chosen so each pair is at least 4.5:1 in both themes, and UI boundaries at least 3:1. This includes the accent on its backgrounds and text over edge-lit and vent areas. A contrast test checks the pairs (see Test strategy).

**2. Shared primitives (FR-1, FR-4, FR-5, FR-7, FR-8, FR-11).** Small components or CSS classes in a `ui/` folder **[CONFIRM: existing component and style layout]**:
- `Button` with variants `primary` (solid accent pill with glow), `secondary` (outlined or tonal pill) and `danger`. It has distinct hover, focus-visible, active, disabled and error states. Transitions use `--motion-fast`.
- `Card` / `Tile` with large radius and a tone background. The edge-light border is a `::before` pseudo-element: a masked `linear-gradient` strongest at the top-left corner, with `pointer-events: none` and sitting under content (z-index below it). It never overlays text.
- `LiveBadge`: a dot plus the visible text "Live". The dot pulses via one keyframe. The text keeps meaning without motion.
- `ChatBubble` styling: radius on three corners and a pointed fourth. The user's own bubble uses the accent.
- Replace spec 015 square, outlined styles with these. Screens consume the primitives and do not restyle individually.

**3. Header, vent texture, light line (FR-2, FR-3).**
- The vent texture is a CSS `repeating-linear-gradient` with a mask-image fade, set on the header pseudo-element. It is static. FR-3 says it must not animate under reduced motion, and a static texture satisfies that. Nothing is animated for it by default.
- The light line is a 1–2px element under the header. Its sweep is a CSS `transform: translateX` animation on a gradient child, compositor-only, so no layout or paint cost. It runs only when the header has the class `is-live`. Reduced motion is handled with `@media (prefers-reduced-motion: reduce)` turning off all animations and transitions at the token level (`--motion-*: 0s`, `animation: none`).
- `is-live` comes from `useAnyLive()`: true when at least one session or game visible to the user is live. It reads data the app already fetches for the session and game lists, so there are no new requests **[CONFIRM: existing live flag on sessions and games]**.
- First paint: the sweep starts after mount through a class toggle. The texture and line add no blocking assets.

**4. Appearance menu (FR-6, FR-10).**
- `ThemeProvider` holds `choice: "light" | "dark" | "system"`, persisted in `localStorage` under one key **[CONFIRM: reuse the existing key if spec 015 had one]**. It sets or removes `data-theme` on `<html>`. A tiny inline script in `index.html` applies the stored choice before first paint to avoid a flash.
- `ThemeMenu` is a floating panel with `role="menu"` and three `menuitemradio` items. Each has an icon, and the current one carries a check and `aria-checked`. The panel is rendered in a portal to `document.body` with `position: fixed`, positioned from the trigger's rect and clamped to the viewport on open and on resize. It sits at the top z-index token, so it is always on screen and above content.
- Keyboard: ArrowDown and ArrowUp move focus, wrapping. Enter applies the choice. Escape closes and returns focus to the trigger. A click outside closes it.

**5. Jump bar (FR-15).**
- `JumpBar` is a header trigger plus a command-palette dialog (`role="dialog"`, with a combobox input and a `listbox`). A global `keydown` for `⌘K` / `Ctrl+K` opens it, calling `preventDefault`. Escape closes and returns focus to the previous element.
- Data comes from a `useJumpIndex()` hook that assembles an in-memory list from what the app already holds: sessions list, problems list and a static list of app areas. **No new endpoint and no new search data.** Filtering is a client-side case-insensitive substring match with a stable order of areas, then sessions, then problems. Enter opens the highlighted result through the existing router navigation.
- **[CONFIRM]** the problems list is already loaded app-wide or lazily. If it is lazy, `useJumpIndex` triggers the same existing fetch on first open, and does not add a new API.

**6. Bottom dock (FR-16).**
- `Dock` replaces the header tabs. It is a fixed, centred pill at the bottom with Sessions, Learn, Present and Games as links, `aria-current="page"` on the current one, and icon plus label.
- Guests and chess invitees get `aria-disabled="true"` items and a visible and accessible reason (`aria-describedby`, plus a title). They are not links. **[CONFIRM]** which areas guests may use today, so the disabled set matches current permissions and does not change them.
- Narrow screens (breakpoint token) show icons only, each with `aria-label`.
- Content is never covered because the app shell reserves space with `padding-bottom: calc(var(--dock-height) + env(safe-area-inset-bottom) + gap)`. `--dock-height` is a token, so the last scrollable content ends above the dock. Full-screen layouts, such as the chess board and editor, are sized with `height: calc(100dvh - header - dock)`, so none sits under it.

**7. Run summary strip (FR-17).** See Contracts. `RunSummaryStrip` renders under the editor from the finished run result. It shows time, memory and "passed/total". Each figure is rendered only when the field is present, never as 0 (see the nullable fields below).

**8. Per-screen application (FR-9).** Editor, run output, interactive learning, GIF search, presentation, hub self-registration and Games (chess board, clocks, move list, invite link) adopt the primitives and tokens only. They get no screen-specific colour literals. The Keycloak login theme, if it is in the repo, takes the tokens through its own copy **[CONFIRM: sign-in theming mechanism]**. The spec requires only "the same look".

**9. Invite link copy (FR-14).** `CopyButton` (primary pill) is always rendered beside the invite link. It uses `navigator.clipboard.writeText` and falls back to `document.execCommand("copy")` on a hidden textarea. It confirms through an `aria-live="polite"` "Copied" status shown for about 2s. It is a native `<button>`, so keyboard activation works. **[CONFIRM]** whether spec 015 already added this, and if so restyle it only.

**10. Brand assets (FR-12).**
- Audi Type, the Audi icons and the logo stay supplied at deploy, outside the repo, as 015 did **[CONFIRM: current supply mechanism, which the "brand-assets" commit suggests exists]**. Nothing proprietary is added.
- The repo keeps a neutral fallback typeface stack (system UI fonts, no font file needed) and a neutral inline-SVG icon set.
- The font stack is `"Audi Type", system-ui, …`. An `Icon` component renders the supplied Audi icon if present and otherwise the fallback SVG. The logo component renders nothing, with no `<img>` and no reserved gap, until the cached logo loads. On error it shows the app name as text.
- A repo check fails if any `*.woff*`, `*.ttf`, `*.otf` or Audi logo asset is tracked, and also checks the icon set.

### Back end (Python 3.12, FastAPI; stack unchanged)

- Extend the code-run result with `memory_kb`, `examples_passed` and `examples_total`. **[CONFIRM]** the run path: where code executes, how it is sandboxed, and whether examples are already run and compared.
- **Memory measurement:** the child process's peak resident set size. This uses the stdlib `resource.getrusage(RUSAGE_CHILDREN).ru_maxrss` taken before and after the run if the runner is a subprocess. It handles the Linux KB versus macOS bytes difference. If the runner is a container or another mechanism, use that mechanism's peak figure. No new dependency is expected. If the existing runner design needs one, add it to this section with a justification (constitution rule 6) before tasks.
- **Examples:** `examples_total` is the number of examples on the problem. `examples_passed` is the number whose output matched. Both are `null` when the problem has no examples. Both are omitted or `null` for a run that did not finish (timeout, error before completion), as the spec requires "omitted, not zero". Time is the existing run duration **[CONFIRM: already reported]**.

## Data model

No database change and no migration.

- Client-only: `localStorage["theme"] ∈ {"light","dark","system"}`. Absent means system.
- Run result (transient, not stored): the three new fields below. If run results are persisted today, **[CONFIRM]**, the fields are carried through the same path without schema change if the result is a JSON blob. A column change is a planning gap, to be flagged to the human.

## Contracts

### Run result (existing run endpoint **[CONFIRM name and path]**, additive and backward compatible)

```jsonc
{
  // existing fields unchanged, including output and time
  "duration_ms": 123,          // existing, or the equivalent field today
  "memory_kb": 18432,          // int | null. Peak memory of the run. null if not measured or the run did not finish
  "examples_passed": 3,        // int | null. null if the problem has no examples or the run did not finish
  "examples_total": 4          // int | null. same rule
}
```

Rule: `examples_passed` and `examples_total` are both null or both set, and `0 ≤ passed ≤ total`. A finished run of a problem with examples always has both set, and passed may legitimately be 0, which is shown. Null means the figure is omitted.

### Front-end interfaces

```ts
type ThemeChoice = "light" | "dark" | "system";
interface ThemeContext { choice: ThemeChoice; setChoice(c: ThemeChoice): void }

interface JumpItem { kind: "area" | "session" | "problem"; id: string; label: string; to: string }
function useJumpIndex(): { items: JumpItem[] };
function filterJump(items: JumpItem[], query: string): JumpItem[]; // pure, case-insensitive

interface DockItem { key: "sessions" | "learn" | "present" | "games"; label: string; to: string; disabledReason?: string }

interface RunSummary { durationMs?: number; memoryKb?: number | null; examplesPassed?: number | null; examplesTotal?: number | null }
function formatRunSummary(r: RunSummary): { label: string; value: string }[]; // pure, omits missing, keeps 0 passed
```

### Token names (the contract between CSS and components)

`--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--accent`, `--accent-hover`, `--accent-press`, `--on-accent`, `--glow`, `--danger`, `--edge-light`, `--radius-pill`, `--radius-card`, `--space-1…8`, `--motion-fast`, `--motion-sweep`, `--z-dock`, `--z-header`, `--z-menu`, `--dock-height`, `--bp-narrow`.

## Module layout and dependency direction (constitution rule 9)

```
tokens.css                      (no deps)
ui/*  (Button, Card, LiveBadge, CopyButton, Icon, ChatBubble)  -> tokens.css
theme/ThemeProvider, ThemeMenu  -> ui, tokens
shell/Header, Dock, JumpBar, LightLine -> ui, theme, existing data hooks (read-only)
screens/*  (existing)           -> ui, shell, theme
backend: run service            -> existing runner; the response model gains the 3 fields
```
Dependencies point downward only. `ui` never imports from `shell` or `screens`. Folder names are indicative **[CONFIRM against the existing layout]**. The tasks must follow the real structure.

## Test strategy

Levels: unit (pure functions, token checks), component or integration (React Testing Library against real components, no mocking of owned code), end-to-end (Playwright against the real stack, per the existing harness), and backend (pytest against the real runner). Only third-party network services (the Audi styleguide logo fetch) are faked, per constitution rule 4. Audi assets are absent in tests, which exercises the fallbacks.

| AC | Test |
|---|---|
| FR-1 | E2E: on each listed screen, assert computed `border-radius` of primary controls and cards is at least the token radius, tile and region backgrounds differ by tone (`--surface` vs `--bg`), no `border` on regions, and the only non-neutral hue among computed colours is the accent family (plus danger on error). |
| FR-2 | E2E: with a live session seeded, the header has `is-live` and the line element's computed `animation-name` is not `none`. With none live, `animation-name` is `none`. Vent: the pseudo-element has a gradient `mask-image`. |
| FR-3 | E2E with `reducedMotion: "reduce"`: all animations on the page have `animation-name: none` or zero duration, the line is static, and the pulse is inert. |
| FR-4 | Unit: computed contrast of text on tile surfaces is at least 4.5 in both themes. E2E: the tile `::before` has a gradient whose strongest stop is at one corner, text is not covered (`pointer-events: none`, below content). |
| FR-5 | Component and E2E: a live session row has a `LiveBadge` with text "Live" and a pulsing dot. An idle row has neither. |
| FR-6 | Component: panel items, icons, `aria-checked` check on the current one. Keyboard: ArrowDown, ArrowUp, Enter and Escape move focus, apply and close. E2E: bounding box is entirely inside the viewport at several widths, with the trigger near the edge, and the panel is the topmost element at its centre (`elementFromPoint`). |
| FR-7 | Component and E2E: a primary action has accent background and a `box-shadow` glow, and a secondary one has none. |
| FR-8 | E2E on the chat: own bubble has accent background and three equal radii plus one near-zero radius. Others' bubbles do not use the accent. |
| FR-9 | E2E: run the FR-1 check on editor, run output, learning, GIF search, presentation, hub self-registration, and Games including chess as a guest via invite link. |
| FR-10 | E2E: with `colorScheme: "dark"` and empty storage, dark tokens apply, and flipping the emulated system scheme changes them without reload. Choosing light applies it at once and after reload. Choosing system removes the stored override. |
| FR-11 | E2E: for a button, hover, focus-visible, active, disabled and error states yield distinct computed styles, and a non-zero transition duration normally and zero under reduced motion. |
| FR-12 | Repo test: no tracked file matches font, icon or Audi logo patterns. E2E with no assets supplied: the fallback typeface is applied, icons render as fallback SVG, there is no `<img>` for the logo, the app name shows, and there are no console errors or failed requests for assets. |
| FR-13 | The existing unit and E2E suites run unchanged. The assertions that encode spec 015 shapes (square or outlined controls, header tabs, theme toggle form) are the only ones edited. **[CONFIRM]** They are enumerated by `/sdd-tasks` in a dedicated task, each listed with the old and new assertion so no other assertion is loosened. |
| FR-14 | E2E in light and dark: with the invite panel open, a visible copy button is next to the link. Mouse and keyboard activation put the link on the clipboard (read through the Playwright clipboard permission) and the "Copied" status appears. |
| FR-15 | Unit: `filterJump` matching and order. E2E: ⌘K or Ctrl+K opens the bar with the input focused, typing lists matching sessions, problems and areas, Enter navigates, and Escape closes with focus restored. Also asserts that no network request is made for search. |
| FR-16 | E2E: the dock has four items with `aria-current` on the current area, and activating another navigates. On a long page, scrolled to the end, the last element's bottom is at most the dock's top. As a guest, disabled items have `aria-disabled` and an accessible reason. At a narrow viewport, the dock is at the bottom, labels are hidden and each item has an `aria-label`. |
| FR-17 | Backend (pytest, real runner): a run with examples returns `memory_kb > 0` and `examples_passed/total` equal to a known fixture. One failing example gives passed = total − 1. A problem without examples gives null for both. A timeout or error gives null figures. Unit: `formatRunSummary` omits missing, keeps a legitimate 0. E2E: the strip appears under the editor after a finished run with figures matching the API response, and is absent before a run. |
| NFR Accessibility | Automated axe run on every screen in light and dark (no AA contrast violations), plus unit contrast checks of the token pairs. Focus-visible is asserted in the FR-11 test. |
| NFR Performance | E2E: the light line animates only `transform` (computed `animation-name` keyframes check). A Playwright trace on the live header must show no layout or paint work per frame beyond compositing, and first contentful paint must not regress against the baseline recorded in the task. |
| NFR Responsive | E2E at every width the existing suite uses: `scrollWidth <= clientWidth`, and no overlap of the dock, header and menus with controls. |
| NFR Consistency | Repo test: no colour, radius or duration literals in CSS or TSX outside `tokens.css`. |

## Constitution compliance

1. **Test-first**: the plan's test table is written so each task starts with a failing test from its criterion. Pass: the tasks must keep that order.
2. **Green before done**: no change to the harness. Adding the E2E for FR-1/9 over many screens must stay inside the 5-minute per-task limit. Run them on a kept stack, and share fixtures and the seeded live session. If a screen sweep is too slow, mark it `slow`, with the full suite run once before validation. Pass, with that risk noted.
3. **Traceable tests**: every FR and NFR in the table maps to a test. The tasks must name the criterion. Pass.
4. **Real dependencies**: owned components, the runner and the database are real in tests. Only the Audi logo fetch is faked. No other mock proposed. Pass.
5. **Fixed stack**: Python/FastAPI, React TS strict, Vite, docker compose. No departure. Pass.
6. **Dependency justification**: no new third-party dependency is introduced. Icons are inline SVG, the clipboard uses a browser API, and memory uses the stdlib `resource`. The jump bar and dock are hand-built. If tasks find one is needed, the plan amends here first. Pass.
7. **No secrets**: none involved. The logo URL is the public styleguide, with no credentials. Pass.
8. **Lint and format**: `ruff check`/`ruff format --check`, `biome ci` and `tsc --noEmit` must pass per task. Pass.
9. **Architecture**: layout and dependency direction stated above. Pass.

## Open items for the human at this gate

- The **[CONFIRM]** markers assume the codebase supports them, notably the existing run endpoint and runner, the live flag on sessions and games, and the guest permission set. They are resolved in `/sdd-tasks` by reading the code. If any contradicts this plan, fix the plan first.
- The memory figure is peak RSS of the run, not an average and not the whole server. Say so if you want a different definition.
