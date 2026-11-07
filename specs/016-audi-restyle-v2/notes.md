# Notes — 016 Audi restyle v2

## 2026-11-07 — Dock rework after review of the deployed home screen

Changes the user asked for while looking at the live app. The spec (FR-16) and plan §6 were updated to match; this log records why and what was learned.

**Asked for, in order**
1. The coding problems were missing from the dock: added a **Problems** item (`/problems`, pencil icon as the icon set has no code icon). Sessions stays the home screen. The dock now has its own `currentKey`, since `currentArea` maps both `/` and `/problems` to `/`.
2. The dock became an overlay and the footer is no longer black: the bottom padding `Window` reserved for it (the black band) was removed, so content uses the whole screen. `Window.dock.test.ts` now asserts the absence of that padding (it asserted its presence before).
3. A "slim icons only, grows on hover" middle state was tried and then removed. The final design has two states only: a thin sliver when idle, full size (icons and labels together) when up.
4. Idle shows only the pill's nub: children are `opacity: 0` while idle, because the highlighted (blue) current button peeked out of the sliver.
5. Timing: coming up is instant; hiding waits 250ms.

**Bugs met on the way (and fixed)**
- Icons off-centre in the small buttons: a flex `gap` reserved space for the hidden label. The gap now belongs to the label and narrow screens use square padding.
- Dock stayed wide after a click: `:focus-within` kept it open as the clicked link kept focus. Only `:focus-visible` counts now.
- Buttons stopped working: the invisible hover strip (`::before`, absolute, covering the dock) painted above the buttons and took their clicks. Fixed with `z-index: -1`. Lesson: a positioned pseudo-element over a dock needs to sit below its children; unit tests cannot see this, only a click in a browser can.

**Drift from the spec as first written**
- FR-16 said the dock never covers content that cannot be scrolled out from under it. It is now an overlay by decision; the slim sliver can cover the last rows of a scrolled page. Not mitigated; add end-of-scroll clearance if it bothers anyone.
- FR-16 said four areas; it is five.

**Verification**
- Unit tests for `src/ui`, `src/home`, `src/styles` pass; `tsc --noEmit` clean. Deployed to VM 105 with the smoke check passing (certificate and services only; it does not click the dock).
- **Not run:** the Playwright e2e suite. Specs that expect four dock items, the reserved bottom strip or the old hover behaviour may need updating. Hover timing and the sliver's hit area were checked by eye by the user only.
