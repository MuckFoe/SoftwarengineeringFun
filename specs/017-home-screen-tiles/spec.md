# 017 — Home screen with live session tiles

## Problem / Why

The first screen after sign-in is a plain list of sessions. It does not show what is happening now, who is in it, or what to do first. The suggested home screen (mockup "V2") turns it into a calm overview: a personal greeting, by first name, that says what is live, one obvious way to start a session, and large tiles for the sessions and games you can jump into, with a glimpse of the live code or board. Behaviour of the sessions themselves does not change; this is the landing screen only. It uses the look of spec 016.

## Users

Signed-in account holders. Anonymous guests and chess invitees see a reduced version showing only the session or game they joined.

## Functional requirements

- **FR-1** WHEN a signed-in user opens the home screen THE SYSTEM SHALL show a greeting that matches the time of day, includes the user's first name, or the display name or username when there is no first name, and states how many people, including the user, are in live sessions right now.
- **FR-2** WHEN the home screen is shown THE SYSTEM SHALL show one prominent "Start session" tile that starts a session exactly as the existing start action does.
- **FR-3** WHEN sessions exist THE SYSTEM SHALL show one tile per live session the user may open, then the user's own idle sessions, newest first, up to 8 with a "Show more" tile when there are more, each with its kind (coding, learning, presentation), title, host, a "Live" tag and participant count when live, the participants' avatars, and the last-active time when idle.
- **FR-4** WHEN a session is live THE SYSTEM SHALL show on its tile (coding sessions only; learning and presentation tiles have none) a short, non-interactive preview of its current code, fading out at the bottom.
- **FR-5** WHEN a session tile is activated by mouse or keyboard THE SYSTEM SHALL open that session as the existing "join" action does.
- **FR-6** WHEN a chess game involving the user is in progress or waiting THE SYSTEM SHALL show a Games tile with the game's title, whose turn it is and a small board preview, and activating it SHALL open the game.
- **FR-7** WHEN session or game activity changes while the home screen is open THE SYSTEM SHALL update the tiles, counts and the greeting without a reload.
- **FR-8** WHEN the user has no sessions and no games THE SYSTEM SHALL show an empty state that tells them to start a session, and the Start session tile SHALL remain.
- **FR-9** WHEN the viewport is narrow THE SYSTEM SHALL reflow the tiles into fewer columns, keeping Start session first, with no horizontal scrolling.
- **FR-11** WHEN an anonymous guest or chess invitee opens the app THE SYSTEM SHALL show only a tile for the session or game they joined, in the same look, and no other tiles, greeting count or previews of other sessions.
- **FR-10** WHEN the "my sessions" view for accounts exists today THE SYSTEM SHALL keep its content and functions reachable from the home screen, now as tiles.

## Non-functional requirements

- **Privacy:** some sessions are private or invite-only. A tile, avatars or code preview SHALL appear only for a session the viewing user may open; private sessions the user may not open never appear. Guests see nothing of other sessions.
- **Performance:** the home screen shows its first tiles without waiting for code previews; previews fill in as they arrive.
- **Accessibility:** WCAG 2.1 AA; every tile is a keyboard-focusable control with an accessible name stating title, host and live state; the preview is hidden from assistive technology; the greeting's count is announced politely when it changes, not on every change.
- **Look:** follows spec 016, including reduced-motion behaviour.

## Out of scope

- Changes to how sessions, chat, the editor or chess behave.
- Searching, filtering or sorting controls on the home screen.
- Notifications and invites to a session.
- Any new data about users beyond what the app already has.

## Acceptance criteria

**FR-1**
- Given it is 19:00 and two people are in live sessions the user can see, When the home screen opens, Then the greeting names the user, says good evening and that two people are coding (the user counted if one of them).
- Given nobody is live, When it opens, Then the greeting says so without a count of zero people "coding".

**FR-2**
- Given the home screen, When Start session is activated, Then a new session starts as before.

**FR-3**
- Given two live sessions and two idle ones, When shown, Then the live ones come first, each with "Live", a participant count and avatars, and the idle ones show last-active time and no Live tag.

**FR-4**
- Given a live session with code, When its tile is shown, Then a few lines of the current code appear faded at the bottom and cannot be focused or edited.
- Given a live session with no code yet, Then the tile shows no preview and no empty box.

**FR-5**
- Given a tile, When activated by click or by Enter, Then the session opens.

**FR-6**
- Given the user is in a chess game, When the home screen is shown, Then a Games tile shows the opponent, whose move it is, and a board preview, and opens the game when activated.
- Given no such game, Then no Games tile is shown.

**FR-7**
- Given the home screen is open, When another user joins or leaves a session, Then the tile's count and avatars and the greeting count update within a few seconds without reload.

**FR-8**
- Given a private session the user may not open, When the home screen is shown, Then no tile, avatar or code of it appears.
- Given a user with no sessions or games, When the home screen opens, Then an empty state tells them to start a session and the Start session tile is present.

**FR-9**
- Given a narrow viewport, When shown, Then tiles stack in fewer columns, Start session is first, and nothing scrolls horizontally.

**FR-11**
- Given a chess invitee, When the app opens, Then they see only the game tile and its board preview.

**FR-10**
- Given an account with earlier sessions, When the home screen is shown, Then those sessions are reachable as tiles with the same actions as before.

**Privacy / Accessibility**
- Given an anonymous guest, When the app opens, Then only the tile of the session or game they joined appears, with no other session's title, avatars or code.
- Given keyboard only, When tabbing, Then every tile is reachable in reading order, shows focus, and announces its title, host and live state.

## Open questions

Resolved with the user (2026-11-07): the count includes the user; the greeting uses the first name, else the display name or username; tiles show every live session the user may open (some sessions are private or invite-only), then up to 8 of the user's own idle sessions; the code preview shows to everyone who sees the tile, with no host control; guests get a reduced home; learning and presentation sessions get tiles with no code preview.

None.
