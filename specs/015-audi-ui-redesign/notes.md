# 015 — Audi UI redesign: notes

## Audit

Task 1, read-only. Date 2026-11-06. Paths are relative to the repo root. Nothing in `frontend/`, compose, hub or backend files was changed.

### (a) Screens (FR-5), components, routes, minimum width

Routes are from `frontend/src/App.tsx` (router basename is `BASE_URL`: `/` locally, `/collab/` on the hub). Every screen below is a `ui/Window` (toolbar, sidebar with `components/AreaNav`, main, optional 320 px inspector) except the Keycloak pages.

**Minimum width.** Nothing in the CSS sets a page-level floor. What it enforces, from `ui/Window.module.css` and `ui/Panels.module.css`: main column `min-width: 420px`, inspector 320 px when open (so 740 px with the inspector open, 420 px without), sidebar 220 px, which overlays instead of pushing below 1200 px. The documented support floor is **1024 px** (spec 003 NFR-2 / AC-20), and every existing width-bound e2e runs at 1024×768 (`e2e/a11y.spec.ts`, `e2e/learn-a11y.spec.ts`, `e2e/chat-beside-description.spec.ts`, `e2e/descriptions.spec.ts`). "Current minimum" below therefore means 1024 for every Window screen, with the CSS floor in brackets. Task 12 should use widths {1024, 1920} (+1440 under `VISUAL_FULL`) for all Window screens; no screen has a lower tested bound.

| FR-5 screen | Route | Component and folder | Styles | Min width |
|---|---|---|---|---|
| Landing / problem library ("session list" entry; start a session) | `/`, `/problems/new`, `/problems/:id/edit` | `frontend/src/pages/ProblemsWindow.tsx`, `ProblemEditorSheet.tsx`; `components/StaleSessionsList.tsx` (admins) | `pages/ProblemsWindow.module.css`, `ProblemEditorSheet.module.css`, `components/StaleSessionsList.module.css` | 1024 (CSS 420) |
| "My sessions" | `/profile` (signed in) | `pages/ProfileWindow.tsx`, `pages/ProfileSessions.tsx` | `pages/ProfileWindow.module.css`, `ProfileSessions.module.css` | 1024 (CSS 420; content max 640) |
| App-side sign-in entry | `/profile` signed out (Sign in / Register links) and `auth/RequireRole.tsx` redirect to `/api/auth/login` | `pages/ProfileWindow.tsx`, `components/AccountControl.tsx` | as above, `components/AccountControl.module.css` | 1024 |
| Sign-in page itself | Keycloak `hub` realm login page (separate origin), `a11y.spec.ts` screen "Keycloak login" | `keycloak-theme/collab/login/` (theme.properties, `resources/css/collab.css`, `resources/js/appearance.js`); parent theme `keycloak.v2` | `keycloak-theme/collab/login/resources/css/collab.css` | Keycloak's own responsive layout; tested at 1024 |
| Hub self-registration | Keycloak register / pending pages, reached through `registerUrl()` in `api/client.ts` (`/api/auth/register`) | same Keycloak theme as above (there is no register template of our own; spec 009 uses keycloak.v2's) | `collab.css` | as above |
| Session window: description, chat, editor, run output | `/s/:invite` | `pages/SessionWindow.tsx`; `description/DescriptionView.tsx`, `DescriptionEditor.tsx`, `components/DescriptionPane.tsx`; `components/ChatPane.tsx`, `SessionInspector.tsx`, `PresenceList.tsx`, `ProblemSourceList.tsx`; `components/CodeEditor.tsx`; `components/RunPanel.tsx`, `scratch/ScratchPanel.tsx` | `pages/SessionWindow.module.css`, `description/*.module.css`, `components/ChatPane.module.css`, `SessionInspector.module.css`, `PresenceList.module.css`, `RunPanel.module.css`, `scratch/ScratchPanel.module.css` | 1024 (CSS 740 with inspector) |
| Interactive learning | `/learn`, `/learn/s/:invite` | `learn/LearnWindow.tsx`, `LearningSessionWindow.tsx`, `StepView.tsx`, `Terminal.tsx`, `CompletionSummary.tsx` | `learn/*.module.css` | 1024 |
| GIF search and chat GIF tile | inside the chat (session `/s/:invite`, chess `/games/chess/s/:invite`, learn and present sessions) | `chat/gifs/GifPicker.tsx`, `GifImage.tsx` (used by `components/ChatPane.tsx`) | `chat/gifs/GifPicker.module.css`, `GifImage.module.css` (picker width 320, max 100%) | 1024 |
| HTML presentations | `/present`, `/present/s/:invite` | `present/PresentWindow.tsx`, `PresentSessionWindow.tsx`, `PresentationFrame.tsx`, `PresentationEditorSheet.tsx` | `present/*.module.css` | 1024 |
| Games lobby | `/games` | `games/GamesWindow.tsx` | `games/GamesWindow.module.css` | 1024 |
| Chess session, invite flow, guest join | `/games/chess/s/:invite` (guest by invite link) | `games/chess/ChessSessionWindow.tsx` (join form, `.joinForm` min-width 18rem), `SeatsPanel.tsx`, `GameControls.tsx`, `MoveList.tsx`, `PromotionPicker.tsx`, `ResultBanner.tsx` | `games/chess/ChessSessionWindow.module.css` | 1024 (CSS: 320 chat + main, board `min(100%, 560px)`) |
| Chess board, pieces, clocks | same | `games/chess/Board.tsx`, `pieces/*.svg`, clocks inside `GameControls.tsx` / `ChessSessionWindow.tsx` | `games/chess/Board.module.css` | 1024 |
| Shared / other | `*` (404), Forbidden, shortcut list | `pages/NotFound.tsx`, `pages/Forbidden.tsx`, `shortcuts/ShortcutList.tsx` | `pages/NotFound.module.css`, `shortcuts/ShortcutList.module.css` | 1024 |

Header: there is no header component. Each screen builds its own `ui/Toolbar` and composes `components/AreaNav` (in the sidebar), `AppearanceControl` and `AccountControl`. Task 23 replaces all of these call sites (see per-task list).

### (b) Spec-003 leftovers

- **Tokens:** `frontend/src/theme/tokens.css` (145 lines): Apple font stacks (`-apple-system`, `SFMono-Regular`), HIG scale `--type-large-title … --type-caption` (13 px body), `--space-1..8`, `--radius-control: 6px`, `--radius-sheet: 10px`, colour tokens `--window-bg --content-bg --control-bg(-hover/-pressed) --control-border --label(-secondary/-tertiary) --separator --row-alt-bg --row-hover-bg --selection-bg --backdrop --accent(-hover/-pressed/-label) --focus-ring --status-error/-success/-warning(-bg) --shadow-popover` etc. Dark block: `:root[data-appearance="dark"]`.
- **Materials / vibrancy:** `frontend/src/theme/materials.css` (`.material`, `backdrop-filter: blur(20px) saturate(180%)`, `--material-bg`, `--material-bg-opaque`). Imported by `frontend/src/main.tsx`. Used by `ui/Toolbar.tsx:62` and `ui/Sidebar.tsx:7` (class `material`), and `--material-bg-opaque` by `ui/Hud.module.css:9`.
- **Motion:** `frontend/src/theme/motion.css` (`--motion-fast/-base`, `sheet-in`, `popover-in`, `row-in` keyframes with `*-reduced` twins, `.anim-*`, `.motion-collapse`). Used by `ui/Sheet.tsx` (`anim-sheet-in`), `ui/collapse.ts`, others. Imported by `main.tsx`.
- **Large radii:** `--radius-control` / `--radius-sheet` used by `ui/SearchField`, `ui/SegmentedControl`, `present/PresentationFrame` modules and others (`grep -rl "radius-" frontend/src`).
- **Traffic-light window chrome:** none exists in the code (searched `traffic`, `vibran`: no hits). Plan §1.9 lists it, but there is nothing to delete.
- **Appearance storage and attribute (different from the plan's assumption):** the attribute is **`data-appearance`** on `<html>` (not `data-theme`), values `light|dark`. Storage key `localStorage["appearance"]` (`light|dark`, absence = system) in `frontend/src/theme/appearance.ts`; also held in the account preference store `frontend/src/prefs/accountPrefs.ts` and applied by `frontend/src/theme/useAppearance.ts` (called once in `App.tsx` `AppShell`). Pre-paint script: inline `<script>` in `frontend/index.html` (mirrors `appearance.ts`). The Keycloak copy is `keycloak-theme/collab/login/resources/js/appearance.js` (same key, same attribute, `?appearance=` query). Tests that pin the attribute and key: `theme/appearance.test.ts`, `components/AppearanceControl.test.tsx`, `e2e/appearance.spec.ts`, `e2e/a11y.spec.ts` (`dataset.appearance`), `prefs/accountPrefs.test.ts`. Under FR-9 these cannot change, so the new tokens must key their dark block on `[data-appearance="dark"]` (see Questions 1).
- **Keycloak token copy:** `keycloak-theme/collab/login/resources/css/collab.css` (region between `tokens:begin` / `tokens:end` copies `theme/tokens.css`), kept in sync by `scripts/check-theme-tokens.sh`, run from `scripts/check.sh`.
- **Apple-asset guard:** `scripts/check-no-apple-assets.sh` (spec 003 NFR-1) fails on any `.woff/.woff2/.ttf/.otf` in `frontend/dist` or `keycloak-theme`, and on the words Apple / macOS / SF Pro. Task 6's vendored woff2 would trip it.
- **Existing equivalents of each `ui/` primitive** (all in `frontend/src/ui/`, CSS modules, `*.module.css`): Button (`Button.tsx`, variants plain/primary…; `icon` prop), Spinner, TextField, SearchField (text input), SegmentedControl (tabs-like / appearance), Popover (`Popover.tsx`, trigger + `[popover]`), Sheet (`Sheet.tsx`, native `<dialog>`; Dialog equivalent), Banner and InlineMessage (alerts), Hud (toast equivalent), EmptyState, Toolbar (header equivalent), Sidebar, SourceList (ListItem equivalent), Panels (Inspector, BottomPanel), SplitPane, Window, `Icon.tsx` (existing icon component; name set to be listed by task 7). No Select, Menu, Checkbox, Radio, Switch, Badge, Tag, Card, Divider, ChatBubble primitives exist; chat bubbles are in `components/ChatPane.module.css`. Existing behaviour tests: `ui/controls.test.tsx`, `feedback.test.tsx`, `fields.test.tsx`, `keyboard.test.tsx`, `layout.test.tsx`, `overlays.test.tsx`, `Icon.test.tsx`, `SplitPane.test.tsx`.
- **Icons in use:** `ui/Icon.tsx` and the `icon=` props (e.g. `icon="link"` in `pages/SessionWindow.tsx:596`). Task 7 must grep `icon="` and the `Icon` name union for the complete semantic list.
- **CSS import points:** `frontend/src/main.tsx` imports `theme/tokens.css`, `materials.css`, `motion.css` (the only global CSS entry; everything else is CSS modules).
- **Vitest CSS config:** `frontend/vite.config.ts` `test.css.include` is `[/\/theme\/.*\.css/, /\/ui\/.*\.css/]`. `src/styles/` and `src/brand/` are **not** included; tasks 2, 3, 4, 6, 7, 8 read CSS with `?raw` and must add those folders to that list (a one-line change in `vite.config.ts`, not mentioned in their file lists).

### (c) Tests that assert only the Apple look (proposed for removal, for human approval)

Every other test is untouched under FR-9. The Apple-only assertions found:

1. `frontend/src/theme/tokens.test.ts` › `"references fonts by family name only"`: requires no `@font-face` / `url(` and exactly `--font-text` (starts `system-ui,`) and `--font-mono` (`ui-monospace,`). Contradicts FR-3 (Audi Type via `@font-face`).
2. `frontend/src/theme/tokens.test.ts` › `"uses the HIG macOS type scale"`: body 13/16, title2 17/22. Replaced by the kit type scale.
3. `frontend/src/theme/tokens.test.ts` › `"rounds controls at 6 px and sheets/popovers at 10 px"`: contradicts radius 0 (FR-1).
4. `frontend/src/theme/tokens.test.ts` › `"defines a focus ring token"` (`--focus-ring`, Apple blue ring): superseded by `--focus` and the double-ring rule. Remove only when the legacy bridge no longer needs `--focus-ring`.
5. `frontend/src/theme/motion.test.ts` › `describe("materials.css")`, four tests: `"blurs the material where supported"`, `"is opaque under @supports not"`, `"is opaque under reduced transparency"`, `"defines both material colours for light and dark"`: vibrancy / `backdrop-filter`, forbidden by FR-8 and the guard test.
6. `frontend/src/ui/keyboard.test.tsx` › `describe("Toolbar")` › `"uses the material"` (line 78): asserts class `material` on the toolbar.
7. `e2e/appearance.spec.ts` › `"AC-22: with reduced transparency the sidebar and toolbar are opaque"` (line 203): asserts `backdrop-filter` computed style and the vibrancy fallback; with no vibrancy the premise is gone.

Not Apple-only, so **not** proposed for removal: the other tests in `tokens.test.ts` (dark block redefines every colour token; one accent family; 4 px spacing grid) and the `motion.css` tests in `motion.test.ts` (300 ms ceiling, reduced-motion `-reduced` twins, no `pointer-events: none`). They read `theme/tokens.css` / `theme/motion.css`; see Questions 2 for what happens to them when those files are retired.

Single assertions inside otherwise valid tests (a line edit, not a removal; a plan violation unless approved, see Questions 3):
- `frontend/src/ui/layout.test.tsx:68` inside `"is a navigation landmark whose sections are labelled regions"` asserts `nav.className` matches `/material/`. The rest of the test is behaviour.
- `frontend/src/ui/overlays.test.tsx:78-85` `"uses the sheet animation"` asserts class `anim-sheet-in` on the Sheet dialog. This is spec 003 AC-5 motion behaviour, not Apple-look per se; keep the class name (see per-task note for 19/35).
- `frontend/src/components/editorTheme.test.ts` reads `theme/tokens.css?raw` to check every `var(--x)` in the editor theme is a defined token; task 27 changes the tokens it references, so the import path and token source change while the assertions stay.

The following mention macOS but are keyboard-platform behaviour and stay: `shortcuts/*.test.ts`, `components/AppearanceControl.test.tsx:54`, `pages/SessionWindow.test.tsx:881`, `e2e/keyboard.spec.ts`. `e2e/latency.spec.ts` only cites spec 003's notes path.

### (d) Chess pieces

SVG files, 12 of them: `frontend/src/games/chess/pieces/{w,b}{K,Q,R,B,N,P}.svg`, 45×45 viewBox, imported as URLs in `games/chess/Board.tsx` (`import wK from "./pieces/wK.svg"`), so they are rendered as images (`<img>`/CSS image), not inline SVG. Fills and outlines are hard-coded hex inside the files (white `#fafafa` fill / `#1a1a1a` stroke; black `#2b2b2b` fill / `#0d0d0d` stroke with a `#f2f2f2` underlay stroke). `pieces/pieces.test.ts` requires plain self-contained SVG with `viewBox="0 0 45 45"` and a `stroke=`, no `<image>`, `href=`, `data:`.
Consequence for task 33: CSS custom properties cannot reach an SVG loaded as an image, and the raw-value guard (task 4) scans only `css/tsx/ts`, so it does not flag the SVG hex. The plan's "only fills/outlines move to tokens" needs either inlining the SVGs (e.g. `?raw` or React components; `pieces.test.ts` keys on `import.meta.glob("./*.svg")` raw, which still works) or keeping them as-is and letting the board squares carry the contrast. See Questions 4. Board CSS also holds raw colours at `Board.module.css:48,52,56` (`rgba(255,221,0,.4)`, `rgba(20,120,255,.45)`, `rgba(220,30,30,.55)`): selection, last move, check.

### (e) Serving, hub prefix, brand/ gating, deploy, empty brand.css

- **Serving container:** the `api` service (FastAPI, `backend/Dockerfile`), in both `docker-compose.yml` (port 8000) and `docker-compose.hub.yml` (no published port; hub alias `collab-api:8000`). The Dockerfile builds the frontend in a Node stage (`npm run build` with `ARG APP_BASE_PATH`, root build context) and copies `frontend/dist` to `/app/frontend/dist`. `backend/app/main.py:49` `FRONTEND_DIST`; lines 216-235 mount only `/assets` (StaticFiles) and an SPA fallback that returns `index.html` for every non-`/api/` path. There is no nginx / Caddy in this repo for the app; `db` and `runner` are separate services.
- **Hub path prefix:** `/collab/` (`APP_BASE_PATH=/collab/` build arg, `BASE_PATH=/collab` runtime, `.env.hub.example`). `backend/app/asgi.py` `build_app` mounts the whole app under `BASE_PATH`; the browser URL for brand files is `/collab/brand/…`; locally `/brand/…`.
- **Does the proxy gate `brand/`?** No. The hub's `~/Desktop/ProjectHub/hub/caddy/apps/collab.caddy` is `handle /collab/* { import strip-identity; reverse_proxy collab-api:8000 }` with no gate import (spec 005 FR2), so `/collab/brand/*` is unauthenticated for guests with no hub change. That file lives in the hub repo, outside this one.
- **Where the deploy calls compose:** there is no deploy script. Deploys are the manual steps in `deploy/hub/RUNBOOK.md` (section "3. Static checks, build and start" and the Update section): `docker compose -f docker-compose.hub.yml --env-file .env.hub build sandbox` then `… up -d --build --wait`, run on VM 105 in `~/collab`, then `deploy/hub/smoke.sh`. The local hub stand-in `scripts/check-hub.sh` (line ~157, `collab() { docker compose -f docker-compose.hub.yml … }`) also runs it. `frontend/scripts/brand.sh` should be added as a RUNBOOK step before `up` (both hub sections) and called from `scripts/check-hub.sh` before `collab up`; the local stack (`docker-compose.yml`, `docker-compose.test.yml` for e2e) needs the same call or a no-mount fallback.
- **Mount points that do not exist yet:** neither compose file has a `volumes:` entry for the frontend, and `.dockerignore` does not exist (only `.gitignore`). Task 8 must create `.dockerignore` (not just add lines).
- **How a missing mount serves an empty `brand.css`:** it does not today. A request for `/brand/brand.css` falls into `_spa_fallback`, which returns `index.html` with status 200 and `text/html`, so a `<link rel=stylesheet>` would be rejected (MIME) and log a console error, breaking FR-3 AC 2. Any solution needs a backend change in `backend/app/main.py`: mount `StaticFiles` for `/brand` from a configurable directory (env `BRAND_DIR`, container path such as `/app/brand-assets`) when it exists, otherwise register a route answering `/brand/brand.css` with an empty `text/css` body (and 404 for other `/brand/*` paths so they do not become HTML). This contradicts the plan intro ("frontend-only change... No backend ... change"); see Questions 5. Plan §1.5's writable-for-cache mount and the runtime `fetch-brand-logo.mjs` start-up job also need Node in the serving container, but the final image is `python:3.12-slim` (Node exists only in the builder stage). See Questions 5.
- **e2e and compose:** `e2e/playwright.config.ts` runs against the production stack at `http://127.0.0.1:8000` (`docker-compose.yml` via `e2e/global-setup.ts`), so brand-fixture e2e (task 34) can use that stack with a mount, or the dev server per plan. `frontend/vite.config.ts` has `base` from `APP_BASE_PATH` and a `/api` proxy only; the dev plugin is new.

### (f) Biome and CSS

`frontend/biome.json` has no `css` section and sets `files.ignoreUnknown: false`. Biome 2.5.15 formats and lints CSS by default: `npx biome ci src/ui/Window.module.css` checks the file, and `npx biome ci .` reports "Checked 247 files" including every `*.module.css`. So CSS is covered by `scripts/check.sh` "biome ci" and tasks 2-8 CSS and `.mjs` files will be linted and formatted (100-column width, double quotes; custom-property values like `19px / 28px` may be reformatted). Because `ignoreUnknown` is false, a vendored `.woff2` under `frontend/src/assets/fonts/` or `.svg` icons in a scanned path may be reported as an unknown file type; the existing `pieces/*.svg` pass today, so check at task 6 and add a `files.includes` exclusion if needed.

### (g) Code editor

CodeMirror 6 (`codemirror`, `@codemirror/view`, `@codemirror/language`, `@lezer/highlight`, `y-codemirror.next` for collaboration). `frontend/src/components/CodeEditor.tsx` builds the extensions and includes `editorTheme` (line 40). The theme is `frontend/src/components/editorTheme.ts`: an `EditorView.theme(themeSpec)` plus a `HighlightStyle` from `highlightSpecs`, already written as CSS variables only (`var(--label)`, `var(--content-bg)`, `var(--selection-bg)`, `var(--accent)`, `var(--status-error)` …), so appearance changes need no reconfiguration. Test: `components/editorTheme.test.ts` (no literal colours, every `var()` names a token in `theme/tokens.css`). Tab at cursor lives in `components/editorTab.ts` (+ `editorTab.test.ts`, `e2e/editor-tab.spec.ts`), untouched by task 27. The remote cursors use y-codemirror.next's own colours.

### Audit resolutions per later task

New files named in tasks 2-9, 12-22, 34 are as written in `tasks.md`; only audit-dependent or conflicting items are listed. "Needs" means a path or decision the task did not have.

- **2:** `[data-theme]` in the task becomes `[data-appearance]` (existing attribute; Question 1); also `prefers-color-scheme` fallback `:root:not([data-appearance])`. Add `/styles/` to `vite.config.ts` `test.css.include`. Keep `theme/tokens.css` alive (consumed by `theme/tokens.test.ts`, `editorTheme.test.ts`, `scripts/check-theme-tokens.sh`, Keycloak copy) until task 35.
- **3:** Import in `frontend/src/main.tsx` (currently `theme/tokens.css`, `materials.css`, `motion.css`); add new imports after `theme/tokens.css` or replace. `styles/motion.css` coexists with `theme/motion.css` (keep `anim-*` classes, see 19/35).
- **4:** Spec-003 variable list for `legacy.css`: all of `theme/tokens.css` names listed in (b), plus `--material-bg`, `--material-bg-opaque` (from `theme/materials.css`), `--motion-fast`, `--motion-base`, `--ease-out`, `--ease-in-out` (from `theme/motion.css`). Baseline offender scan targets: `theme/materials.css`, `theme/tokens.css`, `theme/motion.test.ts`, `theme/tokens.test.ts`, `games/chess/Board.module.css`, `keycloak-theme/` is outside `src` (not scanned).
- **5:** no audit dependency.
- **6:** `scripts/check-no-apple-assets.sh` must allow the vendored woff2 in `frontend/dist` (adjust the font-file rule, with its `--self-test`); `theme/tokens.test.ts` "references fonts by family name only" goes (c.1). `biome.json` unknown-file check (f).
- **7:** Icon names: `frontend/src/ui/Icon.tsx` and every `icon="…"` prop under `frontend/src` (task must grep; the existing component is replaced/moved to `frontend/src/brand/Icon.tsx`, existing test `ui/Icon.test.tsx` stays unchanged in assertions: keep a re-export from `ui/Icon.tsx`).
- **8:** `.dockerignore` does not exist, create at repo root. `.gitignore` exists at root (already ignores `dist/`, `node_modules/`).
- **9:** no audit dependency.
- **10:** no audit dependency.
- **11:** Serving container is `api` (`backend/Dockerfile`, `backend/app/main.py`). Required (not "frontend-only"): add the `/brand` mount and empty-stylesheet route to `backend/app/main.py`; add a `volumes:` bind (`${BRAND_DIR:-./brand-assets}:/app/brand-assets`) to `api` in `docker-compose.yml` and `docker-compose.hub.yml` (and `docker-compose.test.yml` if e2e uses it); Dockerfile cannot run the Node logo fetch at start-up (Question 5). Deploy "script" = `deploy/hub/RUNBOOK.md` steps + `scripts/check-hub.sh`; add `brand.sh` there. Proxy: nothing to change in the hub (ungated). Backend test needed (constitution 1) for the new route and `backend/tests/unit/test_hub_compose.py` pins the hub compose file, check it still passes. Add `/brand/` (and `/styles/`, `/brand/` for src) handling in `frontend/vite.config.ts`; pre-paint script in `frontend/index.html` stays (it sets `data-appearance`).
- **12:** Screen list for `e2e/audi/matrix.ts` is the (a) table. Existing screen openers to reuse: `e2e/a11y.spec.ts` `SCREENS` (problems, problem sheet, session, stale session, empty state, profile signed out/in, games, chess session, Keycloak login), `e2e/learn-a11y.spec.ts` `SCREENS`, `e2e/chess-a11y.spec.ts`, `e2e/present-harness.ts`, `e2e/fixtures.ts`. Lower bound for every screen is 1024, so widths {1024, 1920}. Existing appearance test `e2e/appearance.spec.ts` stays (except AC-22 removal).
- **13-22 (primitives):** each replaces an existing primitive in `frontend/src/ui/`, which the existing tests (`ui/controls.test.tsx`, `fields.test.tsx`, `feedback.test.tsx`, `keyboard.test.tsx`, `layout.test.tsx`, `overlays.test.tsx`) still render. The task files such as `ui/Button.tsx` and `ui/button.css` collide with existing `ui/Button.tsx` and `ui/Button.module.css`: the new primitive must keep the existing export names, props and accessible behaviour (13 Button/Spinner; 15 TextField; 18 Tabs vs `SegmentedControl`; 19 Dialog vs `Sheet` (keep `anim-sheet-in` class and `Sheet` export until screens are converted); 20 Popover (existing `ui/Popover.tsx`) and Toast vs `Hud`/`Banner`; 21 ListItem vs `SourceList`, ChatBubble vs `components/ChatPane.module.css`; 22 Card/Divider new). Decide in-task: edit the existing file or add the new file beside it and switch call sites; the audit recommends editing in place (same file names, new `.css` imported alongside). Plan's `ui/*.css` plain-CSS (not `.module.css`) differs from the repo convention (CSS modules); raw-value guard and vitest `css.include` already cover `/ui/` for either.
- **23:** Replace per-screen `Toolbar` + `AreaNav` + `AppearanceControl` + `AccountControl` call sites: `pages/ProblemsWindow.tsx`, `pages/ProfileWindow.tsx`, `pages/SessionWindow.tsx`, `pages/NotFound.tsx`, `learn/LearnWindow.tsx`, `learn/LearningSessionWindow.tsx`, `present/PresentWindow.tsx`, `present/PresentSessionWindow.tsx`, `games/GamesWindow.tsx`, `games/chess/ChessSessionWindow.tsx`; plus `ui/Window.tsx` (header slot) and `ui/Toolbar.tsx`. Storage key `appearance`, attribute **`data-appearance`** (not `data-theme`); the toggle's existing logic is `theme/useAppearance.ts`, `prefs/accountPrefs.ts`, `components/AppearanceControl.tsx` (+ test, unchanged assertions).
- **24:** Components: `pages/ProblemsWindow.tsx` (landing `/`), `pages/ProfileWindow.tsx` (+ `.module.css`), `components/AccountControl.tsx`, `auth/RequireRole.tsx`; the actual sign-in page is the Keycloak theme (`keycloak-theme/collab/login/resources/css/collab.css`, `js/appearance.js`, `theme.properties`), which cannot import `frontend/src`; see Question 6.
- **25:** `pages/ProblemsWindow.tsx`, `components/StaleSessionsList.tsx`, `pages/ProfileSessions.tsx` (+ their `.module.css`). The "session list" is the problems library with a start-session action plus the stale list for admins; "my sessions" is `pages/ProfileSessions.tsx` on `/profile`.
- **26:** `pages/SessionWindow.tsx`, `description/DescriptionView.tsx`, `DescriptionEditor.tsx`, `components/DescriptionPane.tsx`, `ChatPane.tsx`, `SessionInspector.tsx`, `PresenceList.tsx`, `ProblemSourceList.tsx`, with their `.module.css`.
- **27:** `components/CodeEditor.tsx`, `components/editorTheme.ts` (+ `editorTheme.test.ts`, whose token source import changes), `components/RunPanel.tsx` + `RunPanel.module.css`, `scratch/ScratchPanel.tsx` + `.module.css`.
- **28:** `learn/LearnWindow.tsx`, `LearningSessionWindow.tsx`, `StepView.tsx`, `Terminal.tsx`, `CompletionSummary.tsx` + their `.module.css`.
- **29:** `chat/gifs/GifPicker.tsx`, `GifImage.tsx` + `.module.css`; embedded in `components/ChatPane.tsx` (shared with task 26: disjoint if 29 touches only `chat/gifs/`).
- **30:** `present/PresentWindow.tsx`, `PresentSessionWindow.tsx`, `PresentationFrame.tsx`, `PresentationEditorSheet.tsx` + `.module.css`. `PresentationFrame.module.css` is where the stage `#fff` exception belongs.
- **31:** `keycloak-theme/collab/login/` (register and pending pages are keycloak.v2's, styled only by `collab.css`); plus `api/client.ts` `registerUrl`. No React component. See Question 6.
- **32:** `games/GamesWindow.tsx`, `games/chess/ChessSessionWindow.tsx` (join form / invite), `SeatsPanel.tsx`, `GameControls.tsx`, `MoveList.tsx`, `PromotionPicker.tsx`, `ResultBanner.tsx` + `.module.css`.
- **33:** `games/chess/Board.tsx`, `Board.module.css`, `pieces/*.svg` (+ `pieces/pieces.test.ts`), clocks in `GameControls.tsx` / `ChessSessionWindow.tsx`. Pieces are SVG images with hex baked in (Question 4).
- **34:** e2e stack is `docker-compose.yml` + `e2e/global-setup.ts`, base URL `http://127.0.0.1:8000`; the brand mount must be added there for fixtures (or use the dev server as the plan says).
- **35:** Delete list: `frontend/src/theme/tokens.css`, `theme/materials.css`, the import lines in `main.tsx`, `theme/tokens.test.ts` (whole file once superseded, Question 2), `theme/motion.test.ts` materials block, `styles/legacy.css`, `.material` class use in `ui/Toolbar.tsx` and `ui/Sidebar.tsx`, `--material-bg-opaque` in `ui/Hud.module.css`, `--radius-sheet` / `--radius-control` users, the Apple font stacks in `theme/tokens.css` and `keycloak-theme/.../collab.css`, `scripts/check-theme-tokens.sh` (retarget to the new tokens or remove its `check.sh` step), `scripts/check-no-apple-assets.sh` (keep the Apple-words rule, relax the font rule). Tests to remove, as approved from (c): the items 1-7 above. Keep `theme/appearance.ts`, `useAppearance.ts`, `motion.css` `anim-*` classes unless a replacement preserves `overlays.test.tsx` and `e2e/appearance.spec.ts` AC-5 assertions. `specs/README.md` (003 and 015 rows).
- **36:** no further audit input beyond the (a) table.
- **37:** The Games invite flow has **no copy-link button and no invite dialog today**: `games/GamesWindow.tsx` creates a chess session and navigates to `/games/chess/s/:invite`; `games/chess/ChessSessionWindow.tsx` has only a join-name form and no clipboard code. The existing problem-tab "copy-link" is the `Invite` button in `pages/SessionWindow.tsx` (`copyInvite()`, line ~552, `icon="link"`, shortcut `copyInviteLink`, HUD "Invite link copied"); the other session windows have none. Task 37 therefore adds a button to `ChessSessionWindow.tsx` toolbar (and arguably `LearningSessionWindow.tsx` / `PresentSessionWindow.tsx`, which the spec may not require; check spec FR before deciding).

## Questions (need a human decision)

1. **Appearance attribute.** The plan/tasks say `data-theme`; the code, four existing tests, `e2e` and the Keycloak theme use `data-appearance` with storage key `appearance`. Proposed: keep `data-appearance` everywhere (FR-9). Confirm, or approve a rename with its test edits.
2. **Fate of `theme/tokens.test.ts` and `theme/motion.test.ts`.** The generic assertions (dark covers every colour token, 4 px spacing, accent family, motion limits) are not Apple-only but read the old files that task 35 deletes. Either retire those files wholesale with the new task 2 contract test and task 3/4 tests superseding them, or retarget them (changing what they read). Which?
3. **Line-level edits.** Two assertions sit inside valid tests (`layout.test.tsx:68`, material class; `overlays.test.tsx` `anim-sheet-in`). Approve removing just the `/material/` line, and approve keeping `anim-sheet-in` and the Sheet export, versus plan §1.9 deleting the sheet animation?
4. **Chess pieces.** Keep SVG-as-image with baked hex (the guard cannot see it, tokens cannot reach it), or inline them so fills use tokens (changes `Board.tsx` loading, keeps `pieces.test.ts`)?
5. **Backend change and runtime logo cache.** The empty `brand.css` fallback and the `/collab/brand/` route require a change to `backend/app/main.py` and compose volumes (the plan says frontend-only); and the serving image has no Node, so the first-run logo fetch cannot run there. Approve the backend change, and choose: fetch the logo on the host in `brand.sh` (read-only mount, simplest) or add Node to the image?
6. **Sign-in and self-registration live in the Keycloak theme, not the React app.** `keycloak-theme/collab/login/` is a separate origin with its own copied CSS, deployed by copying into the hub repo (`~/Desktop/ProjectHub/hub/keycloak/themes/collab`). Confirm tasks 24 and 31 restyle that theme (with the Audi tokens copied and a replacement for `check-theme-tokens.sh`), that the brand fonts / `brand.css` are not available there (different origin) so it uses fallback fonts, and that the hub-repo copy is synced manually per RUNBOOK.
7. **Traffic-light chrome does not exist** in the code (nothing to remove); FR-8 and task 35 can simply not mention it. No decision needed unless you want the guard word list changed.

## Decisions (human, 2026-11-06)

1. Keep `data-appearance` + `localStorage["appearance"]`; wherever plan/tasks say `data-theme`, read `data-appearance`.
2. Task 35: retarget generic assertions of `theme/tokens.test.ts` and `theme/motion.test.ts` at the new files; remove only the 7 Apple-specific tests listed in the audit. Remove just the `/material/` line in `ui/layout.test.tsx:68`; keep `Sheet` export and `anim-sheet-in` class.
3. Chess pieces stay SVG images with baked-in hex; raw-value guard excludes them.
4. Approved: backend `/brand` mount + empty-stylesheet route in `backend/app/main.py` plus compose volumes; logo fetched on host in `brand.sh`. Approved: restyle Keycloak theme in `keycloak-theme/collab/login/` (tasks 24, 31), hub sync is a manual step noted in the runbook.
5. Add `src/styles/` and `src/brand/` to the vite CSS-processing config (tasks 2-8).

## Implementation notes (waves 2-3)

- Task 2: page margin 16 <375, 28@375, 40@768, 60@1024, 96@>=1440. `--font-copy`/`--font-display` share one stack; width axis via `--wdth-*`. Label sizes: 16/20, 12/16, 10/12. Dark elevation = same shadows, depth from `--surface-n`. No `Surface/Highlight/Secondary`.
- Task 3: weights headings 700, copy 400, labels 500. `ui/Toolbar.module.css` `.toolbar:focus{outline:none}` allowlisted; clean up in task 35.
- Task 4: baseline of 8 offenders in `guard.test.ts`; task 35 removes `BASELINE` and flips the legacy-exists check. Allowlisted for colour literals: `styles/contrast.ts`, `contrast.test.ts`, `tokens.test.ts`.
- Task 5 contrast adjustments: dark editor numbers use provisional `#6F84FF` (neon-blue is 4.18:1 on #1A1A1A); light chess dark square provisional `#808080`; chess pieces need an outline on the dark-appearance dark square. Editor background assumed `--surface-1` (`EDITOR_BG` in contrast.ts).
- Spacing collision: new `--space-2/4/8` (px) clash with old spacing tokens in `theme/tokens.css` (task 4 finding). Resolved by renaming old vars to `--legacy-space-*`.

## Implementation notes (wave 7, in progress)

- Task 16: `Select` underline styles live in `ui/menu.css`; once `ui/field.css` (task 15) exists, switch them to the shared file (task 36).
- Task 17/18/21: plain CSS with global `ui-*` classes; none of the old call sites are converted yet (screen tasks do that).
- Task 19: `ui/Sheet.tsx` re-exports `Dialog as Sheet`; `Sheet.module.css` deleted. Dialog close button is a native `×` button because `IconButton` and a close glyph did not exist yet; task 36 should switch to `IconButton` + close icon.

## Task 23 notes

- Ten screens now render `AppHeader` (area tabs, appearance menu, account). Games/Chess/session windows lost their AreaNav-only sidebar. `Window` still has the old sidebar/toolbar layout and `AreaNav` in sidebars of Problems, Learn, Present: duplicate of header tabs, remove in the screen tasks (25/28/30) and finally task 35.
- `saveChoice("system")` now removes the stored key.
- Old `AppearanceControl` unused; delete in task 35.

- Task 27: editor numbers are `color-mix(in srgb, var(--neon-blue) 80%, var(--text-interactive))` (not the provisional #6F84FF): follows the appearance, darker in light, lighter in dark, both >= 4.5:1 on `--surface-1`; `contrast.ts` `EDITOR_NUMBER` mirrors it. Other syntax colours as plan 1.8, no adjustment. Success/notice text in RunPanel/ScratchPanel moved to `--text` (green/amber text fail 4.5:1).

## Task 33 / wave 9 notes

- Chess has no clock UI anywhere in the code, so the clock clause of task 33 had nothing to restyle. Not added as a feature (default: out of scope for a restyle); human to confirm or request a spec change. The `contrast.ts` clock pair is harmless.
- `--board-light` / `--board-dark` tokens added to `styles/tokens.css` (#E6E6E6/#808080 light, #B3B3B3/#4D4D4D dark). Guard baseline now 7.
- Leftovers for tasks 35/36: `ui/Banner.module.css` still uses legacy vars; `Tag` has no warning variant (Stale tag looks like other tags); `Window` still uses `--content-bg`, `--window-bg`, `--separator`.
- Task 26: `TextArea` lacks an `onKeyDown` pass-through and forces `maxLength`; ChatPane works around both (task 36: add pass-through). `ui/Panels.module.css` still uses legacy vars (`--legacy-space-N`, `--separator`, `--content-bg`): convert in task 35/36. Own-bubble "Remove" tertiary button contrast on accent fill unverified until axe gate.
- Task 31: `register.css` assumes keycloak.v2 markup (`#kc-register-form`, `.pf-v5-c-form-control`, `[id^="input-error"]`); verify at the batched e2e gate. Depends on task 24's `collab.css` kit-token block (needs `--font-copy`, `--bw-*`, `--radius-0`, `--fs-copy-*`, `--lh-copy-*`, `--fs-label-1`, `--lh-label-1`, `--form-*`, `--action-*`, `--focus`). `scripts/check-theme-tokens.sh` currently fails (old token block) — retarget in 24 or 35. Registration "pending" page not covered.
- Task 24: Keycloak `collab.css` rewritten with the kit token block (`tokens:begin/end` copied from `frontend/src/styles/tokens.css`); `check-theme-tokens.sh` retargeted. `--focus-ring` is not a kit token (only via `legacy.css`); Button and tests still name it — rename to `--focus` in task 35. `Button` has no link/anchor variant (sign-in anchors copy the look). `ProfileWindow` still has a raw checkbox: swap for `Checkbox` in task 36. ProblemsWindow landing was restyled by task 25.

## Task 34 notes

- Brand icons were unused in the app (inline-SVG `ui/Icon.tsx` everywhere, ~15 components); only the header now uses `brand/Icon` (mask span). FR-2 therefore holds only in the header. Task 36 should make `ui/Icon` render `brand/Icon` everywhere and update the assertions in `ui/Icon.test.tsx` and `PresenceList.test.tsx` that check for inline SVG (implementation detail, not behaviour) — flagged for human review.
- `brand.css` link moved to the end of `<body>` in `index.html` so supplied icons override the fallback; `BrandLogo` probes a temp element to decide visibility.
- Task 37 (copy-invite-link) is on hold: it adds behaviour not in spec.md; needs `/sdd-specify` first.

## Batched e2e gate (after wave 9)

`e2e/audi/` green: 126/126 serial. Source fixes: radius 0 on SegmentedControl/SearchField, Sidebar/Toolbar lost `material`, h1/h2 `font-stretch:130%`, ChatPane/header overflow, keyboard-focusable scroll regions, GIF placeholder contrast, chess board a1 now dark (pre-existing parity bug). Removed the `/material/` line in `ui/layout.test.tsx` and the `"uses the material"` test in `ui/keyboard.test.tsx` (both approved).
Open: (1) `ui/menu.css` options keep `--radius-sm` 4px (pinned by `menuSelect.test.tsx`, plan §1.7) vs FR-1 radius 0 — decide. (2) Pre-existing non-audi e2e specs are stale (AreaNav links are now header tabs; `chess.spec.ts` expects an unstarted board that the UI no longer renders) — update locators in task 36. (3) Chess clocks absent; task 37 on hold.

## Decisions (human, 2026-11-06, second round)

6. FR-12 (copy-invite-link) added to spec.md; task 37 proceeds. (Plan has no section for it; implement via existing `IconButton` + `Toast`.)
7. Menu/Select options and panel: radius 0 (FR-1 wins over plan §1.7); update `menuSelect.test.tsx` assertion accordingly.
8. Chess clocks: clause dropped, no new feature.
9. FR-2: migrate all icons to `brand/Icon` in task 36; update the inline-SVG assertions in `ui/Icon.test.tsx` and `PresenceList.test.tsx`.
10. (orchestrator, task 35) Retargeting `PresenceList.test.tsx`, `e2e/signin.spec.ts`, `e2e/hub.spec.ts` from the deleted `theme/tokens.css` to `styles/tokens.css` (path + token renames only; same assertions on the same intent) was applied as a mechanical consequence of Decision 2. `AppearanceControl` (unused) deleted together with its test — dead code.
11. `e2e/signin.spec.ts` AC-18d asserts the spec-003 system typeface on the Keycloak page; it is a pure Apple-look assertion superseded by the Audi font (FR-3/FR-8). Task 36 updates it to assert the Audi stack (first family "Audi Type"), keeping the "no Keycloak logo" half.

## Task 36 results

Status: **not complete** (task left unticked). 357/369 e2e green on the final full run (`VISUAL_FULL=1`, all specs, serial); `e2e/audi` is 198/198 (1024, 1440, 1920, both appearances) and the new keyboard sweep is 24/24. Frontend `vitest` 1237/1237, `tsc -b` clean.

**Done**
- `e2e/audi/a11y-sweep.spec.ts`: tabs through every FR-5 screen from `matrix.ts` in light and dark at the lower bound; each stop must itself show a non-none box-shadow or outline (no ancestor allowance). Passes.
- `e2e/signin.spec.ts` AC-18d: asserts the first font family is "Audi Type" (Decision 11); the "no Keycloak logo" half is unchanged.
- Stale non-audi e2e locators/measures updated, assertions unchanged in intent (for review): appearance control radio group is now `menu` / `menuitemradio` (`appearance.spec.ts`, `profile-prefs.spec.ts`, `keyboard.spec.ts`; the keyboard test arrows with ArrowDown then Enter instead of ArrowLeft, because it is now a menu); AreaNav links are now header `tab`s (`chess.spec.ts`, `learn.spec.ts` with `aria-selected` for `aria-current`); `chat-beside-description.spec.ts` "no tabs" excludes the header's Areas tablist; `a11y.spec.ts` and `learn-a11y.spec.ts` count a box-shadow ring as a focus ring (the kit indicator is a double box-shadow ring with outline none), which is the same "every stop shows a ring" assertion measured on the Audi indicator.
- Source fixes: `styles/motion.css` reduced-motion block moved last so the `*-reduced` fade twins win over the base `.anim-*` rules (AC-5 was failing: sheet still used `sheet-in`); `ui/Dialog.tsx` focuses the first form field on open (the new close button came first in the DOM and took the initial focus, which broke the keyboard flow of the problem editor).
- Cleanups: `ui/TextArea` has an optional `onKeyDown`, used by `ChatPane` instead of the wrapper div; `ProfileWindow` uses `ui/Checkbox`; biome `--write` applied to `src`.

**Open**
1. Unstarted chess board (spec 014 FR-3 / AC-2 say the board shows the starting position in the not-started state; `ChessSessionWindow.tsx` renders `Board` only `{game && ...}`, so there is no board until Start). Nine tests wait for the Chess board grid after joining and fail on it: `chess.spec.ts` (5), `chess-a11y.spec.ts`, `chess-latency.spec.ts`, `appearance.spec.ts` NFR-5, and the "chess session" screen in `a11y.spec.ts` (x2). Not edited, per instruction: the UI contradicts spec 014. Either render the starting position when `game` is null (source fix) or change the spec; human decision.
2. `present-drawing.spec.ts` AC-18-23: with Draw off, a drag across the slide text selects nothing (`getSelection()` empty; overlay has `pointer-events: none`, the hit target is the iframe). Not diagnosed; candidate causes are the new framed stage (`PresentationFrame.module.css`: white stage, border, `color-scheme: light`) or the presentation window layout.
3. `latency.spec.ts` AC-23 (edit propagation p95 within 10% of baseline): 3.80 ms vs 2.86 limit in the full runs, passed when run alone. Looks like load noise on this machine; needs a quiet re-run before it is called a regression.
4. Not done: moving the Select underline rules from `ui/menu.css` to `ui/field.css` (not trivial: they target the trigger's states). Biome still reports 5 errors in `src` (`ui/Switch.tsx` role=switch aria-checked, `ui/Badge.tsx` aria prop, `ui/chat.test.tsx` ambiguous anchor text, `ui/Dialog.test.tsx` button type, one more) and about 20 warnings (non-null assertions, `!important` in `styles/motion.css`, a `useTemplate`); none auto-fixable safely. The biome nested-config crash was not hit running `npx biome check src` from `frontend/`.
5. No `--full` flag exists in `e2e/package.json` or the Playwright config; "full suite" was `npx playwright test` with `VISUAL_FULL=1`.

**Records**
- Contrast adjustments: dark editor numbers `color-mix(neon-blue 80%, text-interactive)` instead of the provisional `#6F84FF` (task 27); success/notice text in RunPanel/ScratchPanel uses `--text` (green/amber text fails 4.5:1); light chess dark square `#808080` and an outline on pieces on the dark-appearance dark square (task 5/33); GIF placeholder contrast fixed at the batched gate. The axe colour-contrast pass is green on every screen in both appearances (`e2e/audi`).
- Monospace exception: code in the editor and run output stays on the existing monospace stack (plan 1.4); the kit has no monospace face. Deviation from a literal reading of FR-3 "any text".
- Toast text deviation: text on success/notice/negative signal fills is black or white, whichever meets 4.5:1, instead of the kit's `OnSignal` white, which fails on #0DA20D, #15DA15 and #FFAA00 (plan table, `contrast.ts`).
- Icon fidelity at 16/48 px: no issues recorded by the sweep or the visual checks (no dedicated 16/48 px pixel comparison was added in this pass).

## Task 36 follow-ups (orchestrator)

- `present-drawing.spec.ts`: not a CSS regression; the Draw-off text drag landed on a line boundary after the layout widened; the drag now covers the first line (assertions unchanged).
- `latency.spec.ts` AC-23: not attributable to the redesign. Pre-redesign HEAD built in a worktree measured 2.7/2.9/4.0 ms vs 015 tree 2.5–3.3 ms; the 2.60 ms baseline (spec 003 notes) looks like a quiet-machine sample. Human to re-record the baseline on a quiet machine or widen the statistics.
- Chess e2e (9 tests + `chess-latency` AC-29): the board is only rendered once a game exists (`{game && <Board…`), identical in HEAD; spec 014 FR-3/AC-2 says the starting position shows before Start. Pre-existing mismatch, not a 015 regression. Needs a decision (render the starting position, or change spec 014).
- Task 36 left unticked until the chess decision and the latency baseline are resolved.

## Validation pass (automated, 2026-11-07)

**Tasks:** 37/37 ticked in tasks.md. Note: task 36 is now ticked, but the last notes entry (above) said it stays unticked until the chess starting-position decision and the latency baseline were settled. No note records either decision.

**Run**
- Frontend `vitest`: 108 files, 1240/1240 pass. `tsc -b`: clean.
- `scripts/check-no-apple-assets.sh`: pass. `scripts/check-theme-tokens.sh`: pass (FR-8, consistency).
- No font, icon or logo files tracked by git (`git ls-files` match for woff/ttf/otf/logo/rings is empty) (FR-2, FR-3, FR-11 licensing criteria).
- **e2e NOT RUN.** `npx playwright test` aborted in global-setup: `TEST_KEYCLOAK_ADMIN_PASSWORD` unset and the compose env (DATABASE_URL, OIDC_*, POSTGRES_*) missing. It needs the test stack's credentials, which this pass does not have. So no verification of the e2e-only criteria below.
- `scripts/check.sh` (biome, ruff, secret scan, backend tests) not run. The last notes entry recorded 5 biome errors in `src`; unverified whether they are fixed.

**Acceptance criteria**
- Verified by this pass: FR-8 (no Apple assets or tokens), licensing half of FR-2/FR-3/FR-11 (nothing committed), FR-9 unit half (1240 tests green).
- Not verified (need e2e stack): FR-1, FR-4, FR-5, FR-6/6a, FR-7, FR-10, FR-11 logo behaviour, FR-12 (the `InviteLink` component exists and is used by `ChessSessionWindow`/`SessionWindow`, but the "visible in light and dark" check is in `e2e/audi/invite-copy.spec.ts`), a11y contrast and focus sweeps.
- Code reading only: `ChessSessionWindow.tsx` now renders `Board` with `START_GAME` before a game exists, which looks like it resolves open item 1 from task 36. Unconfirmed until the chess e2e specs run.

**Still open from the task 36 notes**
- `latency.spec.ts` AC-23 baseline (2.60 ms) needs a human re-record on a quiet machine.
- Known deviations still stand: monospace in editor/run output (FR-3 "any text"), toast text black/white instead of the kit's OnSignal white. **spec.md is now stale on: FR-3 (monospace exception) and FR-4 toast colour. Update it before the next change to this feature.**
- Biome errors/warnings listed in task 36 open item 4.
