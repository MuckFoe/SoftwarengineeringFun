# 011 — Run the solution on your own input: tasks

Resolved against the code while tasking (the plan was written without reading it):

- **A1 does not hold.** `runner/service.py` + `sandbox/harness.py` run one *test case* per fresh interpreter, discard the solution's output, take no stdin and return one JSON reply at the end. A streaming, stdin-fed, no-tests mode is new work (tasks 2, 3, 4). The 3 s wall limit and the rlimits are the harness's existing constants and are reused (NFR-1, FR-7).
- **Names.** `backend/app/runs/` and `RunPanel.tsx` already mean *test runs*. The plan's `runs` unit, `session_run` table and `RunPanel` are named **`scratch`** here: `backend/app/scratch/`, `session_scratch_run`, `ScratchPanel.tsx`.
- **Message names** follow the session channel's existing snake_case (`run_started`, `run_finished`): the plan's `run.start` / `run.started` / `run.output` / `run.end` / `run.refused` become `scratch_run` (client→server), `scratch_run_started`, `scratch_run_output`, `scratch_run_end`, `scratch_run_refused`. The welcome message (A2) gains a `scratch_run` field.
- **A3** (proxy passes the channel unbuffered) is covered by the existing live channel; task 13 measures it (NFR-5). **A4** holds: `_RUNNING` in `sessions/ws.py` is already an in-process registry.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 5, 9, 10 — all `[P]` | Five disjoint foundations with no prerequisite: pure output buffer, sandbox stdin mode, migration + repository, and the two pure frontend modules. |
| 2 | 3, 11 — all `[P]` | 3 needs the sandbox mode (2); 11 needs the frontend modules (9, 10). Disjoint files. |
| 3 | 4 | The backend sandbox client needs the runner endpoint (3) and the buffer's decoding rules (1). |
| 4 | 6 | The manager joins buffer (1), sandbox client (4) and repository (5). |
| 5 | 7, 8 — all `[P]` | Channel handlers (`ws.py`) and the startup reconcile (`main.py`) both need only the manager. Disjoint files. |
| 6 | 12, 14 — all `[P]` | 12 wires the panel into the session screen (needs 7 and 11); 14 is backend-only security/isolation tests (needs 7). Disjoint files. |
| 7 | 13 | End-to-end needs the whole path on screen (12). |

## Checklist

- [x] **1** — `[P]` `OutputBuffer` and incremental decoding (pure)
- [x] **2** — `[P]` Sandbox harness: stdin run mode with separate stdout/stderr
- [x] **3** — `[P]` Runner: streaming `/execute-stream` endpoint
- [x] **4** — `RunSandbox`: backend streaming client
- [x] **5** — `[P]` Migration and `RunRepository` for `session_scratch_run`
- [x] **6** — `RunManager`: claim, stream, cap, batch, persist
- [x] **7** — `[P]` Session channel: `scratch_run` handler, refusals, welcome snapshot
- [x] **8** — `[P]` Startup reconcile of interrupted runs
- [x] **9** — `[P]` `visibleText` (pure)
- [x] **10** — `[P]` `scratchReducer` (pure)
- [x] **11** — `[P]` `ScratchPanel` component
- [x] **12** — `[P]` Wire `ScratchPanel` into the session screen
- [x] **13** — E2E: live view, refusal, status text, stale, safe display, latency
- [x] **14** — `[P]` Integration: isolation, no leak, test runs unchanged

## Tasks

### 1. `[P]` `OutputBuffer` and incremental decoding (pure)

- **Plan:** `OutputBuffer`; the incremental UTF-8 decoder of `RunSandbox`. **Spec:** FR-3, FR-7, NFR-3.
- **Files:** `backend/app/scratch/__init__.py`, `backend/app/scratch/output.py`, `backend/tests/unit/test_scratch_output.py`
- **Depends on:** nothing
- **Do:** Tests first, then `OutputBuffer` (`append(stream, text) -> accepted`, `segments`, `size` in UTF-8 bytes, `truncated`, 64 KB cap shared by both streams, cut at a character boundary, no growth after truncation, same-stream pieces merged) and a small `StreamDecoder` wrapping `codecs.getincrementaldecoder("utf-8")(errors="replace")` for feeding raw bytes per stream. Constants (`OUTPUT_LIMIT_B = 64 * 1024`) live here.
- **Acceptance:**
  - *NFR-3 — Given a solution that prints 100 KB, when it runs, then the panel shows the first 64 KB and says the output limit was reached.* Unit: appending 100 KB in pieces yields exactly 64 KB (`size == 65536`), `truncated` is true, later appends return `""`.
  - *NFR-3 — multi-byte characters count in bytes.* Unit: the cap falls inside a 3-byte character; the accepted text ends before it and is valid UTF-8.
  - *FR-3 — stdout and errors are kept apart.* Unit: `out`, `err`, `err`, `out` gives three segments, the two `err` pieces merged.
  - *Decoding — a chunk boundary never splits a character.* Unit: the bytes of `é` fed one byte at a time decode to `é` with no replacement character.

### 2. `[P]` Sandbox harness: stdin run mode with separate stdout/stderr

- **Plan:** `RunSandbox` ("no tests" mode of the existing sandbox). **Spec:** FR-1, FR-6, FR-7, NFR-1, NFR-2.
- **Files:** `sandbox/harness.py`, `backend/tests/integration/test_sandbox_scratch_mode.py`
- **Depends on:** nothing
- **Do:** Tests first (run the real sandbox image with `docker run -i`). Add a mode selected by the first stdin JSON (`{"mode": "scratch", "code": str, "stdin": str}`) that runs `code` as `solution.py` in a fresh interpreter, with the same rlimits, non-dumpable parent, wall limit and no network as the case mode. The child's stdin is the given text, then EOF; its stdout and stderr are passed through to the container's stdout and stderr unmerged and unbuffered. Wall-limit overrun kills the child and exits with a distinct code (time limit). The mode's request has no field for tests or cases. The sandbox image must be rebuilt for the test.
- **Acceptance:**
  - *FR-1 — Given a solution that prints `input()` twice and the input `3` and `4` on two lines, when it runs, then the container's stdout is `3` and `4` on two lines.*
  - *FR-6 — Given a solution that calls `input()` with no input entered, when it runs, then it gets `EOFError` and the container exits at once, not at the wall limit.*
  - *FR-3 — Given a solution that raises `ValueError("bad")`, when it runs, then the container's stderr contains the traceback with `ValueError: bad` and stdout is empty.*
  - *FR-7 — Given a solution that loops forever, when it runs, then the container exits with the time-limit code at about the wall limit.*
  - *NFR-1 — Given a solution that opens a network connection, when it runs, then the connection fails.*

### 3. `[P]` Runner: streaming `/execute-stream` endpoint

- **Plan:** `RunSandbox` (transport between hub and sandbox). **Spec:** FR-2, FR-7, NFR-1, NFR-5.
- **Files:** `runner/service.py`, `backend/tests/integration/test_runner_stream.py`
- **Depends on:** 2
- **Do:** Tests first (real runner, real sandbox). Add `POST /execute-stream` taking `{code, stdin}`; start the sandbox container with the same `docker_command` limits as `/execute` (including the concurrency slot) and answer with a chunked NDJSON body: `{"s": "out"|"err", "b": "<base64 bytes>"}` lines as bytes arrive on each pipe (read the two pipes concurrently, flush per chunk), then one `{"end": "exited", "code": n}` or `{"end": "time_limit"}` line. When the client closes the connection, remove the container (the hub does this to stop a run at the output cap). Infrastructure failure before the first byte answers 503 as `/execute` does. `/execute` is unchanged.
- **Acceptance:**
  - *FR-2 — Given a solution that prints `a`, sleeps 2 s, then prints `b`, when it runs, then `a` arrives in the response before `b` is printed.* The test reads lines as they arrive and asserts the `a` line is received before the sandbox has run for 2 s and before the `end` line.
  - *FR-7 — Given a solution that prints in an endless loop, when the client closes the connection early, then the container is gone within a few seconds.* Checked with `docker ps` by the runner's label.
  - *FR-7 — Given a solution that loops silently, when it runs, then the last line is `{"end": "time_limit"}`.*
  - *Existing behaviour — `/execute` still returns the same replies.* The existing runner tests stay green.

### 4. `RunSandbox`: backend streaming client

- **Plan:** `RunSandbox`. **Spec:** FR-1, FR-2, FR-3, FR-4, FR-7.
- **Files:** `backend/app/scratch/sandbox.py`, `backend/tests/integration/test_scratch_sandbox.py`
- **Depends on:** 3, 1
- **Do:** Tests first. Add `run(runner_url, code, stdin_text)`: an async generator over `/execute-stream` (httpx streaming) that decodes each stream's bytes with `StreamDecoder` and yields `(stream, text)`, then returns an exit outcome `Exited(code)` or `TimeLimit`; raises `RunnerUnavailable` (existing class) on 503 or an unreachable runner. Closing the generator closes the connection. Parameters are only `{code, stdin_text}`.
- **Acceptance:**
  - *FR-2 — Given a solution that prints `a`, sleeps 2 s, then prints `b`, when it runs, then the generator yields `("out", "a…")` while the process is still running.* Asserted before `b` is yielded.
  - *FR-3 — Given a solution that raises `ValueError("bad")`, when it runs, then the pieces on `err` contain `ValueError: bad` and the outcome is `Exited(1)`.*
  - *FR-4 — Given runs that finish, raise and loop forever, when each ends, then the outcomes are `Exited(0)`, `Exited(1)` and `TimeLimit`.*
  - *Decoding — a solution printing `é` byte by byte yields `é`, never a replacement character.*

### 5. `[P]` Migration and `RunRepository` for `session_scratch_run`

- **Plan:** Data model; `RunRepository`; the claim statement. **Spec:** FR-9, FR-10.
- **Files:** `backend/app/migrations/0009_scratch_run.sql`, `backend/app/scratch/repo.py`, `backend/tests/integration/test_scratch_repo.py`
- **Depends on:** nothing
- **Do:** Tests first (real PostgreSQL). Migration: the `session_scratch_run` table exactly as in plan.md *Data model* (PK and cascade on `session_id`, `status`, `started_by`, `started_at`, `ended_at`, `input`, `output` jsonb, `exit_code`). Repository: `claim(conn, session_id, started_by, input) -> bool` as the single `INSERT … ON CONFLICT (session_id) DO UPDATE … WHERE status <> 'running'` checking the affected row count (a successful claim replaces the previous row: empty output, status `running`); `save_progress(conn, session_id, segments)`; `finish(conn, session_id, status, exit_code, segments)`; `get(conn, session_id) -> Run | None` returning the plan's `Run` shape including `seq`; `interrupt_running(conn) -> int`.
- **Acceptance:**
  - *FR-9 — Given two simultaneous starts for one session, when both call `claim`, then exactly one returns true.* `asyncio.gather` of two claims on separate connections.
  - *FR-9 — Given a run in progress, when a second claim is made, then it returns false and the row is unchanged; once the run is finished, the claim succeeds.*
  - *FR-8 — Given a finished run with output `old`, when a new claim is made, then `get` returns the new run with empty output and the new input.*
  - *FR-10 — Given a finished run with input `3`, output `9` by A, when `get` is called, then it returns input `3`, output `9`, status `finished`, starter A, and `seq` equal to the output's UTF-8 length.*
  - *FR-10 — Given a session is deleted, then its row is gone.*

### 6. `RunManager`: claim, stream, cap, batch, persist

- **Plan:** `RunManager` (start, output cap, batching, persistence), `OutputBuffer` use. **Spec:** FR-1, FR-2, FR-4, FR-7, FR-8, FR-9, FR-10, NFR-3, NFR-5.
- **Files:** `backend/app/scratch/manager.py`, `backend/tests/integration/test_scratch_manager.py`
- **Depends on:** 1, 4, 5
- **Do:** Tests first (real PostgreSQL and sandbox; a recording broadcast callback is the only seam). `start(session_id, user, input_text)` returns `Started | Refused(by)`; the stale check is the caller's (task 7). A refused claim reads the starter's name from the stored row. On a granted claim: broadcast `scratch_run_started`, stream `RunSandbox` into the `OutputBuffer`, broadcast `scratch_run_output {seq, s, t}` flushed when ≥100 ms have passed since the last flush (a quiet run's first piece goes out at once), save progress at most every 1 s, close the stream and end with `output_limit` when the buffer truncates, otherwise map the outcome to `finished` (code 0) / `error` (non-zero) / `time_limit`; write the final row, broadcast `scratch_run_end`. A runner failure ends the run `error` with the message on `err`. `snapshot(session_id)` returns the in-memory run while one is in progress, else the stored row.
- **Acceptance:**
  - *FR-1 — Given a solution that prints `input()` twice and the input `3` and `4`, when a run is started, then the run's output is `3` and `4` and the status `finished`.*
  - *FR-4 — Given runs that finish, raise and loop forever, when each ends, then the status is `finished`, `error` and `time_limit`.*
  - *FR-7 / NFR-3 — Given a solution that prints in an endless loop, when it runs, then the output is exactly 64 KB, the status is `output_limit` and the container is gone before the time limit.*
  - *FR-8 — Given a finished run with output `old`, when a run printing `new` starts, then the snapshot has only `new`.*
  - *FR-9 — Given A's long run in progress, when B starts a run, then it is `Refused(by="A")` and A's output is unchanged; two simultaneous starts produce exactly one run; after A's run ends B's start succeeds.*
  - *FR-10 — Given a run in progress, when `snapshot` is called, then it returns the output so far with its `seq`, and later `scratch_run_output` messages start at that `seq`.*
  - *NFR-5 — the first piece of a quiet run is broadcast without waiting for a 100 ms tick, and no more than one `scratch_run_output` per 100 ms is sent for a fast printer.*

### 7. `[P]` Session channel: `scratch_run` handler, refusals, welcome snapshot

- **Plan:** channel handler; Session snapshot; Contracts. **Spec:** FR-1, FR-5, FR-9, FR-10, FR-12.
- **Files:** `backend/app/sessions/ws.py`, `backend/tests/integration/test_ws_scratch.py`
- **Depends on:** 6
- **Do:** Tests first (real PostgreSQL, runner and WebSocket test clients, as in `test_ws_run.py`). In `_handle_text` add `scratch_run` with `{input: str}`: if the session is stale answer `scratch_run_refused {reason: "stale"}` to the sender only; otherwise `RunManager.start` with the participant's display name, and a refused claim answers `scratch_run_refused {reason: "in_progress", by}` to the sender only. The manager's broadcasts go through `hub_module.broadcast`. The `welcome` message gains `scratch_run` (the manager's `snapshot`, or `null`). Test runs (`run`, `run_started`, `run_finished`) are untouched.
- **Acceptance:**
  - *FR-5 — Given participants A and B in one session, when A starts a run, then B receives `scratch_run_started` naming A, then the output messages, then `scratch_run_end`.*
  - *FR-9 — Given A's run in progress, when B sends `scratch_run`, then only B receives `scratch_run_refused {in_progress, by: A}` and A keeps receiving its output unchanged.*
  - *FR-10 — Given A ran with input `3` which printed `9`, when C joins afterwards, then C's `welcome.scratch_run` has input `3`, output `9`, status `finished`, starter A. Given a run in progress, when C joins, then C gets the output so far in `welcome` and the rest as messages with no duplicate and no gap (checked by `seq`).*
  - *FR-12 — Given a stale session, when a participant sends `scratch_run`, then it is answered `scratch_run_refused {stale}` and no run row is created.*
  - *Existing behaviour — the test-run messages and results are unchanged.* The existing `test_ws_run.py` and `test_ws_switch.py` stay green.

### 8. `[P]` Startup reconcile of interrupted runs

- **Plan:** `RunManager` startup reconcile. **Spec:** FR-9, FR-10 (and FR-4's "stopped" family; flagged in the plan's *Spec feedback*).
- **Files:** `backend/app/main.py`, `backend/tests/integration/test_scratch_reconcile.py`
- **Depends on:** 6
- **Do:** Tests first. Call `reconcile_after_restart` (rows left `running` become status `interrupted`, `ended_at` set) once in the app's startup, before connections are accepted. The restart-the-stack cases are marked `slow` (constitution rule 2) and are the only tests in this feature that restart the hub; the non-slow test calls the function against a seeded `running` row.
- **Acceptance:**
  - *FR-9 — Given a row left `running` by a restart, when the hub starts, then the row is `interrupted` and a new run can be claimed.*
  - *FR-10 — Given the hub restarts after a run finished, when A reopens the session, then the last run is still shown.* **slow**: restart the stack, join, assert `welcome.scratch_run` equals the earlier run.
  - *FR-10 — Given the hub restarts mid-run, when A reopens, then the run shows status `interrupted` with the output saved so far, and *Run* is available.* **slow**.

### 9. `[P]` `visibleText` (pure)

- **Plan:** `visibleText(s)`. **Spec:** NFR-4.
- **Files:** `frontend/src/scratch/visibleText.ts`, `frontend/src/scratch/visibleText.test.ts`
- **Depends on:** nothing
- **Do:** Test first, then `visibleText`: every C0 control character other than `\n` and `\t`, and DEL, is replaced by `U+2400 + code` (DEL by `␡`); everything else is returned unchanged.
- **Acceptance:**
  - *NFR-4 — Given the text `\x1b[31mred`, when made visible, then it is `␛[31mred`.*
  - *NFR-4 — Given the text `<b>x</b>`, then it is returned unchanged.*
  - *NFR-4 — `\n` and `\t` are kept; `\r`, `\x00`, `\x7f` are replaced.*

### 10. `[P]` `scratchReducer` (pure)

- **Plan:** `runReducer`. **Spec:** FR-5, FR-8, FR-9, FR-10.
- **Files:** `frontend/src/scratch/scratchReducer.ts`, `frontend/src/scratch/scratchReducer.test.ts`
- **Depends on:** nothing
- **Do:** Test first, then the types of plan.md *Contracts* (`Segment`, `RunStatus`, `Run`) and a reducer over `snapshot | started | output | end | refused` (message names as above). `output` carries `seq` of its first byte: a message wholly at or below the current `seq` is discarded, one overlapping it keeps only the new bytes, one beyond it marks a gap (state flag `needsSnapshot`). `started` replaces the whole run. `refused` leaves the run and records a notice (`in_progress` with the starter's name, or `stale`). Merging of same-stream segments as in task 1.
- **Acceptance:**
  - *FR-8 — Given a finished run with output `old`, when `started` then `output` `new` arrive, then the state shows only `new`.*
  - *FR-10 — Given a snapshot with output `ab` (`seq` 2) and then an `output` message `{seq: 1, t: "bc"}`, then the output is `abc` with no duplicate; given `{seq: 2, t: "c"}` it is `abc`; given a message at the same `seq` again it is ignored.*
  - *FR-10 — Given an `output` message with `seq` beyond the current one, then `needsSnapshot` is set and the output is unchanged.*
  - *FR-9 — Given a run in progress, when `refused {in_progress, by: A}` arrives, then the run is unchanged and the notice names A.*
  - *FR-5 — the state carries `started_by` and `status` from `started`/`end`.*

### 11. `[P]` `ScratchPanel` component

- **Plan:** `RunPanel` (named `ScratchPanel` here). **Spec:** FR-2, FR-3, FR-4, FR-9, FR-12, NFR-4.
- **Files:** `frontend/src/scratch/ScratchPanel.tsx`, `frontend/src/scratch/ScratchPanel.module.css`, `frontend/src/scratch/ScratchPanel.test.tsx`
- **Depends on:** 9, 10
- **Do:** Tests first (React Testing Library). Props: the reducer's state, `stale`, `onRun(input)`. Multi-line input field (plain text, shows the last run's input), *Run* button, `<pre>` output with one `<span>` per segment (`out` / `err`; `err` differs by colour **and** a marker, readable at WCAG AA as in spec 003), a status line (`running…`, `finished`, `error`, `stopped: time limit`, `stopped: output limit`, `stopped: interrupted`) with `started by <name>`. *Run* is not rendered when `stale`, and is disabled while the run is `running` with the starter's name shown. All text goes through `visibleText` as React text nodes; no `dangerouslySetInnerHTML`.
- **Acceptance:**
  - *FR-4 — Given runs that finish, raise and loop forever, when each ends, then the panel says *finished*, *error* and *stopped: time limit*.* One render per status.
  - *FR-3 — Given an `err` segment containing `ValueError: bad`, then it renders in an element with the `err` class and its marker, distinct from `out`.*
  - *FR-9 — Given a run in progress started by A, then *Run* is disabled and the panel names A.*
  - *FR-12 — Given `stale`, then there is no *Run* control.*
  - *NFR-4 — Given output `<b>x</b>` and `\x1b[31m`, then the panel's text is those characters literally and no `<b>` element exists in the output area.*

### 12. `[P]` Wire `ScratchPanel` into the session screen

- **Plan:** Frontend wiring into the session channel client ("no new connection"). **Spec:** FR-5, FR-9, FR-10, FR-12.
- **Files:** `frontend/src/pages/SessionWindow.tsx`, `frontend/src/api/types.ts`, `frontend/src/pages/SessionWindow.test.tsx`
- **Depends on:** 7, 11
- **Do:** Tests first. Hold `scratchReducer` state in the joined state, seeded from `welcome.scratch_run`; feed it `scratch_run_started`, `scratch_run_output`, `scratch_run_end`, `scratch_run_refused`; on `needsSnapshot` re-join to fetch a fresh `welcome`. Render `ScratchPanel` next to the existing test-run results panel (its own show/hide toggle, as for the run results) and send `{type: "scratch_run", input}`. Add the message and `Run` types to `types.ts`. The existing test-run button, shortcut and panel are unchanged.
- **Acceptance:**
  - *FR-10 — Given a welcome with `scratch_run` input `3`, output `9`, status finished by A, when the session opens, then the panel shows input `3`, output `9`, *finished* and *started by A*.*
  - *FR-5 — Given `scratch_run_started` by A then output messages, then the panel shows them as they arrive.*
  - *FR-9 — Given `scratch_run_refused {in_progress, by: A}`, then B sees a message naming A.*
  - *FR-12 — Given a stale session, then the panel has no *Run*.*
  - *Existing behaviour — the existing session-window tests stay green.*

### 13. E2E: live view, refusal, status text, stale, safe display, latency

- **Plan:** Test strategy rows FR-3, FR-4, FR-5, FR-9, FR-10, FR-12, NFR-4, NFR-5 (e2e). **Spec:** FR-3, FR-4, FR-5, FR-9, FR-10, FR-12, NFR-4, NFR-5.
- **Files:** `e2e/scratch-run.spec.ts`
- **Depends on:** 12
- **Do:** Tests only (Playwright on the real stack, two browser contexts; not `slow`). Seed solutions through the editor as the existing session specs do.
- **Acceptance:**
  - *FR-5 — Given participants A and B in one session, when A starts *Run*, then B sees the same output as it is produced and "started by A".*
  - *FR-9 — Given A's run in progress, then B's *Run* is disabled and names A; when A's run ends, then *Run* is available to both again.*
  - *FR-4 — Given solutions that finish, raise and loop forever, then the visible status is *finished*, *error* and *stopped: time limit*.*
  - *FR-3 — Given a solution that raises `ValueError("bad")`, then the `err` element is visibly distinct and contains `ValueError: bad`.*
  - *FR-10 — Given A's finished run, when A reloads, then the last run is shown.*
  - *FR-12 — Given a stale session (seeded), then there is no *Run* control.*
  - *NFR-4 — Given a solution that prints `<b>x</b>` and an ANSI colour sequence, then the panel shows those characters literally.*
  - *NFR-5 — Given a solution printing a line, then it appears in B's panel within 1 s of A's start of output (with a margin for the test environment).*

### 14. `[P]` Integration: isolation, no leak, test runs unchanged

- **Plan:** Test strategy rows FR-1 (no test result changes), FR-6, FR-11, NFR-1, NFR-2 (integration). **Spec:** FR-1, FR-6, FR-11, NFR-1, NFR-2.
- **Files:** `backend/tests/integration/test_scratch_isolation.py`
- **Depends on:** 7
- **Do:** Tests only, over the real channel, PostgreSQL and sandbox, using a seeded problem's real hidden tests as the needle. If one fails, fix the production code in the earlier task's file and say so. Not `slow`.
- **Acceptance:**
  - *FR-1 — Given a solution that prints `input()` twice and the input `3` and `4`, when A starts *Run*, then the output is `3` and `4` and a test run before and after gives identical results.*
  - *FR-6 — Given a solution that calls `input()` with no input entered, when it runs, then the run ends `error` with `EOFError` in the output, well before the time limit.*
  - *FR-11 — Given a solution that prints a hidden test's argument, when the tests are run, then no printed output appears anywhere on the channel for that test run.*
  - *NFR-1 — Given a solution that opens a network connection, when it runs, then the connection fails, as in the test-run case.*
  - *NFR-2 — Given a solution that searches the file system and environment for the hidden tests, when it runs, then it finds none of their inputs or expected outputs.*
