# 022 — Sketch board in coding sessions

Status: approved

## Problem / Why

A group solving a problem together in a coding session can only talk in chat and in code. Many solutions are found by drawing first: boxes for array cells, circles for graph nodes, a few arrows and scribbles to show how pointers move. Today the group has nowhere shared to do that, so they either type awkward ASCII art into chat or move to another tool and lose the session's context. Each coding session needs one simple shared drawing surface, live for everyone in it and kept with the session, so the group can sketch an idea next to the code they are writing.

## Users

- **Participants of a coding session (spec 001)** — anonymous guests who joined by invite link and signed-in users (spec 012) alike. All of them may view and draw; no account or role is needed beyond being in the session.
- Not editors or admins in any special capacity: the sketch belongs to the session, not to the problem.

## Functional requirements

Defaults chosen on the human's direction ("keep it simple") are marked *(default)*; correct them at the gate if wrong.

**The board**

- **FR-1** WHEN a coding session exists THE SYSTEM SHALL give it exactly one sketch board, empty at the start, shared by every participant of that session.
- **FR-2** WHEN a participant is in a coding session THE SYSTEM SHALL let them open and close the sketch board without leaving the session, and SHALL let them see the board and the solution code at the same time on a window ≥1024 px wide. Whether the board is open is each participant's own choice, remembered per browser (as chat visibility in 008), and opening it does not open it for others *(default)*.
- **FR-3** WHEN two participants view the board on different window sizes THE SYSTEM SHALL show the same drawing in the same relative positions for both (the board has one fixed shape, scaled to fit) *(default)*.

**Tools**

- **FR-4** WHEN a participant chooses the pen and drags with mouse, touch or pen THE SYSTEM SHALL draw a freehand line along the path in the current colour.
- **FR-5** WHEN a participant chooses the box tool or the circle tool and drags on the board THE SYSTEM SHALL draw an outlined rectangle or ellipse spanning the dragged area in the current colour; WHEN they click without dragging THE SYSTEM SHALL place one of a standard size centred on the click *(default)*.
- **FR-6** WHEN a participant chooses the eraser and drags across the board THE SYSTEM SHALL rub out only the parts of lines and shapes the eraser passes over, leaving the rest of them in place.
- **FR-7** WHEN a participant picks a colour THE SYSTEM SHALL use it for everything they draw next, from a small fixed palette of about 8 colours. Each palette colour SHALL stay clearly visible on the board in both light and dark appearance, and SHALL be the same named colour for every participant whatever their appearance.
- **FR-8** WHEN a participant opens the board THE SYSTEM SHALL show which tool and colour are selected; both are the participant's own and do not change anyone else's.

**Sharing and keeping**

- **FR-9** WHEN a participant finishes a line, shape or erase stroke THE SYSTEM SHALL show it to every other participant who has the board open, without them reloading.
- **FR-10** WHEN several participants draw at the same time THE SYSTEM SHALL accept all their drawing, with no locking or turn-taking, and every participant SHALL end up seeing the same board.
- **FR-11** WHEN a participant reloads, rejoins, or opens the board later THE SYSTEM SHALL show the board exactly as it was last left, stored durably with the session like its code and chat.
- **FR-12** WHEN a participant presses *Clear* and confirms THE SYSTEM SHALL empty the board for everyone. Cancelling the confirmation changes nothing.

**Undo**

- **FR-13** WHEN a participant presses *Undo* (button or Ctrl/Cmd+Z while the board has focus) THE SYSTEM SHALL reverse that participant's own most recent drawing action still on record — a line, a shape, an erase stroke, or a clear — for everyone. Repeating it steps back through their earlier actions. It never reverses another participant's action.
- **FR-14** WHEN a participant undoes a line or shape that someone else has since partly rubbed out THE SYSTEM SHALL remove what is left of it; WHEN they undo an erase stroke or a clear THE SYSTEM SHALL bring back what it removed, as far as that content has not since been removed by another means.
- **FR-15** WHEN a participant has no action left to undo THE SYSTEM SHALL show *Undo* as disabled with an accessible reason. A participant's undo history lasts for as long as their current visit to the session; it starts empty after a reload or rejoin *(default)*.

**Session lifecycle**

- **FR-16** WHEN a session is stale (spec 001) THE SYSTEM SHALL still show its board, read-only: no tools, no *Clear*, no *Undo*.
- **FR-17** WHEN a session is deleted (spec 019) THE SYSTEM SHALL delete its board with it.
- **FR-18** WHEN a board reaches its size limit (NFR-3) THE SYSTEM SHALL refuse further drawing with a visible message that suggests clearing or erasing, and SHALL keep what is already there.

**Home screen, navigation, guests (UI constitution A)**

- **FR-19** WHEN the home screen (spec 017) lists a coding session THE SYSTEM SHALL show its tile unchanged: the sketch adds no tile kind, no preview and no field. Opening the tile opens the session as today.
- **FR-20** The sketch adds no dock entry and no "Jump to anything" entry: it is part of a session, not a list or area of its own.
- **FR-21** WHEN someone is not a participant of a session THE SYSTEM SHALL not send them any of its board, its existence or its contents, enforced by the server.

## Non-functional requirements

- **NFR-1 Latency.** A finished line, shape or erase stroke appears for other participants on the same hub within 500 ms under normal load.
- **NFR-2 Scale.** Up to the session maximum of 5 participants drawing at once without visible lag for any of them.
- **NFR-3 Size.** A board holds at least 2,000 drawing actions; past its limit FR-18 applies. One board's stored drawing stays within 1 MB.
- **NFR-4 Durability.** The board survives app restarts and redeploys exactly as code and chat do.
- **NFR-5 Safety.** Drawing content is shapes and lines only; nothing a participant sends is ever rendered as markup or run.
- **NFR-6 UI rules.** Complies with `memory/constitution-ui.md`: tokens only, primitives first, light and dark, reduced motion (no animation on the board), narrow width (≈390 px: the board is reachable and usable, it need not sit beside the code).
- **NFR-7 Accessibility.** Tool, colour, *Undo* and *Clear* controls are reachable and operable by keyboard with visible focus and accessible names carrying their state ("Pen, selected", "Red, selected"). Drawing itself needs a pointer (mouse, touch or pen); the board has an accessible name and politely announces when another participant changes it, at most once every few seconds.

## Out of scope

- Text labels, arrows, lines with handles, or any shape other than box and circle.
- Filled shapes, line thickness choice, opacity, custom colours.
- Selecting, moving, resizing or re-colouring something already drawn.
- Redo. Undoing other participants' actions.
- More than one board or page per session; zoom and pan; an infinite canvas.
- Exporting, downloading or copying the board as an image; inserting images.
- A sketch in learning sessions (006), presentations (013 has its own drawing) or games.
- Showing who drew what, or live cursors of other participants.
- Admin moderation of sketch content.
- A preview of the sketch on the home screen or the profile.

## Acceptance criteria

**AC-1 (FR-1)** Given a newly started coding session, When any participant opens the board, Then it is empty, and every participant of that session opening it sees the same board.

**AC-2 (FR-2)** Given a participant in a session on a 1280 px wide window, When they open the board, Then the board and the code editor are both visible without leaving the session; When they reload, Then the board is still open for them; And another participant's board stays closed.

**AC-3 (FR-3)** Given participant A on a 1920 px window and B on a 1024 px window, When A draws a box in the top-left quarter of the board, Then B sees it in the top-left quarter of the board.

**AC-4 (FR-4)** Given the pen and colour blue selected, When a participant drags from one point to another along a curve, Then a blue freehand line following that path appears.

**AC-5 (FR-5)** Given the box tool, When a participant drags from point P to point Q, Then an outlined rectangle with opposite corners at P and Q appears in the current colour. Given the circle tool, When they drag likewise, Then an outlined ellipse inside that rectangle appears. Given either tool, When they click without dragging, Then a shape of the standard size centred on the click appears.

**AC-6 (FR-6)** Given a long horizontal line on the board, When a participant drags the eraser vertically across its middle, Then the middle part is gone and both ends of the line remain.

**AC-7 (FR-7)** Given the palette, When a participant looks at it, Then it offers about 8 colours; Given participant A in light appearance and B in dark, When A draws in a palette colour, Then B sees it as the same named colour, clearly visible against the board (contrast checked in both appearances).

**AC-8 (FR-8)** Given A has the eraser and red selected, When B selects the pen and green, Then A still has the eraser and red, and each sees their own selection marked.

**AC-9 (FR-9)** Given A and B both have the board open, When A finishes a circle, Then B sees it within 500 ms without reloading.

**AC-10 (FR-10)** Given A, B and C draw lines at the same moment, When all three finish, Then each of them sees all three lines, and their boards are identical.

**AC-11 (FR-11, NFR-4)** Given a board with lines, shapes and erased parts, When a participant reloads, and separately When the app is restarted and they rejoin, Then the board looks exactly as before.

**AC-12 (FR-12)** Given a board with content, When a participant presses *Clear* and cancels, Then nothing changes; When they press *Clear* and confirm, Then the board is empty for every participant.

**AC-13 (FR-13)** Given A drew a line then a box, and B then drew a circle, When A presses *Undo*, Then A's box disappears for everyone and B's circle stays; When A presses *Undo* again, Then A's line disappears; When A presses Ctrl/Cmd+Z with the board focused, Then the same happens as pressing *Undo*.

**AC-14 (FR-14)** Given A drew a line and B rubbed out half of it, When A undoes the line, Then the remaining half disappears. Given A rubbed out part of B's box, When A undoes the erase, Then B's box is whole again. Given A cleared the board, When A undoes, Then the cleared content returns for everyone.

**AC-15 (FR-15)** Given a participant who has drawn nothing this visit, When they look at *Undo*, Then it is disabled with an accessible reason; Given they drew a line and reloaded, When they look at *Undo*, Then it is disabled and the line remains.

**AC-16 (FR-16)** Given a stale session with a drawn board, When a participant opens it, Then the drawing is shown and no tool, *Clear* or *Undo* is available, and any drawing attempt is refused by the server.

**AC-17 (FR-17)** Given a session with a drawn board, When the session is deleted, Then its board no longer exists anywhere in storage.

**AC-18 (FR-18, NFR-3)** Given a board at its limit, When a participant tries to draw, Then the drawing is refused with a message suggesting clearing or erasing, and the existing content is unchanged; Given a board with 2,000 drawing actions, Then it is not yet at its limit.

**AC-19 (FR-19, FR-20)** Given a coding session with a drawn board, When the home screen shows its tile, Then the tile is identical to one without a board; And the dock and "Jump to anything" have no sketch entry.

**AC-20 (FR-21)** Given someone who is not a participant of session S, When they try to read or draw on S's board, Then the server refuses and returns nothing of the board.

**AC-21 (NFR-2)** Given 5 participants drawing continuously for 30 seconds, When it ends, Then all 5 boards are identical and each participant's own strokes appeared without visible delay for them.

**AC-22 (NFR-5)** Given a participant sends a drawing action containing markup or script text in any field, When others receive it, Then nothing is rendered as markup or run, and malformed actions are refused.

**AC-23 (NFR-6, NFR-7)** Given the board open, When a keyboard-only user tabs through it, Then every tool, colour, *Undo* and *Clear* is reachable in order with a visible focus ring and a name carrying its state; Given dark appearance, reduced motion and a 390 px window, Then the board passes the look checks and is usable without horizontal overflow.

## Open questions

None. Resolved:

- *UI rule 7 (one accent hue) and the ~8-colour palette* — the palette colours are user content (what participants draw), not UI chrome, so rule 7 does not apply to them. All chrome — buttons, the selected-tool and selected-colour highlight, focus rings — stays accent-only. The constitution is not amended.

## UI checklist (constitution-ui.md, section E)

- [x] Home screen presence defined (tile, live state, activation, privacy) or declared none — FR-19: reuses the coding session tile unchanged
- [x] Dock / Jump-to-anything entries defined — FR-20: none, with reason
- [x] Guest and invitee view defined — Users, FR-21: every participant, guest or signed-in, has full use; non-participants get nothing
- [ ] Tokens only; new tokens in light, dark and Keycloak theme — palette colours become tokens (light and dark); they are user content, exempt from rule 7
- [ ] Primitives reused; new ones justified — for plan.md (a drawing surface likely needs a new primitive)
- [x] Narrow, dark, reduced-motion, keyboard and screen-reader behaviour stated — NFR-6, NFR-7
- [ ] Look matrix entry and E2E tasks present — for tasks.md
