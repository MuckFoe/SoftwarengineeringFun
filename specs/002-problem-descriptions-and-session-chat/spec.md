# 002 — Problem descriptions and session chat

## Problem / Why

A problem today gives participants too little to work from: they need a proper statement of the task — what to build, input and output, examples, constraints, sometimes a diagram — before they can write a solution together. And the people in a session can edit the same code but have no way to talk to each other inside it; discussing an approach means leaving the product for another channel. This feature gives every problem a required, formatted description with optional images, and gives every session a text chat that is stored with the session, so anyone who joins or comes back later can read the whole conversation.

## Users

- **Session participants** — anyone who joined a session through its invite link, under their session name, without an account. They read the problem description and chat.
- **Editors** — SSO users with the editor role who manage problems. They write and change descriptions, including images.
- **Admins** — as in 001; they can reactivate stale sessions, which affects whether chat is writable, and they can remove abusive chat messages.

## Functional requirements

- **FR1** — WHEN an editor creates or saves a problem THE SYSTEM SHALL require a non-empty description and refuse the save, naming the missing description, if there is none.
- **FR2** — WHEN an editor writes a description THE SYSTEM SHALL support formatted text: headings, paragraphs, bulleted and numbered lists, emphasis, inline code, code blocks and links.
- **FR3** — WHEN an editor adds an image to a description THE SYSTEM SHALL store it with the problem and show it inline at the position the editor placed it.
- **FR4** — WHEN an editor adds an image that is not an accepted image format or exceeds the size limit THE SYSTEM SHALL refuse that image with a message stating why, and leave the rest of the description unchanged.
- **FR5** — WHEN an editor is writing a description THE SYSTEM SHALL let them preview it as participants will see it before saving.
- **FR6** — WHEN a participant opens a session THE SYSTEM SHALL show the problem's description, formatted and with its images, alongside the shared editor.
- **FR7** — WHEN an editor saves a changed description THE SYSTEM SHALL show the new description in every session on that problem the next time it is opened or refreshed, without changing any session's code or chat.
- **FR8** — WHEN the system is first set up THE SYSTEM SHALL provide a description for each of the 20 starter problems.
- **FR9** — WHEN a description is shown or edited THE SYSTEM SHALL keep it apart from the problem's hidden tests and never reveal those tests through it.
- **FR10** — WHEN a participant sends a chat message in a session THE SYSTEM SHALL deliver it to every participant currently connected to that session, labelled with the sender's session name and the time it was sent.
- **FR11** — WHEN a participant sends a chat message THE SYSTEM SHALL store it durably with the session, in the order the system received it.
- **FR12** — WHEN a participant joins or reopens a session THE SYSTEM SHALL show that session's full chat history in order, followed by new messages as they arrive.
- **FR13** — WHEN a participant sends a message that is empty or only whitespace THE SYSTEM SHALL not send it.
- **FR14** — WHEN a participant sends a message longer than 2000 characters THE SYSTEM SHALL refuse it with a message stating the limit, and keep the text in the participant's input so it is not lost.
- **FR15** — WHEN a chat message is shown THE SYSTEM SHALL display it as plain text, so that markup, scripts or links in it are never rendered or executed.
- **FR16** — WHEN a session is stale THE SYSTEM SHALL show its chat history read-only and refuse new messages; WHEN an admin reactivates it THE SYSTEM SHALL accept messages again.
- **FR17** — WHEN anyone requests a session's chat THE SYSTEM SHALL serve it only to someone who has that session's invite link, and never mix messages between sessions.
- **FR18** — WHEN a participant's connection drops and returns THE SYSTEM SHALL show any messages sent while they were away, without duplicates and in order.
- **FR19** — WHEN an admin removes a chat message from a session THE SYSTEM SHALL stop showing it to everyone: it disappears for participants currently connected and is absent from the history anyone loads afterwards. No one other than an admin can remove a message, including its sender.

## Non-functional requirements

- **Latency** — a chat message reaches every other connected participant of the session within 1 second under normal conditions (the session's maximum of 5 participants).
- **Durability** — a message the sender sees as sent is stored; it survives a restart of the system, as sessions do in 001.
- **Retention** — chat is kept as long as its session is kept; sessions are never deleted (001), so neither is their chat, except messages an admin removes (FR19).
- **Security** — description content is rendered so that nothing an editor writes can run script in a participant's browser; chat content is never rendered as markup (FR15). Images are served only as images.
- **Images** — accepted formats are PNG, JPEG, GIF and WebP; at most 2 MB per image and 10 images per description.
- **Readability** — descriptions and their images remain readable at the narrowest screen width the session page supports.

## Out of scope

- An AI assistant or bot in the chat.
- Chat between people outside a session, direct/private messages, and chat across sessions.
- Editing or deleting chat messages after sending, by the sender or anyone else, except an admin removing a message (FR19).
- Attachments, images, files, reactions, threads or formatting in chat messages.
- Notifications outside the session page (email, push, sound) for new messages.
- Typing indicators and read receipts.
- Search across chat history.
- Video or audio in descriptions; formulas/math typesetting.
- Version history of descriptions beyond what 001 already keeps for problems.
- Localisation of descriptions into multiple languages.

## Acceptance criteria

- **FR1** — Given an editor creating a problem with title and tests but an empty description, When they save, Then the save is refused, the message names the description, and no problem is created.
- **FR1** — Given an existing problem, When an editor clears its description and saves, Then the save is refused and the stored description is unchanged.
- **FR2** — Given a description containing a heading, a numbered list, inline code and a fenced code block, When a participant views it in a session, Then each element renders with its formatting and the code block keeps its whitespace.
- **FR3** — Given an editor who places a PNG image between the second and third paragraphs and saves, When a participant opens a session on that problem, Then the image is shown between those two paragraphs.
- **FR4** — Given an editor adding a 3 MB image, When they add it, Then it is refused with a message stating the 2 MB limit, and the description's existing text and images are unchanged.
- **FR4** — Given an editor adding a PDF as an image, When they add it, Then it is refused with a message stating the accepted formats.
- **FR4** — Given a description that already has 10 images, When the editor adds an 11th, Then it is refused with a message stating the limit.
- **FR5** — Given an editor with unsaved description changes, When they open the preview, Then they see the description rendered exactly as a participant would, and nothing is saved.
- **FR6** — Given a session on a problem with a description, When a participant opens the session, Then the formatted description and its images are visible alongside the shared editor.
- **FR7** — Given two sessions on the same problem, each with code and chat messages, When an editor saves a new description and a participant refreshes each session, Then both show the new description and both sessions' code and chat are unchanged.
- **FR8** — Given a freshly set-up system, When an editor lists the 20 starter problems, Then each one has a non-empty description.
- **FR9** — Given a problem with hidden tests, When a participant views its description in a session, Then none of the hidden tests' inputs or expected outputs appear unless the editor wrote them into the description text themselves.
- **FR10** — Given a session with participants "Ana" and "Ben" connected, When Ana sends "try a hashmap", Then Ben sees "try a hashmap" labelled "Ana" with its send time, within 1 second.
- **FR11** — Given messages "one", "two", "three" sent in that order, When the system is restarted and a participant reopens the session, Then all three are shown in that order.
- **FR12** — Given a session with 50 earlier messages, When a new participant joins through the invite link, Then they see all 50 in order, and then a message sent afterwards appears after them.
- **FR13** — Given a participant whose input contains only spaces and line breaks, When they try to send, Then nothing is sent and no one sees a new message.
- **FR14** — Given a participant who typed 2001 characters, When they send, Then the message is refused with a message stating the 2000-character limit, nobody receives it, and the 2001 characters remain in their input.
- **FR14** — Given a participant who typed exactly 2000 characters, When they send, Then the message is delivered.
- **FR15** — Given a participant who sends `<script>alert(1)</script> **bold** <b>x</b>`, When others see it, Then they see exactly those characters as text, nothing is bold, and no script runs.
- **FR16** — Given a stale session with chat history, When a participant opens it, Then the history is shown and sending is unavailable; When an admin reactivates the session, Then the participant can send again.
- **FR17** — Given sessions A and B, When a participant in A sends a message, Then it appears in A's chat and never in B's; and a request for A's chat without A's invite link is refused.
- **FR18** — Given Ana disconnected while Ben sends two messages, When Ana reconnects, Then Ana sees both messages once each, in order, after the messages already seen before the drop.
- **FR19** — Given Ana and Ben connected to a session where Ben sent "one", "abuse", "three", When an admin removes "abuse", Then within 1 second Ana and Ben see "one" and "three" only, and a participant who joins afterwards sees "one" and "three" in that order.
- **FR19** — Given a participant (the sender or anyone else) or an editor without the admin role, When they try to remove a message, Then it is refused and the message stays visible to everyone.

## Decisions

Resolved with the user on 2026-10-25:

- Participants cannot edit or delete their own chat messages after sending.
- Admins can remove any chat message from any session (FR19); editors cannot.
- A removed message is hidden, not erased: it stays stored with the session but is never shown or served again.
- Image limits stay as stated: PNG, JPEG, GIF and WebP; 2 MB per image; 10 images per description.
