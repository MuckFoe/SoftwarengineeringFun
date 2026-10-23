# 003 — Apple-style UI overhaul: plan

HOW only. Requirement ids refer to `spec.md`.

## Architecture

The frontend is restyled rather than rewritten. Existing data hooks, the API client, the Yjs collab provider and routing are reused unchanged. What changes is the presentation layer, the page structure (one window per screen) and three additions: an appearance system, a shortcut system and an admin "Stale sessions" list. The backend gains one read endpoint and passes an appearance hint through sign-in. The identity provider (Keycloak) gets a login theme.

### Module layout (frontend/src)

```
theme/        tokens.css        colour, type, spacing, radius, shadow tokens for light + dark (FR-1, FR-7)
              materials.css     translucent sidebar/toolbar material, opaque fallbacks (FR-1, NFR-3, NFR-4)
              motion.css        durations/easings, reduce-motion overrides (FR-4, NFR-4, NFR-5)
              appearance.ts     pure: Choice = "light"|"dark"|"system"; resolve(choice, osDark); load/save (FR-5, FR-6)
              useAppearance.ts  React hook: current choice, resolved value, setter; live OS listener (FR-5)
ui/           Window, Toolbar, Sidebar, SourceList, Inspector, BottomPanel,
              Sheet, Popover, Button, TextField, SearchField, SegmentedControl,
              Banner, Spinner, InlineMessage, Hud, EmptyState, Icon        (FR-1..FR-4, FR-13)
shortcuts/    registry.ts       the single table of every shortcut (FR-17)
              keys.ts           platform detection, event → combo matching, label rendering (⌘ vs Ctrl)
              reserved.ts       browser-reserved combos per browser/OS + CodeMirror keymap combos (FR-20)
              useShortcut.ts    one global keydown dispatcher; hook registers a handler by id
              ShortcutList.tsx  sheet listing the registry for the current platform (FR-19)
components/   CodeEditor (theme via CSS vars), PresenceList, RunPanel, ProblemSourceList,
              StaleSessionsList, AccountControl (Sign in / account menu), AppearanceControl
pages/        ProblemsWindow (was ProblemList), ProblemEditorSheet (was ProblemForm),
              SessionWindow (was SessionPage), NotFound, Forbidden
```

`components/ProblemSwitcher.tsx` is removed: problem switching moves into `ProblemSourceList` in the session sidebar (FR-9). Its switching logic moves along with it.

**Dependency direction:** `pages → components → ui → theme`. `shortcuts` is used by `pages` and `components`. `ui` and `theme` never import `api/`, `collab/` or `auth/`. Nothing imports from `pages`.

**Styling:** plain CSS custom properties in `theme/` plus CSS Modules (`*.module.css`, built into Vite) per `ui` component. No CSS framework.

### Window structure

| Screen | Sidebar | Toolbar | Main | Panels |
|---|---|---|---|---|
| Problems (`/`) | "Problems" source list. Admins also get a "Stale sessions" section (FR-9). | Sidebar toggle, search field, New problem (editors), appearance, account | Problem table, filtered as the user types (FR-11) | Create/edit as a `Sheet` (FR-2) |
| Session (`/s/:invite`) | "Problems" source list (switching, FR-9), "Participants" (presence) | Sidebar toggle, problem title, Run, Invite, run-panel toggle, inspector toggle (once 002 is in), appearance, account (FR-10) | CodeMirror editor | Bottom panel with run results (FR-10). Right inspector with tabs *Description* and *Chat* (FR-14, FR-15, spec 002). Stale `Banner` under the toolbar (FR-12). |
| Not found / forbidden | none | Appearance, account | `EmptyState` with a link to `/` (FR-13) | none |

**Widths (NFR-2).** Sidebar 220 px, inspector 320 px, editor at least 420 px. Below 1200 px the sidebar can still be shown, but it overlays the editor instead of pushing it. At 1024 px, sidebar overlay + editor + inspector fits without horizontal scroll. Description and chat share the inspector as tabs, so at 1280 px the editor, sidebar and description are all visible at once (AC-15).

**Sheets (FR-2, AC-2).** `Sheet` is a native `<dialog>` opened with `showModal()`, which gives the focus trap, Esc and the backdrop. Opening create/edit from the list sets local state and does not navigate. The list stays mounted, so its scroll position and URL are untouched. The old deep links `/problems/new` and `/problems/:id/edit` still work (FR-8): they render `ProblemsWindow` with the sheet already open. `Popover` uses the HTML `popover` attribute for the appearance control and the account menu.

**Feedback (FR-3).** Run shows a `Spinner` inside the Run button and in the bottom panel right away, and the result replaces it. Failures are an `InlineMessage` next to the control, with form state kept (AC-4). Non-blocking confirmations ("Invite link copied", "Session reactivated") use `Hud`, a transient `role="status"` overlay. Alerts are used only for destructive confirmations (deleting a problem).

**Motion (FR-4, NFR-5).** All animation is CSS transitions and keyframes using the tokens `--motion-fast: 150ms` and `--motion-base: 250ms`, never more than 300 ms. Sheet: slide down + fade. Panels: width/height collapse. Participant join/leave and list row add/remove: fade + height. Under `prefers-reduced-motion: reduce`, every movement keyframe is swapped for a fade-only keyframe of the same name suffix (`*-reduced`). Animations never block pointer or keyboard events.

### Appearance (FR-5..FR-7)

- `appearance.ts` stores the choice in `localStorage["appearance"]` as `light`, `dark` or `system`; nothing stored means `system`. Reads and writes are wrapped in try/catch and fall back to `system`.
- An inline script in `index.html` sets `<html data-appearance="light|dark">` before first paint, so there's no flash. `useAppearance` keeps it in sync and listens to `matchMedia("(prefers-color-scheme: dark)")` for live OS changes.
- Tokens: `:root[data-appearance="dark"] { … }` redefines every colour token. All components and the CodeMirror theme use tokens only, so FR-7 has no light-only leftovers.
- **CodeMirror:** one `EditorView.theme` plus one `HighlightStyle`, both written against CSS variables. Switching appearance needs no editor reconfiguration, and remote cursors from `y-codemirror.next` keep working.
- **Materials:** sidebar and toolbar use `background: var(--material-bg); backdrop-filter: blur(20px) saturate(180%)`. Without `@supports (backdrop-filter: …)`, or under `@media (prefers-reduced-transparency: reduce)`, they fall back to the opaque `--material-bg-opaque` (NFR-3, AC-22).
- **Type:** `font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Code uses `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. Fonts are referenced by family name only and no font files are shipped (NFR-1). The HIG macOS type scale goes into tokens (`--type-body: 13px/16px`, `--type-title2: 17px/22px`, …).
- **Accent:** one token, `--accent` (blue), with light and dark values, also applied through CSS `accent-color`.
- **Icons:** about 20 hand-drawn inline SVGs in `ui/Icon.tsx` (sidebar, play, stop, person, link, sun/moon, chevrons, search, plus, gear, exclamation, chat, doc). No SF Symbols and no icon package (NFR-1).

### Shortcuts (FR-17, FR-19..FR-21)

`registry.ts` is the only place a combo is defined. Each entry is `{ id, label, mac, other, scope: "global" | "session" | "problems" | "sheet" }`. `useShortcut(id, handler)` registers a handler. A single `keydown` listener on `window` matches the event against entries in the active scopes, calls `preventDefault()` and runs the handler. `ShortcutList` renders the registry with platform labels.

| Action | macOS | Windows / Linux | Scope | Convention |
|---|---|---|---|---|
| Run code | ⌘↩ | Ctrl+Enter | session | Xcode / playgrounds |
| Close sheet or popover | Esc | Esc | sheet | HIG |
| Default button | ↩ | Enter | sheet | HIG |
| Focus search | ⌘F | Ctrl+F | problems | Finder/Mail. Inside the editor, ⌘F stays CodeMirror's find. |
| New problem | ⌥⌘N | Ctrl+Alt+N | problems | ⌘N is reserved by browsers |
| Save problem | ⌘S | Ctrl+S | sheet | standard |
| Show/hide sidebar | ⌃⌘S | Ctrl+Alt+S | global | Finder/Mail "Show Sidebar" |
| Show/hide run panel | ⌃⌘R | Ctrl+Alt+R | session | — |
| Show/hide chat | ⌃⌘C | Ctrl+Alt+C | session | — |
| Next / previous problem | ⌃⌘↓ / ⌃⌘↑ | Ctrl+Alt+PageDown / PageUp | session | — |
| Copy invite link | ⌃⌘I | Ctrl+Alt+I | session | — |
| Appearance setting | ⌘, | Ctrl+, | global | macOS Settings |
| Shortcut list | ⇧⌘/ (⌘?) | Ctrl+Shift+/ | global | macOS Help |

Key choices approved 2026-10-23. `reserved.ts` lists the combos the four browsers on macOS and Windows keep for themselves (new tab/window, close, address bar, tab switching, reload, devtools including ⌥⌘I and ⇧⌘C, fullscreen ⌃⌘F, and the OS combos ⌃⌘Q, ⌃⌘D and ⌃⌘Space), plus every binding in the CodeMirror keymaps the editor loads. The registry test (AC-18b) fails on any overlap. If implementation finds a combo that can't be intercepted in a browser (⌘, is the one most likely to fail), the replacement is chosen within the same task and the table is updated here.

Known risk: on some European layouts Ctrl+Alt acts as AltGr. Inside the editor, the Windows/Linux Ctrl+Alt combos are only handled when the key doesn't produce a character (`event.key.length > 1` or a letter key without composition), so typing ć/ś still works.

**Keyboard reach (FR-21).** Source lists use roving tabindex with arrow keys and Return to open. The toolbar is one tab stop with arrow keys between buttons (WAI-ARIA toolbar pattern). Tab order is sidebar → toolbar → main → panels. The editor doesn't trap Tab: Esc followed by Tab leaves it (CodeMirror's `indentWithTab` escape behaviour). Every `ui` control shows a `:focus-visible` ring drawn from `--focus-ring` (NFR-4).

### Sign-in (FR-9, FR-18)

- **Entry point:** `AccountControl` sits in every window's toolbar. Signed out, it shows "Sign in", which links to `/api/auth/login?next=<current path>&appearance=<resolved>`. Signed in, it shows the user's name and a popover with Sign out. The existing `next` handling returns the user to where they started (AC-10a).
- **Backend:** `/api/auth/login` takes an optional `appearance` (`light|dark`, any other value is dropped) and forwards it as an extra authorization request parameter (`authorize_redirect(..., appearance=…)`). Keycloak ignores unknown parameters but leaves them in the first login page's URL.
- **Keycloak theme:** `keycloak-theme/collab/login/` with `theme.properties` (`parent=keycloak.v2`), `resources/css/collab.css` (the same token values as `theme/tokens.css`, copied by a small check script rather than shared at runtime, because it's a different origin) and `resources/js/appearance.js`. The script reads `appearance` from the URL on first load, keeps it in `sessionStorage` on the Keycloak origin for later pages (errors, OTP), falls back to `prefers-color-scheme`, and sets `data-appearance`.
- **Wiring:** `realm.json` sets `"loginTheme": "collab"`, and `docker-compose.test.yml` mounts `./keycloak-theme/collab` at `/opt/keycloak/themes/collab:ro`. Production Keycloak is external, so `.env.example` / deployment docs explain how to install the theme and select it for the realm. See the compliance notes.

### Admin "Stale sessions" (FR-9, FR-12)

- **Backend:** add `repo.list_stale(conn) -> list[StaleSessionRow]` (session joined to current problem title, ordered by `stale_at desc`) and `GET /api/sessions/stale`, gated by `require_role("admin")`. It's declared before `GET /{invite}` so the path doesn't fall into the invite route. Reactivation reuses `POST /api/sessions/{invite}/reactivate` unchanged.
- **Frontend:** `StaleSessionsList` renders in the Problems window sidebar only when `useMe()` has the `admin` role. Each row shows the problem title and how long it has been stale, with an inline Reactivate button. Success removes the row (animated) and shows a `Hud`. A 409 `not_stale` also removes the row. Selecting the row text opens `/s/:invite`.
- **In session:** the existing `423 stale` response with `can_reactivate` drives the `Banner`. The Reactivate button sits in the banner, editor and Run are disabled (CodeMirror `readOnly` + `editable` false), and controls show the `disabled` state (AC-13).

### Spec 002 surfaces (FR-14..FR-16)

Spec 002 is still `draft`, so these are built as slots that render only once 002's data exists. *Description* is an inspector tab that renders 002's sanitised description HTML inside `.prose` styles, with `img { max-width: 100%; height: auto }`. *Chat* is an inspector tab with sender grouping (consecutive messages from one sender within 5 minutes share a header), a `n/2000` counter, and a disabled input with the reason text when the session is stale. The problem editor sheet gets a *Description* field that hosts 002's editor controls. Decided 2026-10-23: 003 goes ahead first, and 002 is done later. The tasks for these slots depend on 002's implementation tasks and are scheduled after them.

## Data model

No schema changes. One new read query:

```sql
select s.invite_id, p.title as problem_title, s.stale_at, s.last_activity_at
from session s join problem p on p.id = s.current_problem_id
where s.stale_at is not null
order by s.stale_at desc;
```

Client-side: `localStorage["appearance"]: "light" | "dark" | "system"`. On the Keycloak origin: `sessionStorage["appearance"]`.

## Contracts

```
GET /api/sessions/stale            admin only
  200 [{ "invite_id": str, "problem_title": str, "stale_at": ISO-8601, "last_activity_at": ISO-8601 }]
  401 {"error": "unauthenticated"}   403 {"error": "forbidden"}     (existing require_role shapes)

GET /api/auth/login?next=<path>&appearance=<light|dark>
  302 → Keycloak authorize URL, with &appearance=<value> appended when valid
```

```ts
// theme/appearance.ts
export type Choice = "light" | "dark" | "system";
export function resolve(choice: Choice, osDark: boolean): "light" | "dark";
export function loadChoice(): Choice;            // never throws
export function saveChoice(c: Choice): void;     // never throws
// theme/useAppearance.ts
export function useAppearance(): { choice: Choice; resolved: "light" | "dark"; setChoice(c: Choice): void };

// shortcuts/registry.ts
export type Scope = "global" | "session" | "problems" | "sheet";
export interface Shortcut { id: ShortcutId; label: string; mac: Combo; other: Combo; scope: Scope }
export interface Combo { key: string; mod?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } // mod = ⌘ on mac, Ctrl elsewhere
export const SHORTCUTS: readonly Shortcut[];
// shortcuts/keys.ts
export function isMac(): boolean;
export function matches(e: KeyboardEvent, c: Combo, mac: boolean): boolean;
export function label(c: Combo, mac: boolean): string;
// shortcuts/useShortcut.ts
export function useShortcut(id: ShortcutId, handler: () => void, opts?: { enabled?: boolean }): void;

// ui/Sheet.tsx
export function Sheet(p: { open: boolean; onClose(): void; title: string; children: ReactNode; defaultAction?: () => void }): JSX.Element;
```

```python
# backend/app/sessions/repo.py
@dataclass(frozen=True)
class StaleSessionRow:
    invite_id: str
    problem_title: str
    stale_at: datetime
    last_activity_at: datetime

async def list_stale(conn: asyncpg.Connection) -> list[StaleSessionRow]: ...
```

## HIG checklist (referenced by AC-1)

A human reviewer runs this per screen × appearance, and the results are logged in `notes.md`:

1. Only the system UI font stack. Sizes come from the type-scale tokens only.
2. Spacing on the 4 pt grid (multiples of 4 px). Content margins of at least 20 px.
3. One accent colour, used only for primary actions, selection and focus.
4. Controls have rounded corners (6 px controls, 10 px sheets/popovers). The primary button is filled, others are bordered or plain.
5. Sidebar and toolbar use the translucent material (or its opaque fallback).
6. Secondary tasks open as sheets or popovers, not as pages.
7. No decorative colour, gradients or heavy shadows. Separators are hairline.
8. Destructive actions are labelled in red and confirmed with an alert.

## Test strategy

Levels: **unit/component** = Vitest + Testing Library in jsdom (`frontend/`). **Backend integration** = pytest against real Postgres and Keycloak (`backend/tests/integration/`). **E2E** = Playwright in real Chromium, WebKit and Firefox against the docker compose test stack (`e2e/`). Per constitution rule 4, browser APIs that jsdom lacks (`matchMedia`, `backdrop-filter`, layout) aren't faked: anything that depends on them is tested in E2E.

| AC | Level | Test |
|---|---|---|
| AC-1 | manual | HIG checklist above, recorded in `notes.md` by `/sdd-validate` |
| AC-2 | component + E2E | open create/edit from the list → `dialog[open]`, `location.pathname` unchanged, list scroll offset kept after close |
| AC-3 | E2E | click Run → spinner visible within 100 ms, no `dialog[open]`, result replaces spinner |
| AC-4 | component | server 422 on save → `InlineMessage` next to the field, inputs keep their values (real API via test stack in E2E twin) |
| AC-5 | E2E | `reducedMotion: "reduce"` → open sheet and join a participant; computed `animation-name` ends in `-reduced` (fade only) |
| AC-6 | E2E | `colorScheme: "dark"` with no storage → dark tokens; `page.emulateMedia({colorScheme:"light"})` → light without reload |
| AC-7 | E2E | choose Light under dark OS, new page in the same context → light; choose System → follows OS |
| AC-8 | E2E | dark: background luminance of the editor, run panel, presence list and alert all below a threshold |
| AC-9 | E2E + integration | the existing 001 suites (`backend/tests`, `e2e/*.spec.ts`) run unchanged, with selectors updated to roles/labels only |
| AC-10 | E2E | choose another problem in the sidebar → editor switches; no `ProblemSwitcher` / combobox present |
| AC-10a | E2E | signed out on `/s/:invite` → Sign in → Keycloak login → back on the same path, account name shown |
| AC-10b | integration + E2E | `GET /api/sessions/stale`: admin 200 with only stale rows, editor 403, anonymous 401. E2E: reactivate from the sidebar → row gone, session active |
| AC-10c | E2E | the existing 001 invite-join spec passes unchanged |
| AC-11 | E2E | landmarks: sidebar has Problems + Participants, toolbar has Run/Invite/Appearance, run panel toggles |
| AC-12 | component | 12 problems, type a substring → rows narrow on each keystroke |
| AC-13 | E2E | stale session: banner inside the viewport, editor `contenteditable=false`, Run disabled; admin sees Reactivate in the banner |
| AC-14 | E2E | `/nope` → EmptyState with a link to `/` |
| AC-15..17 | E2E | written with 002's tasks, skipped (`test.fixme`) until 002 is implemented |
| AC-18 | E2E | ⌘↩ (WebKit, mac platform) and Ctrl+Enter (Chromium, linux) run code; Esc closes a sheet and a popover |
| AC-18a | unit + E2E | registry covers every FR-17 action id; E2E presses each combo and asserts its effect |
| AC-18b | unit | no `SHORTCUTS` combo appears in `reserved.ts` for any browser/OS or in the CodeMirror keymaps; no duplicates within a scope |
| AC-18c | E2E | per screen, a keyboard-only script (Tab/arrows/Return/shortcuts, no `click`) completes each action |
| AC-18d | E2E | `colorScheme` dark/light → Keycloak login page body uses the theme's dark/light background; also with `appearance=` overriding the OS |
| AC-19 | script + CI | `scripts/check-no-apple-assets.sh` scans `frontend/dist` and `keycloak-theme/` for any font file (`.otf/.ttf/.woff*`), `apple-touch-icon`, and the words "Apple", "macOS", "SF Pro" in user-visible text. Fails on a match. |
| AC-20 | E2E | 1024×768, each screen × appearance: `scrollWidth <= clientWidth`; every button's bounding box inside the viewport |
| AC-21 | E2E | `@axe-core/playwright` `color-contrast` rule, zero violations per screen × appearance (incl. Keycloak page); Tab through all → each focused element has a non-`none` outline |
| AC-22 | E2E (Chromium) | CDP `Emulation.setEmulatedMedia` `prefers-reduced-transparency: reduce` → sidebar/toolbar `backdrop-filter: none`, opaque background |
| AC-23 | E2E | 50 edits, p95 propagation latency between two pages ≤ baseline × 1.1. Baseline measured once on commit `154f84b` (pre-redesign) with the same harness and recorded in `notes.md` |

## Dependencies

| Dependency | Where | Why existing code / stdlib isn't enough |
|---|---|---|
| `@codemirror/language`, `@lezer/highlight` | frontend | Already installed transitively by `codemirror`. Declared explicitly because the token-based `HighlightStyle` imports them directly. |
| `@axe-core/playwright` | e2e (dev) | WCAG contrast measurement across real rendered colours (AC-21). Writing a correct contrast checker that handles alpha, materials and blur is out of proportion. |

No backend dependency is added. No UI kit, CSS framework, icon or font package (NFR-1).

## Constitution compliance

1. **Test-first:** every row in the test table is written as a failing test inside the task that implements it.
2. **Green before done:** the full suite includes the unchanged 001 backend and E2E suites (AC-9).
3. **Traceable tests:** the table above maps every AC, including AC-10a..c and AC-18a..d, to a test. AC-1 is a manual check, because the spec defines it as a human review against this checklist.
4. **Real dependencies:** no mocks. jsdom gaps are handled by moving those tests to E2E rather than stubbing `matchMedia`. Keycloak runs for real in the test stack.
5. **Fixed stack:** React + TS strict + Vite, FastAPI, Postgres, docker compose, all unchanged. The Keycloak theme (FreeMarker-parented CSS/JS) is configuration for the identity provider that already exists, not a new application stack. Production Keycloak is external, so FR-18 holds there only once the operator installs the theme. Decided 2026-10-23: documenting the install step is enough.
6. **Dependency justification:** see Dependencies.
7. **No secrets:** none introduced. The theme and realm changes contain no credentials.
8. **Lint/format:** `biome ci` covers the new TS and CSS. `ruff` covers the endpoint. The Keycloak theme JS is inside the biome scope.
9. **Module layout and dependency direction:** stated under Architecture.
