# 007 — GIF search in session chat

Amends spec 002 (session chat is plain text, ≤2000 characters per message). Source: feedback F1, 2026-10-29.

## Problem / Why

Session chat only carries plain text. Participants want to react the way they do in other chat tools: search for a GIF and post it. Adding this means that what a participant types into the search leaves the hub for a third-party GIF service, and that anyone with an invite link (no account) can post images into a shared, durably stored chat, so both the privacy exposure and the content allowed have to be bounded.

## Users

- **Session participants**: anyone who joined a session by invite link, with or without an account; they search for and post GIFs.
- **Admins**: they remove chat messages, GIFs included.

## Functional requirements

- **FR-1** WHEN a participant opens GIF search in an active session's chat and enters a search term THE SYSTEM SHALL show matching GIFs from a third-party GIF service, rated no higher than PG-13.
- **FR-2** WHEN a participant opens GIF search with no term entered THE SYSTEM SHALL show trending GIFs under the same rating limit.
- **FR-3** WHEN a participant picks a GIF from the results THE SYSTEM SHALL post it to the session chat as one message, attributed to that participant with the same name and time as a text message.
- **FR-4** WHEN a GIF message is posted THE SYSTEM SHALL show it, playing, to every participant currently in the session, in order with text messages, as for spec 002 chat.
- **FR-5** WHEN a participant opens GIF search for the first time in a session THE SYSTEM SHALL tell them that search terms are sent to a third-party service before any term is sent.
- **FR-6** WHEN a GIF message is posted THE SYSTEM SHALL store it durably with the session, like any other chat message.
- **FR-7** WHEN an admin removes a GIF message THE SYSTEM SHALL remove it for every participant, as for a text message under spec 002.
- **FR-8** WHEN a session is stale THE SYSTEM SHALL show its GIF messages read-only and SHALL NOT offer GIF search.
- **FR-9** WHEN the GIF service is unreachable or returns an error THE SYSTEM SHALL tell the participant GIF search is unavailable, and plain-text chat SHALL keep working.
- **FR-10** WHEN a GIF message is shown THE SYSTEM SHALL show a text alternative for it (the GIF's title from the service, or "GIF" when it has none) to assistive technology.
- **FR-11** WHEN a GIF message is shown THE SYSTEM SHALL credit the GIF service as its terms require.
- **FR-12** WHEN a GIF message is posted THE SYSTEM SHALL keep only a reference to the GIF at the service, not a copy of the GIF itself; WHEN that GIF is no longer available from the service THE SYSTEM SHALL show the message as a "GIF no longer available" placeholder, keeping its author, time and position.

## Non-functional requirements

- **NFR-1 Privacy.** Only the search term goes to the GIF service. No participant name, session identifier, chat content or account data is sent with it.
- **NFR-2 Content.** No search result or posted GIF exceeds a PG-13 rating, regardless of what the participant types.
- **NFR-3 Abuse.** A single participant can make at most 20 GIF searches and 5 GIF posts per minute, so one participant cannot flood a session or exhaust the service quota of the hub.
- **NFR-4 Responsiveness.** Results for a search term appear within 2 seconds under normal conditions.
- **NFR-5 Secrets.** Any key needed to use the GIF service comes from the environment, per the constitution.
- **NFR-6 Accessibility.** GIF search is fully usable by keyboard and meets WCAG AA, as spec 003 requires for every screen; GIF playback respects the system's reduced-motion setting by showing a still frame.

## Out of scope

- Uploading one's own images or GIFs.
- Stickers, emoji reactions on messages, or a combined text + GIF message.
- Choosing a rating per session or per participant; the PG-13 limit is fixed.
- Searching GIFs from places other than session chat (e.g. problem descriptions).
- Any change to the spec 002 text-message rules (length, plain text).

## Acceptance criteria

**FR-1** — Given an active session with chat, When a participant searches "cat", Then GIFs matching "cat" are shown, and the request to the service asks for a rating of PG-13 or lower.

**FR-2** — Given GIF search is open with an empty search field, When results load, Then trending GIFs are shown, limited to PG-13.

**FR-3** — Given search results, When participant "Ada" picks one, Then a chat message from "Ada" with the current time appears containing that GIF.

**FR-4** — Given three participants in a session, When one posts a GIF, Then the other two see it in chat without reloading, after the messages posted before it.

**FR-5** — Given a participant who hasn't used GIF search in this session, When they open it, Then a notice that search terms go to a third-party service is visible before the first search is sent.

**FR-6** — Given a posted GIF message, When the session is reloaded later, Then the GIF message is still in the chat in its original position.

**FR-7** — Given a posted GIF message, When an admin removes it, Then it disappears for every participant and is gone after reload.

**FR-8** — Given a stale session with GIF messages, When it is opened, Then the GIFs are shown and no GIF search control is available.

**FR-9** — Given the GIF service is unreachable, When a participant searches, Then a "GIF search unavailable" message is shown, And sending a text message still succeeds.

**FR-10** — Given a GIF message whose GIF has the title "Happy dance", When it is read by a screen reader, Then "Happy dance" is announced; Given one with no title, Then "GIF" is announced.

**FR-11** — Given GIF search results or a GIF message, When shown, Then the service attribution required by its terms is visible.

**FR-12** — Given a posted GIF message, When it is stored, Then the stored message holds a reference to the GIF and no GIF file; Given the service no longer serves that GIF, When the session is opened, Then the message shows "GIF no longer available" with its original author, time and position.

**NFR-1** — Given a participant named "Ada" searches "cat" in session S, When the outgoing request to the service is inspected, Then it contains "cat" and contains neither "Ada", S's identifier, nor any chat text.

**NFR-3** — Given a participant who has made 20 searches (or posted 5 GIFs) within the last minute, When they search or post again, Then the action is refused with a message saying to wait, And other participants are unaffected.

**NFR-6** — Given GIF search is open, When a participant uses only the keyboard, Then they can type a term, move through results and post one; Given reduced motion is on, When a GIF message is shown, Then it does not animate.

## Open questions

None. Resolved 2026-10-30: the hub keeps only a reference to each GIF, shown as a placeholder once gone (FR-12); limits are 20 searches and 5 posts per participant per minute (NFR-3).
