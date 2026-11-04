# 010 — Tab inserts at the cursor in the code editor

Source: feedback F10 (`specs/feedback.md`), a participant's chat message on 2026-10-30, after the F5 fix went live. Amends the editing behaviour of 001 and the keyboard behaviour of 003 (FR-17).

## Problem / Why

Participants write Python together in the session's code editor. Since the F5 fix, Tab with no selection indents the whole line, even when the cursor is after the text. So you can't add spaces in the middle or at the end of a line. When an autocomplete suggestion is open, Tab accepts it and then also indents the line, which corrupts the code. Both break the Tab behaviour participants know from every other code editor, and they were reported from real use on the hub.

## Users

- **Participants** editing a session's solution with the keyboard.
- **Keyboard-only participants**, who need a way to move focus out of the editor (accessibility).

## Functional requirements

- **FR-1** WHEN a participant presses Tab with no text selected and no autocomplete suggestion open THE SYSTEM SHALL insert 4 spaces at the cursor position and change nothing else on the line.
- **FR-2** WHEN a participant presses Tab while an autocomplete suggestion is open THE SYSTEM SHALL accept the suggestion and insert nothing else.
- **FR-3** WHEN a participant presses Tab with a selection spanning more than one line THE SYSTEM SHALL indent every line of the selection by 4 spaces.
- **FR-4** WHEN a participant presses Shift+Tab THE SYSTEM SHALL remove up to 4 leading spaces from the current line, or from every line of the selection.
- **FR-5** WHEN a participant presses Esc and then Tab THE SYSTEM SHALL move keyboard focus out of the editor to the next control, without changing the text.
- **FR-6** WHEN a participant presses Tab with a selection inside a single line THE SYSTEM SHALL indent that line by 4 spaces and keep the selection on the same text.
- **FR-7** WHEN a Tab or Shift+Tab edit is made THE SYSTEM SHALL show it to every other participant in the session as any other edit is shown (001).

## Non-functional requirements

- **NFR-1** Every Tab and Shift+Tab edit is undone by a single undo, as one step.
- **NFR-2** Tab never inserts a tab character. Indentation is always spaces, 4 per level, consistent with Python.

## Out of scope

- Other keys and editor behaviour (Enter auto-indent, bracket matching, autocomplete content).
- Configurable indent width or tab characters.
- The learning sessions' simulated terminal (006).

## Acceptance criteria

- **FR-1** — Given the line `x = 1` with the cursor at its end, When the participant presses Tab, Then the line is `x = 1` followed by 4 spaces, And the cursor is after them. Given the cursor between `x` and ` = 1`, When Tab is pressed, Then 4 spaces are inserted there and the start of the line is unchanged.
- **FR-2** — Given an autocomplete suggestion `print` is open after typing `pri`, When the participant presses Tab, Then the line reads `print` with no extra spaces, And its indentation is unchanged.
- **FR-3** — Given lines 2–4 are selected, When Tab is pressed, Then each of lines 2, 3 and 4 starts with 4 more spaces, And lines 1 and 5 are unchanged.
- **FR-4** — Given a line indented by 8 spaces, When Shift+Tab is pressed, Then it is indented by 4. Given a line indented by 2 spaces, When Shift+Tab is pressed, Then it has no indent. Given lines 2–3 selected and each indented by 4, When Shift+Tab is pressed, Then neither has an indent.
- **FR-5** — Given focus is in the editor, When the participant presses Esc then Tab, Then focus is on the next control after the editor, And the solution text is unchanged.
- **FR-6** — Given `= 1` is selected in the line `x = 1`, When Tab is pressed, Then the line is `    x = 1`, And `= 1` is still selected.
- **FR-7** — Given two participants in one session, When one presses Tab at the end of line 1, Then the other sees the 4 spaces on line 1.
- **NFR-1** — Given the participant pressed Tab with lines 2–4 selected, When they undo once, Then lines 2–4 have their previous indentation.

## Open questions

None. FR-6 was decided on 2026-10-30: a selection inside one line is indented, not replaced.
