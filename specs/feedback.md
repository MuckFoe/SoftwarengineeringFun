# Feedback inbox

Raw feedback from using the deployed app, not yet a spec. Each item says which
existing spec it touches and whether it's a bug (the app contradicts a spec) or
a change (a spec has to change first). Items leave this file when a
`/sdd-specify` run or a fix picks them up.

## 2026-10-29 — first use on the hub

| # | Feedback | Kind | Touches | Open questions |
|---|---|---|---|---|
| F3 | After sending a chat message, the input moves down. It should stay pinned to the bottom of the chat panel. | Bug | 003 FR-15 | — |
| F4 | Two identical icons at the top hide the panels, so you can't tell which hides which. | Bug | 003 FR-10, FR-1 (HIG) | — |
| F5 | Tab doesn't work correctly in the code editor. | Bug | 001 (editing), 003 FR-17 and the WCAG AA requirement | What happens now: focus leaves the editor, or the wrong indent width? Expected: Tab indents 4 spaces (Python), with some escape (e.g. Esc then Tab) so keyboard users aren't trapped. |
| F6 | No output window for runs, e.g. error messages. | Bug or change, depending on what's missing | 001 FR-22 (error per test with message and traceback), 001 out of scope: "showing printed output" | Is it errors that don't show (bug), or printed output (change)? Printed output was excluded on purpose: a solution could print the hidden tests' inputs. Also a syntax error that stops every test: one message instead of the same error per test? |
| F7 | Competitive sessions: everyone works on their own solution and sees the others' progress. | New feature | 001 (one shared solution per session) | Is it a session mode or a separate kind of session? What does "progress" show (tests passed, run count, finished time; never the code)? Is there a winner, a timer, or a ranking? Does the chat stay shared? |
| F9 | Interactive learning sessions on topics, as a whole new tab or site. The first two topics are Docker and Tailscale. | New feature | none (new product area); 004 if it becomes its own app on the hub | A section of this app, or its own app on the hub (e.g. `/learn/`, sharing sign-in)? What makes it interactive: step-by-step lessons with checks, quizzes, or hands-on commands? If hands-on, Docker and Tailscale commands can't run in today's sandbox (no network, no Docker inside); a simulated terminal, or real per-learner environments, which cost a lot on a 4 GB VM? Alone or together with others, like coding sessions? Is progress saved (then learners need accounts, see F8)? Who writes lessons, and how (editors in the app, or files in the repo)? |

## 2026-10-30 — chat message from "To" (session `26d6d17c`, 09:47 UTC, after the F5 fix went live at 09:29 UTC)

> When editing, tab does shift the entire line, even if the current cursor position is right of the the text. Pressing tab should only insert one tab (or 4 whitespaces) at the cursor position. Right now, if the editor suggests autocomplete, and the user presses tab to confirm the autocomplete suggestion, the spaces will also be added to the line. This should also not happen.
>
> Also, include a commandline, where std out will be visable for the user

| # | Feedback | Kind | Touches | Open questions |
|---|---|---|---|---|
| F10 | The F5 Tab fix is still wrong. (a) With no selection, Tab indents the whole line even when the cursor is after the text. It should insert 4 spaces at the cursor. (b) When an autocomplete suggestion is open, Tab should accept the suggestion and insert nothing else. Today it accepts the suggestion and also indents. | Bug (regression in the F5 fix) | 001 (editing), 003 FR-17, F5 | With a multi-line selection, should Tab still indent every selected line (editor convention)? Should Shift+Tab still dedent the line? Does the Esc-then-Tab escape from F5 stay? |
| F11 | A command-line style output panel where the user sees what their code prints (stdout). | Change (001 excluded printed output on purpose) | 001 FR-22 and out of scope "showing printed output"; F6 | This answers F6's question: printed output is wanted. How should hidden test inputs stay hidden: show stdout only for a "run my code" with the user's own input, not for the graded test run? Is stderr or the traceback shown in the same panel? Is it interactive (stdin), or output only? Is it shared live with everyone in the session? Is there a size or time limit? |

Suggested routing: F3, F4 and F5 are small fixes, probably without new spec
ceremony. F2 is a spec 003 amendment. F1 is a spec 002 amendment or a new spec.
F6 needs the question above answered first. F7 is a new spec. F8 is a spec 004
amendment. F9 is a new spec, possibly for a new app on the hub. F10 is a small fix to the F5 change once its questions are answered.
F11 is an amendment to 001 (or a new spec), and folds F6 into it.
