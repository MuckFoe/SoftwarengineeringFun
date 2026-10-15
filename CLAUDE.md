# Spec-Driven Development (SDD)

Drop this file, `.claude/skills/sdd-*` and the `specs/` folder (`README.md`, `index.html`, `serve.py`) into a target repo root to run SDD there.

## Pipeline

`constitution → specify → plan → tasks → implement → validate`

| # | Skill | Reads | Writes | Human gate |
|---|---|---|---|---|
| 0 | `/sdd-constitution` | (interview) | `memory/constitution.md` | approve principles — run once, rarely revisited |
| 1 | `/sdd-specify` | constitution | `specs/<slug>/spec.md`, a row in `specs/README.md` | resolve every `[NEEDS CLARIFICATION]`, approve |
| 2 | `/sdd-plan` | spec.md, constitution | `specs/<slug>/plan.md` | approve architecture |
| 3 | `/sdd-tasks` | plan.md, spec.md | `specs/<slug>/tasks.md` | approve/reorder task list |
| 4 | `/sdd-implement` | one task | code + tests, task ticked off | approve diff, per task |
| 5 | `/sdd-validate` | spec.md, tasks.md, test run | `specs/<slug>/notes.md` | sign off feature |

**Hard rule:** a skill stops after writing its artifact. It never invokes the next skill itself. No exceptions, no "since it looks obviously right." The human runs the next `/sdd-*` command.

## Why this order

- Spec = WHAT/WHY. Plan = HOW. Never mix them — implementation detail in a spec is the single most common SDD failure mode across every source reviewed.
- Ambiguity gets marked (`[NEEDS CLARIFICATION: ...]`), never guessed away.
- Tasks carry acceptance criteria traceable back to the spec's Given/When/Then, not invented ad hoc.
- Tests are written from acceptance criteria before implementation (TDD), not after.
- The spec is the durable record. Code and tests are regenerable from it; when behavior changes, the spec changes first.

## Repo layout

```
memory/constitution.md          # project-wide, one-time, rarely edited
specs/README.md                 # index: one row per spec, with its status
specs/index.html, serve.py      # viewer and editor for everything under specs/
specs/<NNN-feature-slug>/
  spec.md                       # WHAT/WHY — stable
  plan.md                       # HOW — architecture, data model, contracts
  tasks.md                      # execution delta — per-task checklist; progress lives here
  notes.md                      # validation log, drift/learnings, appended each cycle
```

One folder per feature. Never one monolithic spec for the whole product.

## Seeing and changing it

`python specs/serve.py`, then <http://127.0.0.1:8777/>. The viewer reads the markdown under `specs/` each time it loads and holds no copy of it:

- **Index** — every spec with its status, open questions and which artifacts exist; each spec's documents; requirements paired with their acceptance criteria.
- **Progress** — every spec and task, charts of tasks per spec, artifacts reached and tasks per wave, and filters over all of it.
- **Edit** — any of those files in the browser, and task checkboxes by clicking. A save writes straight to the markdown file; git is the undo.

Progress is the checkboxes in `tasks.md`, nothing else. `/sdd-tasks` writes the format the viewer counts; `specs/README.md` documents the viewer.

## Context management — non-negotiable

State lives in files, not in conversation. This is what makes the gates real: a human can `/clear` or close the session between every phase with zero loss, because the next skill reconstructs everything it needs from disk.

- **Each skill reads only its declared inputs** — its upstream artifact(s) + constitution. Never the whole `specs/` tree, never unrelated features, never "the rest of the chat" for facts that belong on disk.
- **Isolate features.** Working feature B must not load feature A's spec/plan/tasks into context.
- **Size tasks to a context window.** A task that touches more than ~3 files or mixes concerns is a planning bug — split it in `/sdd-tasks`, don't let `/sdd-implement` discover the overflow mid-task.
- **One task (or one `[P]` wave) per implementation pass.** Prefer a fresh Agent/session per task. Never carry task N's exploration noise into task N+1 — the handoff is `tasks.md` + `spec.md` on disk, not memory.
- **Split specs before they grow unbounded.** If a spec needs a table of contents, it should have been two features.

## Do / Don't (cross-source synthesis)

**Do:** write specs collaboratively; use EARS (WHEN/THEN) or Given/When/Then for acceptance criteria; keep plan/tasks separate from spec; calibrate spec detail to risk; keep everything under version control; require human approval at every gate; run a second, fresh-context review pass before calling a feature done.

**Don't:** put tech stack or file structure in the spec; resolve ambiguity by guessing; over-specify into pseudo-code or under-specify into "should work well"; implement a whole feature in one pass; let agent self-review replace human review; skip re-validating the spec after implementation surfaces new facts; apply this ceremony to a trivial one-file fix.
