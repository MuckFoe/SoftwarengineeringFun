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
| 003 | [apple-style-ui-overhaul](003-apple-style-ui-overhaul/spec.md) | **Superseded by 015** (visual design and tokens; its behaviour requirements stand). Full redesign of every screen (incl. spec 002's description and chat) to look and feel like a macOS app per Apple's HIG — system/light/dark appearance with remembered override, sheet-based flows, keyboard shortcuts, desktop ≥1024 px only, WCAG AA, no Apple-owned assets, no change to 001/002 rules | approved | 0 |
| 004 | [project-hub-shared-ingress](004-project-hub-shared-ingress/spec.md) | One entry point (HTTPS, trusted cert, nothing else reachable) and one shared identity provider for every app on the project hub; per-app gated/ungated sign-in; adding or failing one app disturbs no other; survives reboot; follows BoarHQ's decided ingress design | draft | 0 |
| 005 | [deploy-to-project-hub](005-deploy-to-project-hub/spec.md) | Host this app on the project hub behind the shared entry point, using the shared identity provider instead of its own; under a sub-path of the hub address; invite links stay account-free and work from the public internet; editor/admin capabilities scoped to this app; fresh starter set; ≤1 GB memory; live collaboration, sandboxed runs and data persistence work as locally | draft | 0 |
| 006 | [interactive-learning-sessions](006-interactive-learning-sessions/spec.md) | A *Learn* section of this app: Docker and Tailscale lessons (files in the repo) made of explanation steps, quizzes and simulated-terminal exercises (nothing executed); a group goes through one together by invite link (no account, max 5); anyone passing a check moves everyone on; progress stored durably per session, stale after 30 days; 4 lessons per topic, show-answer after 3 misses, chat as in 002 | planned | 0 |
| 007 | [chat-gif-search](007-chat-gif-search/spec.md) | Session chat gets GIF search (third-party service, results capped at PG-13, trending when empty); search terms only leave the hub after a notice and carry no participant data; GIF messages are chat messages: stored durably as a reference (placeholder once gone), admin-removable, read-only when stale; 20 searches / 5 posts per participant per minute; amends 002 | planned | 0 |
| 008 | [chat-beside-description](008-chat-beside-description/spec.md) | Chat sits below the problem description in the session window, both visible at once (no tabs); chat hideable on its own, remembered per browser; resizable divider; distinct panel controls; amends 003 FR-15 | planned | 0 |
| 009 | [hub-self-registration](009-hub-self-registration/spec.md) | Open sign-up on the hub's shared sign-in; accounts stay pending until a hub admin approves (reject frees the name, unanswered ones removed after 30 days); approval opens ungated apps only, each gated app grants access itself; no app roles by default; no email verification, mail or self-service password reset; 5 sign-ups per source per hour; amends 004 | planned | 0 |
| 010 | [editor-tab-at-cursor](010-editor-tab-at-cursor/spec.md) | Tab in the code editor inserts 4 spaces at the cursor (not a whole-line indent); Tab only accepts an open autocomplete suggestion; multi-line Tab indents, Shift+Tab dedents, Esc then Tab leaves the editor; a selection inside one line indents it; one undo per Tab; fixes F10, amends 001 editing and 003 FR-17 | approved | 0 |
| 011 | [run-with-own-input](011-run-with-own-input/spec.md) | A separate *Run* of the solution on input the participant types, no tests: printed output and errors stream live to everyone in the session; output only, end of input after what was entered; one run per session at a time (others refused); last run stored and shown on join/reload; same isolation and limits as test runs, output capped at 64 KB, shown as plain text; test runs still show no printed output; F11 and F6, amends 001 | draft | 0 |
| 012 | [my-sessions-for-accounts](012-my-sessions-for-accounts/spec.md) | A profile reachable from every screen; anonymous visitors only get sign in / register there. Signed-in users start and join coding, learning and presentation sessions under their account username with no name prompt; their profile shows username and app roles, every session they started or joined while signed in (most recent first, stale marked, hosted presentations marked, hideable from own list), reopenable as the same participant; appearance and chat-visibility preferences kept per account across devices; one participant across devices; signed-in participants visibly marked; anonymous joining by invite link unchanged; amends 001, 003, 006, 008 | approved | 0 |
| 013 | [html-presentations](013-html-presentations/spec.md) | Editors keep a library of HTML presentations (uploaded or pasted, title + topic, ≤5 MB, slides or single page); anyone starts a session from it, others join by invite link (no account); everyone follows the host's slide/scroll with a simulated host cursor; host can hand over, passes to longest-present participant after 60 s away; scripts run fully isolated (no app access, no network); any participant can toggle drawing, strokes live for all, cleared on slide change or by anyone, never stored; sessions durable, stale after 30 days, chat as in 002/007 | planned | 0 |
| 014 | [games-chess](014-games-chess/spec.md) | A *Games* section in the app (built to hold more games), chess first: anyone starts a session, others join by invite link (no account); first two in are White and Black, the rest watch; before a game anyone may switch between player and viewer, then a player presses *Start* (shown always, again after each game); full chess rules enforced by the app, no clock, resign and draw offers, automatic draws; at most 5 participants; after the opponent is away 2 min the present player can claim the win; resignation or a claimed win deletes the session, as can the starter or an admin; sessions durable, stale after 30 days, chat as in 002/007, listed on profiles as in 012 | planned | 0 |
| 015 | [audi-ui-redesign](015-audi-ui-redesign/spec.md) | Restyle every screen, games included, in the Audi design language (kit colours, Audi type and icons, component states, light/dark), replacing spec 003's Apple look; behaviour unchanged | draft | 0 |
| 016 | [Audi restyle v2](016-audi-restyle-v2/spec.md) | Carry the chosen v2 look (pills, rounded tiles, light line, blue accent, floating appearance menu) to every screen | draft | 0 |
| 017 | [Home screen with live session tiles](017-home-screen-tiles/spec.md) | Landing screen with a live greeting, Start session tile and tiles for sessions and games with code and board previews | validated | 0 |
| 018 | [Problem catalogue of 150](018-problem-catalogue-150/spec.md) | Grow the starter set to 150 problems (50 easy, 50 medium, 50 hard, existing 20 included), each in one category, with category and difficulty browsing and filtering | draft | 0 |
| 019 | [Delete sessions from the profile](019-delete-sessions/spec.md) | Hosts (and admins) delete a session for everyone from the profile list, with confirmation; participants are told and disconnected, the invite link shows it was deleted | approved | 0 |

**Status** is one of `draft` (written, not approved), `approved` (every
`[NEEDS CLARIFICATION]` resolved and the spec signed off), `planned`, `in
progress`, `validated`. Only the human moves a spec out of `draft`.

Adding a spec means adding its row here; `/sdd-specify` does that. The row links
to the spec file — `[slug](NNN-slug/spec.md)` — which is how the viewer finds
it. Numbers are never reused.
