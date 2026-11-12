# 011 — notes

## 2026-11-12 change

At the user's request ("the icon to run something is an edit icon … i don't want to run an input, i want to run what i coded"), implemented directly without a new spec:

- **Run** (toolbar, play icon, primary; ⌘↩ / Ctrl+Enter, "Run code") runs the session's code as a script with empty standard input (`scratch_run` with `input: ""`). Its status, starter and full output, stdout and stderr/tracebacks (marked `stderr ▸`), plain text (NFR-4), show in the bottom panel's **Output** tab.
- **Check** (toolbar, checkmark icon, bordered; ⇧⌘↩ / Ctrl+Shift+Enter, "Check solution") runs the hidden tests (the `run` message); results show in the **Tests** tab.
- The own-input box and the pencil "own-input run" toggle are removed. Old stored runs that carry an input still show their output; the input is not shown.
- Starting Run selects Output and starting Check selects Tests, for every participant (on `scratch_run_started` / `run_started`), and opens the bottom panel locally if it was hidden. A fresh join opens on Tests when a check is in progress, or when the problem has test results and the session has no script run; otherwise on Output.
- Both are disabled for a deleted problem and in a stale session; Run is busy while a script run is starting or running, Check while tests run.
- Backend unchanged (stderr was already captured and streamed); a ws test now covers an empty-input run that prints and raises.
- An error status now names the exit code, e.g. "error (exit code 1) · started by A".
