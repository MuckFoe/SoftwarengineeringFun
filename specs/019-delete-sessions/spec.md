# 019 — Delete sessions from the profile

Status: approved

## Problem / Why

A signed-in user's profile lists their recent sessions, and today the only thing they can do with one is **Hide** it, which removes it from their own list while the session itself lives on: its invite link still works, its code, slides, board and chat stay, and other participants still see it. A host who is done with a session, or who started one by mistake, has no way to end it for good. Only admins can delete, and only chess games. Hosts need to delete the sessions they host, for everyone, from the place they already manage their sessions.

## Users

- **Host**: the signed-in user who started a session, of any kind (FR-0). The profile marks it "Hosted by you". Deletes their own sessions.
- **Admin**: deletes any session that appears in their own profile list.
- **Other participants** (signed-in users, guests and chess invitees) of a deleted session: are told it is gone and lose access.

## Functional requirements

- **FR-0** THE SYSTEM SHALL treat as a session's host: for a presentation, its presenter (as today); for a coding, learning or chess session, the signed-in account that started it. WHEN a session was started before this feature and no starter account is known, THE SYSTEM SHALL treat the first signed-in account that joined it as its host. A session started by a guest, with no signed-in participant, has no host (only admins can delete it). WHEN the profile lists a session whose host is the user, THE SYSTEM SHALL mark it "Hosted by you", for every kind.

- **FR-1** WHEN a signed-in user's profile lists a session they host, of any kind (coding, learning, presentation, chess), THE SYSTEM SHALL show a Delete action on that session, beside Hide.
- **FR-2** WHEN a signed-in admin's profile lists any session, THE SYSTEM SHALL show the Delete action on it, whether or not they host it. An admin's delete request is accepted for any session, even one not in their list; the profile still offers Delete only on listed sessions.
- **FR-3** WHEN the profile lists a session the user neither hosts nor may delete as an admin, THE SYSTEM SHALL show no Delete action on it.
- **FR-4** WHEN the user activates Delete, THE SYSTEM SHALL ask for confirmation, naming the session and saying that it is deleted for everyone and cannot be undone, before anything is deleted.
- **FR-5** WHEN the user cancels the confirmation, THE SYSTEM SHALL delete nothing and leave the list unchanged.
- **FR-6** WHEN the user confirms, THE SYSTEM SHALL delete the session for everyone, immediately and permanently: everything belonging to it (code, run results and grading records, lesson progress, slides position and drawings, board and moves, as applicable to its kind) and its chat. Nothing is kept, for statistics or otherwise; only the fact that the invite was deleted remains, so FR-8 can say so.
- **FR-7** WHEN a session is deleted while participants are connected, THE SYSTEM SHALL tell each of them, in the session window, that the host (or an admin) deleted the session, and end their connection.
- **FR-8** WHEN anyone opens the invite link of a deleted session, THE SYSTEM SHALL show that the session was deleted, not a generic "not found", and offer a way back to the home screen.
- **FR-9** WHEN a session is deleted, THE SYSTEM SHALL remove it from every user's profile sessions list and from the home screen (its tile disappears for everyone who saw it).
- **FR-10** WHEN the deletion succeeds, THE SYSTEM SHALL remove the row from the user's list and confirm the deletion with a short, polite announcement.
- **FR-11** WHEN the deletion fails (for example the session was already deleted, or the user may no longer delete it), THE SYSTEM SHALL leave the row in place, say why in the list, and change nothing else. A session that turns out to be already deleted is removed from the list.
- **FR-12** WHEN a user who is neither the host nor an admin asks the server to delete a session (by any route, not only the UI), THE SYSTEM SHALL refuse and change nothing.
- **FR-13** THE SYSTEM SHALL keep Hide as it is today: it removes a session from the user's own list only.
- **FR-14** WHEN a chess session is deleted this way, THE SYSTEM SHALL behave as the existing admin deletion of chess games does for the people in it (same message, same disconnect, same deleted-link page), so chess has one deletion behaviour, now open to its host as well.

## Non-functional requirements

- **Security**: who may delete is decided by the server for every request (host of that session, or admin), never by what the UI shows. A guest or invitee can never delete.
- **Privacy**: after deletion no title, code, chat or count of the session is sent to or left on any client, including other users' profile lists and home screens.
- **Responsiveness**: participants connected to a deleted session see the "deleted" message within 2 seconds.
- **UI rules** (constitution rule 10): tokens only; Delete is the `danger` (destructive) style; the confirmation is the existing dialog primitive with focus in it, Escape cancels, and focus returns to the list; works at narrow width, in dark mode and under reduced motion; operable by keyboard; the button's accessible name names the session ("Delete <title>").

## Out of scope

- Deleting sessions from anywhere other than the profile (home tiles, session windows, admin stale lists). The existing admin chess deletion stays where it is.
- Bulk deletion (select several, delete all).
- Transferring host to someone else, or "leave session" for non-hosts.
- Deleting problems, presentations, lessons or user accounts.
- Changing who hosts a presentation, or handing hosting to someone else.

## Acceptance criteria

**AC-0 (FR-0)** Given a signed-in user who starts a coding, a learning and a chess session, and another signed-in user who joins each, When each opens their profile, Then the starter sees "Hosted by you" on all three and the joiner sees it on none; And Given a coding session created before this feature whose first signed-in participant was user A, Then A's profile marks it "Hosted by you".

**AC-1 (FR-1)** Given a signed-in user whose profile lists a coding, a learning, a presentation and a chess session they host, When the profile loads, Then each of those rows shows a Delete action named "Delete <title>", next to Hide.

**AC-2 (FR-2)** Given a signed-in admin whose profile lists a session someone else hosts, When the profile loads, Then that row shows Delete.

**AC-3 (FR-3)** Given a signed-in non-admin whose profile lists a session they joined but do not host, When the profile loads, Then that row shows Hide and no Delete.

**AC-4 (FR-4, FR-5)** Given a hosted session in the list, When the user activates Delete, Then a confirmation names the session and says it is deleted for everyone and cannot be undone; And When they cancel (button or Escape), Then the session still exists, its invite link still works, the row is still listed, and focus is back on the Delete action.

**AC-5 (FR-6, FR-10)** Given a hosted coding session with code and chat messages, When the host confirms deletion, Then the row leaves the list, a polite announcement confirms it, and neither its code nor its chat can be retrieved by anyone afterwards.

**AC-6 (FR-7)** Given a hosted presentation session with a second participant connected, When the host deletes it from their profile, Then within 2 seconds the participant's window says the session was deleted and their connection ends. The same holds for coding, learning and chess sessions.

**AC-7 (FR-8)** Given a deleted session, When anyone (signed in, guest or invitee) opens its invite link, Then they see that the session was deleted and a way back to the home screen.

**AC-8 (FR-9)** Given a session that appears in another participant's profile list and on their home screen, When the host deletes it, Then on their next load neither the list nor the home screen shows it.

**AC-9 (FR-11)** Given a session in the list that was already deleted elsewhere, When the user confirms Delete, Then the row is removed and the user is told it was already deleted; Given the delete fails for another reason, Then the row stays and an error in the list says what failed.

**AC-10 (FR-12)** Given a signed-in non-admin who joined but does not host a session, and an anonymous guest, When either sends a delete request for that session directly to the server, Then it is refused and the session is unchanged.

**AC-11 (FR-13)** Given a session in the list, When the user activates Hide, Then it leaves only their own list and stays available to everyone else, exactly as before this feature.

**AC-12 (FR-14)** Given a chess game with both players connected, When its host deletes it from their profile, Then both see the same "deleted" message and deleted-link page as for an admin deletion of a chess game today.

## Open questions

None. Resolved 2026-11-12:

- Host of a coding, learning or chess session: whoever started it, signed in; for older sessions without that record, the first signed-in account that joined (FR-0).
- Deletion is immediate and permanent: no undo, no grace period.
- Everything belonging to the session is deleted, including run results and grading records of a coding session and the progress records of a learning session. Nothing is kept for statistics.

## UI spec checklist (constitution-ui section E)

- [x] Home screen presence defined: no new tile; a deleted session's tile disappears for everyone (FR-9)
- [x] Dock / Jump-to-anything entries defined: none new; a deleted session drops out of Jump to anything because it leaves the lists it reads
- [x] Guest and invitee view defined: told and disconnected (FR-7), deleted-link page (FR-8), can never delete (FR-12)
- [x] Tokens only; new tokens in light, dark and Keycloak theme (none expected)
- [x] Primitives reused (Button `danger`, Dialog, the live announcement); none new expected
- [x] Narrow, dark, reduced-motion, keyboard and screen-reader behaviour stated (NFR UI rules)
- [x] Look matrix entry and E2E tasks present: to be carried into tasks (profile with Delete and its confirmation)
