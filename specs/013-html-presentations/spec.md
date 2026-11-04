# 013 — HTML presentations with follow-the-host and drawing

Status: approved (2026-11-03, by the user's go-ahead to plan and implement)

## Problem / Why

People using this app want to walk a group through a topic — an explanation, a walkthrough, a talk — and the material they have is HTML: a hand-made document, an exported deck, or a snippet of markup. Today the app has no way to show such material to a group in sync. Sharing a screen elsewhere loses the app's invite-link sessions, and passing a file around means everyone looks at a different place. This feature lets editors keep a library of HTML presentations, lets anyone start a presentation session from it, and has every participant follow the host through it, seeing where the host points and being able to draw on top of it together.

## Users

- **Editors** (SSO users with the editor role, as in 001): add, replace and remove presentations in the library.
- **Host**: whoever starts a presentation session from the library (anyone, no account needed), until they hand hosting over or it passes on automatically. Drives what everyone sees. Exactly one host per session at a time.
- **Participants**: anyone who joins by invite link, no account needed, as with coding and learning sessions. Follow the host; may draw.

## Functional requirements

### Library

- **FR-1** WHEN an editor adds a presentation THE SYSTEM SHALL accept either an uploaded HTML file or HTML markup pasted as text, together with a required title (≤ 100 characters) and a required topic (≤ 60 characters).
- **FR-2** WHEN an editor adds or replaces a presentation THE SYSTEM SHALL tell the editor, before saving, whether it was recognised as a set of slides (and how many) or as a single page.
- **FR-3** WHEN the HTML exceeds the size limit (NFR-4) or is not HTML at all THE SYSTEM SHALL refuse it with a message saying why and save nothing.
- **FR-4** WHEN an editor replaces a presentation's HTML THE SYSTEM SHALL use the new version for sessions started afterwards; sessions already started keep showing the version they started with.
- **FR-5** WHEN an editor removes a presentation THE SYSTEM SHALL remove it from the library; existing sessions of it show that the presentation is no longer available instead of its content.
- **FR-6** WHEN anyone opens the presentation library THE SYSTEM SHALL list every presentation with its title and topic, and let them filter by topic.
- **FR-7** WHEN a user who is not an editor tries to add, replace or remove a presentation THE SYSTEM SHALL refuse.

### Sessions

- **FR-8** WHEN anyone, signed in or not, starts a session from a library presentation THE SYSTEM SHALL create a presentation session with an invite link, make the starter its host, and show the first slide (or the top of the page).
- **FR-9** WHEN someone opens a presentation session's invite link THE SYSTEM SHALL let them join under a name, without an account, with the same participant limit and name rules as coding sessions (001).
- **FR-10** WHILE a presentation session is open THE SYSTEM SHALL show every participant the slide the host is on; for a single-page presentation, the part of the page the host is looking at.
- **FR-11** WHEN the host moves to the next or previous slide, or scrolls a single-page presentation, THE SYSTEM SHALL move every participant to the same place.
- **FR-12** WHEN a participant joins or reloads mid-presentation THE SYSTEM SHALL show them the host's current place immediately, not the beginning.
- **FR-13** WHILE the host's pointer is over the presentation THE SYSTEM SHALL show every other participant a simulated cursor, labelled with the host's name, at the same spot in the content, moving as the host's pointer moves; WHEN the host's pointer leaves the presentation THE SYSTEM SHALL hide it.
- **FR-14** WHILE a participant other than the host is in a session THE SYSTEM SHALL not let them change the shown slide or scroll position.
- **FR-15** WHEN a single-page presentation is shown on screens of different sizes THE SYSTEM SHALL keep the host's place and the simulated cursor on the same content for every participant, not the same screen coordinates.
- **FR-16** WHEN the host leaves or disconnects THE SYSTEM SHALL keep every participant on the last place the host showed and tell them the host is away; WHEN the host returns within 60 seconds THE SYSTEM SHALL keep them host and resume following.

### Hosting

- **FR-25** WHEN the host hands hosting to another connected participant THE SYSTEM SHALL make that participant host at once, make the former host a regular participant, and tell everyone who the host now is.
- **FR-26** WHEN the host has been disconnected for 60 seconds and at least one other participant is connected THE SYSTEM SHALL make the connected participant who has been connected longest the host and tell everyone.
- **FR-27** WHEN a participant connects to a session whose host has been disconnected for at least 60 seconds and no other participant is connected THE SYSTEM SHALL make them host.
- **FR-28** WHEN a former host returns after hosting has passed to someone else THE SYSTEM SHALL let them in as a regular participant following the current host.
- **FR-29** WHEN hosting passes to someone, by handover or automatically, THE SYSTEM SHALL keep everyone on the place last shown until the new host moves.

### Session lifetime

- **FR-30** THE SYSTEM SHALL store presentation sessions durably like coding and learning sessions: the invite link keeps working, and reopening it shows the current host and the last place shown.
- **FR-31** WHEN a presentation session has had no activity for 30 days THE SYSTEM SHALL mark it stale, as in 001: it can still be opened and shows the last place, but nobody can move through it, draw, or post in its chat until an admin reactivates it. Sessions are never deleted.

### Chat

- **FR-32** THE SYSTEM SHALL give every presentation session the session chat of 002, including GIF messages as in 007, with the same rules: stored durably with the session, admin-removable, read-only when stale.

### Scripts in presentations

- **FR-17** WHEN a presentation contains scripts THE SYSTEM SHALL run them for each participant isolated from the app, from other participants and from the network: they cannot read or change anything outside the presentation, reach the participant's session, or send or load anything from elsewhere.
- **FR-18** WHEN a presentation's scripts fail or never finish THE SYSTEM SHALL keep the rest of the session window (controls, participants, drawing) working.

### Drawing

- **FR-19** WHEN any participant, host included, turns on the drawing tool THE SYSTEM SHALL let them draw freehand on top of the presentation; while it is on, their pointer draws instead of interacting with the presentation. Turning it on or off affects only that participant.
- **FR-20** WHEN a participant draws THE SYSTEM SHALL show the stroke live to every participant, on the same content, in a colour that tells participants apart.
- **FR-21** WHEN the host moves to another slide THE SYSTEM SHALL clear all drawings for everyone. On a single-page presentation, drawings stay attached to the content they were drawn on and scroll with it; scrolling never clears them.
- **FR-22** WHEN any participant chooses to clear drawings THE SYSTEM SHALL clear all drawings for everyone.
- **FR-23** WHEN a participant joins or reloads THE SYSTEM SHALL show them the drawings currently on screen.
- **FR-24** THE SYSTEM SHALL never store drawings durably; once every participant has left a session its drawings are gone.

## Non-functional requirements

- **NFR-1 Sync latency.** A slide change, scroll or drawn stroke by one participant appears for the others within 500 ms on the hub; the simulated cursor within 200 ms.
- **NFR-2 Isolation.** A presentation, whatever its HTML or scripts, cannot read cookies, tokens, other participants' data or anything of the app around it, cannot navigate the session window away, and cannot make network requests. This holds for HTML pasted by an editor exactly as for files.
- **NFR-3 Scale.** As with other sessions: up to the participant limit per session (001), and drawing stays smooth with every participant drawing at once.
- **NFR-4 Size.** One presentation's HTML is at most 5 MB, embedded images included.
- **NFR-5 Desktop.** Desktop browsers ≥ 1024 px wide, consistent with 003; light and dark appearance apply to the app around the presentation, not to the presentation's own styling.
- **NFR-6 Accessibility.** Controls (slide stepping, drawing toggle, clear) are keyboard-reachable and meet WCAG AA as in 003.

## Out of scope

- Converting other formats (PowerPoint, PDF, Markdown, Google Slides) to presentations.
- Editing a presentation's content inside the app; editors replace the whole HTML.
- Participants uploading their own HTML, or presentations outside the editors' library.
- Mirroring what the host does inside a presentation's scripts (clicking interactive elements, typing into it, animation state). Only the place — slide or scroll position — and the host's pointer are followed.
- Participants browsing ahead on their own ("free mode").
- Saving, exporting or undoing drawings; shapes, text, erasers or colour choice beyond the per-participant colour.
- Recording a presentation, audio or video.
- Speaker notes or a separate presenter view.
- Mobile and touch-only devices.
- Loading resources from outside the presentation's own HTML (separate image, style or script files, web fonts from the internet).

## Acceptance criteria

**AC-1 (FR-1)** Given an editor on the library, When they upload an HTML file with title "Intro to DNS" and topic "Networking", Then the presentation appears in the library with that title and topic. And When they instead paste HTML markup with a title and topic, Then it is added the same way. And When the title or topic is empty, or the title is 101 characters, Then it is refused.

**AC-2 (FR-2)** Given an editor adding HTML that marks 4 slides, When they submit it, Then before saving they are told it is a presentation of 4 slides. And Given HTML with no slide marks, Then they are told it will be shown as a single page.

**AC-3 (FR-3, NFR-4)** Given an editor, When they upload a 6 MB HTML file, Then it is refused with a message naming the 5 MB limit and the library is unchanged. And When they upload a PNG renamed to `.html`, Then it is refused as not HTML.

**AC-4 (FR-4)** Given a session started from presentation P with 4 slides, When an editor replaces P's HTML with a 6-slide version, Then that session still shows 4 slides, and a session started afterwards shows 6.

**AC-5 (FR-5)** Given an open session of presentation P, When an editor removes P, Then P is gone from the library and the session shows that the presentation is no longer available.

**AC-6 (FR-6)** Given presentations with topics "Networking" and "Docker", When anyone filters the library by "Docker", Then only the Docker presentations are listed, each with title and topic.

**AC-7 (FR-7)** Given a signed-in user without the editor role, or someone not signed in, When they try to add, replace or remove a presentation, Then it is refused and the library is unchanged.

**AC-8 (FR-8)** Given a library presentation, When Ana starts a session from it, Then she gets an invite link, is shown as host, and sees slide 1 (or the top of a single page).

**AC-9 (FR-9)** Given a session's invite link, When Ben opens it without an account and enters a name, Then he joins. And Given the session is at the participant limit, When one more person tries to join, Then they are refused as in 001.

**AC-10 (FR-10, FR-11)** Given host Ana and participant Ben on slide 1 of 4, When Ana moves to slide 3, Then Ben is shown slide 3; When she moves back, Ben is shown slide 2. And Given a single-page presentation, When Ana scrolls to the third heading, Then Ben's view shows the third heading.

**AC-11 (FR-12)** Given Ana on slide 3, When Ben reloads, or Cleo joins for the first time, Then they are shown slide 3 straight away.

**AC-12 (FR-13)** Given Ana's pointer over a word on the current slide, Then Ben sees a cursor labelled "Ana" over the same word, and it moves when Ana moves. When Ana's pointer leaves the presentation, Then Ben no longer sees it.

**AC-13 (FR-14)** Given participant Ben (not host) on slide 2, When he presses next, uses the keyboard, or scrolls, Then the shown place does not change for him or anyone else.

**AC-14 (FR-15)** Given Ana's window 1920 px wide and Ben's 1024 px wide on a single-page presentation, When Ana points at a heading half-way down the page, Then Ben's view shows that heading and the cursor is on it.

**AC-15 (FR-16)** Given Ana on slide 2, When Ana closes her tab, Then Ben stays on slide 2 and is told the host is away. When Ana opens the session again within 60 seconds and moves to slide 3, Then she is still host and Ben is shown slide 3.

**AC-15b (FR-25, FR-29)** Given host Ana on slide 2 with Ben and Cleo, When Ana hands hosting to Cleo, Then everyone is told Cleo is host, everyone stays on slide 2, Cleo can move to slide 3 and everyone follows, and Ana can no longer change the slide.

**AC-15c (FR-26, FR-29)** Given host Ana, Ben (joined first) and Cleo, When Ana disconnects and 60 seconds pass, Then Ben becomes host, everyone is told, and everyone stays on the last slide Ana showed. And When Ana disconnects and only 59 seconds pass before she returns, Then she is still host.

**AC-15d (FR-27)** Given host Ana disconnected for more than 60 seconds and nobody connected, When Ben opens the session, Then Ben is host.

**AC-15e (FR-28)** Given hosting passed from Ana to Ben, When Ana returns, Then she joins as a regular participant following Ben and cannot change the slide.

**AC-15f (FR-30)** Given a session where Cleo is host and slide 3 was last shown, When everyone leaves and Dana later opens the invite link, Then she joins, sees slide 3, and Cleo is shown as host.

**AC-15g (FR-31)** Given a presentation session with no activity for 30 days, When anyone opens it, Then it is marked stale, shows the last place, and slide changes, drawing and chat posting are refused. When an admin reactivates it, Then all three work again.

**AC-15h (FR-32)** Given a presentation session, When Ben posts a chat message and a GIF, Then every participant sees both, they are still there after everyone reloads, and an admin can remove either.

**AC-16 (FR-17, NFR-2)** Given a presentation whose script tries to read the page's cookies and local storage, read or change anything of the session window around it, navigate the window, and fetch a URL, When it is shown, Then every attempt fails, the session window is unchanged, and no request leaves the participant's browser. And Given a presentation whose script draws an animation on its own slide, Then the animation runs for each participant.

**AC-17 (FR-18)** Given a presentation whose script loops forever, When a session of it is open, Then the host can still change slides, participants still follow, and drawing still works.

**AC-18 (FR-19)** Given Ben turns on the drawing tool, Then dragging over the presentation draws a line for him and does not click or select anything in it, and Ana's tool stays off. When Ben turns it off, Then his pointer interacts with the presentation again.

**AC-19 (FR-20, NFR-1)** Given Ben and Cleo both drawing, When each draws a stroke, Then every participant sees both strokes on the same content within 500 ms, in two different colours.

**AC-20 (FR-21)** Given strokes on slide 2, When Ana moves to slide 3, Then no participant sees any strokes; When Ana returns to slide 2, Then it has no strokes either.

**AC-20b (FR-21)** Given a single-page presentation with Ben's stroke circling the second heading, When Ana scrolls down until the heading is off screen and back up, Then the stroke is still around the second heading for everyone.

**AC-21 (FR-22)** Given strokes from Ben and Cleo, When Cleo clears drawings, Then every participant sees none.

**AC-22 (FR-23)** Given strokes on the current slide, When Dana joins, Then she sees those strokes.

**AC-23 (FR-24)** Given strokes on the current slide, When every participant leaves and Ana later reopens the session, Then there are no strokes, and nothing of them is in stored session data.

**AC-24 (NFR-1)** Given host and participant on the hub, When the host changes slide, Then the participant's view changes within 500 ms; When the host moves the pointer, the simulated cursor follows within 200 ms.

**AC-25 (NFR-6)** Given a keyboard-only host, Then slide stepping, the drawing toggle and clear can all be reached and used without a mouse, and the controls pass a WCAG AA check.

## Open questions

None. Resolved 2026-11-03: hosting can be handed over and passes automatically after 60 s away (FR-25–FR-29); sessions kept durably and go stale after 30 days (FR-30, FR-31); chat as in 002/007 (FR-32); single-page drawings stay anchored until cleared (FR-21); anyone may start a session (FR-8).
