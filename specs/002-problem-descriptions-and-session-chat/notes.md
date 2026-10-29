# 002 — Problem descriptions and session chat: notes

## 2026-10-29 — Validation (`/sdd-validate`)

**Tasks:** 21 of 21 ticked in `tasks.md`.

**Suite** (working tree, uncommitted 002/003/004/005 changes included):

| Step | Result |
|---|---|
| ruff check, ruff format, biome ci, tsc, vite build | pass |
| no Apple assets, theme tokens | pass |
| gitleaks, git history | pass |
| gitleaks, working tree | **fail**: 1 finding, `generic-api-key` at `specs/004-project-hub-shared-ingress/plan.md:238`. The line is `KC_DB_PASSWORD=${POSTGRES_AUTH_PASSWORD}`, a reference to an env var, so the finding is a false positive. It is in spec 004's plan, not this feature, but it stops `scripts/check.sh` before the tests. The later steps were run by hand with the same commands. |
| pytest | 484 passed |
| vitest | 351 passed (34 files) |
| playwright (`default` project) | 60 passed, including `chat.spec.ts` (FR10, FR15, FR16, FR19), `descriptions.spec.ts` (FR2–FR6, NFR Readability), `problems-002.spec.ts` and `session-002.spec.ts` |

The `hub` Playwright project (spec 005) was not run. It needs the deployed hub, and this feature doesn't depend on it.

**Acceptance criteria.** Each was checked against the running stack's E2E behaviour where an E2E covers it, and otherwise against the backend integration tests and a reading of the code.

| Criterion | Result | Evidence |
|---|---|---|
| FR1: empty description refused on create, nothing created | pass | `problems/service.py` `_check_description`, `test_problem_descriptions_api.py` |
| FR1: description cleared on update is refused, stored description unchanged | pass | same |
| FR2: heading, numbered list, inline code and code block render, whitespace kept | pass | `descriptions.spec.ts` FR2, `test_markdown.py` |
| FR3: PNG between paragraphs 2 and 3 is shown there in a session | pass | `descriptions.spec.ts` FR3/FR6 |
| FR4: a 3 MB image is refused, naming 2 MB, text unchanged | pass | E2E FR4; server 413 `image_too_large` |
| FR4: a PDF is refused, listing the formats | pass | E2E FR4; type sniffed from magic bytes, so the declared type is ignored |
| FR4: an 11th image is refused, stating the limit | pass | client pre-check (`imageChecks`), server 422 `too_many_images` |
| FR5: preview of unsaved changes, nothing saved | pass | E2E FR5; `/api/problems/preview` writes nothing |
| FR6: description and images shown beside the shared editor | pass | E2E FR3/FR6, `session-002.spec.ts` AC-15 |
| FR7: new description in both sessions, their code and chat unchanged | pass | `test_description_change.py` |
| FR8: all 20 starter problems have a non-empty description | pass | `test_seed_content.py`; also checked directly: 20 non-empty, 251 to 925 characters each |
| FR9: no hidden-test data in the description | pass | `test_secrecy.py` sweeps the REST detail, `welcome`, `problem_switched` and preview |
| FR10: Ben sees Ana's message, labelled, within 1 s | pass | `chat.spec.ts` FR10 (1000 ms timeout) |
| FR11: order survives a restart | pass | `test_ws_chat.py` (fresh app, same DB); ordered by `bigserial` id |
| FR12: 50 earlier messages in order, then the new one | pass | `test_ws_chat.py` |
| FR13: whitespace-only input is never sent | pass | client `chatError` and server `validate_body` |
| FR14: 2001 characters refused, limit stated, text kept in the input | pass | `ChatPane` clears the input only on `ok`; the refusal text names 2000 |
| FR14: exactly 2000 characters are delivered | pass | `test_ws_chat.py`, `test_chat_rules.py` (code points, astral characters included) |
| FR15: markup shown as literal text, no script | pass | `chat.spec.ts` FR15; the body is a React text node |
| FR16: stale session shows history read-only; sending works after reactivation | pass, see note 1 | `chat.spec.ts` FR16 |
| FR17: no messages leak between sessions; no chat without the invite | pass | every query is scoped to the session the invite resolves to; `test_chat_api.py`, `test_chat_repo.py` |
| FR18: messages sent while away, once each and in order, on reconnect | pass | `welcome.chat` replaces the client's list (`replaceHistory`) |
| FR19: an admin's removal disappears for everyone within 1 s and is absent for later joiners | pass | `chat.spec.ts` FR19 |
| FR19: non-admins (sender, participant, editor) can't remove | pass | `require_role("admin")`; a `chat_remove` frame over the WebSocket is ignored |
| NFR Images, Security, Durability, Retention, Readability | pass | migration checks; serve headers `nosniff` and `default-src 'none'`; broadcast only after the insert; removal hides rows rather than deleting them; E2E at 1024 px |

**Notes and learnings (no drift in spec.md):**

1. **FR16, reactivation is seen on reload.** A participant who already has a stale session open does not become able to send when an admin reactivates it. They can send once they reload or reopen the session, which is what the E2E does. That meets the criterion as written, since it doesn't require the change to appear live. If it should appear live, that is a spec change.
2. **Image URLs carry the base path.** `render_description` prefixes `/api/images/<uuid>` with the app's base path, which came from spec 005. Descriptions still store the bare `/api/images/<uuid>` form, so nothing in 002 changed.
3. **The order across specs held.** The order from the plan (002 waves 1–4, then 003 tasks 39–41, then 002 waves 5–6) produced no rework.
4. **The secret scan blocks the suite.** `scripts/check.sh` stops at the gitleaks working-tree finding in spec 004's plan, a false positive. Until it's fixed in 004's plan or allowlisted, the full suite can't run green from the script.
5. **The index is behind.** `specs/README.md` still lists 002 as `approved`. Moving it to `validated` is the human's step.

spec.md is not stale on any point found here.
