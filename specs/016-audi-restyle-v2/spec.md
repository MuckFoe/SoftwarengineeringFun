# 016 — Audi restyle v2 (all screens)

## Problem / Why

Spec 015 (which this spec supersedes entirely) moved the app to the Audi design language and works, but it reads as a literal copy of the UI kit: square, outlined, flat. It is not fluent or stylish enough, and it shows no trace of the Nuvolari-inspired direction (calm monolithic surfaces, one memorable element per screen, live status that is quiet). The user reviewed three directions and chose "B / Aero Vent" as the starting point, then the "V2 light-trace" variant of it: rounded pill and card shapes, a restrained blue accent, a vent-slot texture behind the header, a thin moving light line under the header, edge-lit tiles, and a floating, icon-led appearance menu. The user also chose the jump bar, bottom dock and run summary strip from the other mockups. This spec carries that second look to every screen so the product feels like one polished whole. Behaviour does not change, apart from three additions the user asked for from other mockups: a jump bar, a bottom dock and a run summary strip with the reporting behind it.

## Users

Everyone who uses the app today: signed-in account holders, anonymous guests (including chess invitees), session hosts and participants.

## Functional requirements

- **FR-1** WHEN any screen is shown THE SYSTEM SHALL present it in the v2 look: pill-shaped controls and navigation, large rounded cards and tiles, tone-based separation of regions (not outlines), and a single blue accent colour.
- **FR-2** WHEN the app header is shown THE SYSTEM SHALL display a vent-slot texture fading out behind it, and beneath it a thin line of light that moves across while at least one session or game the user can see is live, and is static otherwise.
- **FR-3** WHEN the user prefers reduced motion THE SYSTEM SHALL show the light line static and SHALL NOT animate the vent texture or any pulsing indicator.
- **FR-4** WHEN a tile or card is shown THE SYSTEM SHALL give it a soft edge-light border that is strongest at one corner, and SHALL keep tile text and controls legible over it.
- **FR-5** WHEN a participant, game or session is live THE SYSTEM SHALL show a quiet pulsing dot with a "Live" tag, and no other animation for it.
- **FR-6** WHEN the user opens the appearance menu THE SYSTEM SHALL show a floating rounded panel listing Light, Dark and System, each with an icon, the current choice highlighted with a check, operable by mouse and keyboard (arrow keys, Enter, Escape), and the panel SHALL always be fully on screen and above other content.
- **FR-7** WHEN a primary action is shown (for example Start session, Run, Copy link) THE SYSTEM SHALL render it as a solid accent-coloured pill with a soft glow, and secondary actions as outlined or tonal pills.
- **FR-8** WHEN chat messages are shown THE SYSTEM SHALL render rounded bubbles with one pointed corner, the user's own messages in the accent colour.
- **FR-9** WHEN the code editor, run output, interactive learning, GIF search, presentation, hub self-registration and Games screens (including the chess board, clocks, move list and invite link) are shown THE SYSTEM SHALL apply the same v2 shapes, colours, spacing and motion as every other screen.
- **FR-10** WHEN the appearance is light or dark THE SYSTEM SHALL use the v2 light or dark palette respectively, following the system's light or dark preference when the user has not chosen, and the in-app choice (kept on later visits on that device) when they have; the system preference is followed without reload while no choice is made.
- **FR-11** WHEN a control changes state (hover, focus, press, disabled, error) THE SYSTEM SHALL show a visible, distinct state, with a smooth short transition that is skipped for reduced motion.
- **FR-12** THE SYSTEM SHALL keep Audi Type, the Audi icons and the Audi logo as supplied at deploy, and a neutral fallback icon set and typeface kept in the repository; the logo is obtained at runtime from the Audi styleguide and cached outside the repository, and without it the app name shows with no broken image or gap. Nothing proprietary enters the repository.
- **FR-13** THE SYSTEM SHALL preserve all existing functionality and keyboard behaviour.
- **FR-14** WHEN an invite link is shown in the Games invite flow THE SYSTEM SHALL always show next to it a button that copies the link to the clipboard and confirms the copy, visible without extra interaction and operable by mouse and keyboard (carried over from spec 015 FR-12).
- **FR-15** WHEN the header is shown THE SYSTEM SHALL show a "Jump to anything" bar, opened also with the ⌘K / Ctrl+K shortcut, that lists the sessions, problems and app areas matching what the user types (using only what the app already lists, no new search data) and opens the chosen one by mouse or keyboard.
- **FR-16** WHEN any screen is shown to a signed-in user, anonymous guest or chess invitee THE SYSTEM SHALL present the main areas (Sessions, Learn, Present, Games) as a floating pill dock at the bottom of the screen with the current area highlighted, instead of tabs in the header; areas a guest may not use SHALL be shown disabled with an accessible reason; on narrow screens the dock SHALL stay at the bottom and show icons only, each with an accessible name; the dock SHALL never cover content that cannot be scrolled out from under it.
- **FR-17** WHEN a code run has finished THE SYSTEM SHALL show beneath the editor a strip with the run's time, memory use and the number of examples passed out of the total, alongside the existing run output; for this THE SYSTEM SHALL measure and report the run's memory use and the examples passed out of the total, which it does not report today.

## Non-functional requirements

- **Accessibility:** text and interactive elements meet WCAG 2.1 AA contrast in light and dark, including the blue accent on its backgrounds and text on edge-lit or textured areas; focus is always visible; no information is conveyed by colour or motion alone.
- **Performance:** the light line and pulsing dots must not cause visible jank or noticeable CPU use on a typical laptop, and must not delay first paint.
- **Responsive:** no horizontal scrolling and no clipped or overlapping controls at every width supported today.
- **Consistency:** one source of visual values so a later tweak (accent, radius, spacing) is a contained change.
- **Existing tests:** behaviour-level tests keep passing without loosening their assertions.

## Out of scope

- New screens, and behaviour changes other than FR-14 to FR-17 (FR-17 adds run reporting).
- The new home screen layout (spec 017).
- Localisation or copy changes outside the home screen.
- Changing the Keycloak sign-in beyond the same look.

## Acceptance criteria

**FR-1**
- Given any screen, When shown, Then its controls are pill-shaped, its cards and tiles are rounded, regions are separated by tone rather than outlines, and the only accent colour is the blue.

**FR-2**
- Given a live session or game is visible to the user, When the header is shown, Then the vent texture fades out behind it and a light line moves across the line under it.
- Given nothing live is visible, Then the light line is static.

**FR-3**
- Given reduced motion is preferred, When any screen is shown, Then the light line is static and no vent, pulse or sweep animation runs.

**FR-4**
- Given a tile, When shown in light and dark, Then it has an edge-light border strongest at one corner and its text meets 4.5:1 contrast.

**FR-5**
- Given a live session, When listed, Then it shows a pulsing dot and a "Live" tag; given an idle session, Then it shows neither.

**FR-6**
- Given the appearance control, When activated, Then the panel lists Light, Dark and System with icons, highlights and checks the current choice, and is entirely within the viewport above all content.
- Given the panel is open, When the user presses ArrowDown, ArrowUp, Enter or Escape, Then focus moves, the choice is applied, or the panel closes, respectively.

**FR-7**
- Given a primary action, When shown, Then it is a solid accent pill with a glow; given a secondary action, Then it is outlined or tonal.

**FR-8**
- Given a chat with messages from the user and others, When shown, Then bubbles are rounded with one pointed corner and the user's own are accent-coloured.

**FR-9**
- Given each of the listed screens, When opened (including chess as a guest via invite link), Then it passes the FR-1 check.

**FR-10**
- Given the system prefers dark with no in-app choice, When any screen loads, Then the dark palette is used; given the user picks light in the menu, Then light is shown immediately and after reload.

**FR-11**
- Given a button, When hovered, focused, pressed, disabled or in error, Then each state is visually distinct and transitions smoothly (instantly under reduced motion).

**FR-12**
- Given the repository, When inspected, Then it contains no Audi font, icon or logo file; given none supplied, Then the fallbacks show with no broken image or missing glyph.

**FR-13**
- Given the existing unit and end-to-end tests, When run, Then they pass with unchanged assertions (except those that assert spec 015 shapes, listed in the plan).

**FR-14**
- Given an invite link in the Games flow, When the panel is open, Then a copy button is visible without extra interaction in light and dark; When activated by mouse or keyboard, Then the link is on the clipboard and a confirmation appears.

**FR-15**
- Given any screen, When the user presses ⌘K (Ctrl+K), Then the jump bar opens focused; When they type, Then matching sessions, problems and areas are listed; When they press Enter on one, Then it opens; When they press Escape, Then the bar closes and focus returns.

**FR-16**
- Given a signed-in user, When any main area is shown, Then a bottom pill dock lists Sessions, Learn, Present and Games with the current one highlighted; When another is activated, Then that area opens.
- Given a long page, When scrolled to the end, Then the last content is fully visible above the dock.
- Given a guest, When the dock is shown, Then areas they cannot use are disabled with an accessible reason.
- Given a narrow viewport, When the dock is shown, Then it stays at the bottom with icons only, each with an accessible name.

**FR-17**
- Given a finished run of a problem with examples, When shown, Then time, memory use and examples passed out of the total appear in a strip under the editor, and the figures match the run's actual result.
- Given a run that has not finished, or a problem without examples, Then the missing figures are omitted, not shown as zero.

## Open questions

Resolved with the user (2026-11-07): 016 supersedes 015 entirely; the accent is blue, with red only for errors and destructive actions; the jump bar, bottom dock and run summary strip are adopted; the light line moves only while something visible to the user is live and is static otherwise (FR-2); the jump bar searches sessions, problems and app areas with existing data; the dock shows for everyone, icons only when narrow; memory and examples passed are newly reported by runs.

None.
