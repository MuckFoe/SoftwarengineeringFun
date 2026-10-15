---
name: sdd-plan
description: Turn an approved spec.md into a technical plan.md (architecture, data model, contracts, test strategy). Use when asked to plan/design the implementation for a spec, after a feature's spec.md has been approved.
---

# sdd-plan

Input: `specs/<slug>/spec.md` (must be approved, zero unresolved markers) + `memory/constitution.md`.
Output: `specs/<slug>/plan.md`.

## Context discipline

Read only this feature's `spec.md` and the constitution. Do not read other features' specs/plans. Do not read tasks.md or code — this skill produces the plan, it doesn't consume downstream artifacts.

## Steps

1. Open `specs/<slug>/spec.md`. If it contains any `[NEEDS CLARIFICATION]` marker, stop and tell the human to resolve it first — do not plan around an open question.
2. Write `plan.md`:
   - **Architecture** — components/modules touched or added, how they connect.
   - **Data model** — schemas/entities, only what this feature needs.
   - **Contracts** — API/interface shapes (request/response, function signatures) precise enough to code from.
   - **Test strategy** — what gets tested at which level (unit/integration), and how each acceptance criterion in spec.md maps to a test.
   - **Constitution compliance** — walk each constitution rule, state how the plan satisfies it or flag a conflict for the human to resolve.
3. Every design decision must trace back to a spec requirement. If you find yourself adding something the spec doesn't ask for, either cut it or send it back to `/sdd-specify` — don't silently expand scope here.
4. Stop. Print the file path and: **"Review plan.md for architecture and constitution compliance, then run /sdd-tasks."**

## Do / Don't

**Do:** keep this HOW-only; be concrete enough that `/sdd-tasks` can decompose without re-deciding architecture.

**Don't:** restate spec content. Don't write tasks or code. Don't invent requirements not present in spec.md.
