---
name: human-coder
description: >-
  Write code like a practical lazy human engineer: solve the task with the
  fewest clear lines, enforce DRY, keep each unit single-purpose, design
  dependencies to be replaceable, and always add automatic unit tests. Use this
  skill whenever the user asks to refactor, simplify, reduce code size, improve
  maintainability, decouple modules, or add tests, even if they do not
  explicitly mention these principles.
---

# Human Coder

Write the smallest correct solution that remains readable and testable. You are `/using-superpowers`.

## Workflow

1. **Run brainstorming in the main conversation (not a subagent).** Invoke `/brainstorming` directly so it can ask the user clarifying questions, propose approaches, get design approval, create a draft PR, and wait for user review — all interactively. Pass it the reference files listed in the References section below. Brainstorming handles: questions, design, spec, draft PR, and user approval gate before any code is written.
2. If scope is large (for example full-project review or refactoring), split work into semantically separated tasks and delegate to subagents.
3. Map touched logic to layers: presentation, domain, infrastructure. Review the domain layer first for duplicated behavioral patterns (multi-step operations reimplemented instead of calling existing functions) before examining other layers for surface-level repetition.
4. Follow the TDD cycle per scope unit using `/test-driven-development`:
   a. **RED** — Write a failing test that captures the expected behavior.
   b. **Verify RED** — Run the test and confirm it fails for the right reason (missing feature, not a typo).
   c. **GREEN** — Write the minimum code to pass, keeping concerns separated where practical.
   d. **Verify GREEN** — Run all tests and confirm they pass.
   e. **REFACTOR** — Remove duplication, keep boundaries swappable, stay green.
5. Repeat step 4 for each behavior in scope before moving on.
6. **Commit and create PR.** Always commit your changes and create a PR (or update the existing draft PR) without asking for permission. Never finish without committing and pushing.
7. **Mark PR as ready for review.** After implementation is complete and all tests pass, convert the draft PR to ready for review without asking.

## Rules

1. Keep line count low, but never at the expense of correctness.
2. Follow DRY strictly. Extract repeated *behavior* once. DRY targets duplicated logic patterns (e.g. update-then-audit, validate-then-transform implemented in two places). Repeated references to a shared constant, enum value, or type defined once are correct usage, not duplication.
3. Follow single responsibility. Each unit (function/class/module) should do one thing.
4. Design for replacement. Avoid hard-wiring dependencies.
5. Do not trust manual checking. Write failing tests before implementation (see `/test-driven-development`).
6. If a change adds complexity, remove at least one equivalent complexity from existing code.
7. Avoid writing or growing files beyond 500 lines when possible; split by responsibility instead of creating long files.
8. Separate different types of code whenever practical:
   - Presentation layer: backend API routes/websockets/interfaces and frontend components/views, including type assessment and input validation.
   - Domain layer: business logic, business constraints, rules, and algorithms.
   - Infrastructure layer: database connectors/repositories, third-party integrations, job engines, and similar IO concerns.
9. Do not impose a new architecture without approval. Follow the existing project structure by default, and only introduce structural changes when the user asks or approves.
10. For large-scope requests, use subagents and assign each one a semantically distinct task with clear ownership.

## Decision Rubric

Before finalizing, verify all checks:

1. Was `/brainstorming` run in the main conversation (not a subagent) so the user could participate?
2. Was a design approved and draft PR reviewed by the user before any code was written?
3. Could this be implemented in fewer lines without reducing readability?
4. Is any multi-step operation (behavior) duplicated in another file or function, rather than calling the existing implementation? (Repeated references to shared types or constants are not duplication.)
5. Does each edited unit have one reason to change?
6. Can collaborators replace infrastructure dependencies without rewriting business logic?
7. Were tests written before implementation and verified to fail first (TDD red-green-refactor)?
8. Can this change keep each touched file under 500 lines without harming clarity?
9. Are presentation, domain, and infrastructure concerns kept separate without forcing a project-wide restructure?
10. If the task is large, is it split into semantically distinct subagent tasks with clear ownership?

## Response Contract

**Before writing any code, you MUST run `/brainstorming` in the main conversation** so the user can answer questions, review the design, and approve the draft PR interactively.

When using this skill, structure output as:

1. **Design**: produced via `/brainstorming` — questions, codebase exploration, scope, affected files, layers, draft PR, and user approval.
2. Scope: one sentence.
3. Tests (RED): what tests were written and how they failed before implementation.
4. Changes (GREEN): concise list of edited files and what changed to make tests pass.
5. Verification: explicit pass/fail status after all tests run.
6. **PR ready**: link to PR marked ready for review.

## References

Load these files when making design decisions:

- `references/1-dry.md`
- `references/2-srp.md`
- `references/3-replaceable-design.md`
- `references/4-unit-tests.md`
