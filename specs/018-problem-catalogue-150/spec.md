# 018 — Problem catalogue of 150

## Problem / Why

The site ships with only 20 starter problems, 16 of them easy and none hard, so groups run out of material quickly and cannot practise at a level that stretches them. The catalogue should grow into a balanced library of 150 problems, 50 each of easy, medium and hard, sorted into categories so people can find problems on the topic and at the level they want. The 20 existing starter problems count toward the 150 (16 easy, 4 medium), so 130 new problems are needed: 34 easy, 46 medium, 50 hard. All problems are written for this project, not copied from another site.

## Users

- **Participants and guests** — pick a problem for a session and want to browse by category and difficulty.
- **Editors** — maintain the catalogue; the new problems are ordinary problems they can view, edit and delete like any other (spec 001).

## Functional requirements

### Catalogue content

- **FR-1** WHEN the system is first made available THE SYSTEM SHALL already contain exactly 150 starter problems: 50 easy, 50 medium and 50 hard. This replaces spec 001's starter count of 20.
- **FR-2** THE SYSTEM SHALL keep the 20 existing starter problems with their current identity, so sessions that reference them keep working, and count them within the 150.
- **FR-3** WHEN a starter problem is seeded THE SYSTEM SHALL give it a title, a description with task, input, output, example and constraints, a Python function signature, exactly one difficulty (easy, medium or hard) and exactly one category.
- **FR-4** THE SYSTEM SHALL assign every problem to one category from a fixed list (see Open questions), and every category SHALL contain, for each difficulty, between 3 and 6 problems (the even share of 50 over 11 categories is about 4.5, ±2).
- **FR-5** WHEN a starter problem is seeded THE SYSTEM SHALL give it hidden tests that include edge cases, and a reference solution that passes all of them.
- **FR-6** THE SYSTEM SHALL give every starter problem a title unique among the starter set and an original description and tests.
- **FR-7** WHEN a starter problem is graded THE SYSTEM SHALL judge it by the same rules as every other problem: a solution is correct only if it passes all of the problem's tests within the run limits.
- **FR-8** WHEN the system is updated on a deployment that already has the 20 starter problems, with or without editor changes to them, THE SYSTEM SHALL add the missing starter problems without duplicating existing ones and without overwriting an editor's edits or deletions of starter problems.

### Browsing

- **FR-9** WHEN a user opens the problem picker THE SYSTEM SHALL show each problem's difficulty and category.
- **FR-10** WHEN a user chooses a category THE SYSTEM SHALL list only that category's problems, and WHEN they choose a difficulty THE SYSTEM SHALL list only problems of that difficulty; both filters SHALL combine, and combine with text search.
- **FR-11** WHEN a user views the problem list without a filter THE SYSTEM SHALL group the problems by category, ordered easy to hard within each category.
- **FR-12** WHEN a filter matches no problem THE SYSTEM SHALL say so and offer to clear the filters.
- **FR-13** WHEN an editor creates or edits a problem THE SYSTEM SHALL let them set its category (from the fixed list) and difficulty.
- **FR-14** WHEN a guest or invitee opens the problem picker THE SYSTEM SHALL show the same filters and grouping.

## Non-functional requirements

- **NFR-1 Correctness:** every reference solution passes its own tests, and every test's expected output is verified by running the reference, not written by hand.
- **NFR-2 Feasibility:** each hard problem's reference solution passes all its tests within the existing run limits (time and memory); no new cap is introduced; tests are sized so a correct efficient solution passes and a naive exponential or quadratic-on-large-input one fails only where the description says that is intended.
- **NFR-3 Determinism:** tests are deterministic; no randomness, clock or network in tests or references.
- **NFR-4 Hidden tests:** tests stay visible to editors only (spec 001); the seed data contains no secrets.
- **NFR-5 Performance:** the problem list with 150 entries loads and filters without a perceptible delay (filter result shown within 200 ms of a choice on a normal connection).
- **NFR-6 Accessibility and UI rules:** filters follow `memory/constitution-ui.md` (tokens only, primitives reused, keyboard operable, screen-reader labelled, usable on narrow screens, dark mode, reduced motion).
- **NFR-7 Provenance:** problems are written for this project; no text or tests copied from other catalogues.

## Out of scope

- Per-user progress, solved markers, scores, streaks or recommendations.
- Tags beyond one category and one difficulty; multiple categories per problem.
- Languages other than Python.
- Editorials, hints or video explanations.
- Importing problems from outside the project.
- Changing how sessions run or grade code.
- A new home-screen tile (the picker is an existing screen; no new startable, joinable or live feature).

## Acceptance criteria

**FR-1** — Given a fresh deployment, When the catalogue is listed with no filter, Then there are exactly 150 problems, 50 with difficulty easy, 50 medium and 50 hard.

**FR-2** — Given a deployment seeded before this change with a session on a starter problem, When the system is updated, Then that session still opens on the same problem with its code intact.

**FR-3** — Given any starter problem, When its stored data is read, Then it has a non-empty title, description containing task, input, output, example and constraints sections, a function signature, one difficulty and one category.

**FR-4** — Given the fixed category list, When problems are counted per category and difficulty, Then every category has, for each difficulty, between 3 and 6 problems, and no problem has no category or more than one.

**FR-5** — Given each starter problem, When its reference solution is run against its tests, Then all tests pass, and there are at least 5 tests per problem including at least one edge case (empty, minimum or boundary input as the problem allows).

**FR-6** — Given the 150 starter problems, When titles are compared case-insensitively, Then no two are equal.

**FR-7** — Given a starter problem and a wrong solution that fails one test, When it is run, Then the result is not correct; Given the reference, Then it is correct.

**FR-8** — Given a deployment with the original 20 problems where an editor edited one and deleted another, When the system is updated, Then 130 problems are added (or 131 where the deleted one is not re-added), the edited problem keeps its edits, the deleted one stays deleted, and no problem appears twice.

**FR-9** — Given the problem picker is open, When it lists problems, Then each row shows its difficulty and category.

**FR-10** — Given the picker, When the user selects category "Strings", Then every listed problem has category Strings; When they also select "hard", Then every listed problem is Strings and hard; When they also type a search word, Then every listed problem also matches that text.

**FR-11** — Given no filter, When the picker lists problems, Then they appear under category headings, and within each heading easy problems come before medium before hard.

**FR-12** — Given a filter combination with no matching problem (e.g. a text search with no hit), When applied, Then a "no problems match" message and a clear-filters control are shown, and activating it restores the full list.

**FR-13** — Given an editor creating a problem, When they save with a category and difficulty chosen, Then the problem appears under that category and difficulty; Given a category outside the list, Then saving is refused with a message.

**FR-14** — Given a guest opens a session link and its problem picker, When they use the filters, Then the same filters and grouping work as for a signed-in user.

**NFR-1/NFR-3** — Given the seed, When every problem's reference is run twice, Then both runs produce identical outputs equal to the stored expected values.

**NFR-2** — Given each hard problem's reference solution, When run against all its tests under the run limits, Then it finishes within the time and memory limits.

**NFR-5** — Given 150 problems, When a filter is chosen, Then the filtered list is shown within 200 ms.

**NFR-6** — Given the filters, When used by keyboard only, in dark mode, at a narrow width and with reduced motion on, Then every filter can be reached and operated, labelled for a screen reader, and no animation plays.

**NFR-7** — Given the seed, When it is checked against a list of known catalogue titles, Then no problem description or test set is copied verbatim.

## Open questions

None. Resolved with the human:

- Categories are the fixed list of 11: Arrays, Strings, Hash maps & sets, Two pointers & sliding window, Stacks & queues, Sorting & searching, Recursion & backtracking, Dynamic programming, Graphs & trees, Math & bit tricks, Greedy & intervals.
- The existing 20 problems are re-categorised into that list, keeping their identity and difficulty.
- The 50 problems per difficulty are spread roughly evenly: each category holds the same number per difficulty between 3 and 6.
- Hard problems use the existing run limits; no new cap.
- The dock and Jump-to-anything get no new entries; filters live only in the problem picker.

## UI spec checklist (memory/constitution-ui.md, section E)

- [x] Home screen presence defined — none: no new startable, joinable or live feature (see Out of scope).
- [x] Dock / Jump-to-anything entries defined — none; filters live only in the problem picker.
- [x] Guest and invitee view defined — FR-14.
- [x] Tokens only; new tokens in light, dark and Keycloak theme — NFR-6; filters introduce no new tokens.
- [x] Primitives reused; new ones justified — NFR-6; reuse existing filter/chip/select primitives, justify any new one in the plan.
- [x] Narrow, dark, reduced-motion, keyboard and screen-reader behaviour stated — NFR-6.
- [ ] Look matrix entry and E2E tasks present — deferred to `/sdd-tasks`.
