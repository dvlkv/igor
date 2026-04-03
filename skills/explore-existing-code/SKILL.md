---
name: explore-existing-code
description: >-
  ALWAYS run at the start of every coding session, unconditionally. Generates a
  compressed repository map using repomix and stores it in .claude/repomap.xml
  so you know everything already implemented before writing any code. If there
  is even a 1% chance this skill applies, invoke it.
---

# Explore Existing Code

Build a full picture of what already exists in the repository before touching anything.

## When to Run

**ALWAYS. Every session. No exceptions.**

This skill must be invoked at the very beginning of every coding conversation — before planning, before writing code, before answering questions about the codebase. If you think there is even a 1% chance you will need to understand existing code, run this skill.

## Workflow

1. **Run repomix** to generate a compressed repository map:

   ```bash
   npx repomix --compress --output .claude/repomap.xml \
     --ignore "node_modules,dist,build,.next,out,coverage,.git,*.lock,package-lock.json,yarn.lock,pnpm-lock.yaml,*.min.js,*.min.css,*.map,*.bundle.js,*.chunk.js,.env*,*.log,tmp,temp,.cache,.turbo,.parcel-cache,__pycache__,.pytest_cache,.mypy_cache,.venv,venv,env,.tox,.eggs,*.egg-info,.gradle,target,bin/Debug,bin/Release,obj,*.o,*.a,*.so,*.dylib,*.dll,*.class,*.pyc,*.pyo,.DS_Store,Thumbs.db,*.sqlite,*.db"
   ```

2. **Log the token count** of the generated map so you know the context cost:

   ```bash
   wc -c .claude/repomap.xml | awk '{printf "Repo map size: %d bytes (~%d tokens)\n", $1, $1/4}'
   ```

3. **Read the generated map** from `.claude/repomap.xml` to understand:
   - Project structure and file organization
   - Existing modules, classes, functions, and their signatures
   - Dependencies and how components connect
   - What is already implemented vs what is missing

4. **Use this knowledge** throughout the session to:
   - Avoid reimplementing existing functionality
   - Follow established patterns and conventions
   - Place new code in the right location
   - Reuse existing utilities and helpers

## Rules

1. Never skip this step. The cost of running repomix is low; the cost of duplicating existing code or breaking conventions is high.
2. If `.claude/repomap.xml` already exists but is older than the current session, regenerate it.
3. After reading the map, do NOT dump the full contents to the user. Internalize the knowledge silently and use it to inform your work.
4. If repomix is not available or fails, fall back to using Glob and Grep to manually survey the repository structure.

## Response Contract

After running this skill:

1. Confirm the repo map was generated (one line).
2. Summarize the project in 2-3 sentences: what it is, main technologies, key modules.
3. Proceed with whatever the user actually asked for.
