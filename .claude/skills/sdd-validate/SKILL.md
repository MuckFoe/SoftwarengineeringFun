---
name: sdd-validate
description: After all tasks for a feature are implemented, verify the result against spec.md's acceptance criteria, run tests, and log drift/learnings to notes.md. Use when asked to validate, review, or sign off a completed feature.
---

# sdd-validate

Input: `specs/<slug>/spec.md`, `specs/<slug>/tasks.md`, the implemented code/tests.
Output: `specs/<slug>/notes.md` (appended, never overwritten).

## Context discipline

Read spec.md, tasks.md, and run the test suite — don't re-read implementation history from chat; the code and tests are the record.

## Steps

1. Confirm every task in tasks.md is marked done. If not, stop and say which remain.
2. Run the full test suite for this feature (and broader suite if shared code was touched).
3. Walk spec.md's acceptance criteria one by one; report pass/fail per criterion against actual behavior, not against the tests' intent.
4. If anything drifted — a requirement that changed shape during implementation, an assumption that proved wrong — append it to `notes.md` under today's date, and explicitly flag: **"spec.md is now stale on: <point>. Update it before the next change to this feature."** Do not silently edit spec.md yourself.
5. This is a second, fresh check — do not rubber-stamp your own prior implementation work; verify against spec.md as if you hadn't written the code.
6. Stop. Summarize pass/fail and: **"Human sign-off required to close this feature."**

## Do / Don't

**Do:** treat spec.md as ground truth for "correct," not the code. Log drift instead of hiding it.

**Don't:** let this validation substitute for human review — it's a second automated pass, not the final gate. Don't edit spec.md/plan.md/tasks.md content here beyond notes.md.
