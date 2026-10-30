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

Suggested routing: F3, F4 and F5 are small fixes, probably without new spec
ceremony. F2 is a spec 003 amendment. F1 is a spec 002 amendment or a new spec.
F6 needs the question above answered first. F7 is a new spec. F8 is a spec 004
amendment. F9 is a new spec, possibly for a new app on the hub.
