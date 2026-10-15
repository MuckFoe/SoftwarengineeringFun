# 001 — Collaborative coding sessions

Status: approved

## Problem / Why

Practising algorithm problems (LeetCode-style) is usually solitary, and pairing on one means screen-sharing, where only one person can type. People who want to solve problems *together* need a shared place to pick a problem, all edit the same solution at the same time, run it safely, and find out objectively whether it is correct. Problems should not depend on a third-party catalogue. Editors maintain a shared catalogue of problems with hidden tests, and a starter set means the site is useful on day one.

## Users

- **Session participants:** anyone with an invite link. They need no account, only a display name. A session holds at most 5 participants at a time.
- **Admins:** single sign-on users holding the admin role. Their only power on this site is reactivating stale sessions.
- **Session creator:** whoever starts a session. They need no account and have no extra privileges beyond creating it.
- **Editors:** people with an account in the organisation's existing single sign-on who hold the editor role. Any editor can create, edit and delete any problem, including the starter problems, and can see every problem's tests. Accounts and roles are created and managed in the single sign-on, not on this site, so the same login works across the organisation's applications.

## Functional requirements

### Accounts

- **FR-1** WHEN a visitor who is not signed in tries to create a problem THE SYSTEM SHALL send them to sign in through the organisation's single sign-on, and not create the problem until they have.
- **FR-2** WHEN a user signs in through single sign-on and holds the editor role THE SYSTEM SHALL let them create problems, and edit or delete any problem.
- **FR-2a** WHEN a user signs in through single sign-on without the editor role THE SYSTEM SHALL refuse problem creation, editing and deletion, and tell them they lack the required role.
- **FR-2b** WHEN a user is already signed in to another application on the same single sign-on THE SYSTEM SHALL sign them in without asking for their credentials again.

### Problems

- **FR-3** WHEN an editor submits a new problem with a title, a description, a Python function signature and at least one test THE SYSTEM SHALL save it, recording which editor created it, and make it findable by everyone.
- **FR-4** WHEN an editor submits a problem with no tests, or with a test that doesn't match the function signature, THE SYSTEM SHALL reject it and say which part is invalid.
- **FR-5** WHEN anyone searches problems by text THE SYSTEM SHALL list the problems whose title or description match.
- **FR-6** WHEN the system is first made available THE SYSTEM SHALL already contain a starter set of 20 problems, mostly easy, covering mixed topics, each with a description and tests written for this project (not copied from another site).
- **FR-7** WHEN an editor edits any problem, including a starter problem, THE SYSTEM SHALL let them view and change its title, description, signature and tests.
- **FR-8** WHEN an editor deletes any problem, including a starter problem, THE SYSTEM SHALL remove it from search and stop new sessions being started for it.
- **FR-9** WHEN anyone without the editor role tries to edit or delete a problem, or to view its tests, THE SYSTEM SHALL refuse.
- **FR-10** WHEN a session is on a problem that has been deleted THE SYSTEM SHALL keep the session's code, tell participants the problem was deleted, refuse new runs for it, and still let participants switch to another problem.

A **test** is a set of input arguments for the function signature together with the expected return value. Tests are **hidden**: only editors ever see them.

### Sessions

- **FR-11** WHEN anyone starts a session for a chosen problem THE SYSTEM SHALL create the session with a unique, hard-to-guess invite ID and show a shareable invite link.
- **FR-12** WHEN a visitor opens a valid invite link of a session with fewer than 5 participants present THE SYSTEM SHALL ask for a display name and then add them to that session.
- **FR-12a** WHEN a visitor enters a display name that is empty (after trimming spaces) or longer than 30 characters THE SYSTEM SHALL refuse it, say why, and let them enter another.
- **FR-13** WHEN a visitor opens a valid invite link of a session that already has 5 participants present THE SYSTEM SHALL tell them the session is full and not add them.
- **FR-14** WHEN a visitor opens an invite link whose ID doesn't exist THE SYSTEM SHALL say the session wasn't found and not reveal anything about other sessions.
- **FR-15** WHILE participants are in a session THE SYSTEM SHALL show every participant the list of who is currently present.
- **FR-16** WHEN a session is first put on a problem THE SYSTEM SHALL pre-fill the shared editor with the problem's function signature as a starting point.
- **FR-17** WHEN any participant switches the session to a different problem THE SYSTEM SHALL move every participant to that problem. It keeps the code and results the session had for the previous problem, so switching back restores them.

### Collaborative editing

- **FR-18** WHEN any participant edits the solution code THE SYSTEM SHALL show the change to every other participant in the session within the latency limit in NFR-1.
- **FR-19** WHEN two or more participants edit at the same time THE SYSTEM SHALL merge their edits so that every participant ends up seeing identical code and no participant's edit is silently lost.
- **FR-20** WHILE participants edit THE SYSTEM SHALL show where each of the other participants is editing, labelled with their display name.

### Running and verifying

- **FR-21** WHEN any participant runs the code THE SYSTEM SHALL execute the current shared code against the problem's hidden tests inside an isolated environment and show the result to every participant in the session.
- **FR-22** WHEN a run completes THE SYSTEM SHALL report, per test (identified only by its number), one outcome: *passed*, *wrong answer*, *error* (with the exception message and traceback), *time limit exceeded* or *memory limit exceeded*. It never shows the test's inputs, its expected value, the actual returned value, or anything the code printed.
- **FR-23** WHEN every test of the problem passes in one run THE SYSTEM SHALL mark that problem as accepted in the session, visible to all participants.
- **FR-24** WHEN running code exceeds the time limit or memory limit THE SYSTEM SHALL stop it and report which limit was exceeded. The same limits apply to every problem.
- **FR-25** WHEN running code attempts network access, writing files outside its own scratch space, reading any host file, reading the tests or other sessions' data, or any other interaction with the host THE SYSTEM SHALL block the attempt so that it has no effect outside that run. Reading the run environment's own read-only files, such as the Python standard library, is allowed.
- **FR-26** WHILE a run for a session is in progress THE SYSTEM SHALL show all participants that a run is in progress and not start a second run for that session.

### Persistence

- **FR-27** WHEN anything happens in a session (an edit, a run, a problem switch, a participant joining) THE SYSTEM SHALL store it durably, so that it survives every participant leaving and the system restarting. This covers the current code for every problem the session has used, every run with the code it ran and its per-test results, accepted status, the session's current problem, and the display names of everyone who joined.
- **FR-28** WHEN anyone opens the invite link of a session everyone has left THE SYSTEM SHALL restore it with its current problem, code, run results and accepted status.
- **FR-29** WHEN a session has had no activity for 30 days THE SYSTEM SHALL mark it as stale. It never deletes the session or any of its stored data.
- **FR-30** WHEN anyone without the admin role opens the invite link of a stale session THE SYSTEM SHALL say that the session is stale and only an admin can reactivate it, and not let them join, edit or run.
- **FR-31** WHEN a user signed in through single sign-on with the admin role opens the invite link of a stale session THE SYSTEM SHALL offer to reactivate it.
- **FR-32** WHEN an admin reactivates a stale session THE SYSTEM SHALL clear the stale mark and restore it to normal, with all of its stored data, so that anyone with the link can join again. Its 30-day inactivity period starts again.

## Non-functional requirements

- **NFR-1** Latency: an edit appears for other participants within 500 ms under normal network conditions.
- **NFR-2** Isolation: a run can't read or change the tests, another session's data, other runs, account data, or the host. It has no network access. CPU time, wall time, memory, output size and process count are all limited, with the same limits for every problem.
- **NFR-3** Run time: a correct solution to a starter problem returns its full result within 10 seconds of the user clicking "run".
- **NFR-4** Access: the invite ID is the only thing that grants access to a session. It must be long enough and random enough that guessing an existing one isn't feasible.
- **NFR-5** Test secrecy: tests are never sent to anyone except editors. A known, accepted leak: an exception message in an *error* outcome may contain a value taken from a test input.
- **NFR-6** Language: solutions are written in Python only.
- **NFR-7** No secrets: following the constitution, no credentials ever appear in the repository, including the starter problem set.
- **NFR-8** Identity: the site never stores or handles user passwords. Authentication and role assignment come only from the organisation's single sign-on, which is currently the self-hosted Keycloak instance on the local server.
- **NFR-9** Durability: no session data is ever deleted automatically. Storage grows without limit, and that is accepted for v1.

## Out of scope

- Accounts for session participants or creators. Sign-in exists only for editors and admins.
- Registration, password handling, profiles and role management on this site. All of that lives in the single sign-on.
- Admin features beyond reactivating a stale session from its invite link, such as listing or searching sessions.
- Moderation of problems: no reporting, review or takedown in v1.
- Any solution language other than Python.
- **The diagram / visual low-code canvas.** That is a separate future feature with its own spec.
- Text, voice or video chat inside a session.
- Running code against custom inputs, or showing printed output.
- Importing or scraping problems from LeetCode or other sites.
- Rankings, leaderboards, contests, scoring by speed.
- Problem ratings and comments.
- Per-problem time or memory limits.
- Undo, and browsing or restoring older code versions in the interface. Runs are stored with their code (FR-27), but v1 offers no history view.
- Manual deletion of sessions.
- Abuse protection: rate limiting, brute-force protection and spam controls. This is a private tool.

## Acceptance criteria

**FR-1**
Given a visitor who is not signed in
When they open "new problem"
Then they are sent to the single sign-on login, and no problem is created.

**FR-2**
Given a single sign-on user who holds the editor role
When they sign in and open "new problem", or open edit on any existing problem
Then the form is available to them.

**FR-2a**
Given a single sign-on user without the editor role
When they sign in and open "new problem", or try to edit or delete a problem
Then they are told they lack the required role, and nothing is created or changed.

**FR-2b**
Given a user already signed in to another application on the same single sign-on
When they open "new problem" on this site
Then they reach the form without entering credentials again.

**FR-3**
Given an editor on the "new problem" form
When they submit title "Sum two", a description, signature `def add(a: int, b: int) -> int` and the test `(2, 3) → 5`
Then the problem is saved with them recorded as its creator, and a search for "Sum two" lists it.

**FR-4**
Given an editor on the "new problem" form
When they submit a problem with zero tests
Then it is not saved and the message names the missing tests.
And when they submit a test with three arguments for a two-parameter signature
Then it is not saved and the message identifies that test.

**FR-5**
Given problems titled "Two targets" and "Reverse list" exist
When a visitor searches "reverse"
Then "Reverse list" is listed and "Two targets" is not.

**FR-6**
Given a fresh installation with no user-created problems
When a visitor lists all problems
Then exactly the 20 starter problems are shown, spanning more than one topic, and every one has at least one test.
And a correct reference solution to each starter problem passes all of its tests.

**FR-7**
Given editor Ada created "Sum two" with one test, and Linus is also an editor
When Linus edits it and adds the test `(0, 0) → 0`
Then Linus sees all of its tests including the new one, and the next run in any session on "Sum two" executes 2 tests.
And when an editor edits a starter problem's description, the change is saved.

**FR-8**
Given editor Ada created "Sum two", and Linus is also an editor
When Linus deletes it
Then a search for "Sum two" no longer lists it, and no new session can be started for it.
And when an editor deletes a starter problem, it disappears from search in the same way.

**FR-9**
Given a problem "Sum two", a visitor who is not signed in, and a signed-in user without the editor role
When either of them tries to edit it, delete it, or view its tests
Then each attempt is refused and nothing changes.

**FR-10**
Given a session on "Sum two" with code `return a + b`
When an editor deletes "Sum two"
Then participants still see `return a + b`, are told the problem was deleted, cannot run it, and can switch to another problem.

**FR-11**
Given a visitor without an account, viewing a problem
When they start a session
Then they are in a new session for that problem and see an invite link containing an ID no other session has.

**FR-12**
Given a session with 1 participant
When a second visitor opens its invite link and enters the display name "Ada"
Then they are in the session and both participants' presence lists show "Ada".

**FR-12a**
Given a visitor opening a valid invite link
When they enter an empty name, or a name of 31 characters
Then the name is refused with a reason, and they are not added until they enter a name of 1–30 characters.

**FR-13**
Given a session with 5 participants present
When a sixth visitor opens its invite link
Then they are told the session is full, and the presence list still shows 5 participants.

**FR-14**
Given no session has ID `doesnotexist`
When a visitor opens the invite link for `doesnotexist`
Then they see "session not found" and are not placed in any session.

**FR-15**
Given participants "Ada" and "Linus" are in a session
When "Linus" leaves
Then within a few seconds Ada's presence list no longer shows "Linus".

**FR-16**
Given a problem with signature `def add(a: int, b: int) -> int`
When a session is started for it
Then the shared editor contains that signature as starter code.

**FR-17**
Given Ada and Linus are in a session on "Sum two" with code `return a + b`
When Ada switches the session to "Reverse list"
Then both see "Reverse list" with its starter code.
And when Linus switches back to "Sum two"
Then both see `return a + b` again, with its previous results.

**FR-18**
Given Ada and Linus are in the same session
When Ada types `return a + b`
Then Linus's editor shows `return a + b` within 500 ms.

**FR-19**
Given Ada and Linus are in the same session with identical code
When both type on different lines at the same moment
Then afterwards both editors show identical code containing both edits.

**FR-20**
Given Ada and Linus are in the same session
When Linus places his cursor on line 3
Then Ada sees a marker on line 3 labelled "Linus".

**FR-21**
Given Ada and Linus are in a session
When Ada clicks run
Then both Ada and Linus see the same run result.

**FR-22**
Given a problem with tests `(2, 3) → 5` and `(1, 1) → 2`, and shared code that prints `a` and returns `a * b`
When a participant runs it
Then test 1 shows *wrong answer* and test 2 shows *wrong answer*, and nowhere on the page do `2, 3`, `5`, `6`, `1, 1` or the printed output appear.
And when the code instead raises `ValueError("bad")`, each test shows *error* with the message `bad` and a traceback.

**FR-23**
Given shared code that returns `a + b` for the problem above
When a participant runs it
Then all tests show *passed* and every participant sees the problem marked accepted in the session.

**FR-24**
Given shared code containing an infinite loop
When a participant runs it
Then the run is stopped and reports *time limit exceeded*.
And given code that allocates memory without bound, the run is stopped and reports *memory limit exceeded*.

**FR-25**
Given shared code that tries to open a network connection, write a file outside its scratch space, read a host file, or read or modify the problem's tests
When a participant runs it
Then the attempt fails inside the run, and afterwards the tests, other sessions and the host are unchanged.

**FR-26**
Given a run is in progress in a session
When another participant clicks run
Then no second run starts and every participant sees a "running" indicator until the first run finishes.

**FR-27**
Given a session where Ada and Linus joined, ran `return a * b` (failed), then ran `return a + b` (accepted)
When every participant leaves and the system is restarted
Then the stored session still holds both runs, each with its code and per-test results, the current code `return a + b`, the accepted status, and the display names Ada and Linus.

**FR-28**
Given the session from FR-27, which everyone has left
When anyone opens its invite link 29 days later
Then the editor shows `return a + b` and the problem shows as accepted.

**FR-29**
Given a session whose last activity was 31 days ago
When the system checks session activity
Then the session is marked stale, and all of its stored data is still present.

**FR-30**
Given a stale session
When a visitor without the admin role opens its invite link
Then they see that the session is stale and only an admin can reactivate it, and they are not placed in the session.

**FR-31**
Given a stale session
When a user with the admin role, signed in through single sign-on, opens its invite link
Then they are offered "reactivate".

**FR-32**
Given a stale session with code `return a + b`, opened by an admin
When the admin reactivates it
Then it is no longer stale, and a visitor opening the link joins normally and sees `return a + b`.

## Open questions

None. Every question has been resolved.
