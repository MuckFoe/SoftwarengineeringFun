# 015 — Audi UI redesign

## Problem / Why

The app currently looks and feels like a macOS app (spec 003). The product is to adopt the Audi design language instead, taken from the Audi Figma UI Kit (DS 3.0 Unified Web UI Kit) and the Audi icon library supplied with the project. Every screen should look as though it belongs to one Audi-designed product: same colours, type, spacing, components and icons, with no screen left in the old look. Behaviour does not change; only appearance and the interaction details that belong to the Audi components.

## Users

Everyone who uses the app today: signed-in account holders, anonymous guests joining via link (including chess invitees), session hosts and participants.

## Functional requirements

- **FR-1** WHEN any screen of the app is shown THE SYSTEM SHALL render it in the Audi visual language: Audi colour palette, Audi typography, Audi spacing and corner/shape conventions, Audi component styling.
- **FR-2** WHEN a screen shows an icon THE SYSTEM SHALL use the matching icon from the Audi icon library when the Audi icons have been supplied to the deployment, and otherwise a neutral fallback icon set kept in the repository, in the same sizes and line style. The Audi icon files SHALL NOT be stored in the repository.
- **FR-3** WHEN a screen shows text THE SYSTEM SHALL set it in Audi Type and Audi's type scale when the Audi font files have been supplied to the deployment, and otherwise in a fallback typeface kept in the repository, with the same type scale. The Audi font files themselves SHALL NOT be stored in the repository (the user states they are licensed to use them).
- **FR-4** WHEN a control (button, input, select, tab, toggle, dialog, menu, tooltip, list, chat bubble, badge, toast) is shown THE SYSTEM SHALL style it after the corresponding component in the Audi UI kit, including its hover, focus, active, disabled and error states.
- **FR-5** THE SYSTEM SHALL cover every screen: sign-in/landing, session list and "my sessions", session window (description, chat, code editor, run output), interactive learning sessions, GIF search, HTML presentations, hub self-registration, and the Games section including the chess board, pieces, clocks and invite flow.
- **FR-6** WHEN the user has not chosen an appearance THE SYSTEM SHALL follow the system's light or dark preference, using the Audi kit's light and dark palettes.
- **FR-6a** WHEN the user picks light or dark with the in-app toggle THE SYSTEM SHALL use that choice instead of the system preference and keep it on later visits on that device.
- **FR-11** WHEN the app header is shown THE SYSTEM SHALL display the Audi four-rings logo, in the variant that suits the current appearance, when it has been obtained at runtime from the Audi styleguide and cached locally (https://styleguide.audi.com/document/2865#/-/ui-introduction); otherwise it SHALL show the app name without a broken image or layout gap. The logo file SHALL NOT be stored in the repository.
- **FR-7** WHEN the viewport is narrow or wide THE SYSTEM SHALL lay out per the Audi kit's responsive behaviour, and no screen SHALL require horizontal scrolling at the widths it supports today.
- **FR-8** THE SYSTEM SHALL remove the macOS/Apple-specific look (spec 003) everywhere; spec 003 is superseded by this spec.
- **FR-9** WHEN the redesign is applied THE SYSTEM SHALL preserve all existing functionality and keyboard behaviour (e.g. Tab at cursor in the editor).
- **FR-10** THE SYSTEM SHALL keep third-party content that has its own look (GIFs, user presentations, code-editor syntax themes) readable against the Audi palette; the editor's syntax colours SHALL be harmonised with the Audi palette.
- **FR-12** WHEN an invite link is shown in the Games invite flow THE SYSTEM SHALL always show, next to it, a button that copies the link to the clipboard and confirms the copy, visible without any extra interaction and operable by mouse and keyboard.

## Non-functional requirements

- **Accessibility:** text and interactive elements meet WCAG 2.1 AA contrast in both light and dark appearance; focus is always visible; the redesign does not remove existing keyboard operability.
- **Performance:** custom fonts and icons must not noticeably delay first meaningful paint; text remains visible while fonts load.
- **Licensing:** Audi fonts and Audi icons are proprietary: they are supplied at deploy time and never committed; the repository holds fallbacks only. The four-rings logo is likewise never committed: it is fetched from the Audi styleguide (https://styleguide.audi.com/document/2865#/-/ui-introduction) at runtime and cached outside the repository. The Figma kit files are not redistributed. No licence keys are committed.
- **Consistency:** one source of visual values (colours, spacing, type) so a later kit update is a contained change.
- **Existing tests:** behaviour-level tests keep passing without loosening their assertions.

## Out of scope

- New features, new screens or changed behaviour.
- Re-creating the design in Figma or editing the kit.
- Audi marketing/brand content (car imagery, configurator-style pages).
- Theming switch between Apple and Audi looks (Apple look is removed).
- Localisation or copy changes.
- Native mobile apps.

## Acceptance criteria

**FR-1**
- Given any screen of the app, When it is loaded, Then its colours, type, spacing and component shapes match the Audi kit's values (verified against the Design reference below) and no macOS-style element (traffic-light window chrome, vibrancy/blur panels, SF-style type) remains.

**FR-2**
- Given Audi icons were supplied at deploy, When a screen with icons is shown, Then each icon that has an Audi equivalent is the Audi one.
- Given they were not supplied, When it is shown, Then the fallback icons appear with no missing or blank icon.

**FR-3**
- Given any text on any screen, When rendered, Then it uses the Audi typeface and the sizes/weights of the Audi type scale.
- Given the Audi font files were not supplied at deploy, When the page renders, Then the repository fallback typeface is used and no request for a missing font error surfaces to the user.
- Given the font file has not loaded yet, When the page renders, Then text is visible in a fallback face and then swaps.

**FR-4**
- Given a button, When it is hovered, focused, pressed, disabled, Then each state is visually distinct and matches the Audi button states.
- Given an input with invalid content, When it is validated, Then the Audi error state appears with its message.
- Given a dialog, menu, tab bar, toast or chat bubble, When shown, Then it follows the corresponding Audi component.

**FR-5**
- Given each screen listed in FR-5, When opened (including chess as guest via invite link), Then it renders in the Audi look and passes the FR-1 check.

**FR-6**
- Given the system prefers dark, When any screen loads, Then the dark palette is used; given it prefers light, Then the light palette is used.
- Given a palette change while the app is open and no in-app choice made, When the system preference flips, Then the app follows without reload.

**FR-6a**
- Given the system prefers dark, When the user picks light in the toggle, Then the light palette is shown immediately and still shown after reload.
- Given an in-app choice was made, When the user clears it (back to "system"), Then the app follows the system again.

**FR-11**
- Given the logo asset is supplied, When the header is shown in light and in dark, Then the logo is visible with sufficient contrast in both.
- Given a narrow viewport, When the header is shown, Then the logo is not clipped or distorted.
- Given the logo could not be obtained from the Audi styleguide, When the header is shown, Then the app name appears and no broken image or layout gap is visible.
- Given the repository, When inspected, Then it contains no copy of the logo file.

**FR-7**
- Given a viewport at each width supported today, When any screen is shown, Then there is no horizontal scrolling and no clipped or overlapping controls.

**FR-8**
- Given the finished redesign, When the codebase and UI are inspected, Then no Apple-style theme remains in use.

**FR-9**
- Given the existing end-to-end and unit tests, When run after the redesign, Then they pass unchanged in what they assert.
- Given the code editor, When Tab is pressed at the cursor, Then the existing behaviour still applies.

**FR-10**
- Given a chat GIF, an HTML presentation, and code with syntax highlighting, When shown, Then each remains legible in both appearances.

**Accessibility (NFR)**
- Given any text/background pair in light or dark, When measured, Then the contrast ratio is at least 4.5:1 (3:1 for large text and UI boundaries).
- Given keyboard navigation, When tabbing through any screen, Then the focused element is always visibly indicated.

**FR-12**
- Given the invite flow shows an invite link, when the dialog or panel is open, then a copy button is visible without any extra interaction, in light and dark.
- Given the copy button, when activated by mouse or keyboard, then the invite link is on the clipboard and a confirmation appears.
- Given the LeetCode problem tab, then its existing copy-link button behaves as before.

## Design reference

Verified against `docs/research/audi-figma-kit-tokens.md` (values decoded from the supplied Figma kit and icons) and `docs/research/audi-styleguide-notes.md` (styleguide.audi.com). `docs/research/audi-ui-nuvolari.md` is background only. Where these disagree, the Figma kit tokens win. Gaps the notes list (e.g. radius, some spacing) are decided in the plan.

## Open questions

None. Note for the plan: the styleguide is a single-page app that a plain HTTP fetch returns empty (per `docs/research/audi-styleguide-notes.md`), so the plan must show how the logo is actually obtained from it; if that proves impossible, the app-name fallback applies and the spec is revisited.
