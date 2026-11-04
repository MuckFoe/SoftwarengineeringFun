# 011 — Run the solution on your own input and see what it prints

Source: feedback F11, which also answers F6 (`specs/feedback.md`), from a participant's chat message on 2026-10-30: "include a commandline, where std out will be visable for the user". Amends 001: its exclusion of "showing printed output" stays for test runs. This spec adds a separate kind of run where printed output is shown.

## Problem / Why

Participants can only find out what their solution does by running the tests, which report pass or fail and errors, never what the code prints. You can't debug with `print`, try a function on an input of your own, or see the output of code that isn't finished yet. Printed output was kept out of test runs on purpose: a solution could print the hidden tests' inputs. A separate run, on input the participant types and with no tests involved, gives them the output without exposing anything hidden.

## Users

- **Participants** in a coding session who want to see what their solution prints.
- **The other participants** in the same session, who follow the run as they follow test results today.

## Functional requirements

- **FR-1** WHEN a participant starts a *Run* THE SYSTEM SHALL run the session's current solution once, with the input text the participant entered as its standard input, and with no tests.
- **FR-2** WHILE a run is in progress THE SYSTEM SHALL show its printed output (standard output) in an output panel as it is produced.
- **FR-3** WHEN a run writes to standard error or ends with an uncaught error THE SYSTEM SHALL show that text in the same panel, visibly distinct from standard output.
- **FR-4** WHEN a run ends THE SYSTEM SHALL show how it ended: finished, failed with an error, or stopped at a limit.
- **FR-5** WHEN a run is started, is in progress or ends THE SYSTEM SHALL show the same output and status live to every participant in the session, together with who started it.
- **FR-6** WHEN the solution reads more input than was entered THE SYSTEM SHALL give it end of input. Nothing typed during the run reaches the program.
- **FR-7** WHEN a run exceeds the time limit or the output limit THE SYSTEM SHALL stop it (time) or stop showing further output (size), and say which limit was reached.
- **FR-8** WHEN a new run starts THE SYSTEM SHALL replace the previous run's output in the panel.
- **FR-9** WHEN a run is started while another run of the same session is in progress THE SYSTEM SHALL refuse it with a message naming who started the run in progress, and leave that run untouched. *Run* stays unavailable to everyone until the run ends.
- **FR-10** WHEN a participant joins or reloads the session THE SYSTEM SHALL show the session's last run: its input, its output so far (or all of it), its status and who started it. Only the last run is kept; it is stored durably with the session.
- **FR-11** WHEN tests are run THE SYSTEM SHALL keep showing no printed output from them (001 unchanged).
- **FR-12** WHEN a session is read-only (stale) THE SYSTEM SHALL not offer *Run*, as it doesn't offer test runs.

## Non-functional requirements

- **NFR-1 (isolation)** A run gets the same isolation as a test run (001): no network, no access to other sessions or to the hidden tests, and the same CPU, memory and time limits.
- **NFR-2 (no leak)** Nothing a run receives or can read contains a hidden test's input or expected output.
- **NFR-3 (output limit)** A run's output shown in the panel is capped at 64 KB, standard output and errors together.
- **NFR-4 (safe display)** Output and input are shown as plain text. Markup or control sequences in them are never interpreted.
- **NFR-5 (latency)** On the hub, printed output reaches every participant's panel within 1 s of being written.

## Out of scope

- Interactive input while the program runs (a real terminal or shell).
- Printed output from test runs, hidden or visible.
- Running anything other than the session's solution (other files, shell commands, installing packages).
- A history of past runs: only the last run is kept (FR-10).
- Learning sessions (006) and their simulated terminal.

## Acceptance criteria

- **FR-1** — Given a solution that prints `input()` twice and the input `3` and `4` on two lines, When a participant starts *Run*, Then the panel shows `3` and `4`, And no test result changes.
- **FR-2** — Given a solution that prints `a`, sleeps 2 s, then prints `b`, When it runs, Then `a` appears in the panel before `b` is printed.
- **FR-3** — Given a solution that raises `ValueError("bad")`, When it runs, Then the panel shows the traceback with `ValueError: bad`, styled differently from standard output.
- **FR-4** — Given runs that finish, raise and loop forever, When each ends, Then the panel says *finished*, *error* and *stopped: time limit* respectively.
- **FR-5** — Given participants A and B in one session, When A starts *Run*, Then B sees the same output as it is produced, And B sees that A started it.
- **FR-6** — Given a solution that calls `input()` with no input entered, When it runs, Then it gets end of input (`EOFError`), And the run ends instead of waiting.
- **FR-7** — Given a solution that prints in an endless loop, When it runs, Then output stops at the output limit, And the panel says the output limit was reached, And the run is stopped no later than the time limit.
- **FR-8** — Given a finished run with output `old`, When a new run printing `new` starts, Then the panel shows only `new`.
- **FR-9** — Given A's run is in progress, When B tries to start *Run*, Then B's run doesn't start, And B sees that A's run is in progress, And A's output keeps arriving unchanged. When A's run ends, Then *Run* is available to both again.
- **FR-10** — Given A ran the solution with input `3`, which printed `9`, When C joins the session afterwards (or A reloads), Then C's panel shows input `3`, output `9`, status *finished* and that A started it. Given a run that is still in progress, When C joins, Then C sees the output so far, followed by the rest as it is produced. Given the hub restarts after a run finished, When A reopens the session, Then the last run is still shown.
- **FR-11** — Given a solution that prints a hidden test's argument, When the tests are run, Then no printed output appears anywhere for that test run.
- **FR-12** — Given a stale session, When a participant opens it, Then there is no way to start *Run*.
- **NFR-3** — Given a solution that prints 100 KB, When it runs, Then the panel shows the first 64 KB, And says the output limit was reached.
- **NFR-1** — Given a solution that opens a network connection, When it runs, Then the connection fails, as in a test run.
- **NFR-2** — Given a solution that searches the file system and environment for the hidden tests, When it runs, Then it finds none of their inputs or expected outputs.
- **NFR-4** — Given a solution that prints `<b>x</b>` and an ANSI color sequence, When it runs, Then the panel shows those characters literally.

## Open questions

None. Decided on 2026-10-30: a second run is refused while one is in progress (FR-9); the last run is stored with the session and shown on join and reload (FR-10); output is capped at 64 KB (NFR-3).
