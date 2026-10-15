---
name: sdd-constitution
description: Write or update the project's governing engineering principles (memory/constitution.md) — testing discipline, architecture boundaries, tech stack limits, style standards. Run once per project, rarely revisited. Use when asked to set up spec-driven development, define project principles/constitution, or before the first /sdd-specify on a new repo.
---

# sdd-constitution

One-time setup. Produces `memory/constitution.md`: the fixed rules every later spec/plan must comply with.

## Steps

1. Check if `memory/constitution.md` already exists. If yes, show it and ask whether this is an update or a no-op — don't silently rewrite it.
2. Read whatever already defines standards in this repo (existing README, lint/test config, CI config) to ground the interview — don't invent conventions the repo doesn't have.
3. Interview the human for principles that don't already show up in the repo. Cover, briefly:
   - Testing discipline (test-first? what must pass before merge?)
   - Architecture boundaries (layering rules, forbidden dependencies, module limits)
   - Integration vs. mocked testing policy
   - Non-negotiable tech stack / library constraints
   - Anything that should block a plan or task outright if violated
4. Write `memory/constitution.md` as short, numbered, testable rules — each rule must be checkable ("plan.md must not do X"), not aspirational prose.
5. Stop. Print the file path and: **"Review and edit constitution.md, then run /sdd-specify for your first feature."**

## Don't

- Don't pad with generic best-practice boilerplate not grounded in this repo or this interview.
- Don't write feature-specific rules here — that belongs in a spec.
- Don't proceed to specify/plan/tasks yourself.
