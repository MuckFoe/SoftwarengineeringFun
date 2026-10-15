---
name: sdd-specify
description: Turn a vague feature idea into a structured spec.md (WHAT/WHY, requirements, acceptance criteria) under specs/<slug>/. Use when starting spec-driven development for a new feature, or asked to "specify", "write a spec", "turn this idea into a spec".
---

# sdd-specify

Input: a rough, possibly vague feature description from the human.
Output: `specs/<NNN-feature-slug>/spec.md`.

## Context discipline

Read only: `memory/constitution.md` (if present). Do not read other features under `specs/`. Do not read plan/task/implementation artifacts — this skill produces the spec, it doesn't consume downstream ones.

## Steps

1. Pick the next feature number and a short kebab-case slug; create `specs/<NNN-slug>/`.
2. Extract what's genuinely ambiguous vs. what's a reasonable default. Ask the human targeted questions (AskUserQuestion) only for ambiguities that would change behavior or scope — not for things you can reasonably default and flag.
3. Write `spec.md` with these sections only:
   - **Problem / Why** — the need, in one paragraph.
   - **Users** — who this is for.
   - **Functional requirements** — EARS notation: `WHEN <trigger> THE SYSTEM SHALL <response>`.
   - **Non-functional requirements** — performance, security, scale constraints that matter here.
   - **Out of scope** — explicit exclusions, to stop scope creep later.
   - **Acceptance criteria** — Given/When/Then, one block per requirement, concrete enough to become a test.
   - **Open questions** — anything still unresolved, marked `[NEEDS CLARIFICATION: <specific question>]`.
4. Add a row for the new spec to `specs/README.md` (number, link to `<NNN-slug>/spec.md`, one-line summary, status `draft`, count of open questions). Touch no other row. If the file is missing, create it with a `# Specs` heading and a table with the columns `# | Spec | What it requires | Status | Open questions`.
5. Stop. Print the file path and: **"Resolve every [NEEDS CLARIFICATION] marker and approve spec.md before running /sdd-plan."**

## Do / Don't

**Do:** stay at WHAT/WHY level; use the constitution's domain language if one exists; mark ambiguity explicitly.

**Don't:** name a tech stack, file, API shape, or architecture — that's `/sdd-plan`'s job. Don't guess an answer to a real ambiguity — mark it. Don't write the plan or tasks yourself.
