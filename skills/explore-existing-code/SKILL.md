---
name: explore-existing-code
description: >-
  ALWAYS run at the start of every coding session, unconditionally. Uses LSP
  tools and targeted exploration to understand the codebase structure, symbols,
  and patterns before writing any code. If there is even a 1% chance this skill
  applies, invoke it.
---

# Explore Existing Code

Build a full picture of what already exists in the repository before touching anything.

## When to Run

**ALWAYS. Every session. No exceptions.**

This skill must be invoked at the very beginning of every coding conversation — before planning, before writing code, before answering questions about the codebase. If you think there is even a 1% chance you will need to understand existing code, run this skill.

## Workflow

Use LSP tools and targeted file exploration to understand the codebase. This is faster, more accurate, and doesn't require external dependencies.

1. **Survey the project structure** using Glob to understand file organization:

   ```
   Glob: **/*.ts, **/*.tsx, **/*.js, **/*.py, **/*.go (adapt to project languages)
   ```

   Get the lay of the land: directories, modules, entry points.

2. **Use LSP tools** to understand code semantics:

   - **Document symbols** — get the symbols (functions, classes, interfaces, types) defined in key files to understand their API surface
   - **Workspace symbols** — search for specific symbols across the entire project when you need to find where something is defined
   - **Go to definition** — trace how components connect to each other
   - **Find references** — understand how symbols are used across the codebase
   - **Diagnostics** — check for existing type errors or warnings

3. **Read key files** to understand patterns and conventions:

   - Entry points (index.ts, main.ts, app.ts, etc.)
   - Package.json / pyproject.toml / go.mod for dependencies
   - Config files (tsconfig.json, etc.)
   - README and docs if present

4. **Use Grep** for pattern-based exploration:

   - Find imports/exports to understand module boundaries
   - Search for patterns like `export function`, `export class`, `interface` to catalog the public API
   - Find TODOs, FIXMEs, or other markers

5. **Use this knowledge** throughout the session to:
   - Avoid reimplementing existing functionality
   - Follow established patterns and conventions
   - Place new code in the right location
   - Reuse existing utilities and helpers

## Rules

1. Never skip this step. The cost of exploring is low; the cost of duplicating existing code or breaking conventions is high.
2. Prefer LSP tools over reading entire files — they give you structured, semantic information efficiently.
3. After exploring, do NOT dump the full findings to the user. Internalize the knowledge silently and use it to inform your work.
4. If LSP tools are not available, fall back to using Glob and Grep to manually survey the repository structure.

## Response Contract

After running this skill:

1. Confirm the codebase was explored (one line).
2. Summarize the project in 2-3 sentences: what it is, main technologies, key modules.
3. Proceed with whatever the user actually asked for.
