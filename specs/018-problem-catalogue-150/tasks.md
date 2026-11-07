# 018 — Problem catalogue of 150: tasks

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1 | Schema, ledger and category list underpin everything backend |
| 2 | 2 | Validator is required by every content task and by the loader tests |
| 3 | 3, 4 — all `[P]`; 6 (depends only on 1, different files) | Fill tool and legacy categories need only the validator; list API needs only the schema |
| 4 | 5; 7; 8 | Loader (needs 1, 2); create/update validation (needs 6); picker UI (needs 6) — different files, can run together |
| 5 | 9 | Editor form needs the validated create/update contract |
| 6 | 10–42 — all `[P]` | 33 content slices, pre-numbered disjoint directory ranges; need only 2 and 3 |
| 7 | 43 | Whole-catalogue verification after loader, API and all content |
| 8 | 44 | E2E and look matrix need UI, editor form and the full 150 |

## Checklist

- [x] **1** — Category list, schema and ledger migration
- [x] **2** — seed_check.py validator and title denylist
- [x] **3** — `[P]` seed_fill_expected.py
- [x] **4** — `[P]` Category field on the 20 existing starters
- [x] **5** — Seed loader: insert missing starters, backfill category
- [x] **6** — Problem list API: filters, order, fields, categories endpoint
- [x] **7** — Create/update validates category and difficulty
- [x] **8** — Picker: filters, grouping, empty state
- [x] **9** — Editor form: category and difficulty selects
- [x] **10** — `[P]` Author 3 new easy problems: Arrays
- [x] **11** — `[P]` Author 5 new medium problems: Arrays
- [x] **12** — `[P]` Author 4 new hard problems: Arrays
- [x] **13** — `[P]` Author 2 new easy problems: Strings
- [x] **14** — `[P]` Author 4 new medium problems: Strings
- [x] **15** — `[P]` Author 5 new hard problems: Strings
- [x] **16** — `[P]` Author 3 new easy problems: Hash maps & sets
- [x] **17** — `[P]` Author 4 new medium problems: Hash maps & sets
- [x] **18** — `[P]` Author 4 new hard problems: Hash maps & sets
- [x] **19** — `[P]` Author 3 new easy problems: Two pointers & sliding window
- [x] **20** — `[P]` Author 5 new medium problems: Two pointers & sliding window
- [x] **21** — `[P]` Author 4 new hard problems: Two pointers & sliding window
- [x] **22** — `[P]` Author 3 new easy problems: Stacks & queues
- [x] **23** — `[P]` Author 4 new medium problems: Stacks & queues
- [x] **24** — `[P]` Author 5 new hard problems: Stacks & queues
- [x] **25** — `[P]` Author 3 new easy problems: Sorting & searching
- [x] **26** — `[P]` Author 5 new medium problems: Sorting & searching
- [x] **27** — `[P]` Author 5 new hard problems: Sorting & searching
- [x] **28** — `[P]` Author 3 new easy problems: Recursion & backtracking
- [x] **29** — `[P]` Author 4 new medium problems: Recursion & backtracking
- [x] **30** — `[P]` Author 5 new hard problems: Recursion & backtracking
- [x] **31** — `[P]` Author 4 new easy problems: Dynamic programming
- [x] **32** — `[P]` Author 4 new medium problems: Dynamic programming
- [x] **33** — `[P]` Author 5 new hard problems: Dynamic programming
- [x] **34** — `[P]` Author 4 new easy problems: Graphs & trees
- [x] **35** — `[P]` Author 5 new medium problems: Graphs & trees
- [x] **36** — `[P]` Author 5 new hard problems: Graphs & trees
- [x] **37** — `[P]` Author 2 new easy problems: Math & bit tricks
- [x] **38** — `[P]` Author 3 new medium problems: Math & bit tricks
- [x] **39** — `[P]` Author 4 new hard problems: Math & bit tricks
- [x] **40** — `[P]` Author 4 new easy problems: Greedy & intervals
- [x] **41** — `[P]` Author 3 new medium problems: Greedy & intervals
- [x] **42** — `[P]` Author 4 new hard problems: Greedy & intervals
- [x] **43** — Full-seed integration tests
- [x] **44** — E2E and look matrix for the picker

## Tasks

Content-slice note: a slice's directories count as one data unit for the ~3-file task-size rule (plan.md, authoring workflow). Directory numbers: `021`–`150` are pre-assigned across slices in task order; the 20 existing directories keep their names. Every task ends with the per-task gate (constitution rule 2/8; UI tasks also rule 10 and a look at the real app).

### 1. Category list, schema and ledger migration

- **Plan:** Data model (category list, `category` column, `seeded_problem` ledger, migration backfill). **Spec:** FR-2, FR-4, FR-8.
- **Files:** backend problems model + one migration + its test (confirm names first; record findings in `notes.md`)
- **Depends on:** nothing
- **Do:** Confirm existing facts (list/create/update routes and payloads, whether `difficulty` is stored, seeding step location, ruff scope over `seed/`) and note them in `notes.md`. Add the 11-category constant (ids, labels, fixed order), the nullable `category` column with a CHECK on the ids (and `difficulty` with CHECK if missing), the `seeded_problem` table, and the backfill: non-empty problems table → ledger rows for the 20 legacy keys matched by title (null id if absent); empty table → no rows.
- **Acceptance:**
  - *FR-8 — Given a deployment with the original 20 problems where an editor deleted one, when the migration runs, then the deleted legacy starter has a ledger row with null problem id and the others have rows with their ids.* Integration test on real PostgreSQL.
  - *Fresh database — when the migration runs, then the ledger is empty.*
  - *FR-4 — inserting a problem with a category outside the list is rejected by the database.*

### 2. seed_check.py validator and title denylist

- **Plan:** Seed tooling (`scripts/seed_check.py`, `seed/known-titles.txt`). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `scripts/seed_check.py`, `seed/known-titles.txt`, its test
- **Depends on:** nothing
- **Do:** Implement every check listed in plan.md Contracts for `seed_check.py`, runnable on a list of directories or the whole seed (`--expect-total` enables the 150 / 50-50-50 / 3–6 cell checks so slice runs do not fail on counts). Run references through the project's runner under the existing limits. Seed `known-titles.txt` with well-known catalogue titles.
- **Acceptance:**
  - *FR-3 — Given a fixture problem missing title, a description section, signature, difficulty or category, when checked, then it is reported and the exit code is non-zero.*
  - *FR-6 — Given two fixtures with titles equal case-insensitively, then it fails.*
  - *FR-5 — Given a fixture with fewer than 5 tests or a reference failing a stored test, then it fails; a good fixture passes.*
  - *NFR-3 — Given a reference using randomness, clock or network, then it fails.*
  - *NFR-7 — Given a fixture titled with a denylisted name, then it fails.*
  - *NFR-2 — Given a reference exceeding the run limits, then it fails naming the problem.*

### 3. `[P]` seed_fill_expected.py

- **Plan:** Seed tooling (`scripts/seed_fill_expected.py`). **Spec:** NFR-1, NFR-3.
- **Files:** `scripts/seed_fill_expected.py`, its test
- **Depends on:** 2 (shares the runner invocation helper; reuse, do not duplicate)
- **Do:** Run `reference.py` on every `tests[].args` of the given directories and write results into `tests[].expected`; run twice and refuse to write if the two runs differ.
- **Acceptance:**
  - *NFR-1 — Given a fixture with args only, when run, then expected equals the reference output and the file passes seed_check.*
  - *NFR-3 — Given a nondeterministic reference, then nothing is written and it exits non-zero.*

### 4. `[P]` Category field on the 20 existing starters

- **Plan:** Seed content (legacy re-categorisation). **Spec:** FR-2, FR-4.
- **Files:** the 20 existing `seed/problems/*/problem.json` (data unit; only adds `category`, per the plan's mapping table)
- **Depends on:** 2
- **Do:** Add `category` to each of the 20 existing `problem.json` files using the mapping table in plan.md. Change nothing else; `topic` and directory names stay.
- **Acceptance:**
  - *FR-2 — Given the 20 files, then diff shows only an added `category` line each, and seed_check passes on them.*
  - *FR-4 — every one has a category from the list.*

### 5. Seed loader: insert missing starters, backfill category

- **Plan:** Seed loader (extended). **Spec:** FR-1, FR-2, FR-8.
- **Files:** existing seeding module + its test
- **Depends on:** 1, 2
- **Do:** For each seed dir without a ledger row: insert the problem (with category) and a ledger row. For ledger rows with a live problem whose `category` is null: set category only. Never touch other fields; never re-add when the ledger says seeded. Tests use temporary seed directories, not the real seed.
- **Acceptance:**
  - *FR-8 — Given a legacy-20 database with one problem edited and one deleted, when seeding runs twice, then the edit is kept, the deleted one stays deleted, no problem appears twice, new starters are present, and the second run changes nothing.*
  - *FR-2 — Given a legacy database and a session on a starter, when seeding runs, then problem id and session are unchanged, `topic` untouched, `category` filled.*
  - *FR-1 — Given an empty database and a temp seed of N directories, when seeding runs, then N problems exist.*
  - Update the existing test asserting 20 starters to the new behaviour without hard-coding 150 (the 150 check lives in task 43).

### 6. Problem list API: filters, order, fields, categories endpoint

- **Plan:** Problem list API. **Spec:** FR-4, FR-9, FR-10, FR-11, FR-14, NFR-4.
- **Files:** existing problems router + its test
- **Depends on:** 1
- **Do:** Add `category` and `difficulty` filters (AND with `q`, 422 on unknown values), return both fields per item without tests, canonical order (category order, null last; easy<medium<hard; title), and `GET problems/categories` declared before id routes. Same access rules as today, including guests.
- **Acceptance:**
  - *FR-10 — Given problems of mixed category/difficulty, when filtering by category, by difficulty, by both, and with a search word, then every result satisfies all predicates; an invalid value returns 422.*
  - *FR-11 — order is category order, then easy before medium before hard, then title.*
  - *FR-9 — each item carries difficulty and category.*
  - *FR-14 — a guest/invitee context gets the same results.*
  - *NFR-4 — non-editor responses contain no tests.*

### 7. Create/update validates category and difficulty

- **Plan:** Problem list API (create/update contract). **Spec:** FR-13.
- **Files:** existing problems router/schema + its test
- **Depends on:** 6
- **Do:** Accept optional `category` on create/update, validated against the list (422 naming `category`); omitted on create stores null, omitted on update leaves unchanged.
- **Acceptance:**
  - *FR-13 — Given an editor creating a problem with a valid category and difficulty, then it appears under them in the list; Given a category outside the list, then the request is refused naming `category`.*
  - *Editor-role rules from spec 001 unchanged.*

### 8. Picker: filters, grouping, empty state

- **Plan:** Problem picker UI. **Spec:** FR-9, FR-10, FR-11, FR-12, FR-14, NFR-5, NFR-6.
- **Files:** existing picker component, its CSS (tokens only), its test
- **Depends on:** 6
- **Do:** Add category and difficulty filter controls (existing `ui/*` primitives, `aria-pressed`/menu semantics, accessible names with state), show category and difficulty on rows, group by category with headings when unfiltered, `EmptyState` with clear-filters control, polite result-count announcement, narrow layout. Update the picker's problem-list client call. Look at the real app before ticking.
- **Acceptance:**
  - *FR-9 — rows show difficulty and category.*
  - *FR-10 — selecting a category, then a difficulty, then typing narrows the list as stated.*
  - *FR-11 — category headings, easy before medium before hard within each.*
  - *FR-12 — no match shows the message and a clear-filters control; activating it restores the list.*
  - *NFR-6 — operable by keyboard, accessible names, narrow width, dark, reduced motion.*

### 9. Editor form: category and difficulty selects

- **Plan:** Problem picker UI (editor form). **Spec:** FR-13.
- **Files:** existing problem editor form + its test
- **Depends on:** 7
- **Do:** Add category (the API's list) and difficulty selects to the create/edit form; show the server's refusal message for an invalid category.
- **Acceptance:**
  - *FR-13 — Given an editor saving with category and difficulty chosen, then the problem lists under them; Given the server refuses a category, then the form shows the message.*
  - *NFR-6 — selects keyboard operable with accessible names.*

### 10. `[P]` Author 3 new easy problems: Arrays

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/021-*` … `023-*` (3 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 3 original easy problems with category `arrays`, in directories numbered `021`–`023` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `arrays`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 3 directories added for this cell; seed_check passes on them.*

### 11. `[P]` Author 5 new medium problems: Arrays

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/024-*` … `028-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original medium problems with category `arrays`, in directories numbered `024`–`028` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `arrays`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*

### 12. `[P]` Author 4 new hard problems: Arrays

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/029-*` … `032-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original hard problems with category `arrays`, in directories numbered `029`–`032` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `arrays`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 13. `[P]` Author 2 new easy problems: Strings

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/033-*` … `034-*` (2 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 2 original easy problems with category `strings`, in directories numbered `033`–`034` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `strings`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 2 directories added for this cell; seed_check passes on them.*

### 14. `[P]` Author 4 new medium problems: Strings

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/035-*` … `038-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original medium problems with category `strings`, in directories numbered `035`–`038` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `strings`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*

### 15. `[P]` Author 5 new hard problems: Strings

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/039-*` … `043-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original hard problems with category `strings`, in directories numbered `039`–`043` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `strings`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 16. `[P]` Author 3 new easy problems: Hash maps & sets

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/044-*` … `046-*` (3 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 3 original easy problems with category `hash-maps-sets`, in directories numbered `044`–`046` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `hash-maps-sets`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 3 directories added for this cell; seed_check passes on them.*

### 17. `[P]` Author 4 new medium problems: Hash maps & sets

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/047-*` … `050-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original medium problems with category `hash-maps-sets`, in directories numbered `047`–`050` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `hash-maps-sets`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*

### 18. `[P]` Author 4 new hard problems: Hash maps & sets

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/051-*` … `054-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original hard problems with category `hash-maps-sets`, in directories numbered `051`–`054` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `hash-maps-sets`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 19. `[P]` Author 3 new easy problems: Two pointers & sliding window

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/055-*` … `057-*` (3 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 3 original easy problems with category `two-pointers-windows`, in directories numbered `055`–`057` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `two-pointers-windows`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 3 directories added for this cell; seed_check passes on them.*

### 20. `[P]` Author 5 new medium problems: Two pointers & sliding window

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/058-*` … `062-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original medium problems with category `two-pointers-windows`, in directories numbered `058`–`062` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `two-pointers-windows`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*

### 21. `[P]` Author 4 new hard problems: Two pointers & sliding window

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/063-*` … `066-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original hard problems with category `two-pointers-windows`, in directories numbered `063`–`066` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `two-pointers-windows`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 22. `[P]` Author 3 new easy problems: Stacks & queues

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/067-*` … `069-*` (3 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 3 original easy problems with category `stacks-queues`, in directories numbered `067`–`069` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `stacks-queues`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 3 directories added for this cell; seed_check passes on them.*

### 23. `[P]` Author 4 new medium problems: Stacks & queues

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/070-*` … `073-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original medium problems with category `stacks-queues`, in directories numbered `070`–`073` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `stacks-queues`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*

### 24. `[P]` Author 5 new hard problems: Stacks & queues

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/074-*` … `078-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original hard problems with category `stacks-queues`, in directories numbered `074`–`078` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `stacks-queues`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 25. `[P]` Author 3 new easy problems: Sorting & searching

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/079-*` … `081-*` (3 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 3 original easy problems with category `sorting-searching`, in directories numbered `079`–`081` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `sorting-searching`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 3 directories added for this cell; seed_check passes on them.*

### 26. `[P]` Author 5 new medium problems: Sorting & searching

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/082-*` … `086-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original medium problems with category `sorting-searching`, in directories numbered `082`–`086` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `sorting-searching`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*

### 27. `[P]` Author 5 new hard problems: Sorting & searching

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/087-*` … `091-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original hard problems with category `sorting-searching`, in directories numbered `087`–`091` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `sorting-searching`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 28. `[P]` Author 3 new easy problems: Recursion & backtracking

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/092-*` … `094-*` (3 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 3 original easy problems with category `recursion-backtracking`, in directories numbered `092`–`094` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `recursion-backtracking`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 3 directories added for this cell; seed_check passes on them.*

### 29. `[P]` Author 4 new medium problems: Recursion & backtracking

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/095-*` … `098-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original medium problems with category `recursion-backtracking`, in directories numbered `095`–`098` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `recursion-backtracking`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*

### 30. `[P]` Author 5 new hard problems: Recursion & backtracking

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/099-*` … `103-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original hard problems with category `recursion-backtracking`, in directories numbered `099`–`103` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `recursion-backtracking`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 31. `[P]` Author 4 new easy problems: Dynamic programming

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/104-*` … `107-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original easy problems with category `dynamic-programming`, in directories numbered `104`–`107` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `dynamic-programming`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*

### 32. `[P]` Author 4 new medium problems: Dynamic programming

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/108-*` … `111-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original medium problems with category `dynamic-programming`, in directories numbered `108`–`111` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `dynamic-programming`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*

### 33. `[P]` Author 5 new hard problems: Dynamic programming

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/112-*` … `116-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original hard problems with category `dynamic-programming`, in directories numbered `112`–`116` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `dynamic-programming`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 34. `[P]` Author 4 new easy problems: Graphs & trees

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/117-*` … `120-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original easy problems with category `graphs-trees`, in directories numbered `117`–`120` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `graphs-trees`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*

### 35. `[P]` Author 5 new medium problems: Graphs & trees

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/121-*` … `125-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original medium problems with category `graphs-trees`, in directories numbered `121`–`125` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `graphs-trees`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*

### 36. `[P]` Author 5 new hard problems: Graphs & trees

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/126-*` … `130-*` (5 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 5 original hard problems with category `graphs-trees`, in directories numbered `126`–`130` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `graphs-trees`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 5 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 37. `[P]` Author 2 new easy problems: Math & bit tricks

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/131-*` … `132-*` (2 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 2 original easy problems with category `math-bits`, in directories numbered `131`–`132` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `math-bits`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 2 directories added for this cell; seed_check passes on them.*

### 38. `[P]` Author 3 new medium problems: Math & bit tricks

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/133-*` … `135-*` (3 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 3 original medium problems with category `math-bits`, in directories numbered `133`–`135` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `math-bits`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 3 directories added for this cell; seed_check passes on them.*

### 39. `[P]` Author 4 new hard problems: Math & bit tricks

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/136-*` … `139-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original hard problems with category `math-bits`, in directories numbered `136`–`139` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `math-bits`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 40. `[P]` Author 4 new easy problems: Greedy & intervals

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/140-*` … `143-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original easy problems with category `greedy-intervals`, in directories numbered `140`–`143` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `easy`, category `greedy-intervals`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*

### 41. `[P]` Author 3 new medium problems: Greedy & intervals

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/144-*` … `146-*` (3 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 3 original medium problems with category `greedy-intervals`, in directories numbered `144`–`146` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `medium`, category `greedy-intervals`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 3 directories added for this cell; seed_check passes on them.*

### 42. `[P]` Author 4 new hard problems: Greedy & intervals

- **Plan:** Seed content (quota table). **Spec:** FR-3, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-7.
- **Files:** `seed/problems/147-*` … `150-*` (4 directories × `problem.json`+`reference.py`; one data unit)
- **Depends on:** 2, 3
- **Do:** Write exactly 4 original hard problems with category `greedy-intervals`, in directories numbered `147`–`150` (numbers pre-assigned so parallel slices never collide; slug from title). Author args-only tests (≥5, at least one genuine edge case), then run `seed_fill_expected.py` and `seed_check.py` on these directories. Original wording; standard library only; deterministic.
- **Acceptance:**
  - *FR-3 — each has title, task/input/output/example/constraints description, signature, difficulty `hard`, category `greedy-intervals`.*
  - *FR-5 — each reference passes all its ≥5 stored tests, including an edge case (review item).*
  - *FR-6, NFR-7 — titles unique among all seeds and not in the denylist.*
  - *Quota — exactly 4 directories added for this cell; seed_check passes on them.*
  - *NFR-2 — hard references stay within existing run limits; description says where a naive solution is expected to fail.*

### 43. Full-seed integration tests

- **Plan:** Seed content + loader + API (whole catalogue). **Spec:** FR-1, FR-4, FR-5, FR-7, NFR-1, NFR-2, NFR-3, NFR-4.
- **Files:** new integration test file(s) over the real seed; fix-ups only if a check fails
- **Depends on:** 4, 5, 6, 10–42
- **Do:** Run `seed_check --expect-total` over the real seed and assert end-to-end behaviour on a fresh database. Fix any seed defect the check finds in the owning directory.
- **Acceptance:**
  - *FR-1 — Given a fresh deployment, when listed with no filter, then exactly 150 problems: 50 easy, 50 medium, 50 hard.*
  - *FR-4 — every (category, difficulty) cell has 3–6 problems; none has no category or more than one.*
  - *FR-5, NFR-1, NFR-3 — every reference passes its tests, twice identically.*
  - *FR-7 — first starter of each difficulty: reference correct, mutated reference not correct.*
  - *NFR-2 — every hard reference within limits.*
  - *NFR-4 — non-editor list and detail responses contain no tests.*

### 44. E2E and look matrix for the picker

- **Plan:** Problem picker UI (E2E, look matrix). **Spec:** FR-10, FR-14, NFR-5, NFR-6.
- **Files:** `e2e/audi/matrix.ts` entry, one E2E spec
- **Depends on:** 8, 9, 43
- **Do:** Add the picker-with-filters to the look matrix and write E2E: signed-in filtering by category+difficulty+text, guest via session link, keyboard-only path, narrow viewport, and a timing assertion with a generous CI margin.
- **Acceptance:**
  - *FR-14 — Given a guest opens a session link and its picker, when they use the filters, then the same filters and grouping work.*
  - *FR-10 — filters combine with search in the real app.*
  - *NFR-5 — with 150 problems the filtered list appears within 200 ms (measured value logged).*
  - *NFR-6 — keyboard-only, dark, narrow and reduced-motion look checks pass.*
