# 006 — Interactive learning sessions

Status: approved
Source: feedback inbox item F9 (2026-10-29, first use on the hub)

## Problem / Why

The app is used to learn together, but only by solving coding problems. People also want to learn tools and topics, starting with Docker and Tailscale, in the same way: a small group joins by link and works through a lesson together, and the lesson checks they understood each part before they move on. Reading docs alone doesn't check anything, and there's nowhere in the app to do this as a group. Learning sessions add a new area to the app: lessons made of explanation steps, quizzes and simulated terminal exercises that a group goes through together, with progress kept so the group can stop and continue later.

## Users

- **Learners**: anyone holding a learning session's invite link, with or without an account, the same as participants in a coding session (spec 001).
- **Lesson authors**: developers of this project, who write and change lessons as files kept with the project's source. There is no lesson editing in the app.
- **Admins**: the existing admin role, which looks after stale learning sessions the same way it does coding sessions.

## Terms

- **Topic**: a subject with one or more lessons, e.g. *Docker*, *Tailscale*.
- **Lesson**: an ordered list of steps on one topic.
- **Step**: one of three kinds:
  - *explanation*: formatted text and images, with an optional check;
  - *quiz*: a question with either multiple-choice options or a short free-text answer;
  - *terminal exercise*: a task the learner solves by typing a command into a simulated terminal.
- **Check**: what a step requires before the group may continue: the right quiz answer, or an accepted terminal command. An explanation step without a check passes when someone chooses Continue.
- **Simulated terminal**: a terminal look-alike in the page. It responds to commands with responses written in the lesson. Nothing is ever executed.
- **Learning session**: one group's run through one lesson, joined by invite link, holding the group's current step and history.

## Functional requirements

### Browsing lessons

- **FR-1** WHEN anyone opens the app THE SYSTEM SHALL offer a *Learn* area alongside the existing coding area, reachable from the main navigation.
- **FR-2** WHEN a visitor opens the Learn area THE SYSTEM SHALL list every topic with its lessons, each lesson showing its title, a one-line summary, its number of steps and an estimated duration.
- **FR-3** WHEN the app is first deployed with this feature THE SYSTEM SHALL include a starter set of four lessons per topic, in this order:
  - *Docker*: (1) Basics: images vs containers, run, ps, stop, rm, logs, exec; (2) Ports, volumes and networks: port publishing, bind mounts and volumes, user-defined networks; (3) Building images: Dockerfile, build, layers and cache, multi-stage builds, tags and registries; (4) Docker Compose: the compose file, up and down, services, environment, depends_on, volumes.
  - *Tailscale*: (1) Basics: the tailnet, installing, `tailscale up` and login, status, 100.x addresses, ping; (2) MagicDNS and sharing: MagicDNS names, sharing devices, serve and funnel; (3) ACLs and tags: the policy file, groups, tags, tests in the policy; (4) Exit nodes and subnet routers: advertising routes and exit nodes, approving them, using them.
- **FR-4** WHEN a lesson author adds, changes or removes a lesson file and the app is redeployed THE SYSTEM SHALL show the updated set of lessons, and nobody shall be able to create or change lessons from inside the app.
- **FR-5** IF a lesson file is malformed (e.g. a quiz without a correct answer, a terminal exercise without an accepted command) THE SYSTEM SHALL refuse to start with it and name the file and the problem, rather than show a broken lesson to learners.

### Starting and joining

- **FR-6** WHEN a person chooses a lesson and starts a learning session THE SYSTEM SHALL create a session at the lesson's first step and give them an invite link. Who may start one is the same rule that governs who may start a coding session (spec 001).
- **FR-7** WHEN someone opens a learning session's invite link THE SYSTEM SHALL let them join with a display name of at most 30 characters, without an account, the same as joining a coding session.
- **FR-8** WHEN a learning session already has 5 participants connected and a sixth person opens its link THE SYSTEM SHALL refuse the join and say the session is full.
- **FR-9** WHEN a participant joins THE SYSTEM SHALL show them the session's current step, the steps already passed, and who else is connected.

### Going through a lesson together

- **FR-10** WHILE a learning session is active THE SYSTEM SHALL show every participant the same current step, and update it for everyone within 1 second when it changes.
- **FR-11** WHEN any participant passes the current step's check THE SYSTEM SHALL mark the step passed, record who passed it, and move every participant to the next step.
- **FR-12** WHEN a participant submits a quiz answer or a terminal command THE SYSTEM SHALL show the attempt and its result (correct or not) to every participant, with the name of who made it.
- **FR-13** WHEN an answer or command is wrong THE SYSTEM SHALL say so, keep the group on the step and allow unlimited further attempts. IF the lesson gives a hint for that step THE SYSTEM SHALL let any participant reveal it, and the hint shows for everyone.
- **FR-14** THE SYSTEM SHALL NOT reveal a check's expected answer or accepted commands to participants before the step is passed, except through *Show answer* (FR-14a).
- **FR-14a** WHEN the group has made 3 wrong attempts on the current step THE SYSTEM SHALL offer *Show answer*; WHEN any participant uses it THE SYSTEM SHALL show the answer (for a terminal exercise, one accepted command) to every participant. Revealing does not pass the step: it passes only when someone then submits a correct answer, and the step is recorded as passed after the answer was revealed.
- **FR-15** WHEN a step has been passed THE SYSTEM SHALL let participants look back at it, with its content, the correct answer and the group's attempts. Looking back is read-only: the session's current step only moves forward, and a passed step cannot be redone.

### Quizzes

- **FR-16** WHEN a quiz step has multiple-choice options THE SYSTEM SHALL accept an answer when the selected options are exactly the correct set (the lesson says whether one or several options are correct).
- **FR-17** WHEN a quiz step takes a free-text answer THE SYSTEM SHALL accept any of the answers the lesson lists, ignoring letter case and leading or trailing spaces.

### Simulated terminal

- **FR-18** WHEN a terminal exercise is the current step THE SYSTEM SHALL show a simulated terminal with a prompt, and each participant types in their own input line, which others don't see while typing. Every submitted command and its output appear, with the submitter's name, in one terminal history shared by all participants (FR-12).
- **FR-19** WHEN a participant submits a command that the lesson accepts for the step THE SYSTEM SHALL show the lesson's output for that command and pass the step (FR-11).
- **FR-20** WHEN a participant submits a command that the lesson doesn't accept but lists with a response (e.g. a common mistake) THE SYSTEM SHALL show that response, and the step stays unpassed.
- **FR-21** WHEN a participant submits any other command THE SYSTEM SHALL answer with a message saying the command isn't available in this exercise, and the step stays unpassed.
- **FR-22** WHEN the system compares a submitted command with the lesson's commands THE SYSTEM SHALL ignore differences in whitespace between words and leading or trailing whitespace, and nothing else.
- **FR-23** THE SYSTEM SHALL never execute a submitted command, on the server or anywhere else; every output comes from the lesson.

### Finishing and keeping progress

- **FR-24** WHEN the last step of a lesson is passed THE SYSTEM SHALL mark the learning session completed and show every participant a completion summary: steps passed, attempts per step, and who passed each step.
- **FR-25** THE SYSTEM SHALL store each learning session durably — its lesson, current step, passed steps, attempts and participants' display names — so that it survives a restart, and opening the invite link later continues where the group stopped.
- **FR-26** WHEN a completed learning session's link is opened THE SYSTEM SHALL show the lesson with every step passed and its history, read-only.
- **FR-27** WHEN a learning session has had no activity for 30 days THE SYSTEM SHALL mark it stale and show it read-only, and an admin can reactivate it, the same as a coding session. Learning sessions are never deleted.
- **FR-28** WHEN a lesson changes or is removed after a learning session on it started THE SYSTEM SHALL keep that session on the version of the lesson it started with, through to completion and afterwards; only sessions started after the change use the new version.

### Chat

- **FR-29** WHILE a participant is in a learning session THE SYSTEM SHALL offer a participant chat with the same rules as a coding session's chat (spec 002): plain text, at most 2000 characters per message, stored durably with the session, read-only when the session is stale, and admins can remove messages.

## Non-functional requirements

- **NFR-1 Look and accessibility**: the Learn area follows spec 003: macOS look and feel per Apple's HIG, system/light/dark appearance, desktop widths ≥1024 px only, WCAG AA. The simulated terminal is fully usable by keyboard, and its output is available to screen readers.
- **NFR-2 Responsiveness**: a check result reaches every participant within 1 second of submission on the hub, under the 5-participant limit.
- **NFR-3 Resources**: the feature must fit within this app's existing memory budget on the hub (spec 005: ≤1 GB for the app), with no per-learner environment, container or process.
- **NFR-4 Security**: nothing typed into the simulated terminal or a quiz runs as code or reaches a shell. Submitted text is shown to other participants as plain text, never interpreted as markup.
- **NFR-5 Isolation**: learning sessions don't change anything about coding sessions: their rules, links, data and the admin tools for them behave exactly as before.
- **NFR-6 Durability**: no completed or in-progress learning session is lost by a restart or redeploy (FR-25).

## Out of scope

- Real environments: running real Docker or Tailscale commands, per-learner containers or VMs, or network access from lessons.
- Writing or editing lessons inside the app, and lesson authoring by anyone other than the project's developers.
- Personal progress per account (e.g. "lessons I've completed" across sessions). Progress belongs to the session.
- Going through a lesson alone in a mode without a session. A single person can still start a session and not share the link.
- A presenter or leader role; every participant has the same rights in a learning session.
- Each participant at their own pace inside one session.
- Self-registration of accounts (feedback F8).
- Running learning sessions as a separate app on the hub; this is a section of this app.
- Live shared typing in the simulated terminal.
- Rewinding a session to an earlier step.
- Scores, rankings, certificates or grading beyond pass/fail per step.
- Topics other than Docker and Tailscale in the starter set (more can be added later as lesson files).
- Mobile and narrow screens (consistent with spec 003).

## Acceptance criteria

**AC-1 (FR-1)** Given the app is running, when anyone opens it, then the main navigation has a *Learn* entry, and choosing it opens the Learn area.

**AC-2 (FR-2)** Given the starter set is deployed, when a visitor opens the Learn area, then *Docker* and *Tailscale* are listed, each with its lessons, and every lesson shows a title, a one-line summary, its step count and an estimated duration.

**AC-3 (FR-3)** Given a fresh deployment, when the Learn area is opened, then *Docker* lists the four lessons Basics; Ports, volumes and networks; Building images; Docker Compose, and *Tailscale* lists Basics; MagicDNS and sharing; ACLs and tags; Exit nodes and subnet routers, in that order; and each of the eight can be completed from first to last step, covering the subjects FR-3 names for it.

**AC-4 (FR-4)** Given a lesson file is added to the project and the app is redeployed, when the Learn area is opened, then the new lesson is listed; and given any signed-in user, including admins and editors, then there is no way in the app to create or change a lesson.

**AC-5 (FR-5)** Given a lesson file with a quiz that has no correct answer, when the app starts, then it refuses to start and the error names that file and the missing answer.

**AC-6 (FR-6)** Given a person allowed to start a coding session, when they choose a lesson and start a learning session, then a session exists at step 1 of that lesson and they get its invite link.

**AC-7 (FR-7)** Given a learning session's invite link, when someone without an account opens it and enters a 30-character display name, then they join; and when they enter a 31-character name, then the join is refused with a message about the length.

**AC-8 (FR-8)** Given a learning session with 5 connected participants, when a sixth person opens the link, then they don't join and see that the session is full.

**AC-9 (FR-9)** Given a session whose group has passed steps 1–3, when a new participant joins, then they see step 4 as current, steps 1–3 as passed, and the list of connected participants.

**AC-10 (FR-10, FR-11)** Given two participants on step 2, when participant A passes step 2's check, then both A and B are on step 3 within 1 second, and step 2 is recorded as passed by A.

**AC-11 (FR-12)** Given two participants on a quiz step, when A submits a wrong answer, then B sees A's name, the answer and "not correct".

**AC-12 (FR-13)** Given a step with a hint, when a wrong answer is submitted, then the group stays on the step and may try again; and when B reveals the hint, then A sees the hint too. Given a step without a hint, then no hint control is shown.

**AC-13 (FR-14)** Given a quiz or terminal step not yet passed, when a participant inspects everything the app has sent to their browser for that step, then the correct answer and accepted commands are not in it.

**AC-13a (FR-14a)** Given a quiz step with 2 wrong attempts, then *Show answer* is not offered; when a third wrong attempt is made, then it is offered to everyone; when B uses it, then A and B both see the answer and the group is still on the step; when A then submits the answer, then the step passes and is recorded as passed after the answer was revealed.

**AC-14 (FR-15)** Given step 2 has been passed and the group is on step 3, when a participant opens step 2 from the list of passed steps, then they see its content, the correct answer and every attempt made on it, nothing can be submitted there, and the group's current step is still 3.

**AC-15 (FR-16)** Given a multiple-choice quiz with correct options B and D, when a participant submits B and D, then the step passes; when they submit only B, or B, C and D, then it doesn't.

**AC-16 (FR-17)** Given a free-text quiz accepting "container", when a participant submits "  Container ", then the step passes; when they submit "containers", then it doesn't.

**AC-17 (FR-18)** Given a terminal exercise is the current step with participants A and B, when A types a command without submitting it, then B doesn't see it; when A submits it, then both see it in the shared terminal history with A's name and its output.

**AC-18 (FR-19)** Given a terminal exercise accepting `docker ps`, when a participant submits `docker ps`, then the lesson's output for it is shown and the group moves to the next step.

**AC-19 (FR-20)** Given a terminal exercise accepting `docker ps` that lists `docker ls` with a response explaining the mistake, when a participant submits `docker ls`, then that response is shown and the step stays unpassed.

**AC-20 (FR-21)** Given the same exercise, when a participant submits `rm -rf /`, then the terminal says the command isn't available in this exercise and the step stays unpassed.

**AC-21 (FR-22)** Given a terminal exercise accepting `docker run -p 8080:80 nginx`, when a participant submits `  docker  run -p 8080:80   nginx `, then the step passes; when they submit `docker run -p 8080:80 NGINX` or `docker run nginx -p 8080:80`, then it doesn't.

**AC-22 (FR-23, NFR-4)** Given any terminal exercise, when a participant submits a command that would have a side effect if run (e.g. one that creates a file), then no process is started and nothing on the server changes.

**AC-23 (FR-24)** Given the group is on the last step, when it's passed, then every participant sees a completion summary listing each step, its attempt count and who passed it, and the session is marked completed.

**AC-24 (FR-25, NFR-6)** Given a group that has passed steps 1–3 of a lesson, when the app is restarted and the invite link opened again, then the session is on step 4 with steps 1–3 and their attempts intact.

**AC-25 (FR-26)** Given a completed learning session, when its link is opened, then every step shows as passed with its history, and no answer or command can be submitted.

**AC-26 (FR-27)** Given a learning session with no activity for 30 days, when its link is opened, then it is read-only and marked stale; when an admin reactivates it, then participants can submit again from the step where the group stopped.

**AC-27 (NFR-1)** Given the Learn area in light and in dark appearance at 1024 px wide, when it's checked against WCAG AA, then it passes; and a participant can focus the terminal, type, submit and read the output using only the keyboard.

**AC-28 (NFR-4)** Given a participant submits `<b>hi</b>` as a quiz answer or a command, when others see the attempt, then it shows as the literal text `<b>hi</b>`.

**AC-29 (NFR-5)** Given the existing coding-session test suite, when it runs with this feature in place, then it passes unchanged.

**AC-30 (NFR-3)** Given the app on the hub with three learning sessions of 5 participants each in progress, when memory is measured, then the app stays within its 1 GB budget, and no container or process was started per learner.

**AC-31 (FR-28)** Given a session on step 3 of a 10-step lesson, when the lesson file is changed to remove step 5 and the app is redeployed, then that session still has 10 steps with its progress intact, and a session started afterwards has 9.

**AC-32 (FR-29)** Given two participants in a learning session, when A sends a chat message of 2000 characters, then B sees it; when A tries to send 2001 characters, then it is refused; when an admin removes the message, then it disappears for both; and given the session is stale, then the chat is read-only.

## Open questions

None. Resolved 2026-10-29: starter set is four lessons per topic (FR-3); *Show answer* after 3 wrong attempts, not itself passing (FR-14a); looking back is read-only (FR-15); own terminal input, shared history (FR-18); sessions keep their lesson version (FR-28); chat as in spec 002 (FR-29).

Defaults taken without asking, to confirm or change at approval: joining, the 5-participant limit, 30-character names, 30-day staleness and admin reactivation mirror coding sessions (spec 001); who may start a learning session follows whatever rule applies to coding sessions; wrong answers can be retried without limit (with *Show answer* after 3, FR-14a); hints are optional per step; command matching ignores only whitespace (FR-22), so a correct command with flags in a different order fails unless the lesson lists that order as accepted too.
