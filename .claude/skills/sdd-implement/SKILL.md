---
name: sdd-implement
description: Implement exactly one task (or one [P] wave) from an approved tasks.md, test-first. Use when asked to implement/build a task, after tasks.md has been approved.
---

# sdd-implement

Input: one task (or one `[P]` wave) from `specs/<slug>/tasks.md`. Never the whole file in one pass.

## Context discipline

Read: the target task's entry in tasks.md, its acceptance criteria, and only the source files it names. Do not read other tasks' detail, other features, or prior implementation chat history — if you need facts from earlier work, they must already be in `spec.md`/`plan.md`/code, not memory. Prefer running this as a fresh Agent/session per task so task N's exploration noise never leaks into task N+1.

## Steps

1. Confirm the target task's dependencies are marked done in tasks.md. If not, stop and say so.
2. Write the test(s) first, directly from the task's acceptance criteria. Run them and confirm they fail for the right reason.
3. Implement the minimum to make the test(s) pass. No speculative extras beyond this task's scope.
4. Run the full test(s) for this task and confirm green. Run broader tests if the task risks touching shared code.
5. Mark the task done in `tasks.md` by ticking its line in the `## Checklist` (`- [ ]` becomes `- [x]`). Leave everything else in the file untouched.
6. Stop. Show the diff and: **"Review this task's diff, then run /sdd-implement for the next task/wave."**

## Do / Don't

**Do:** test-first; stay inside this task's declared files; ask if the task's acceptance criteria are ambiguous rather than interpret silently.

**Don't:** implement other tasks opportunistically "while you're in there." Don't edit spec.md/plan.md here — if implementation reveals they're wrong, stop and say so instead of quietly diverging.
