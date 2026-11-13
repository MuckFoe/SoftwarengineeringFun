# 020 — Next-step hints from the self-hosted language model

Status: draft

## Problem / Why

A group stuck on a coding problem whose hidden tests keep failing has one option today: keep guessing. People learn more when someone nudges them one step in the right direction and they then do the work themselves. The user runs a language model on their own network, and the app should use it to give the group a short hint about the **next step**. It must never give the complete solution, so the group stays the one solving the problem. Session content (code, run results) belongs to the users, so hints must come only from that self-hosted model, never from a cloud service.

## Users

- **Coding session participants**: anyone in a coding session, including anonymous guests who joined by invite link. Any of them can ask for a hint when the group is stuck, and everyone in the session sees it.
- **Operator**: makes hints available by configuring the self-hosted model, and turns them off by removing that configuration.
- **Editors**: indirectly. Hints must not leak their problems' hidden tests.

## Terms

- **Hint**: a short piece of guidance about what to consider or do next on the session's current problem. The self-hosted model produces it when a participant asks.
- **Complete solution**: code that makes every test pass when put in the editor as the session's solution, or a full implementation of the problem's function in any form (code, pseudo-code, or a step-by-step recipe that leaves nothing to work out).
- **Note**: a single line that came with hints asked before 2026-11-13. The *Hint* action no longer takes one (FR-5); notes already stored are still shown.
- **Question**: a single line a participant types to ask the model something specific about the current problem (FR-17).
- **Answer**: the model's reply to a question. A **revealing answer** is one the asker explicitly agreed to see although it gives away the complete solution (FR-20).

## Functional requirements

### Availability

- **FR-1** WHILE a self-hosted model is configured and a participant is in an active (not stale) coding session whose current problem exists, THE SYSTEM SHALL offer a *Hint* action beside the current problem.
- **FR-2** WHEN no self-hosted model is configured, THE SYSTEM SHALL not offer *Hint* anywhere. Hints are on whenever a model is configured; there is no per-session or per-problem switch.
- **FR-3** WHEN a coding session is stale, or its current problem has been deleted (spec 001 FR-10), THE SYSTEM SHALL not offer *Hint*. Hints already given stay visible (FR-15).
- **FR-4** THE SYSTEM SHALL offer hints only in coding sessions. Learning, presentation and chess sessions have no *Hint* action.

### Asking for a hint

- **FR-5** WHEN any participant, signed in or a guest, activates *Hint*, THE SYSTEM SHALL ask the self-hosted model for a hint on the session's current problem at once, with no input from the asker (changed 2026-11-13: the note field is gone). Everyone in the session sees that a hint is being prepared and who asked.
- **FR-6** WHEN the hint is ready, THE SYSTEM SHALL show it to everyone in the session. It is labelled as a model-generated hint, numbered within the problem ("Hint 2"), and shown with the asker's name (and the note, for hints that have one). The label keeps it from being mistaken for the problem's own text.
- **FR-7** THE SYSTEM SHALL give a hint only when asked. It never offers hints unprompted. No earlier run is required.
- **FR-8** WHILE a hint or an answer is being prepared for a session, THE SYSTEM SHALL not start another hint or question request for that session, and SHALL show anyone who asks that a hint is already being prepared. This is the only limit: there is no cooldown and no cap on the number of hints.

### What a hint is and is not

- **FR-9** THE SYSTEM SHALL make every hint point to a single next step from where the group is now, such as what to consider, which case they are missing, or which idea applies. It does not lay out a full path to the end. A hint is prose of at most about 3 sentences and may include at most one short line of code.
- **FR-10** THE SYSTEM SHALL never show a hint that contains a complete solution (see Terms). WHEN a produced hint would contain one, THE SYSTEM SHALL withhold it and tell the session that no hint could be given this time. The app makes this check on every hint; it is not left to the model alone.
- **FR-11** THE SYSTEM SHALL never show a hidden test in a hint: no inputs, no expected values, and no information about the tests beyond what run results already show (spec 001 NFR-5). The model is not given the hidden tests.
- **FR-12** THE SYSTEM SHALL base each hint only on the session's current problem description, its current shared code, the latest run's per-test outcomes and error messages for that problem, the earlier hints on that problem in this session, and the asker's note. The model is given nothing else: no session chat, no hidden tests, nothing from other sessions, and no participant's account identity.
- **FR-13** WHEN a hint is asked on a problem that already has hints in this session, THE SYSTEM SHALL make the new hint more specific than the one before it and not repeat it. It is still bound by FR-9 to FR-11, so escalation never reaches a complete solution. Hints are counted per problem: switching the session to another problem starts that problem's own sequence, and switching back continues where it left off.

### When the model is unavailable

- **FR-14** WHEN the self-hosted model cannot be reached, answers with an error, or does not answer within its time limit, THE SYSTEM SHALL tell the session that hints are unavailable right now. No hint is recorded or numbered, *Hint* can be used again, and everything else in the session keeps working exactly as before. The time limit is 30 seconds while the model is loaded and 2 minutes while it is cold (FR-14a).
- **FR-14a** WHEN a participant asks for a hint while the self-hosted model is not loaded (cold), THE SYSTEM SHALL tell the session within 5 seconds that the model is warming up and the hint will take longer, and SHALL then show the hint, or the "unavailable" message, within 2 minutes of asking. The model is not kept loaded between hints; nothing warms it in advance.

### Asking a question (added 2026-11-13)

- **FR-17** WHEREVER *Hint* is offered (FR-1 to FR-4), THE SYSTEM SHALL also offer a *Question* action beside it. WHEN a participant activates it, THE SYSTEM SHALL let them type one question (one line, at most 500 characters, not empty) and send it to the self-hosted model about the session's current problem. Everyone in the session sees that an answer is being prepared, who asked and the question.
- **FR-18** WHEN the answer is ready, THE SYSTEM SHALL show it to everyone in the session, labelled as a model answer, numbered within the problem separately from hints ("Question 2"), with the asker's name and the question. Questions do not change hint numbering or how specific the next hint is.
- **FR-19** THE SYSTEM SHALL answer the question itself but never give a complete solution (see Terms) in an answer. An answer is short prose of at most about 6 sentences and at most 3 lines of code. The app checks every answer as it checks hints (FR-10); an answer that breaks the length rules is withheld and the session is told no answer could be given this time.
- **FR-20** WHEN the model judges that answering the question would basically give the complete solution, or the app's check finds a complete solution in the answer, THE SYSTEM SHALL not show it. Instead it SHALL ask the asker, and only the asker, whether they really want the answer even though it is basically the solution. Everyone else sees that the asker is deciding. WHEN the asker confirms, THE SYSTEM SHALL ask the model again with permission to give the solution and show that answer to everyone, marked as revealing the solution. WHEN the asker declines, nothing is shown or stored and the question is dropped.
- **FR-21** A pending confirmation does not block *Hint* or *Question* for anyone. At most one confirmation is pending per session: a newer one replaces it. It is not kept across a server restart.
- **FR-22** THE SYSTEM SHALL base an answer on what a hint is based on (FR-12), plus the question and the earlier questions and answers on that problem in this session. FR-11 (no hidden tests) and FR-14 / FR-14a (unavailable, cold model) apply to answers, revealing answers included.

### Keeping hints

- **FR-15** THE SYSTEM SHALL store every hint and answer shown, with its number, asker's name, note or question and problem, durably with the session. Hints stay visible after a reload, to participants who join later, when the session is reopened from the profile, and read-only in a stale session. They also return when the session switches back to their problem.
- **FR-16** WHEN a session is deleted (spec 019), THE SYSTEM SHALL delete its hints with it.

## Non-functional requirements

- **Data stays on the user's network**: hint requests, and the session content they carry, go only to the self-hosted model the operator configured. They never go to a third-party or cloud service, as the main route or as a fallback, and they never carry account identity (usernames, emails). Participants are shown no notice about this.
- **Security**: the one-request-at-a-time rule is enforced by the server for every request, not by the UI. Model output and notes are shown as plain text. They are never run, and never put into the shared editor or chat automatically.
- **Test secrecy**: FR-10 and FR-11 hold even when the model's output is adversarial, or when the participant's code or note tries to make the model produce a solution or reveal tests.
- **Responsiveness**: a hint, or the "unavailable" message, appears within 30 seconds of asking while the model is loaded, and within 2 minutes when it is cold (FR-14a). Asking for a hint never slows editing, runs or chat for anyone in the session.
- **Isolation from failure**: a slow, down or misconfigured model never breaks session start, join, editing, runs or chat (FR-14).
- **Note length**: a note is a single line of at most 200 characters.
- **UI rules** (constitution rule 10): tokens only. *Hint* is a secondary (tonal or outlined) pill built from existing primitives. The preparing state and a hint's arrival are announced politely to screen readers, once each. Everything works by keyboard with a visible focus ring, at narrow width (≈390 px), in light and dark, and under reduced motion (no pulsing or sweep while preparing).

## Out of scope

- Hints in learning, presentation or chess sessions.
- A chat-style tutor or free conversation with the model. A question gets one answer; there are no follow-up turns, though later questions see earlier ones (FR-22).
- Questions or answers private to the asker; everything is shared with the session.
- A cooldown or a cap on the number of hints; per-session, per-problem or per-user switches to turn hints off.
- A notice or consent step about content being sent to the model.
- Explaining run errors on their own, reviewing code style, or grading.
- Generating problems or tests with the model.
- Any cloud or third-party model, as the main route or as a fallback.
- Choosing, installing, hosting or tuning the model. This app only uses one the operator already runs.

## Acceptance criteria

**AC-1 (FR-1, FR-2, FR-4)** Given a model is configured, When a participant opens an active coding session, Then *Hint* is shown beside the current problem. And When they open a learning, presentation or chess session, Then no *Hint* is shown. And Given no model is configured, When anyone opens a coding session, Then no *Hint* is shown.

**AC-2 (FR-3)** Given a stale coding session with earlier hints, or a coding session whose current problem was deleted, When a participant opens it, Then no *Hint* is shown and the earlier hints are still visible.

**AC-3 (FR-5, FR-6)** Given an active coding session with a signed-in participant and a guest who joined by invite link, When the guest activates *Hint*, Then both see "preparing hint" with the guest's name. Within 30 s both see a hint labelled as a model hint, numbered "Hint 1", with the guest's name.

**AC-4 (FR-5)** Superseded 2026-11-13: *Hint* takes no note. A note sent by an older client is still cut to one line of 200 characters, and an empty one is no note.

**AC-5 (FR-7)** Given a session where nobody has asked, When runs fail repeatedly, Then no hint appears. And Given a session that has never run its code, When a participant asks, Then a hint is given.

**AC-6 (FR-8)** Given a hint is being prepared for a session, When any participant, or a direct request to the server, asks for another, Then no second request is made and the asker is told a hint is already being prepared. And When the first hint arrives, Then *Hint* can be used again at once (no cooldown), and a tenth or later hint on the same problem is still given.

**AC-7 (FR-9)** Given any shown hint, Then it is prose of at most about 3 sentences with at most one line of code.

**AC-8 (FR-10)** Given a model that answers with a full working implementation of the problem's function, or with a single line that passes every test, When a participant asks for a hint, Then that answer is not shown, the session is told no hint could be given this time, no hint number is used, and the shared code is unchanged. And Given the starter problems, When the code line of every shown hint is placed alone into the editor and run, Then it does not pass all tests.

**AC-9 (FR-11, FR-12)** Given a coding problem with hidden tests, and participant code or a note asking the model to print the tests, When a hint is asked, Then the model was given no hidden test, and no test input, expected value or test information beyond the run results reaches any participant.

**AC-10 (FR-12)** Given a session whose chat contains a distinctive phrase, and a second session on the same problem with different code, When the first session asks for a hint, Then the model was given that session's problem description, current code, latest run outcomes and errors, earlier hints on the problem and the note. It was given nothing from its chat, the other session, or any username or email.

**AC-11 (FR-13)** Given "Hint 1" has been shown on problem A, When a participant asks again, Then "Hint 2" is shown, does not repeat Hint 1, and is still bound by AC-7 and AC-8; the model was given Hint 1. And Given the session then switches to problem B and asks, Then that hint is "Hint 1" for B. And When it switches back to A and asks, Then the hint is "Hint 3" for A.

**AC-12 (FR-14)** Given the model is loaded but unreachable, answers with an error, or takes longer than 30 s, When a participant asks for a hint, Then within 30 s everyone in the session sees that hints are unavailable right now. No hint is numbered or stored, *Hint* can be used again, and editing, runs and chat keep working for everyone.

**AC-12a (FR-14a)** Given the model is not loaded, When a participant asks for a hint, Then within 5 s everyone in the session sees that the model is warming up and the hint will take longer; And When the model answers within 2 minutes, Then everyone sees the hint as usual; And When it does not, Then everyone sees that hints are unavailable right now, as in AC-12.

**AC-13 (FR-15)** Given hints 1 and 2 shown on a problem, When a participant reloads, a new participant joins by invite link, or a signed-in participant reopens the session from their profile, Then each sees both hints, numbered, with askers' names and notes. And Given the server restarts, Then they are still there. And Given the session later goes stale, Then they are still shown, read-only.

**AC-14 (FR-16)** Given a session with stored hints, When its host deletes it (spec 019), Then its hints no longer exist and are not shown anywhere.

**AC-15 (NFR Data stays on the user's network, Security)** Given a hint request, Then it goes only to the configured self-hosted model and carries no username or email. And Given a model answer or note containing markup or script, Then it is shown as inert text and nothing runs. And Given a hint containing a code line, Then the shared editor is unchanged until a participant types it themselves.

**AC-17 (FR-5)** Given an active coding session with a model, When a participant activates *Hint*, Then a hint is requested at once; no text field appears.

**AC-18 (FR-17, FR-18)** Given an active coding session with a signed-in participant and a guest, When the guest activates *Question* and sends "what does enumerate return?", Then both see an answer being prepared with the guest's name and the question, and then the answer labelled as a model answer, numbered "Question 1", with the guest's name and question. And When a hint is asked next on that problem, Then it is "Hint 1" and the model was told the hint level of a first hint. And Given an empty question, Then nothing is sent.

**AC-19 (FR-19, FR-20)** Given a model that answers a question with a full working implementation, or that says the answer would be the solution, When the guest asks, Then no answer is shown, the guest is asked whether they really want the answer although it is basically the solution, and the other participant sees that the guest is deciding. And When the guest declines, Then nothing is shown or stored. And When the guest asks again and confirms, Then both see the answer marked as revealing the solution, numbered as the next question. And the other participant is never offered the confirmation.

**AC-20 (FR-21, FR-22)** Given a confirmation is pending, When anyone asks for a hint, Then the hint is given. And Given an earlier question and answer on the problem, When a new question is asked, Then the model was given them, and no hidden test, chat line or username or email.

**AC-16 (NFR UI rules)** Given the coding session window at ≈390 px and at ≥1024 px, in light and dark, with reduced motion, When a keyboard-only user activates *Hint* and a hint arrives, then activates *Question*, types a question, sends it and an answer arrives, Then *Hint* and *Question* have a visible focus ring and an accessible name. "Preparing" and the hint's arrival are each announced politely once, nothing animates under reduced motion, and nothing overflows horizontally.

## Open questions

None. Resolved 2026-11-12:

- Coding sessions only. Learning, presentation and chess sessions have no hints.
- Any participant may ask, guests included, and a hint is shared with everyone in the session.
- Hints escalate per problem in the session and never reach a complete solution. A hint is prose with at most one short line of code.
- The model sees the problem description, current code, the latest run's outcomes and errors, earlier hints on the problem and the asker's note. It never sees hidden tests or chat.
- The only limit is one hint request per session at a time: no cooldown, no cap, and no earlier run required.
- Hints are stored with the session and deleted with it.
- Hints are on whenever a model is configured; the operator turns them off by removing that configuration. There are no other switches.
- No notice about sending code to the model.
- An optional one-line note goes with the request and is shown with the hint.
- Confirmed defaults: hints are labelled model-generated, shown as plain text, about 3 sentences at most, and never inserted automatically. The 30 s unavailable message stands for a loaded model; a cold model gets a warming-up notice and up to 2 minutes (user, 2026-11-12: no keep-alive), and stale sessions get no new hints.

Resolved 2026-11-13 (questions): questions and answers are shared with the whole session and stored with it like hints; only the asker is asked to confirm a revealing answer; *Hint* takes no note any more.

## UI spec checklist (constitution-ui section E)

- [x] Home screen presence defined: none. A hint is not something a user starts, joins or resumes. It lives inside an open coding session window, and no tile, preview or count changes.
- [x] Dock / Jump-to-anything entries defined: none; no new area or list.
- [x] Guest and invitee view defined: guests who joined by invite link may ask and see every hint, the same as signed-in participants (FR-5, FR-6). Chess invitees see nothing, because chess has no hints (FR-4).
- [x] Tokens only; new tokens in light, dark and Keycloak theme (none expected; the hint surface uses existing tone and accent tokens)
- [x] Primitives reused (Button secondary pill, Card/surface for hints, text input for the note, the polite live announcement); none new expected
- [x] Narrow, dark, reduced-motion, keyboard and screen-reader behaviour stated (NFR UI rules, AC-16)
- [x] Look matrix entry and E2E tasks present. To be carried into tasks: in the look matrix, the coding session window with hints shown, the preparing state, the unavailable state and the note input, in light and dark at the listed widths plus narrow. In E2E, a guest asks with a note and the other participant sees the hint, a reload keeps the hints, and keyboard-only and narrow-viewport paths are covered.
