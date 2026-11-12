# 011 — Plan: Run the solution on your own input

Spec: `specs/011-run-with-own-input/spec.md`. Constitution: `memory/constitution.md`.

This plan was written from the spec and the constitution only (per `/sdd-plan`'s context rule); it did not read code or other features' plans. Everything that names an existing part of the system by role ("the test-run sandbox", "the session real-time channel") is an **assumption to verify at review**; they are listed under *Assumptions* below. `/sdd-tasks` resolves them to concrete files.

## Assumptions to verify at review

- **A1** Tests already run in a sandbox that provides FR/NFR-1's isolation (no network, CPU/memory/time limits, hidden tests not readable by the solution), and that sandbox can be invoked without any tests.
- **A2** Sessions already have a real-time channel (WebSocket) over which edits and test results reach every participant, a join/reload snapshot, a stale (read-only) flag, and participant display names.
- **A3** The hub's reverse proxy already passes that channel through unbuffered (NFR-5 depends on it).
- **A4** The backend is one process per deployment (no horizontal scale-out), so an in-process run registry is authoritative while a run is in progress. If not, the lock in *Run manager* must move to the database only (it is already written so that it can).

## Architecture

New backend unit **`runs`** and one new frontend panel. Nothing in test runs changes (FR-11).

```
 client RunPanel ──run.start──▶ session channel handler
                                      │
                                      ▼
                                 RunManager ──▶ RunRepository ──▶ PostgreSQL (session_run)
                                      │
                                      ▼
                                 RunSandbox ──▶ the existing sandbox, "no tests" mode
                                      │
                    chunks (≤100 ms batches)
                                      ▼
                       broadcast to the session's participants
```

Dependency direction (one way, no cycles): channel handler → `RunManager` → {`RunRepository`, `RunSandbox`, `OutputBuffer`}. `RunSandbox` depends only on the existing sandbox. `OutputBuffer` is pure (no I/O). Frontend: `RunPanel` → `runReducer` → `visibleText` (pure).

### Backend components

- **`RunSandbox`** — starts the session's current solution in the existing sandbox with:
  - stdin = the input text, written then closed (FR-1, FR-6: the program sees end of input after it; nothing typed later can reach it).
  - no tests, no test files, no test environment mounted or passed (NFR-2). The sandbox invocation for a run takes only `{solution_source, stdin_text}`; it has no parameter through which a test could enter.
  - same network/CPU/memory/wall-time limits as a test run, taken from the same configuration constants (NFR-1, FR-7).
  - stdout and stderr read as two separate streams, each decoded with an incremental UTF-8 decoder (`errors="replace"`) so a chunk boundary never splits a character.
  - yields `(stream, text)` pieces as they arrive (FR-2, FR-3); reports an exit outcome: `exited(code)`, `time_limit`.
- **`OutputBuffer`** (pure) — ordered list of segments `{s: "out"|"err", t: str}`; consecutive pieces of the same stream are merged. Tracks total UTF-8 bytes. `append(stream, text)` returns the part accepted (possibly truncated at a character boundary) and sets `truncated` once the 64 KB cap (NFR-3) is hit; further appends accept nothing. Stdout and errors share the one cap.
- **`RunManager`** — owns the lifecycle of the one run a session may have (FR-9, FR-10):
  1. `start(session, user, input)`: refuse if the session is stale (FR-12). Claim atomically (below). On a refused claim, send `run.refused` to the requester only, naming the starter; do not touch the run in progress.
  2. Start `RunSandbox`; for each piece, `OutputBuffer.append`; broadcast accepted text as `run.output`, batched to at most one message per 100 ms per run (NFR-5: pieces are flushed when 100 ms have passed since the last flush, not on a fixed tick, so the first byte of a quiet run is not delayed).
  3. On output cap: kill the process (allowed by FR-7, "no later than the time limit"; it spares the host from a runaway printer), end with status `output_limit`.
  4. On end: set status, write final state to the database, broadcast `run.end`.
  - Persisting while running: the buffer is flushed to the database at most every 1 s, so a crash loses at most that much of a partial run.
  - **Claim** is a single conditional statement: `INSERT … ON CONFLICT (session_id) DO UPDATE SET … WHERE session_run.status <> 'running'` and checking the affected row count. This is what makes two simultaneous starts safe (FR-9) with or without the in-process registry (A4).
  - **Startup reconcile**: any row left `running` by a hub restart is set to status `stopped`, reason `interrupted`. The spec does not mention this case; without it *Run* would stay unavailable forever (FR-9), so the plan adds the minimum. It counts as FR-4's "stopped" family and is flagged for the human at review (see *Spec feedback*).
- **`RunRepository`** — read/write of `session_run` (below). A read for the join snapshot returns the in-memory buffer if a run is in progress, otherwise the stored row.

### Session snapshot (FR-10)

The existing join/reload snapshot gains a `run` field (the `Run` object in *Contracts*, or `null`). For a run in progress it carries the output so far and its `seq` (byte length of output so far); later `run.output` messages carry the `seq` of their first byte, so a client that connected between snapshot and message can discard what it already has and detect a gap (and then ask for a fresh snapshot).

### Frontend

- *2026-11-12 change: the input field and the panel's own Run button are gone. The panel (`ScratchPanel`) is the bottom panel's "Output" tab and shows status and output only; the session toolbar's Run sends `scratch_run` with `input: ""`, and Check sends the test `run`. Below is the original design.*
- **`RunPanel`** — a panel in the session screen, with: a multi-line input field (plain text), a *Run* button, an output area, a status line ("finished", "error", "stopped: time limit", "stopped: output limit", "stopped: interrupted", "running…", plus "started by <name>"). *Run* is not rendered when the session is stale (FR-12), and is disabled while any run is in progress, with the starter's name shown (FR-9).
  - The input field reflects the last run's input for everyone (FR-10 shows the input); only the starter's local edits are theirs to make. Editing is available to anyone who can run.
  - Output is rendered as React text nodes inside a `<pre>`, one `<span>` per segment, class `out` or `err` (FR-3: `err` visibly distinct, e.g. a different colour *and* a marker so colour is not the only cue, matching the WCAG AA rule of spec 003). Never `dangerouslySetInnerHTML` (NFR-4).
- **`visibleText(s)`** (pure) — replaces C0 control characters other than `\n` and `\t` (and DEL) with their visible form (`\x1b` → `␛`, i.e. U+2400 + code), so an ANSI sequence is shown as literal characters instead of being swallowed or acted on by the browser (NFR-4). Applied to both input echo and output.
- **`runReducer`** — pure state machine over `snapshot | run.started | run.output | run.end | run.refused`; applies the `seq` check and replaces the whole run on `run.started` (FR-8).
- It is wired into the existing session channel client; no new connection.

## Data model

One table, one row per session (only the last run is kept, FR-10).

`session_run`

| column | type | notes |
|---|---|---|
| `session_id` | FK → session, **PK** | one row per session; cascades with the session |
| `status` | text | `running` \| `finished` \| `error` \| `time_limit` \| `output_limit` \| `interrupted` |
| `started_by` | text | the starter's display name at start time (names, not account ids: sessions need no account, 001) |
| `started_at` | timestamptz | |
| `ended_at` | timestamptz null | |
| `input` | text | as entered |
| `output` | jsonb | the `OutputBuffer` segments; at most 64 KB of text by construction (NFR-3) |
| `exit_code` | int null | set for `finished`/`error`; `error` = non-zero exit or uncaught exception |

`finished` = exit code 0; `error` = non-zero exit (an uncaught exception ends the interpreter with non-zero status and its traceback is on stderr, FR-3/FR-4).

No retention job: the row is replaced by the next run and removed with the session. Stale sessions keep theirs (shown read-only).

## Contracts

All on the existing session channel (A2). JSON; `Run` is the shape below.

```ts
type Segment = { s: "out" | "err"; t: string };
type RunStatus = "running" | "finished" | "error" | "time_limit" | "output_limit" | "interrupted";
type Run = {
  status: RunStatus;
  started_by: string;
  started_at: string;      // ISO 8601
  input: string;
  output: Segment[];
  seq: number;             // UTF-8 bytes of output so far
  exit_code: number | null;
};
```

| direction | message | payload | effect |
|---|---|---|---|
| client → server | `run.start` | `{ input: string }` | start a run (FR-1) |
| server → all | `run.started` | `Run` with `status:"running"`, empty `output`, `seq:0` | replaces the panel (FR-5, FR-8) |
| server → all | `run.output` | `{ seq: number, s: "out"\|"err", t: string }` | append (FR-2, FR-3, FR-5) |
| server → all | `run.end` | `{ status: RunStatus, exit_code: number\|null }` | final status (FR-4, FR-7) |
| server → requester | `run.refused` | `{ reason: "in_progress", by: string }` or `{ reason: "stale" }` | FR-9, FR-12 |
| server → joiner | session snapshot | adds `run: Run \| null` | FR-10 |

Backend signatures (Python, informal):

```python
class OutputBuffer:
    def append(self, stream: Literal["out", "err"], text: str) -> str: ...  # returns accepted text
    truncated: bool
    segments: list[Segment]
    size: int  # UTF-8 bytes

class RunManager:
    async def start(self, session_id: str, user: str, input_text: str) -> RunStartResult  # Started | Refused(by) | Stale
    async def snapshot(self, session_id: str) -> Run | None
    async def reconcile_after_restart(self) -> None
```

Input size: the spec sets no cap on the input text. The plan adds none of its own; the session channel's existing maximum message size bounds it. Flagged at review.

## Test strategy

Constitution rules 1 and 4: failing test first; real Postgres, real sandbox, real channel; nothing mocked (there is no third-party service in this feature).

**Unit** (pure, fast)
- `OutputBuffer`: merge of same-stream pieces, 64 KB cap at a character boundary, multi-byte characters counted in bytes, no growth after truncation.
- Incremental decoding across split multi-byte characters.
- `visibleText`: ESC, other C0 and DEL made visible; `\n`/`\t` kept; `<b>x</b>` untouched.
- `runReducer`: snapshot, output with `seq` (duplicate discarded, gap detected), `run.started` replaces previous output, refusal leaves state.

**Integration** (backend + real PostgreSQL + real sandbox, WebSocket test clients)
**E2E** (Playwright against the real stack; `slow` only where stated)

| Criterion | Level | Test |
|---|---|---|
| FR-1 | integration | solution prints `input()` twice, input `3\n4`; panel data has `3`,`4`; test results for the session unchanged (a test run before and after gives the same results) |
| FR-2 | integration | solution prints `a`, sleeps 2 s, prints `b`; client receives `a` while the process is still running (assert before the `b` message and before `run.end`) |
| FR-3 | integration + e2e | `raise ValueError("bad")`: segments include `err` text containing `ValueError: bad`; e2e checks the `err` element has the different style/marker |
| FR-4 | integration | three solutions end `finished`, `error`, `time_limit`; e2e checks the visible status text for each |
| FR-5 | e2e | two browser contexts A and B in one session; A runs; B sees output arrive and "started by A" |
| FR-6 | integration | `input()` with empty input raises `EOFError` and the run ends `error` without waiting |
| FR-7 | integration | endless `print`: output is exactly 64 KB, status `output_limit`, process gone before the time limit |
| FR-8 | integration | run printing `old`, then run printing `new`; snapshot has only `new` |
| FR-9 | integration + e2e | A's long run in progress; B `run.start` gets `run.refused{in_progress, by:A}`; A's output unchanged; after the end B's start succeeds. A concurrent double-start test (two simultaneous `run.start`) produces exactly one run. e2e: B's *Run* is disabled and names A |
| FR-10 | integration + e2e + **slow** | integration: run, new client joins, snapshot has input/output/status/starter; join mid-run gets output so far then the rest, with no duplicate or gap. e2e: reload shows the last run. **slow**: restart the hub after a finished run and reopen the session; also restart mid-run → row becomes `interrupted` and *Run* is available again (reconcile) |
| FR-11 | integration | solution prints a hidden test's argument; a test run produces no output message and no output field anywhere on the channel |
| FR-12 | integration + e2e | stale session: `run.start` is refused `stale`; e2e shows no *Run* control |
| NFR-1 | integration | solution opens a socket; the connection fails, as in the matching test-run case |
| NFR-2 | integration | solution walks the file system and environment for the hidden tests' inputs and expected outputs; finds none (uses the real hidden tests of a seeded problem as the needle) |
| NFR-3 | integration | prints 100 KB; first 64 KB shown, `output_limit` |
| NFR-4 | unit + e2e | `<b>x</b>` and `\x1b[31m` shown as literal characters; no element created from the output |
| NFR-5 | e2e on the hub | a line printed by the solution appears in a second participant's panel within 1 s (measured with a margin for the test environment) |

Per-task gate and `slow` usage follow constitution rule 2 and the `HUB_KEEP_STACK=1` / `scripts/check.sh` flow; the new tests are not `slow` except where marked, and none of them may add a stack restart outside the marked ones.

## Constitution compliance

1. **Test-first** — every task will start from the failing tests in the table above; `/sdd-tasks` assigns each criterion to a task.
2. **Green before done** — no new gate requirement. Only the restart cases are `slow`, so the per-task run stays within 5 minutes; the complete suite runs once before validation.
3. **Traceable tests** — the table covers every FR-1…FR-12 and NFR-1…NFR-5 criterion.
4. **Real dependencies** — real PostgreSQL, sandbox and channel. No mocks, no exception to justify.
5. **Fixed stack** — Python/FastAPI, PostgreSQL, React/TypeScript strict, docker compose. No departure.
6. **Dependency justification** — no new third-party dependency. The incremental UTF-8 decoder is the standard library's (`codecs`).
7. **No secrets** — none involved; the test for NFR-2 uses seeded hidden tests, not credentials.
8. **Lint and format clean** — applies to all new Python and TypeScript at every task.
9. **Module layout and dependency direction** — stated in *Architecture*.

## Spec feedback (for the human, not scope added here)

- **Interrupted runs.** FR-9 locks *Run* until a run ends; a hub restart mid-run would end it without anyone noticing. The plan marks such a run `interrupted` (under "stopped"). If the spec should name this status, amend FR-4 first.
- **Input size.** The spec has no maximum input length (see *Contracts*).
- **Output limit kills the run.** FR-7 allows it ("stop showing further output", run stopped no later than the time limit); the plan stops the process at the cap rather than discarding output until the time limit.
