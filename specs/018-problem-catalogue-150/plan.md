# Plan — 018 Problem catalogue of 150

Inputs read: `spec.md`, `memory/constitution.md`, `memory/constitution-ui.md`. Per the skill's discipline no code was read; the only repo facts used are the seed layout already in view (`seed/problems/<key>/problem.json` + `reference.py`, with fields `title`, `description`, `signature`, `topic`, `difficulty`, `tests[{args, expected}]`). Where the plan depends on code it has not seen, it says **Confirm in task 1** and the task list must open with that confirmation.

## Architecture

Four pieces, dependency direction left to right (content depends on nothing; UI depends on API; API depends on model):

```
seed content (data)  ──►  seed loader (existing, extended)  ──►  problems table (+category)
                                                                      │
 seed tooling (scripts: fill / check) ──reads──► seed content         ▼
                                                           problem list API (+filters, +order)
                                                                      │
                                                                      ▼
                                                           problem picker UI (filters, grouping)
```

1. **Seed content** — 130 new directories under `seed/problems/`, named `NNN-slug` (`021` … `150`, three-digit, in authoring order; slug from the title). The 20 existing directories keep their names: the directory name is the **seed key** and is the problem's identity (FR-2). Each directory holds `problem.json` and `reference.py` in today's format, plus one new field `category` (category id, below). The 20 existing `problem.json` files gain only `category` (their `topic` stays untouched, FR-2).
2. **Seed loader** (the existing starter-seeding step, extended) — inserts starter problems that have no ledger row (FR-8) and backfills `category` for existing starters whose category is null (FR-2, FR-4). It never updates any other field of an existing row.
3. **Problem list API** — list endpoint gains `category` and `difficulty` filters, returns both fields per item, and returns a canonical order. A small categories endpoint serves the fixed list. Create/update accept and validate `category`.
4. **Problem picker UI** — filter controls (category, difficulty) beside the existing text search, grouped list with category headings, empty state with clear-filters.
5. **Seed tooling** (`scripts/`, Python, used by authors and by the tests) — `seed_fill_expected.py` and `seed_check.py` (below). No runtime role.

Module layout: tooling in `scripts/`, content in `seed/problems/`, backend changes in the existing problems module and seeding module, frontend changes in the existing picker component, plus one new shared constant on each side only if the API cannot supply it (it can; the frontend reads the list from the API, so there is a single source of truth in the backend).

## Data model

**Category list (single source, backend constant, fixed order).** Id → label:

| # | id | label |
|---|---|---|
| 1 | `arrays` | Arrays |
| 2 | `strings` | Strings |
| 3 | `hash-maps-sets` | Hash maps & sets |
| 4 | `two-pointers-windows` | Two pointers & sliding window |
| 5 | `stacks-queues` | Stacks & queues |
| 6 | `sorting-searching` | Sorting & searching |
| 7 | `recursion-backtracking` | Recursion & backtracking |
| 8 | `dynamic-programming` | Dynamic programming |
| 9 | `graphs-trees` | Graphs & trees |
| 10 | `math-bits` | Math & bit tricks |
| 11 | `greedy-intervals` | Greedy & intervals |

**Problems table:** add `category` — nullable text, constrained by the application to the ids above (a database CHECK is added in the same migration so a bad id cannot be stored). Nullable because editor-created problems that exist today have none; they are listed under a trailing "Other" group and are not part of the starter-set rules (a necessity of not breaking existing data, not in the spec). `difficulty` is assumed to already be stored; **Confirm in task 1** and add it with a CHECK on `easy|medium|hard` if it is not.

**Seed ledger:** new table `seeded_problem(seed_key text primary key, problem_id → problems(id) on delete set null, seeded_at timestamptz)`. A row means "this starter was seeded once": it stops re-seeding after an editor deletes the problem (FR-8). `problem_id` null = deleted.

**Migration backfill** (one migration, runs once): if the problems table is non-empty, then for each of the 20 legacy seed keys find the problem by its seed title; write a ledger row with its id, or with null if absent (an editor deleted it). If the problems table is empty the deployment is fresh and the ledger starts empty. Known edge: a deployment where an editor deleted *all* problems before this migration looks fresh and receives all 150 again; accepted.

**Category assignment of the existing 20** (FR-2, fixed by this plan):

| Existing topic | → category | Count |
|---|---|---|
| arrays | arrays | 2 easy |
| strings | strings | 3 easy, 1 medium |
| hash maps, sets | hash-maps-sets | 2 easy |
| two pointers | two-pointers-windows | 1 easy |
| stacks | stacks-queues | 1 easy |
| binary search, sorting | sorting-searching | 2 easy |
| recursion | recursion-backtracking | 1 easy |
| dynamic programming | dynamic-programming | 1 medium |
| math, bit manipulation | math-bits | 3 easy, 1 medium |
| greedy, intervals | greedy-intervals | 1 easy, 1 medium |

**Quota per category (final counts including the existing 20; each cell is within 3–6, FR-4).** "New" = final − existing.

| Category | Easy final (new) | Medium final (new) | Hard final (new) | Total |
|---|---|---|---|---|
| arrays | 5 (3) | 5 (5) | 4 (4) | 14 |
| strings | 5 (2) | 5 (4) | 5 (5) | 15 |
| hash-maps-sets | 5 (3) | 4 (4) | 4 (4) | 13 |
| two-pointers-windows | 4 (3) | 5 (5) | 4 (4) | 13 |
| stacks-queues | 4 (3) | 4 (4) | 5 (5) | 13 |
| sorting-searching | 5 (3) | 5 (5) | 5 (5) | 15 |
| recursion-backtracking | 4 (3) | 4 (4) | 5 (5) | 13 |
| dynamic-programming | 4 (4) | 5 (4) | 5 (5) | 14 |
| graphs-trees | 4 (4) | 5 (5) | 5 (5) | 14 |
| math-bits | 5 (2) | 4 (3) | 4 (4) | 13 |
| greedy-intervals | 5 (4) | 4 (3) | 4 (4) | 13 |
| **Total** | **50 (34)** | **50 (46)** | **50 (50)** | **150 (130)** |

## Contracts

All paths are relative to the existing API prefix; **Confirm in task 1** the exact existing list/create/update routes and payload names, and extend them rather than adding parallel ones.

**`GET problems`** (existing list, extended). Query: `q` (existing text search), `category` (one category id, optional), `difficulty` (`easy|medium|hard`, optional). All three combine with AND. Unknown `category` or `difficulty` → `422` with the offending parameter named. Response items gain `category: string | null` and carry `difficulty`; they never carry tests (unchanged, NFR-4). Order is canonical: category order from the table above (null last), then `easy < medium < hard`, then title ascending. The UI groups by consecutive `category`.

**`GET problems/categories`** (new, same auth as the list). `200 [{ "id": "arrays", "label": "Arrays" }, …]` in fixed order, all 11 always, regardless of filters. Route is declared before any `problems/{id}` route so it is not captured as an id.

**Create / update problem** (existing, extended). Body gains optional `category`; if present it must be one of the 11 ids or the request is refused with `422` naming `category` (FR-13). Omitted on create → stored null. Omitted on update → unchanged. Editor-role rules unchanged (spec 001).

**Seed file schema** (`problem.json`, additions only): `"category": "<id>"`, required for every starter. `tests[].expected` is always present in committed files.

**`scripts/seed_fill_expected.py <dir>…`** — for each dir, loads `reference.py`, runs it on every `tests[].args` in the project's runner under its existing limits, writes the produced values into `tests[].expected`. Authors write `args` only; expected values are never typed by hand (NFR-1).

**`scripts/seed_check.py [dir…]`** — exits non-zero with a list of violations. Checks (all of spec FR-1…FR-6, NFR-1…3, NFR-7 that are mechanical):
- 150 starters; difficulty counts 50/50/50; every `category` is in the list; each (category, difficulty) count within 3–6; every seed key unique and directory names for the 20 legacy keys unchanged.
- title unique case-insensitively; title not in `seed/known-titles.txt` (a denylist of well-known catalogue titles, provenance backstop for NFR-7; originality of wording is otherwise judged in review).
- description has `## Task`, `## Input`, `## Output`, `## Example`, `## Constraints`; signature parses and its function name exists in `reference.py`.
- ≥5 tests per problem; every test's `expected` equals the reference's output on re-run, twice (determinism); total reference run time per problem is within the existing limits.
- `reference.py` imports only the standard library and contains no randomness, clock or network use (NFR-3, rule 6).
Presence of a genuine edge case among the tests cannot be machine-judged; it is a review item in each authoring task's diff.

## Test strategy

Levels: **unit** (pure functions, no I/O), **integration** (real PostgreSQL, real runner, real API per constitution rule 4), **component** (picker with the real API client against a fake network only for third-party services — there are none, so the component tests mount the picker with fixture list data through the same props the app passes), **E2E** (browser flows). Every test is written failing first.

| Criterion | Level | Test |
|---|---|---|
| FR-1 | integration | Empty database, run seeding, list with no filter: 150 items, 50/50/50 by difficulty. |
| FR-2 | integration | Database holding the 20 legacy problems plus a session row on one; run migration + seeding; same problem id, session intact, `topic` untouched, `category` filled. |
| FR-3 | unit (`seed_check`) | Every starter has title, description sections, signature, one difficulty, one valid category; negative cases: a fixture missing each field fails the check. |
| FR-4 | unit (`seed_check`) + integration | Counts per (category, difficulty) in 3–6 on the real seed; list API shows no starter without a category. |
| FR-5 | integration | `seed_check` run over all 150: reference passes all stored tests; ≥5 tests each. Edge-case presence: review item. |
| FR-6 | unit (`seed_check`) | Case-insensitive title uniqueness over the real seed; a fixture with a duplicate fails. |
| FR-7 | integration | For a sampled starter per difficulty (first of each, fixed choice): submit the reference through the normal run path → correct; submit a mutated reference failing one test → not correct. |
| FR-8 | integration | Legacy-20 database with one problem edited and one deleted; run seeding twice: the edit kept, the deleted one absent, no duplicates, remaining starters present; second run changes nothing. |
| FR-9 | component | Picker rows expose difficulty and category in their accessible name and visible text. |
| FR-10 | integration + component | API: each filter alone and combined with `q`, results satisfy all predicates, invalid value → 422. UI: choosing category, then difficulty, then typing a search narrows the list as stated. |
| FR-11 | integration + component | API order test (category order, then easy→hard, then title); UI renders a heading per category with items beneath in that order. |
| FR-12 | component | Filters with no match show the empty state and a clear-filters control; activating it restores the list and moves focus sensibly. |
| FR-13 | integration + component | Editor create/update with a valid category stores it and the problem appears under it; invalid id → 422 and the form shows the message. |
| FR-14 | integration + E2E | A guest/invitee session context requests the list with filters and gets the same results; E2E opens a session link as guest and uses both filters. |
| NFR-1, NFR-3 | integration (`seed_check`) | Reference run twice per problem; both runs equal stored expected. |
| NFR-2 | integration (`seed_check`) | Per-problem total reference time under the existing limits; failure names the problem. |
| NFR-4 | integration | List and detail responses for a non-editor contain no `tests`; seed tree scanned for secrets by the existing secret check. |
| NFR-5 | E2E | With 150 problems loaded, time from filter activation to updated list ≤200 ms (asserted with a generous CI margin and the measured value logged). |
| NFR-6 | component + E2E look matrix | Keyboard-only operation, accessible names, narrow width, dark, reduced motion; picker-with-filters added to `e2e/audi/matrix.ts`. |
| NFR-7 | unit (`seed_check`) | Denylist test: a fixture titled with a denylisted name fails. Wording originality is a review item. |

**Seed fixtures for tests:** the 150-problem real seed is the fixture for count/shape tests; legacy-state tests build the 20-problem state by seeding from the original 20 directories only (the check tooling takes a directory list), so no copy of data is needed.

**Per-task gate and speed:** `seed_check` over 150 references runs in a few seconds; it is not marked `slow`. Authoring tasks run `seed_check` on their own directories while iterating and the whole check before ticking (constitution rule 2).

**Authoring workflow for the 130 problems** (so tasks can slice them): author `problem.json` with `args`-only tests and `reference.py` → run `seed_fill_expected.py` → run `seed_check.py` on those dirs → human reviews the descriptions and the edge-case tests. Slice by the quota table: one slice per (category, difficulty) cell, i.e. 3–6 problems, with the table's "new" number as the exact quota. Data directories in a slice count as one unit for the ~3-file task-size rule; the tasks list should state that explicitly. Hard problems are sized so the reference stays within existing limits; where a naive solution should fail, the description says so (NFR-2).

## Constitution compliance

1. **Test-first** — satisfied: the check tooling and loader/API/picker tests are written first and shown failing; for a content slice, `seed_check` failing on missing directories (quota counts not met) is the failing test.
2. **Green before done** — satisfied: per-task gate unchanged; `seed_check` is fast and non-`slow`; full `--full` suite once before validation.
3. **Traceable tests** — satisfied: the mapping table above covers every FR and NFR; `/sdd-tasks` must name the criterion per task.
4. **Real dependencies** — satisfied: real PostgreSQL, real runner, real API; nothing mocked. No third-party service involved.
5. **Fixed stack** — satisfied: Python 3.12/FastAPI/PostgreSQL, React + strict TypeScript, no departure.
6. **Dependency justification** — no new third-party dependency; tooling uses the standard library and the project's runner. References are standard-library only (enforced by `seed_check`).
7. **No secrets** — satisfied: seed data contains no credentials; checked by the existing secret check.
8. **Lint and format** — all new Python (`scripts/`, loader, migration, API) passes `ruff check`/`ruff format --check`; all TypeScript passes `biome ci` and `tsc --noEmit`. Seed `reference.py` files are Python in the repo and are held to the same ruff rules unless the project already excludes `seed/` (**Confirm in task 1**; if excluded, keep the exclusion).
9. **Architecture** — module layout and dependency direction stated above.
10. **UI** (`constitution-ui.md`):
    - A1 home screen: none, per spec (no new startable/live feature).
    - A2 dock / jump-to-anything: no new entries, per spec's resolved decision (an explicit decision, not an omission, although rule A2 would otherwise ask for a problems list entry; the existing problem entries are unchanged).
    - A3 guests/invitees: scoping is server-side — the list endpoint's existing access rules apply; filters add no new data. Covered by FR-14 tests.
    - A4 existing behaviour kept: text search, selecting a problem, keyboard behaviour in the picker preserved; filters are additive.
    - B5 tokens only, no new tokens planned. B8 primitives first: filters are pill-shaped `Button`s/`Menu` from `frontend/src/ui/*` (pressed state exposed with `aria-pressed` or menu semantics); empty state uses `EmptyState`; category headings are real heading elements styled by existing type tokens. No new primitive.
    - B9 states: hover, focus-visible, active, disabled, error on every filter control.
    - C13–C18: narrow reflow (filters wrap or collapse into a `Menu`, no horizontal overflow at ≈390 px), light/dark contrast, reduced motion (no transitions), keyboard/screen-reader (accessible names include state, e.g. "Category: Strings, selected"; result-count change announced politely only when it changes), privacy (server filters only list what the viewer may already see).
    - D19–D22: component tests via role/name queries; picker-with-filters added to `e2e/audi/matrix.ts`; E2E for the filter flow incl. keyboard-only and narrow; visual look at the real app before ticking each UI task.

## Notes for the human (not scope changes)

- **Spec 018 FR-8 acceptance text** says "130 problems are added (or 131 where the deleted one is not re-added)". With the legacy-20 database in that scenario the correct figures are 130 added and the deleted legacy starter *not* re-added (149 total, one legacy deleted). The tests follow the behaviour, not the "131" wording; consider correcting the spec.
- **Spec 001 FR-6 and its criterion** ("exactly the 20 starter problems") are superseded by 018 FR-1; the existing test asserting 20 must be updated to 150 in the loader task. Spec 001's text is not edited by this plan.
- **Editor-created problems without a category** appear under "Other"; this is an addition the spec does not state, needed so existing data stays listable.
- The "Confirm in task 1" items (existing routes and payload names, whether `difficulty` is stored, ruff scope over `seed/`) are facts about code this skill does not read.
