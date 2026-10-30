# Specs

Every spec in this project, one row each. A spec is one file:
`specs/<NNN-slug>/spec.md`. Its `plan.md`, `tasks.md` and `notes.md` are added
beside it as the feature moves through the pipeline described in `CLAUDE.md`.

## Viewer

`specs/index.html` shows everything here in one place: this index, each spec's
artifacts, requirements paired with their acceptance criteria, task progress.
It holds no copy; it reads the markdown each time it loads. From the root of
the repository:

```
python specs/serve.py
```

then open <http://127.0.0.1:8777/>. A different port goes after the file name.

**Progress.** The *Progress* view (`#progress`) lists every spec with every
task, above three charts: tasks done and open per spec, how many specs have
each artifact, and tasks per wave. One row of filters — text, status, artifact,
open or done, only `[P]` — narrows the charts and the list together; clicking a
bar in the artifact chart sets that filter. All of it is counted from the
markdown on each load. A task's number, wave, `[P]` flag and requirement ids
are read from `tasks.md`: the checklist line, a table with *Wave* and *Tasks*
columns, and the `**Spec:**` line under the heading that starts with the task's
number. `/sdd-tasks` writes that format.

**Editing.** Every file the viewer shows has an **Edit** button: this index,
and each spec's `spec.md`, `plan.md`, `tasks.md` and `notes.md`. It opens the
raw markdown; **Save** (or Ctrl+S) writes the whole file back. Task checkboxes
can be ticked directly, in a `tasks.md` and in the Progress view. What to know
before relying on it:

- A save writes straight to the working tree. Nothing is committed; `git diff`
  shows what changed, and git is the undo.
- If the file changed on disk after the page read it — an agent or an editor
  got there first — the save is refused and nothing is written. Reload, then
  apply the change again.
- It edits files that exist. It does not create, rename or delete one; the
  `/sdd-*` skills create the artifacts.
- It does not know the pipeline. Changing a spec does not mark its plan or
  tasks stale, and changing a status here is the human moving it.
- Task checkboxes are list items — `- [ ] **1** — …` — not headings.

`specs/serve.py` is what saves: Python standard library, bound to `127.0.0.1`,
and it accepts writes only to those markdown files and only from this page.
Under any plain static server (`python -m http.server`, run inside `specs/`)
the page still works, read-only, and says so in its header.

The page loads its markdown renderer from cdnjs, so it needs network access.

## Index

| # | Spec | What it requires | Status | Open questions |
|---|---|---|---|---|
| 001 | [collaborative-coding-sessions](001-collaborative-coding-sessions/spec.md) | Invite-link sessions (max 5, names ≤30 chars, no account) to live-edit one Python solution together and run it sandboxed against hidden tests; problems managed by SSO users with the editor role, 20-problem starter set; sessions stored durably, marked stale after 30 days (admin reactivates), never deleted | validated | 0 |
| 002 | [problem-descriptions-and-session-chat](002-problem-descriptions-and-session-chat/spec.md) | Every problem gets a required formatted description with inline images (starter set included), shown in sessions; each session gets a plain-text participant chat (≤2000 chars/message) stored durably with the session, read-only when stale; admins can remove chat messages | approved | 0 |
| 003 | [apple-style-ui-overhaul](003-apple-style-ui-overhaul/spec.md) | Full redesign of every screen (incl. spec 002's description and chat) to look and feel like a macOS app per Apple's HIG — system/light/dark appearance with remembered override, sheet-based flows, keyboard shortcuts, desktop ≥1024 px only, WCAG AA, no Apple-owned assets, no change to 001/002 rules | approved | 0 |
| 004 | [project-hub-shared-ingress](004-project-hub-shared-ingress/spec.md) | One entry point (HTTPS, trusted cert, nothing else reachable) and one shared identity provider for every app on the project hub; per-app gated/ungated sign-in; adding or failing one app disturbs no other; survives reboot; follows BoarHQ's decided ingress design | draft | 0 |
| 005 | [deploy-to-project-hub](005-deploy-to-project-hub/spec.md) | Host this app on the project hub behind the shared entry point, using the shared identity provider instead of its own; under a sub-path of the hub address; invite links stay account-free and work from the public internet; editor/admin capabilities scoped to this app; fresh starter set; ≤1 GB memory; live collaboration, sandboxed runs and data persistence work as locally | draft | 0 |
| 006 | [interactive-learning-sessions](006-interactive-learning-sessions/spec.md) | A *Learn* section of this app: Docker and Tailscale lessons (files in the repo) made of explanation steps, quizzes and simulated-terminal exercises (nothing executed); a group goes through one together by invite link (no account, max 5); anyone passing a check moves everyone on; progress stored durably per session, stale after 30 days; 4 lessons per topic, show-answer after 3 misses, chat as in 002 | planned | 0 |

**Status** is one of `draft` (written, not approved), `approved` (every
`[NEEDS CLARIFICATION]` resolved and the spec signed off), `planned`, `in
progress`, `validated`. Only the human moves a spec out of `draft`.

Adding a spec means adding its row here; `/sdd-specify` does that. The row links
to the spec file — `[slug](NNN-slug/spec.md)` — which is how the viewer finds
it. Numbers are never reused.
