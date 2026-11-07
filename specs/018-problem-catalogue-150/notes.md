# Notes — 018

## Task 1 findings

Facts confirmed in code (backend/app/problems/, seed/, backend/pyproject.toml). Corrections to plan.md assumptions are marked **(differs)**.

- **Table names (differs):** the table is `problem` (singular), tests in `problem_test`. Migrations are numbered `.sql` files in `backend/app/migrations/` (latest `0009`); this spec adds `0010_problem_category.sql`. Migration runner: `app.db.migrate`.
- **Routes** (router `backend/app/problems/api.py`, prefix `/api/problems`):
  - `GET /api/problems?q=` -> `[{id, title, is_starter}]`, **no auth dependency** (guests and signed-out callers get the same list). Soft-deleted rows excluded. Ordered by title today.
  - `GET /api/problems/{id}` -> `{id, title, description, description_html, signature, deleted}` (no tests).
  - `POST /api/problems` (editor) body `{title, description, signature, tests:[{args, expected}]}` -> 201 `{id}`.
  - `GET /api/problems/{id}/edit` (editor) -> `{id,title,description,signature,tests}`. `PUT /api/problems/{id}` (editor) same body as POST. `DELETE` = soft delete (`deleted_at`), 204.
  - `POST /api/problems/preview` is declared before `/{id}` routes; `GET /categories` must be too.
  - 422 bodies from this router: `{"detail": {"errors":[{"field","message"}]}}` or `{"detail":{"error":code}}`.
- **`difficulty` is NOT stored (differs)**; neither is `topic`. The loader ignores both today. Task 1 adds nullable `problem.difficulty` (CHECK easy|medium|hard) and `problem.category` (CHECK on the 11 ids). Existing rows get null until the loader backfills them (task 5 backfills `category` AND `difficulty` where null).
- **Seeding location:** `backend/app/problems/seed.py` `load_seed(conn, seed_dir)`; it already has a per-problem identity `problem.seed_key` (folder name) and adopts pre-0002 starters by title. Editor deletion is a soft delete (row and seed_key stay), so "deleted is not re-seeded" already holds; the new `seeded_problem` ledger from the plan additionally covers hard-deleted rows. Existing test: `backend/tests/integration/test_seed_loader.py` (uses fixtures in `tests/integration/fixtures/seed_problems`), and `test_seed_content.py` asserts the real seed (20 starters; to be revisited in the loader task).
- **Seed folder names (differs):** the 20 legacy dirs are `01-sum-two` … `20-count-set-bits` (two-digit), not `NNN`. They keep their names. New ones are `021`+ per tasks.md.
- **Ruff scope:** `backend/pyproject.toml` (line length 100, rules E F W I B UP S ASYNC). `scripts/check.sh` runs ruff over `backend/` (`.`) plus `runner/` and `sandbox/` only: `seed/` and `scripts/` are NOT in ruff's scope today (nothing excluded explicitly; they are simply not passed). Plan rule 8 says keep that; run ruff manually on new `scripts/*.py` anyway. Backend code, tests and scripts are all held to it.
- **List API contract (task 6):** items will be `{id, title, is_starter, category, difficulty}`; `GET /api/problems/categories` -> `[{id,label}]` x11; `category`/`difficulty` query filters, 422 `{"detail":{"error":"invalid_category"|"invalid_difficulty","field":"category"|"difficulty"}}` naming the parameter.
- **Create/update (task 7):** body gains optional `category` and `difficulty`; invalid -> 422 `{"detail":{"errors":[{"field":"category","message":...}]}}`.

## Seed tooling usage

Run from the repo root. Python 3.10+ is needed; use the backend venv. No env vars, Docker or services needed (references run through `sandbox/harness.py`'s own per-case runner under its wall/CPU limits; on macOS the memory limit is not enforced locally, the container enforces it).

```
PY=backend/.venv/bin/python
# 1. author seed/problems/NNN-slug/{problem.json,reference.py}; tests[] carry only "args"
$PY scripts/seed_fill_expected.py seed/problems/021-foo seed/problems/022-bar   # writes tests[].expected
$PY scripts/seed_check.py seed/problems/021-foo seed/problems/022-bar            # fast per-slice check
$PY scripts/seed_check.py                                                        # whole seed, per-problem checks
$PY scripts/seed_check.py --expect-total                                         # + 150 / 50-50-50 / 3-6 cells / legacy keys
```

- Both tools exit non-zero and print `<dir>: <violation>` lines. `seed_fill_expected.py` writes nothing for a directory whose reference errors, times out, is non-deterministic or imports a banned module.
- `problem.json` needs `title`, `description` (with `## Task`, `## Input`, `## Output`, `## Example`, `## Constraints`), `signature`, `difficulty`, `category` (plan's 11 ids), and at least 5 `tests`. A test is `{ "args": [...] }` before filling.
- `reference.py`: stdlib only; no `random`, `time`, `datetime`, `os`, `socket`, `uuid`, `threading`, `asyncio`, `open()`, `eval` etc. (see `BANNED_MODULES` in `scripts/seed_check.py`).
- Title must be unique (case-insensitive) among the checked directories and not in `seed/known-titles.txt`. Uniqueness is only checked among the dirs you pass; run the whole-seed check to catch cross-slice clashes.
- Run the check on only your own directories while iterating; the whole-seed run takes about a second per 20 problems.
- The 20 legacy problems currently fail the check only on the missing `category` (task 4 adds it).

### Task 1/5/6/7 implementation facts (for other agents)

- Migration `0010_problem_category.sql`: `problem.category`, `problem.difficulty` (nullable, CHECKed), `seeded_problem(seed_key pk, problem_id fk, seeded_at)`. Deviation: no `on delete set null` on the ledger FK, because spec 001 NFR-9 (test_schema) forbids FK actions; the app only soft-deletes. The 20 legacy keys and titles are hard-coded in the migration backfill.
- `backend/app/problems/categories.py` holds `CATEGORIES`, `CATEGORY_IDS`, `DIFFICULTIES`.
- Loader: `category` (must be in the list) and `difficulty` are read from `problem.json` and stored; for an already-seeded problem only missing seed_key/category/difficulty are filled. Uses `seeded_problem` to avoid re-adding.
- API: list items are `{id,title,is_starter,category,difficulty}`; `GET /api/problems/categories`; filters 422 `{"detail":{"error":"invalid_category"|"invalid_difficulty","field":...}}`; create/update accept `category`/`difficulty`, invalid -> 422 `{"detail":{"errors":[{"field":"category","message":...}]}}`; omitted on update = unchanged (so a category cannot be cleared back to null through the API). `GET /api/problems/{id}/edit` does NOT yet return category/difficulty (task 9 may need it added).
- Backend tests needing no Keycloak: `test_problem_category_schema.py`, `test_problems_catalogue_api.py` (bare app, router mounted directly), `test_seed_loader.py`.
