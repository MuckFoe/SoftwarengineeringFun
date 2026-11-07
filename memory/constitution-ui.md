# Constitution — UI rules

Part of the constitution (`memory/constitution.md`, rule 10). Binds every `spec.md`, `plan.md`, `tasks.md` and implementation that adds or changes anything a user sees. A violation blocks the artifact at its human gate. Sources: specs 015, 016 (look) and 017 (home screen).

## A. Spec and plan gates

1. **Home screen integration is mandatory.** Every new feature that a user can start, join, resume or see activity in (a session kind, a game, a learning or presentation mode, anything with a "live" state) must say in its `spec.md` how it appears on the home screen (spec 017): a tile kind or an existing tile kind it reuses, what the tile shows (title, host, live state and count, avatars, optional preview), what activating it does, and what a user who may not open it sees (nothing: no tile, avatar, title or code). If a feature genuinely has no home presence, the spec says so and why. `plan.md` names the `/api/home` snapshot change and the "home changed" notification trigger; `tasks.md` carries a task for each, with acceptance criteria.
2. **Jump to anything and dock.** A new main area gets a dock entry (spec 016 FR-16, disabled with an accessible reason for principals that may not use it). A new list of things users open (sessions, problems, areas) is added to the "Jump to anything" bar (FR-15) using only data the app already lists.
3. **Guests and invitees.** The spec states what an anonymous guest and a chess invitee see of the feature. Server-side scoping, not hiding in the client.
4. **Existing functionality and keyboard behaviour are preserved** (016 FR-13). A UI change that removes an action moves it, it does not drop it.

## B. Style guide (spec 016 v2 look)

5. **Tokens only.** Colour, radius, spacing, shadow, glow, motion duration and z-index come from `frontend/src/styles/tokens.css` as `var(--…)`. No literals in other CSS or TSX (enforced by `guard.test.ts` / `tokens.test.ts`). A new value is added to `tokens.css` for light and dark, and mirrored in the Keycloak login theme copy (`scripts/check-theme-tokens.sh` must pass).
6. **Shapes and tone.** Pill-shaped controls and navigation, large rounded cards and tiles (`--radius-pill`, `--radius-card`), regions separated by tone (`--bg`, `--surface`, `--surface-2`), not outlines. Tiles and cards use the soft edge-light border (`--edge-light`); text stays legible over it.
7. **One accent.** A single blue `--accent` family. Red is `--danger` only, for errors and destructive actions. No other hue.
8. **Primitives first.** Build from `frontend/src/ui/*` (Button, Card, Dialog, Sheet, Menu, Tabs, Toast, EmptyState, LiveBadge, InviteLink, …). Add a new primitive there, with a test, only when none fits. Primary action: solid accent pill with glow. Secondary: outlined or tonal pill. Destructive: `danger`.
9. **State.** Every control shows distinct hover, focus-visible, active, disabled and error states, with a short `--motion-fast` transition.
10. **Live indicator.** Live things show the quiet pulsing dot and a "Live" tag (`LiveBadge`) and no other animation.
11. **Copy.** An invite link is always shown with a visible copy button that confirms the copy.
12. **Assets.** Brand type, icons and logo are supplied at deploy and never enter the repo. Use the neutral fallbacks in the repository; `scripts/check-no-apple-assets.sh` must pass. Icons go through `brand/Icon`.

## C. Always on every UI change

13. **Responsive.** Works from 1024 px up, and at narrow width (≈390 px): tiles reflow with `repeat(auto-fill, minmax(min(100%, 16rem), 1fr))`, no horizontal overflow, dock icons only with accessible names. Content is never covered by the dock (`--dock-height`, safe-area inset); full-height layouts use `100dvh` minus header and dock.
14. **Light and dark.** Both schemes work, following the system until the user chooses (016 FR-10). Contrast passes (`contrast.test.ts`).
15. **Reduced motion.** Under `prefers-reduced-motion: reduce` every animation and transition is off (token level: `--motion-*: 0s`). No pulsing, no sweep.
16. **Accessibility.** Everything is operable by keyboard in reading order with a visible focus ring; interactive elements have accessible names that carry their state (for example "title, hosted by host, Live, 2 people"); purely decorative or preview content is `aria-hidden` and not focusable; live changes are announced politely and only when the value changes. Menus and overlays: arrow keys, Enter, Escape, focus returned.
17. **Privacy in the UI.** No title, avatar, code or count of something the viewer may not open is rendered, sent or left in the DOM.
18. **Performance.** First paint never waits on secondary data (previews, avatars); it fills in as it arrives.

## D. Tests and checks for every UI task

19. **Component tests** cover each acceptance criterion: role and name queries (not class names), keyboard activation, empty and error states.
20. **Look checks.** A new or changed screen is added to the look matrix in `e2e/audi/matrix.ts` and runs through `e2e/audi/checks.ts` in light and dark at the listed widths (plus narrow where it shows the dock), including reduced motion.
21. **E2E** for any flow the user takes through the new UI, with keyboard-only and narrow-viewport paths where the task changes layout or interaction.
22. **Per-task gate.** Constitution rule 2 and 8 apply (`scripts/check.sh`: lint, `tsc`, tokens, no-Apple-assets, tests), plus a visual look at the real app (`/run`) for any visible change before the task is ticked.

## E. Spec checklist (copy into every UI-touching spec's review)

- [ ] Home screen presence defined (tile, live state, activation, privacy) or declared none
- [ ] Dock / Jump-to-anything entries defined
- [ ] Guest and invitee view defined
- [ ] Tokens only; new tokens in light, dark and Keycloak theme
- [ ] Primitives reused; new ones justified
- [ ] Narrow, dark, reduced-motion, keyboard and screen-reader behaviour stated
- [ ] Look matrix entry and E2E tasks present
