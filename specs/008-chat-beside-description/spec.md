# 008 — Chat always beside the description

Amends spec 003 FR-15 (chat "in a collapsible panel of the session window"). Source: feedback F2, 2026-10-29.

## Problem / Why

In the session window the problem description and the chat share one panel as tabs, so a participant sees either the problem or the conversation, never both. Collaborating means reading the problem while talking about it, and switching tabs to do that hides new messages and the task in turn. The chat should sit below the description, both visible at once, while a participant who doesn't want chat can still hide it.

## Users

- **Session participants**: anyone in a session, with or without an account, reading the description and chatting while they code.

## Functional requirements

- **FR-1** WHEN a participant opens a session that has a description and chat THE SYSTEM SHALL show the description and the chat at the same time in the same side area of the session window, the description above the chat, with no tab switch between them.
- **FR-2** WHEN the participant hides the chat THE SYSTEM SHALL remove the chat from view and give its space to the description.
- **FR-3** WHEN the participant shows a hidden chat again THE SYSTEM SHALL restore it below the description, scrolled to its latest message.
- **FR-4** WHEN the participant reopens any session later in the same browser THE SYSTEM SHALL keep the chat hidden or shown as they last left it, in the same way the appearance setting is remembered under spec 003.
- **FR-5** WHEN the participant drags the divider between description and chat THE SYSTEM SHALL resize the two, keeping each at a usable minimum height.
- **FR-6** WHEN the participant hides the whole side area with the existing control THE SYSTEM SHALL hide the description and chat together; showing it again SHALL restore both as they were.
- **FR-7** WHEN the control to hide or show the chat is shown THE SYSTEM SHALL label it distinctly from every other panel control, in its icon and its accessible name.
- **FR-8** WHEN either part is longer than its space THE SYSTEM SHALL scroll that part on its own, the chat input staying pinned to the bottom of the chat.
- **FR-9** WHEN a session has a description but its chat is unavailable (e.g. stale and read-only) THE SYSTEM SHALL still show the chat history below the description, read-only, as spec 002 requires.

## Non-functional requirements

- **NFR-1 Platform.** Applies at the desktop widths spec 003 supports (≥1024 px); at 1024 px the description, chat and editor are all usable without horizontal scrolling.
- **NFR-2 Accessibility.** WCAG AA as in spec 003: the hide/show control and the divider are operable by keyboard, and the description and chat are separate, named regions for assistive technology.
- **NFR-3 Look.** Follows the HIG styling already established by spec 003.

## Out of scope

- Moving the chat anywhere else (own column, floating window, bottom of the editor).
- Unread-message indicators or notifications while the chat is hidden.
- Remembering the divider position between visits.
- Any change to chat or description content rules (specs 002 and 007).
- The other F3–F5 fixes (input pinning, panel icons, Tab in the editor), except where FR-7 and FR-8 restate them for the new layout.

## Acceptance criteria

**FR-1** — Given a session with a description and chat, When a participant opens it, Then the description and the chat are both visible, the description above the chat, and there is no Description/Chat tab control.

**FR-2** — Given the chat is visible, When the participant activates "Hide chat", Then the chat is not visible and the description fills the side area.

**FR-3** — Given the chat is hidden and new messages arrived meanwhile, When the participant activates "Show chat", Then the chat reappears below the description scrolled to the newest message.

**FR-4** — Given a participant hid the chat, When they open the same or another session later in the same browser, Then the chat starts hidden; Given they showed it again, Then it starts visible.

**FR-5** — Given both are visible, When the participant drags the divider up, Then the chat grows and the description shrinks, And neither can be made smaller than its minimum.

**FR-6** — Given the chat is visible, When the participant hides the side area and shows it again, Then the description and chat are both back; Given the chat was hidden, Then only the description comes back.

**FR-7** — Given the session window toolbar, When it is inspected, Then the chat control's icon differs from every other panel control's icon, And its accessible name is "Hide chat" or "Show chat".

**FR-8** — Given a long description and many chat messages, When the participant scrolls the description, Then the chat does not move; When they send a message, Then the input stays at the bottom of the chat.

**FR-9** — Given a stale session with chat history, When it is opened, Then the history is shown below the description, And no message can be sent.

**NFR-1** — Given a 1024 px wide window, When a session is open with the side area and chat visible, Then nothing scrolls horizontally and the editor is usable.

**NFR-2** — Given only a keyboard, When a participant moves through the session window, Then they can reach and activate the chat control and move the divider, And a screen reader announces separate description and chat regions.

## Open questions

None.
