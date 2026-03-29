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
3. Implement the minimum code to solve that scope.
4. Remove duplication instead of adding parallel logic.
5. Keep boundaries swappable through interfaces, pure functions, or dependency injection.
6. Add or update automatic unit tests before finishing.
7. Run tests and fix failures.

## Rules

1. Keep line count low, but never at the expense of correctness.
2. Follow DRY strictly. Extract repeated logic once.
3. Follow single responsibility. Each unit (function/class/module) should do one thing.
4. Design for replacement. Avoid hard-wiring dependencies.
5. Do not trust manual checking. Require automated unit tests.
6. If a change adds complexity, remove at least one equivalent complexity from existing code.
7. Avoid writing or growing files beyond 500 lines when possible; split by responsibility instead of creating long files.

## Decision Rubric

Before finalizing, verify all checks:

1. Could this be implemented in fewer lines without reducing readability?
2. Is any logic duplicated in another file or function?
3. Does each edited unit have one reason to change?
4. Can collaborators replace infrastructure dependencies without rewriting business logic?
5. Do automated unit tests cover the happy path and at least one edge/failure path?
6. Can this change keep each touched file under 500 lines without harming clarity?

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
