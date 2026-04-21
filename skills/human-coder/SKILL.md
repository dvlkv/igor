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

1. **Ask clarifying questions.** Before any design work, ask the user questions about intent, scope, edge cases, and constraints. Do not assume — confirm.
2. **Dispatch brainstorming to a subagent.** Launch a subagent with the `/brainstorming` skill, passing it: the task description and paths to all reference files listed in the References section below. Subagent should be the smartest model available. The subagent explores the codebase, defines scope, and produces the spec and implementation plan autonomously. This preserves your main context for coordination.
3. **Create a draft PR with spec and plan. Ask for approval before writing code.** Push the branch, open a draft PR whose body contains the spec, affected files, and implementation plan. Ask the user to review and approve before proceeding to implementation.
4. If scope is large (for example full-project review or refactoring), split work into semantically separated tasks and delegate to subagents.
5. Map touched logic to layers: presentation, domain, infrastructure. Review the domain layer first for duplicated behavioral patterns (multi-step operations reimplemented instead of calling existing functions) before examining other layers for surface-level repetition.
6. Follow the TDD cycle per scope unit using `/test-driven-development`:
   a. **RED** — Write a failing test that captures the expected behavior.
   b. **Verify RED** — Run the test and confirm it fails for the right reason (missing feature, not a typo).
   c. **GREEN** — Write the minimum code to pass, keeping concerns separated where practical.
   d. **Verify GREEN** — Run all tests and confirm they pass.
   e. **REFACTOR** — Remove duplication, keep boundaries swappable, stay green.
7. Repeat step 6 for each behavior in scope before moving on.
8. **Mark PR as ready for review.** After implementation is complete and all tests pass, convert the draft PR to ready and notify the user.

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

1. Were clarifying questions asked before starting design?
2. Was a design produced (via `/brainstorming`) before any code was written?
3. Was a draft PR with spec/plan created and approved by the user before implementation?
4. Could this be implemented in fewer lines without reducing readability?
5. Is any multi-step operation (behavior) duplicated in another file or function, rather than calling the existing implementation? (Repeated references to shared types or constants are not duplication.)
6. Does each edited unit have one reason to change?
7. Can collaborators replace infrastructure dependencies without rewriting business logic?
8. Were tests written before implementation and verified to fail first (TDD red-green-refactor)?
9. Can this change keep each touched file under 500 lines without harming clarity?
10. Are presentation, domain, and infrastructure concerns kept separate without forcing a project-wide restructure?
11. If the task is large, is it split into semantically distinct subagent tasks with clear ownership?

## Response Contract

**Before writing any code, you MUST ask clarifying questions, then dispatch `/brainstorming` to a subagent, then create a draft PR with spec/plan and get user approval.**

When using this skill, structure output as:

1. **Questions**: clarifying questions asked and answers received.
2. **Design**: produced via `/brainstorming` subagent — codebase exploration, scope, affected files, layers, and TDD steps.
3. **Draft PR**: link to draft PR with spec and plan, awaiting user approval.
4. Scope: one sentence.
5. Tests (RED): what tests were written and how they failed before implementation.
6. Changes (GREEN): concise list of edited files and what changed to make tests pass.
7. Verification: explicit pass/fail status after all tests run.
8. **PR ready**: link to PR marked ready for review.

## References

Load these files when making design decisions:

- `references/1-dry.md`
- `references/2-srp.md`
- `references/3-replaceable-design.md`
- `references/4-unit-tests.md`
