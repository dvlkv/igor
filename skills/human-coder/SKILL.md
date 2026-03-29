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

1. Read all relevant files.
2. Define one narrow scope for this change.
3. If scope is large (for example full-project review or refactoring), split work into semantically separated tasks and delegate to subagents.
4. Map touched logic to layers: presentation, domain, infrastructure.
5. Implement the minimum code to solve that scope, keeping those concerns separated where practical.
6. Remove duplication instead of adding parallel logic.
7. Keep boundaries swappable through interfaces, pure functions, or dependency injection.
8. Add or update automatic unit tests before finishing.
9. Run tests and fix failures.

## Rules

1. Keep line count low, but never at the expense of correctness.
2. Follow DRY strictly. Extract repeated logic once.
3. Follow single responsibility. Each unit (function/class/module) should do one thing.
4. Design for replacement. Avoid hard-wiring dependencies.
5. Do not trust manual checking. Require automated unit tests.
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

1. Could this be implemented in fewer lines without reducing readability?
2. Is any logic duplicated in another file or function?
3. Does each edited unit have one reason to change?
4. Can collaborators replace infrastructure dependencies without rewriting business logic?
5. Do automated unit tests cover the happy path and at least one edge/failure path?
6. Can this change keep each touched file under 500 lines without harming clarity?
7. Are presentation, domain, and infrastructure concerns kept separate without forcing a project-wide restructure?
8. If the task is large, is it split into semantically distinct subagent tasks with clear ownership?

## Response Contract

When using this skill, structure output as:

1. Scope: one sentence.
2. Changes: concise list of edited files and what changed.
3. Tests: what was added/updated and how it was run.
4. Verification: explicit pass/fail status.

## References

Load these files when making design decisions:

- `references/1-dry.md`
- `references/2-srp.md`
- `references/3-replaceable-design.md`
- `references/4-unit-tests.md`
