# 015 — Audi UI redesign: plan

Spec: `spec.md` (approved, zero open markers). Design values: `docs/research/audi-figma-kit-tokens.md` (wins) and `docs/research/audi-styleguide-notes.md`.

This is a frontend-only change plus two build/deploy scripts. No backend, database or API change. The plan was written without reading code (per `/sdd-plan`), so where it depends on the current structure it says "audit confirms". The first task of `/sdd-tasks` must be that audit.

## 1. Architecture

### 1.1 Layers and dependency direction

```
index.html ── <link> brand/brand.css (generated at deploy, never in repo)
   │
frontend/src/
  styles/   tokens.css  base.css  type.css  motion.css          ← only place raw colours/px scales live
  brand/    fonts-fallback.css (+ vendored woff2)  icons-fallback.css  iconMap.ts  Icon.tsx  BrandLogo.tsx
  ui/       Button IconButton TextField TextArea Select Checkbox Radio Switch Tabs Dialog Menu
            Popover(Tooltip) Toast Notification Badge Tag ListItem ChatBubble Spinner Divider Card
            AppHeader AppearanceToggle        + one <name>.css each
  pages/, games/, scratch/ …                                    ← existing screens, restyled to use ui/
```

Dependency direction: `pages/games/…  →  ui/  →  brand/ + styles/`. `ui/` never imports a page; `styles/` imports nothing. A guard test (§4) enforces that raw colour literals appear only in `styles/tokens.css` (plus the generated icon CSS).

If spec 003 already left equivalents of any `ui/` primitive, the audit maps them and they are **replaced in place**; no second implementation survives. Existing accessible names, roles, placeholders, labels and `data-testid`s are preserved so existing tests keep asserting the same things (FR-9).

### 1.2 Single source of visual values (NFR Consistency)

`styles/tokens.css` is the only definition of colour, spacing, radius, type scale, elevation, motion and focus values, as CSS custom properties, using the **semantic** layer of the kit (`Sem/…`), named below. A later kit update edits this file (and `kit-values.json`, §4) only.

- Light = `:root`. Dark = `:root[data-theme="dark"]`, and `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }`. Explicit light = `:root[data-theme="light"]`.
- FR-6 live follow is therefore pure CSS (no JS listener, no reload); everything else (editor theme, icons, logo, board) reads the same variables, so it follows too.
- FR-6a: the existing appearance setting from spec 003 (system / light / dark, remembered per device, "system" clears it) keeps its storage key and `data-theme` attribute if the audit finds them; only the values it selects change. `AppearanceToggle` restyles it as an Audi segmented/toggle control. The pre-paint inline script in `index.html` stays.

### 1.3 Token names (mapped to kit variables; values pinned by the contract test)

| Group | CSS variables → kit source |
|---|---|
| Canvas/surface | `--canvas`, `--canvas-inverted`, `--surface-1`…`--surface-4` → `Sys/Color/Canvas/*`, `Surface/Elevation/Level1..4` |
| Highlight | `--highlight`, `--on-highlight` → `Surface/Highlight/Primary`, `Foreground/OnHighlight/100` |
| Neutral ramp | `--neutral-100`…`--neutral-800` → `Surface/Neutral/*` (700 is the alpha tint, used as hover/pressed overlay and "other person" chat bubble) |
| Actions | `--action-primary-fill / -fill-hover / -fill-disabled / -text`, `--action-secondary-stroke / -stroke-hover / -stroke-disabled / -fill-pressed`, `--action-text / -text-hover / -text-disabled` → `Sem/Color/Action/*` |
| Forms | `--form-stroke / -stroke-active / -stroke-error / -stroke-disabled / -stroke-readonly`, `--form-underline(+ -active / -error / -disabled)`, `--form-text / -caption / -text-active / -text-error / -text-disabled`, `--form-readonly-fill` → `Sem/Color/Forms/*` |
| Navigation/UI | `--nav-active / -idle / -disabled`, `--nav-pressed`, `--divider`, `--ui-stroke / -hover / -disabled`, `--text`, `--text-interactive`, `--text-disabled`, `--scrim` → `Sem/Color/Navigation|UI/*` |
| Signal | `--focus` (#0989FF), `--negative`, `--success`, `--notice`, `--intelligent`, `--neon-blue` → `Surface/Signal/*` |
| Radius | `--radius-0` (default, all controls), `--radius-xs` 2 (checkbox), `--radius-sm` 4 (select/menu options), `--radius-md` 8 (drawer), `--radius-max` 999 (radio, switch, small badge) |
| Stroke | `--bw-1`, `--bw-2` (active input underline), `--bw-3`, `--bw-focus` 4 |
| Spacing | `--space-2/4/8/12/16/20/24/28/32/36/40/48/56/64/72/80/96/128` (fixed scale) and `--page-margin` (16/28/40/60/96 per breakpoint) |
| Elevation | `--elev-1`…`--elev-4`, `--elev-card` → `Sys/Elevation/*` (light: shadows; dark: the lighter `--surface-n` carries depth) |
| Type | `--font-copy`, `--font-display`, `--wdth-copy` 108, `--wdth-display` 130, `--fs-*`/`--lh-*` for display1/2, h1–h4 (responsive per kit table) and copy1–3, label sizes |
| Motion | `--ease-audi: cubic-bezier(.75,.02,.5,1)`, `--dur-fast` 150ms, `--dur-base` 250ms (durations are unpublished; chosen here) |

Breakpoints for the type/margin media queries: 375, 768, 1024, 1440, 1920 (kit `Breakpoints` set).

### 1.4 Typography (FR-3)

- Stack: `"Audi Type", "Roboto Flex", Verdana, system-ui, sans-serif`. Verdana is Audi's own documented fallback; Roboto Flex (SIL OFL) is the in-repo fallback because it has the **width and weight axes** the kit uses (headlines at `font-stretch: 130%`, copy at 108%, per the styleguide's own `wdth 108` example), so layout metrics stay close.
- The fallback woff2 (latin subset, wght+wdth axes) is **vendored** at `frontend/src/assets/fonts/` with its OFL licence file. It is obtained once from the `@fontsource-variable/roboto-flex` package via `npm pack` and is **not** added to `package.json`.
- Both faces use `font-display: swap` (text visible immediately in the fallback, then swaps — FR-3 AC 3).
- Type scale from the kit tables, as CSS classes in `type.css` (`.type-display-1`, `.type-h1`…`.type-h4`, `.type-copy-1..3`, `.type-label-*`). Headlines Extended; copy/buttons/forms/nav Wide; never uppercase (styleguide rule).
- **Exception, flagged for review:** code in the editor and run output stays on the existing monospace stack. The kit defines no monospace face, and proportional type would damage the editor. This is a deviation from a literal reading of FR-3 "any text".

### 1.5 Brand assets supplied at deploy (FR-2, FR-3, FR-11; licensing NFR)

One host directory, `brand-assets/` at the repo root (env `BRAND_DIR` overrides). It is in `.gitignore` and `.dockerignore`. It is **mounted into** (writable, because the logo is cached there at runtime, §1.6; read-only if `brand.sh` pre-fills it) whichever container serves the built frontend and served at `<BASE_URL>brand/` (audit confirms the serving container and the hub path prefix; references use Vite's `BASE_URL`, and `url()`s inside `brand.css` are relative to it, so a path prefix does not break them).

```
brand-assets/
  fonts/*.woff2            optional, user-supplied Audi Type files
  icons/<name>.svg         optional, user-supplied Audi icons (24px masters, names as in the icon library)
  logo.svg | logo.png      optional, fetched from the styleguide (§1.6)
  brand.css                ALWAYS present: written by frontend/scripts/brand-assets.mjs
```

`brand-assets.mjs` scans the directory and writes `brand.css` containing **only rules for files that exist**:

- `@font-face { font-family: "Audi Type"; src: url(fonts/<file>) format("woff2"); font-weight: 100 900; font-stretch: 75% 150%; font-display: swap }` per supplied file. No files → no rule, no request, no console error (FR-3 AC 2). Weight/stretch ranges are declared as the variable font's; the script reads them from a sidecar `fonts/fonts.json` if present, else uses these defaults.
- `.icon[data-icon="<name>"] { mask-image: url(icons/<name>.svg) }` per supplied icon.
- If a logo exists: `.brand-logo { display: block; mask: url(logo.svg) center/contain no-repeat }` and `.brand-name--with-logo { … }` (see below).
- No files at all → `brand.css` is an empty comment. It is never a 404, so the `<link>` in `index.html` is unconditional. If the directory is not mounted at all, the static server falls back to an empty stylesheet for that path (audit confirms how, in the serving config).

Because all three asset kinds are applied as CSS (`font-face`, `mask-image`) and never as `<img>`, a missing or failed asset can never show a broken image or blank gap.

**Icons.** `Icon.tsx` renders `<span class="icon" data-icon="add" aria-hidden>` sized 16/24/48 (kit sizes) and coloured with `currentColor` via `mask`. `icons-fallback.css` (committed, generated) defines a default `mask-image` for every name in `iconMap.ts`; `brand.css`, loaded later, overrides the names the Audi set provides. Every semantic name the app uses therefore always has a glyph (FR-2 AC 2). `iconMap.ts` maps app-semantic names (e.g. `send`, `close`, `chat`) → Audi icon-library name (from the inventory in the research doc, e.g. `send`, `cancel`, `discussion`) → fallback glyph. Fallback glyphs come from Lucide (ISC), converted by `frontend/scripts/gen-fallback-icons.mjs` with stroke width 1 to match Audi's 1 px contour, output committed with the ISC notice. Audi icons come with Dark/size variants; the mask approach uses the single 24px master scaled to 16/48 — pixel-grid fidelity at 16/48 is traded for one file per icon (flag in notes if visibly off).

**Logo (FR-11).** `AppHeader` always renders `<a class="brand"><span class="brand-logo" role="img" aria-label="Audi"/><span class="brand-name">…</span></a>`. With no logo rule in `brand.css`, `.brand-logo` is `display:none` and the app name shows alone (no gap). With a logo rule, the mask renders the rings in `currentColor` (black in light, white in dark → contrast in both appearances, one file) and the name stays as the text beside it. Height fixed (24 px, `width:auto` via `aspect-ratio` from the file's viewBox is set by the generator) so it cannot distort at narrow widths. Rings are monochrome, so masking is faithful.

### 1.6 Obtaining the logo from the styleguide

The styleguide (`https://styleguide.audi.com/document/2865#/-/ui-introduction`) is a Frontify SPA; a plain HTTP fetch returns an empty shell. `frontend/scripts/fetch-brand-logo.mjs` therefore drives headless Chromium via the **already-present Playwright** (no new dependency):

1. Open the URL; wait for network idle and for the document header to render.
2. Collect candidates from (a) `<img>` / inline `<svg>` in the page header whose alt/aria/href/class mentions audi, logo or rings, and (b) network responses of type `image/svg+xml` or `image/png` whose URL matches `/logo|rings/i`.
3. Validate a candidate: SVG with no `<text>`/`<image>` and a viewBox aspect ratio between 2.5:1 and 4.5:1; or a PNG with an alpha channel that is not fully opaque and the same aspect range. Anything else is rejected. (Rejection of opaque images matters: a mask of an opaque image is a solid block.)
4. Write the first valid candidate to `brand-assets/logo.svg|png` plus `logo.source.txt` (source URL, date). Fetched at runtime when no logo is cached yet (first start of the dev server or serving container) and stored in the gitignored `brand-assets/`; later starts reuse the cache. Never committed and never hot-linked by the browser, so the page has no dependency on, or CSP exposure to, Audi's site; only the start-up fetch touches it.
5. Any failure (timeout, no candidate, rejection, blocked) prints a warning and exits **0** without writing; the app-name fallback applies.

**This is unverified:** the styleguide's DOM and asset URLs are not known to be stable or even to expose the rings as a standalone asset. The first implementation task is therefore a **spike** that runs this against the live site and records the outcome in `notes.md`. If extraction proves impossible, the spec's own instruction applies: the fallback ships and the spec is revisited (the human decides whether to supply `logo.svg` by hand into `brand-assets/`, which the generator accepts identically).

`frontend/scripts/brand.sh` runs fetch-then-generate. **Runtime cache:** when `brand-assets/logo.*` is absent, the dev server and the serving container run it once at start-up, non-blocking (failures only warn, start-up always succeeds); once cached, the generator rewrites `brand.css` and the header shows the logo on the next load. The hub deploy step (spec 005's script — audit locates it) may also call it before `docker compose up` to pre-fill the cache. Dev: a small Vite middleware plugin serves `BRAND_DIR` at `/brand/` and runs the generator on server start.

### 1.7 Component-level decisions where the kit is silent or the spec names a control the kit lacks

| Spec control | Audi source | Decision |
|---|---|---|
| Button | Button primary/secondary/tertiary, XS 32 / SM 48 / MD 56 | Primary filled `--action-primary-*`; secondary 1 px stroke; tertiary text. Default size SM (48) in dense tool areas, MD (56) for primary page actions; radius 0; hover = `-hover` colour; pressed = secondary fill / `-hover`; disabled = `-disabled` colours, no pointer events; loading = Spinner replaces icon slot. Min width 144 px for primary/secondary (styleguide). One primary per view is a guideline, not enforced. |
| Input / Select | Text Input, Select Field (underline) | Underline style, 56 px row, 1 px underline → 2 px active. **Label sits above the field (static), not floating**, as in the Figma kit; the styleguide's floating label is not used because it needs `placeholder=" "` and would break existing placeholder-based tests. Error: underline, label and caption/message turn `--negative`, with a 16 px alert icon. Read-only: `--form-readonly-fill`. |
| Text area (chat composer, notes) | Text Area (boxed) | 1 px box, 12 px padding, appendix/char counter 12/16. |
| Checkbox / Radio / Switch | kit | 20 px (r 2) / circle / 56×32 pill. |
| Tabs | Navigation Bar / Tabs, 56 px | Active = 2 px underline + `--nav-active`; idle `--nav-idle`; `role="tablist"` semantics preserved. |
| Dialog | Dialog | Centred tile, radius 0, `--elev-4`, content padding 16, 48 px close button top-right, scrim `--scrim` (kit 70 %; the styleguide's 90 % loses to the kit). Full-screen below 768 px. Focus trap and Esc behaviour as today. |
| Menu | Select dropdown panel | `--surface-2`, `--elev-2`, option radius `--radius-sm`, hover `--neutral-700`. |
| Tooltip | Popover | `--surface-inverse`-style: `--canvas-inverted` background, `--canvas` text, 12/16. |
| Toast | Notification (overlay toast, corner of right margin) | Feedback surface per signal; **text on success/notice/negative fills is black or white, whichever meets 4.5:1**, because the kit's `OnSignal` white fails on #0DA20D, #15DA15 and #FFAA00. Recorded deviation. |
| Badge / Tag | Badge (count/alert), Tag | As kit; badge small = filled circle. |
| List | Navigation list / Text list | Rows separated by 1 px `--divider`, hover `--neutral-700`, no rounded rows. |
| Chat bubble | **none in kit** | Square (radius 0), no tail. Others: `--neutral-700` fill, `--text`. Own: `--action-primary-fill` with `--action-primary-text`. Author name `type-label`, time `--form-caption`. |
| Card (session/problem tiles) | Card | `--surface-1`, `--elev-card` (light) / outline (dark), no radius, 16 padding, hover effect only when the whole card is the single link. |
| Header | Navigation Bar | 56 px, `--page-margin` horizontal padding, logo/app-name left, tabs, then appearance toggle and account menu. |
| Spinner / progress | Progress Indicator | Spinner 1/2/3 px stroke by size; bar track 2 / fill 4. |

### 1.8 Domain surfaces

- **Chess board.** Squares from the neutral ramp via tokens `--board-light`/`--board-dark` (light theme #E6E6E6 / #999999; dark theme #B3B3B3 / #4D4D4D — proposals, adjusted by the contrast test if piece/square pairs fail 3:1). Selection and last-move highlight use `--focus` at reduced alpha via `color-mix`; legal-move markers use `--highlight`. White pieces: `#fff`-equivalent token fill with a 1 px dark outline; black pieces the inverse, so both read on both squares in both appearances. Piece artwork stays as-is, only its fills/outlines move to tokens (audit confirms whether pieces are SVG, glyphs or images; if images, only the board changes). Clocks: `type-h3`, `tabular-nums`, low time `--negative`; active side underlined. Invite flow uses the standard Dialog/TextField/Button.
- **Code editor.** The editor theme object is built from CSS variables (`editorTheme.ts`) so it follows light/dark without re-instantiating. Chrome (gutter, selection, active line, cursor) from neutral tokens; cursor and selection use `--focus`. Syntax palette, deliberately restrained like the brand: comments `--form-caption`; keywords `--text-interactive` bold; strings `--intelligent`; numbers `--neon-blue`; functions/types `--text`; errors `--negative`. Proposed values; **the contrast test is the arbiter** — any pair under 4.5:1 on the editor background moves one step along its ramp and is noted.
- **Run output panel / chat** use `--surface-1`/`--canvas` with 1 px `--divider`; stderr text `--negative`.
- **Third-party content (FR-10).** GIFs render in a tile with `--neutral-700` placeholder background, unchanged pixels. HTML presentations render in an iframe inside a stage with `color-scheme: light; background: #fff` in **both** appearances: user HTML that sets no background gets the browser default (transparent, black text), which would be unreadable on the dark canvas; the stage frame uses a 1 px `--divider` border. (The `#fff` literal for the stage is the one allowed exception to the raw-colour guard, listed in its allowlist.)
- **Layout (FR-7).** Page shells use `--page-margin`; no fixed widths exceed the viewport; the min supported width stays whatever each screen supports today (audit records it per screen — spec 003 was ≥1024 px). Verified at 1024, 1440 and 1920 plus each screen's current minimum.
- **Motion.** Colour/opacity transitions `--dur-fast var(--ease-audi)`; overlays translate vertically only; `@media (prefers-reduced-motion: reduce)` sets durations to 0.
- **Focus (NFR).** One rule in `base.css`: `:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--canvas), 0 0 0 4px var(--focus) }` (the kit's double-ring indicator, focus colour #0989FF, ≥3:1 on both canvases). Components never remove it; elements that clip box-shadow use `outline` with the same colours.

### 1.9 Removing the Apple look (FR-8)

- Delete spec-003 styles, tokens, traffic-light window chrome, `backdrop-filter`/vibrancy, `-apple-system`/SF font stacks, large radii and macOS-style sheet animation. Spec-003 CSS variables are bridged during conversion by a temporary `styles/legacy.css` (old name → new token alias) so the app stays green per task; the final task deletes it and a guard test fails while it exists.
- Spec 003 is marked `superseded by 015` in `specs/README.md` as part of the closing task. Tests that assert 003-only appearance (traffic lights, vibrancy, SF type) are removed with a reference to FR-8; every other test stays unmodified (FR-9). The audit lists which tests these are; any other test needing a change is a plan violation to raise, not to make quietly.

## 2. Data model

None server-side. Client-side the only state is the existing appearance preference (`system | light | dark`, in `localStorage`, key unchanged). Brand assets are files, described in §1.5.

## 3. Contracts

**CSS token API** — the variables in §1.3. Consumers use only these; `tokens.css` is the sole definition site.

**React primitives (`ui/`)**, signatures precise enough to build:

```ts
type Size = "xs" | "sm" | "md";
Button({ variant: "primary"|"secondary"|"tertiary", size?: Size, icon?: IconName, loading?, disabled?, ...ButtonHTMLAttributes })
IconButton({ icon: IconName, label: string /* aria-label */, size?: "xs"|"sm"|"md", toggled?: boolean, ...})
TextField({ label: string, caption?: string, error?: string, optional?: boolean, ...InputHTMLAttributes })   // error → aria-invalid + aria-describedby
TextArea({ label, caption?, error?, maxLength?, ...})   // shows counter when maxLength set
Select({ label, caption?, error?, options: {value,label}[], value, onChange })
Checkbox / Radio / Switch({ label, caption?, checked, onChange, disabled? })
Tabs({ tabs: {id,label,icon?}[], value, onChange })          // role=tablist
Dialog({ open, onClose, title, children, footer? })          // focus trap, Esc, scrim
Menu({ trigger, items }) · Popover({ content, children }) · Toast({ tone: "info"|"success"|"notice"|"negative", children, onClose? })
Badge({ kind: "dot"|"count"|"alert", value? }) · Tag({ label, selected?, onClick? }) · ChatBubble({ own: boolean, author, time, children })
Icon({ name: IconName, size?: 16|24|48 })   // IconName = keyof typeof iconMap
AppHeader({ appName: string, children /* nav + actions */ })
AppearanceToggle()
```

Primitives forward `ref`, `className` and all native attributes so existing call sites and tests (which query by role/label/placeholder/test id) are unchanged. Where a current component has different prop names, the primitive keeps the current component's public props and adapts internally.

**Scripts**

- `node frontend/scripts/brand-assets.mjs [--dir <path>]` → writes `<dir>/brand.css`; exit 0 always for missing optional files; exit 1 only if the directory cannot be written.
- `node frontend/scripts/fetch-brand-logo.mjs [--dir <path>] [--url <url>]` → exit 0 always (warns on failure).
- `frontend/scripts/brand.sh` → fetch then generate.
- `node frontend/scripts/gen-fallback-icons.mjs` → regenerates `icons-fallback.css` from `iconMap.ts` + `lucide-static`.

**Served paths:** `<BASE_URL>brand/brand.css` (always), `<BASE_URL>brand/{fonts,icons,logo.*}` (optional, unauthenticated static, so guests/chess invitees get them; audit confirms the hub proxy does not gate `brand/`).

## 4. Test strategy

Real dependencies throughout (constitution 4). The only faked third party is the Audi styleguide site, and only in the logo-extraction logic test.

**Levels**

1. **Unit (vitest)**
   - *Token contract:* parse `tokens.css`, resolve each variable in light, dark, and the media-query path, and assert equality with `src/styles/kit-values.json` (values-only transcription of the research doc tables; this is the "verified against the Design reference" check).
   - *Contrast:* a declared list of (foreground, background, kind: text|large|ui) token pairs per appearance, including editor syntax pairs, chess squares/pieces, toast text on signal fills, focus ring on canvas; compute WCAG ratio, assert ≥4.5 (text) / ≥3 (large, UI boundaries). Disabled states are exempt per WCAG.
   - *Raw-value guard:* scan `src/**/*.{css,tsx,ts}` for hex/`rgb(`/`hsl(` literals outside the allowlist (`tokens.css`, `icons-fallback.css`, the presentation-stage `#fff`); scan for `backdrop-filter`, `-apple-system`, `SF Pro`, `BlinkMacSystemFont`, `traffic`; assert `styles/legacy.css` absent (final task).
   - *Primitives (React Testing Library):* each state and prop path (disabled, loading, error → `aria-invalid` + message, `Dialog` focus trap/Esc, `Tabs` keyboard, `Icon` renders the span for every `iconMap` name, `BrandLogo` markup).
   - *Generators:* `brand-assets.mjs` against temp dirs — empty dir (empty CSS, no `@font-face`/`.icon`/`.brand-logo`), fonts only, icons only, logo only, all; asserts output text. `fetch-brand-logo` candidate selection/validation against a local static fixture page that mimics an SPA (fake Audi site — permitted third-party fake), including opaque-PNG and wrong-aspect rejection and exit-0-on-failure.
2. **Integration / e2e (Playwright, real browser against the real stack)** — every screen in the FR-5 list, parametrized over {light, dark via `emulateMedia`} × widths {1024, 1440, 1920, each screen's lower bound}. Includes chess as a **guest via invite link**. Per screen: no `scrollWidth > clientWidth`; no console errors and no failed/4xx requests (covers "no request for a missing font"); axe-core colour-contrast and focus rules; computed-style assertions (canvas background, body font-family first entry, headline `font-stretch`, button/inputs radius 0, no `backdrop-filter`).
   - *Brand fixtures:* a test creates a temp `brand-assets/` from synthetic files (the vendored fallback woff2 renamed as the "Audi" face, a generated dummy SVG icon and logo — none are Audi assets), runs the generator, mounts it (Vite dev server `BRAND_DIR`), and asserts `document.fonts.check('16px "Audi Type"')`, the supplied icon's mask URL is requested while an unsupplied one shows the fallback glyph, and the logo element is visible in both appearances; then repeats with an empty dir and asserts no `brand/fonts` or `brand/logo` request, `.brand-logo` hidden, app name visible, header has no gap (name box left edge equals header padding).
   - *Font load:* route-delay the font file 3 s; assert text is visible (`document.fonts` status `loading`, element has non-zero text box and `visibility: visible`) and later swaps.
   - *Appearance:* system dark → dark palette; flip `emulateMedia` while open → palette changes without reload; toggle to light → persists across reload; back to "system" → follows system again.
   - *States:* on real controls — hover/focus/pressed/disabled computed colours differ pairwise for a primary and secondary button; an invalid field shows `--negative` underline and message; dialog, menu, tab bar, toast and chat bubble each assert their kit-defined fill/radius/height.
   - *FR-9:* the existing unit and e2e suites run unchanged (apart from the 003-only removals above); editor Tab-at-cursor spec re-run.
   - *FR-10:* chat GIF tile, an HTML presentation with no background in dark appearance (assert stage is white and text contrast ≥4.5), and editor syntax sample tokens pass contrast in both appearances.
3. **Repository inspection test** (unit, `git ls-files`): no tracked path under `brand-assets/`, no `.woff`/`.woff2` other than the vendored OFL fallback, no tracked file named like `audi*logo*`/`rings*`; `.gitignore` and `.dockerignore` list `brand-assets/`.
4. **Live smoke (not in the gate):** `BRAND_LIVE=1` runs `fetch-brand-logo.mjs` against the real styleguide and reports; used by the spike and manually before deploy.

**Acceptance-criterion → test map**

| Criterion | Tests |
|---|---|
| FR-1 | token contract; raw-value guard; e2e computed styles per screen |
| FR-2 (×2) | `Icon` unit over `iconMap`; e2e brand-fixture (supplied vs unsupplied icon) |
| FR-3 (×3) | e2e computed font-family/stretch; no-failed-request on empty brand dir; delayed-font visibility; generator unit |
| FR-4 (×3) | primitives unit; e2e states test on real controls; invalid-field e2e |
| FR-5 | e2e screen matrix incl. guest chess invite, GIF search, presentations, hub self-registration, learning sessions, my sessions |
| FR-6, FR-6a | e2e appearance test (all four AC) |
| FR-11 (×4) | e2e brand-fixture with/without logo, light/dark, narrow width; repository inspection test; fetch-brand-logo unit |
| FR-7 | e2e no-horizontal-scroll + overlap check (bounding-box intersection among sibling controls) per width |
| FR-8 | raw-value guard (forbidden strings, `legacy.css` absent); e2e no `backdrop-filter` computed |
| FR-9 | existing suites unchanged; editor Tab e2e |
| FR-10 | e2e third-party content test; editor syntax contrast |
| Accessibility NFR | contrast unit; axe e2e; keyboard-tab sweep asserting a focus indicator (box-shadow/outline non-none) on every focusable element of each screen |
| Performance NFR | `font-display: swap` asserted; e2e asserts no render-blocking font request (fonts load via CSS `@font-face`, never `<link rel=preload>` blocking) |

Per-task gate runtime (constitution 2): parametrization over widths × schemes is the main cost. The screen matrix is a single spec file whose width set is trimmed to {1024, 1920} + lower bound during per-task runs (`VISUAL_FULL=1` for all widths, which runs in the once-per-spec full pass).

## 5. Dependencies (constitution 6)

| Dependency | Where | Why stdlib / existing isn't enough |
|---|---|---|
| `@axe-core/playwright` | dev | Automated WCAG 2.1 AA contrast and focus checks over every screen in both appearances; hand-rolled contrast scanning of rendered pages would reimplement it. Unit-level token contrast is still done in-house (a few lines). |
| `lucide-static` | dev, generation only | Source of the neutral fallback icon glyphs (ISC licence). Drawing ~50 icons by hand is the alternative; output is committed so it is not a runtime dependency. |
| Roboto Flex woff2 | **vendored file, not a package** | In-repo fallback typeface with `wdth`+`wght` axes (OFL). No system font has the width axis. |

Playwright, vitest and Vite are already present. No backend dependency. No new runtime npm dependency.

## 6. Constitution compliance

1. **Test-first** — satisfied: every task opens with the failing test from §4 (token contract and raw-value guard exist before any CSS changes; per-screen e2e is written failing against the old look).
2. **Green before done** — satisfied; per-task gate is the kept-stack non-slow suite. Risk flagged: the screen matrix could exceed 5 min; the trimmed width set and `VISUAL_FULL` split (§4) are the restructuring, not tolerance. Full suite with `--full` once at the end.
3. **Traceable tests** — the table in §4 covers every AC; `/sdd-tasks` must cite criteria per task.
4. **Real dependencies** — satisfied. Single justified fake: the Audi styleguide page in the logo-extraction test (third-party site we do not control). The live smoke exists specifically because a fake cannot prove extraction works.
5. **Fixed stack** — React/TS strict/Vite/docker compose retained. The two scripts are Node `.mjs` inside the frontend toolchain; no new language. Nothing in Python or Postgres changes.
6. **Dependency justification** — §5.
7. **No secrets** — no keys involved. The "licence keys not committed" NFR is met trivially; fonts/icons/logo live only in the gitignored `brand-assets/`; the repository inspection test enforces it.
8. **Lint/format** — `biome ci` and `tsc --noEmit` over all new TS/TSX and `.mjs` scripts; CSS is covered by Biome's CSS support if enabled (audit confirms; if not, the raw-value guard is the CSS check). `ruff` unaffected (no Python changes).
9. **Architecture** — module layout and dependency direction stated in §1.1.

## 7. Risks and items for the human at this gate

1. **Logo extraction is unproven** (§1.6). Plan degrades safely to the app name; the spike decides. Alternative offered by the design: the user drops `logo.svg` into `brand-assets/` manually.
2. **Monospace exception** to FR-3 for code/run output (§1.4).
3. **Contrast deviations from the kit** — text on success/notice/negative fills, possibly editor syntax and board pairs. The kit's own pairs fail 4.5:1 (white on #0DA20D ≈ 3.4:1, on #FFAA00 ≈ 2:1), and the spec's WCAG NFR outranks kit fidelity.
4. **Static (non-floating) input labels** versus the styleguide's floating label (§1.7), chosen to keep existing tests unchanged.
5. **Audi icons at one size** (24 px master scaled), and the file-naming contract for supplied icons (`<name>.svg`) — the user must export them from the icon Figma file accordingly; the plan does not decode vector geometry (research rule).
6. **Spec 003 removal** deletes tests that assert only the Apple look (§1.9); the audit lists them for approval before deletion.
7. `specs/README.md` has no index row for 015 yet (spec stage should have added it); not touched here.
8. Deploy integration (where `brand.sh` is called, which container mounts `brand-assets/`, how the empty-`brand.css` fallback is configured, hub path prefix, whether the proxy gates `brand/`) (including the writable mount for the logo cache) depends on current compose/hub files that this plan deliberately did not read; the audit task must resolve them before any brand task starts.
