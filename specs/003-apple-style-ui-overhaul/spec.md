# 003 — Apple-style UI overhaul

## Problem / Why

The product works, but its interface was built to prove the features of spec 001, not to be pleasant to use. We want the whole interface redesigned to feel as close as possible to a first-party Apple app on the Mac. That means quiet, content-first layouts, the device's native typeface, translucent sidebars and toolbars, rounded controls, sheets and popovers rather than full-page detours, restrained colour with one accent, smooth but subtle motion, and automatic light and dark appearance. The redesign may also change flows where Apple conventions point to a better one, as long as every capability users have today stays available. Apple's Human Interface Guidelines (HIG) for macOS are the reference whenever a design choice is in doubt.

## Users

- **Session participants:** anyone who joins a coding session through an invite link, without an account. They edit code together, see who's present, switch problems, run code against the hidden tests and, once spec 002 lands, read the problem description and chat.
- **Editors:** SSO users with the editor role. They browse, create and edit problems.
- **Admins:** SSO users who reactivate stale sessions.
- **Visitors:** anyone who lands on the app without a session or sign-in, or on a page that doesn't exist.

## Functional requirements

### Visual language

- **FR-1:** WHEN any screen is shown THE SYSTEM SHALL render it in one consistent visual language modelled on the macOS HIG. That covers the device's native system typeface, the HIG type scale, a single accent colour, rounded controls, translucent sidebars and toolbars, and content-first layouts with generous spacing.
- **FR-2:** WHEN a secondary task is started from a screen (for example creating or editing a problem, confirming a destructive action, or seeing run details) THE SYSTEM SHALL present it as a sheet, popover or inspector over the current context, not as a separate full page, unless the task needs a full page to be usable.
- **FR-3:** WHEN an action completes, fails or is in progress THE SYSTEM SHALL give feedback in the Apple manner: inline progress indicators, non-blocking confirmations, and alerts only for decisions the user must make.
- **FR-4:** WHEN an element changes state (a sheet opens, a list updates, a run starts or finishes, a participant joins or leaves) THE SYSTEM SHALL animate the change briefly and subtly.

### Appearance

- **FR-5:** WHEN the user has not chosen an appearance THE SYSTEM SHALL follow the operating system's light or dark setting and switch live if that setting changes while the app is open.
- **FR-6:** WHEN the user picks Light, Dark or System in an in-app appearance control THE SYSTEM SHALL apply it immediately and keep it on later visits from the same browser. This works for participants without an account too.
- **FR-7:** WHEN the dark appearance is active THE SYSTEM SHALL render every surface in dark, including the code editor, run results, presence and dialogs, with no light-only leftovers.

### Screens and flows

- **FR-8:** WHEN the redesign is complete THE SYSTEM SHALL still offer every capability spec 001 provides, with spec 001's rules unchanged. That includes joining by invite link, the participant limit, name length limits, role-gated problem management, running code against hidden tests, stale-session handling and admin reactivation.
- **FR-9:** WHEN a flow is redesigned THE SYSTEM SHALL implement it as listed in this flow inventory, and no flow shall change beyond it:
  - **Switching problems:** done from the problem list in the session sidebar. No separate switcher remains.
  - **Joining by invite link:** unchanged from spec 001 apart from styling.
  - **Signing in:** started from a "Sign in" button in the toolbar on screens a visitor can reach. It leads to the identity provider's sign-in page (styled per FR-18) and returns the user to the screen they started from.
  - **Admin reactivation:** admins see a "Stale sessions" section in the sidebar listing stale sessions, each with a reactivate action inline. The reactivate action beside the stale notice inside a session (FR-12) stays as well.
  - Every other flow keeps its current steps and only changes appearance.
- **FR-10:** WHEN a session is open THE SYSTEM SHALL arrange it as one window. A sidebar holds the problems and participants, the code editor is the main content, and a toolbar holds the primary actions (run, invite, appearance). Run results show in a panel or inspector that can be shown or hidden.
- **FR-11:** WHEN an editor browses problems THE SYSTEM SHALL show them in a source-list or table layout with search, and open create and edit in a sheet.
- **FR-12:** WHEN a session is stale THE SYSTEM SHALL show that state clearly and calmly (for example a banner, with editing controls visibly disabled), and admins shall see the reactivate action in the same place.
- **FR-13:** WHEN a page doesn't exist or the user isn't allowed to see it THE SYSTEM SHALL show an empty-state screen in the same visual language, with a clear way back.

### Spec 002 surfaces

- **FR-14:** WHEN spec 002's problem descriptions are available THE SYSTEM SHALL show a session's problem description in the new visual language, readable alongside the editor without covering it, with inline images sized to fit.
- **FR-15:** WHEN spec 002's session chat is available THE SYSTEM SHALL present it in the new visual language, in a collapsible panel of the session window, with messages grouped by sender, the read-only stale state shown, and the 2000-character limit visible while typing.
- **FR-16:** WHEN an editor writes a problem description (spec 002) THE SYSTEM SHALL offer the formatting and image controls in the same sheet-based problem editor as FR-11.

### Keyboard

- **FR-17:** WHEN the user presses a shortcut THE SYSTEM SHALL perform the matching action using the platform modifier (⌘ on macOS, Ctrl elsewhere). Shortcuts exist for: run code, close sheet or popover (Esc), confirm the default button (Return), focus search, new problem, save in the problem editor, show or hide the sidebar, show or hide the run panel, show or hide the chat, next problem, previous problem, copy the invite link, open the appearance setting, and show the shortcut list. Key choices follow common macOS conventions where they exist.
- **FR-18:** WHEN an editor or admin reaches the identity provider's sign-in page THE SYSTEM SHALL show it in the same visual language and appearance (light, dark or system) as the app.
- **FR-19:** WHEN the user asks for the shortcut list THE SYSTEM SHALL show every shortcut with its keys for the current platform in a sheet or popover.
- **FR-20:** WHEN a shortcut is assigned THE SYSTEM SHALL NOT use a key combination the supported browsers reserve for themselves (for example new window or tab, close tab, address bar, switching tabs, developer tools), so that every shortcut works in every supported browser.
- **FR-21:** WHEN the user works without a mouse THE SYSTEM SHALL let them reach every action on every screen by keyboard alone.

## Non-functional requirements

- **NFR-1 (Not Apple's property):** the interface must not use Apple's logos, trademarks, product names as branding, or Apple-licensed assets that may not be redistributed on the web, such as proprietary fonts or icon sets. It may look like an Apple app but must never present itself as one or as an Apple product.
- **NFR-2 (Screen sizes):** every screen must be fully usable without horizontal scrolling at desktop widths from 1024 px up. Narrower widths, tablets and phones are not supported.
- **NFR-3 (Browsers):** the current versions of Safari, Chrome, Firefox and Edge on desktop. Where translucency is not supported, the design falls back to an opaque equivalent that is still legible.
- **NFR-4 (Accessibility):** text and controls meet WCAG 2.2 AA contrast in both light and dark appearance. Every action can be done with the keyboard and has a visible focus ring. With the OS "reduce motion" setting on, animations are removed or reduced to fades. With "reduce transparency" on, surfaces become opaque.
- **NFR-5 (Responsiveness):** interactions respond visibly within 100 ms. Animations last no longer than 300 ms and never delay input. Live collaboration (typing, presence, runs) is no slower than before the redesign.
- **NFR-6 (No regression):** every existing acceptance criterion of spec 001 still passes after the redesign.

## Out of scope

- Phone and tablet layouts.
- Any change to spec 001's or 002's rules: limits, roles, permissions, data retained, sandboxing or what the hidden tests check. Only how those things are presented and navigated changes.
- Native apps, installable web apps or offline mode.
- New product features that neither spec 001 nor spec 002 already defines, apart from the appearance control (FR-6), the admin "Stale sessions" list (FR-9) and keyboard shortcuts (FR-17, FR-19).
- Localisation or right-to-left layouts.

## Acceptance criteria

**AC-1 (FR-1)**
Given any screen of the app in either appearance
When a human reviewer checks it against the HIG checklist approved with this spec's plan (typeface, type scale, spacing, accent use, control shapes, materials)
Then every checklist item passes for that screen.

**AC-2 (FR-2)**
Given an editor on the problem list
When they choose to create or edit a problem
Then the editor opens as a sheet over the list, the URL of the underlying list is unchanged, and closing the sheet returns them to the same list position.

**AC-3 (FR-3)**
Given a participant in a session
When they run code
Then a progress indicator appears inline at once, no blocking dialog is shown, and the result replaces the indicator when the run finishes.

**AC-4 (FR-3)**
Given an action that fails, such as a save rejected by the server
When the failure occurs
Then an inline message explains it next to the affected control, and the user's input is kept.

**AC-5 (FR-4, NFR-4)**
Given the OS "reduce motion" setting is on
When a sheet opens or a participant joins
Then the change appears without movement animation (at most a fade).

**AC-6 (FR-5)**
Given a browser with no stored appearance choice and the OS set to dark
When the user opens any screen
Then it renders in dark appearance, and when the OS switches to light while the page is open the page switches to light without reloading.

**AC-7 (FR-6)**
Given a participant without an account who chooses Light while the OS is in dark
When they close the browser and later open a session link in the same browser
Then the app renders in light, and choosing System makes it follow the OS again.

**AC-8 (FR-7)**
Given the dark appearance
When the session screen shows the code editor, run results, presence list and a confirmation dialog
Then none of them renders a light background.

**AC-9 (FR-8, NFR-6)**
Given the redesigned app
When the full acceptance suite of spec 001 runs
Then every criterion passes.

**AC-10 (FR-9)**
Given a participant in a session with several problems
When they pick another problem from the sidebar
Then the session switches to it, and no other problem switcher is present.

**AC-10a (FR-9)**
Given a visitor on a screen with the "Sign in" toolbar button
When they sign in successfully
Then they return to the screen they started from, signed in.

**AC-10b (FR-9)**
Given an admin and at least one stale session
When they open the "Stale sessions" sidebar section and choose reactivate on a session
Then that session is no longer stale and leaves the list.

**AC-10c (FR-9, FR-8)**
Given an invite link
When a new participant opens it
Then joining takes the same steps and enforces the same rules as in spec 001.

**AC-11 (FR-10)**
Given a participant in a session
When the session opens
Then problems and participants are in a sidebar, the editor fills the main area, run, invite and appearance are in the toolbar, and the run-results panel can be hidden and shown again.

**AC-12 (FR-11)**
Given an editor on the problem list with more than 10 problems
When they type part of a problem's title into search
Then the list narrows to the matching problems as they type.

**AC-13 (FR-12)**
Given a stale session
When a participant opens it
Then a stale notice is visible without scrolling, and the editing and run controls are visibly disabled. When an admin opens it, the reactivate action appears beside that notice.

**AC-14 (FR-13)**
Given any unknown URL in the app
When it is opened
Then an empty-state screen in the new visual language is shown with a link back to the start.

**AC-15 (FR-14)**
Given spec 002 is implemented and a problem has a description with an image wider than the description area
When a participant opens that problem in a session
Then the description and editor are visible at the same time at 1280 px width, and the image is scaled to fit with no horizontal scrolling.

**AC-16 (FR-15)**
Given spec 002 is implemented and a session has chat messages from two participants
When a participant opens the chat panel and types a message
Then consecutive messages from one sender are grouped, the remaining character count is shown, and in a stale session the input is disabled with a visible reason.

**AC-17 (FR-16)**
Given spec 002 is implemented and an editor is creating a problem
When they format text and add an image in the description
Then they do it inside the problem editor sheet without leaving it.

**AC-18 (FR-17)**
Given a participant on macOS in a session
When they press ⌘+Return
Then the code runs. The same works with Ctrl+Return on Windows or Linux, and Esc closes any open sheet or popover.

**AC-18a (FR-17, FR-19)**
Given a user on any screen
When they press each shortcut shown in the shortcut list
Then the listed action happens, and the list names every action in FR-17.

**AC-18b (FR-20)**
Given each shortcut in the shortcut list
When it is checked against the reserved shortcuts of Safari, Chrome, Firefox and Edge on macOS and Windows
Then none of them collides.

**AC-18c (FR-21)**
Given each screen
When a user completes every action on it using only the keyboard
Then every action succeeds without a mouse.

**AC-18d (FR-18)**
Given an editor who is not signed in, with the OS in dark appearance
When they reach the sign-in page
Then it renders in dark in the app's visual language, and the same check in light renders it in light.

**AC-19 (NFR-1)**
Given the built app and the sign-in page
When their pages, assets and text are inspected
Then they contain no Apple logo, Apple trademark used as branding, or Apple-licensed font or icon files.

**AC-20 (NFR-2)**
Given a desktop browser window 1024 px wide
When each screen is opened in both appearances
Then nothing requires horizontal scrolling and no control is clipped.

**AC-21 (NFR-4)**
Given each screen, including the sign-in page, in light and dark appearance
When its text and control colours are measured
Then every pair meets WCAG 2.2 AA contrast, and every interactive element can be reached by Tab and shows a visible focus ring.

**AC-22 (NFR-4)**
Given the OS "reduce transparency" setting is on
When a screen with a sidebar or toolbar is shown
Then those surfaces are opaque.

**AC-23 (NFR-5)**
Given two participants editing the same session in the redesigned app
When one types
Then the other sees the change no later than in the pre-redesign app under the same conditions.

## Open questions

None. Resolved on 2026-10-23:

- **Q1 (flows that change):** keep flow changes minimal. Problem switching moves to the sidebar, the invite link stays, sign-in and admin reactivation get new entry points. Folded into FR-9, FR-10, AC-10 to AC-10c and AC-11.
- **Q2 (sign-in page):** restyle it to match. Folded into FR-18 and AC-18d, and AC-19 and AC-21 now cover it.
- **Q3 (shortcuts):** a broad set aimed at keyboard-first engineers, using normal macOS conventions and never clashing with browser shortcuts. Folded into FR-17, FR-19 to FR-21 and AC-18a to AC-18c.
