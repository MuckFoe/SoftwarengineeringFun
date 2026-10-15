# Constitution

Project-wide rules every `spec.md`, `plan.md`, `tasks.md` and implementation must comply with. A violation blocks the artifact at its human gate. Amend this file deliberately; never work around it.

Ratified: 2026-10-15

## Testing

1. **Test-first.** For every task, a failing test derived from that task's acceptance criteria must exist before any implementation code for it is written. `/sdd-implement` must show the test failing before the implementation and passing after.
2. **Green before done.** A task's checkbox in `tasks.md` may be ticked only when the full test suite passes, not just the new tests.
3. **Traceable tests.** Every acceptance criterion (Given/When/Then) in `spec.md` must be covered by at least one test, and `tasks.md` must name the criterion each task covers.
4. **Real dependencies.** Tests use real implementations of dependencies the project owns or runs locally (database, filesystem, internal modules). Only third-party network services the project does not control may be mocked or faked. A `plan.md` that proposes mocking anything else must justify the exception explicitly.

## Tech stack

5. **Fixed stack.** Backend: Python 3.12 with FastAPI. Database: PostgreSQL. Frontend: React with TypeScript in strict mode, built with Vite. Deployment: docker compose. A `plan.md` that departs from this must say so explicitly and justify it. Ratified with spec 001's plan, 2026-10-15.
6. **Dependency justification.** Every third-party dependency a `plan.md` introduces must be listed with the reason the standard library or existing code isn't enough. An unlisted new dependency blocks the task's diff.

## Security

7. **No secrets in the repo.** Credentials, tokens and keys are never committed, including in tests, fixtures or examples. Configuration secrets come from the environment. A diff containing one is rejected.

## Code quality

8. **Lint and format clean.** A task isn't done until these pass with zero errors: `ruff check` and `ruff format --check` for Python, and `biome ci` and `tsc --noEmit` for TypeScript.

## Architecture

9. **No standing boundary rules.** Structure is decided per `plan.md`. A plan must still state its module layout and dependency direction so it can be reviewed.
