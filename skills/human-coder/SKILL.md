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

Write the smallest correct solution that remains readable and testable.

## Workflow

1. Explore codebase using `/explore-existing-code` and read all relevant files.
2. Define one narrow scope for this change.
3. **Create a plan using the plan tool (EnterPlanMode).** Outline the scope, affected files, layer mapping, and TDD steps before writing any code. Get user approval on the plan before proceeding.
4. If scope is large (for example full-project review or refactoring), split work into semantically separated tasks and delegate to subagents.
5. Map touched logic to layers: presentation, domain, infrastructure. Review the domain layer first for duplicated behavioral patterns (multi-step operations reimplemented instead of calling existing functions) before examining other layers for surface-level repetition.
6. Follow the TDD cycle per scope unit using `/test-driven-development`:
   a. **RED** — Write a failing test that captures the expected behavior.
   b. **Verify RED** — Run the test and confirm it fails for the right reason (missing feature, not a typo).
   c. **GREEN** — Write the minimum code to pass, keeping concerns separated where practical.
   d. **Verify GREEN** — Run all tests and confirm they pass.
   e. **REFACTOR** — Remove duplication, keep boundaries swappable, stay green.
7. Repeat step 6 for each behavior in scope before moving on.

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

1. Was a plan created (via EnterPlanMode) and approved before any code was written?
2. Could this be implemented in fewer lines without reducing readability?
2. Is any multi-step operation (behavior) duplicated in another file or function, rather than calling the existing implementation? (Repeated references to shared types or constants are not duplication.)
3. Does each edited unit have one reason to change?
4. Can collaborators replace infrastructure dependencies without rewriting business logic?
5. Were tests written before implementation and verified to fail first (TDD red-green-refactor)?
6. Can this change keep each touched file under 500 lines without harming clarity?
7. Are presentation, domain, and infrastructure concerns kept separate without forcing a project-wide restructure?
8. If the task is large, is it split into semantically distinct subagent tasks with clear ownership?

## Response Contract

**Before writing any code, you MUST enter plan mode using the EnterPlanMode tool.** Present the plan to the user and only proceed to implementation after approval.

When using this skill, structure output as:

1. **Plan**: created via EnterPlanMode — scope, affected files, layers, and TDD steps. Wait for user approval.
2. Scope: one sentence.
3. Tests (RED): what tests were written and how they failed before implementation.
4. Changes (GREEN): concise list of edited files and what changed to make tests pass.
5. Verification: explicit pass/fail status after all tests run.

## References

Load these files when making design decisions:

- `references/1-dry.md`
- `references/2-srp.md`
- `references/3-replaceable-design.md`
- `references/4-unit-tests.md`
