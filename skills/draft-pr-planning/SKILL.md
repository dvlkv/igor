---
name: draft-pr-planning
description: "Create a Draft PR with the implementation plan before writing any code. Use this after writing-plans produces a plan document."
---

# Draft PR Planning

Push the branch and create a Draft Pull Request containing the implementation plan, **before** any code is written.

**Announce at start:** "I'm creating a Draft PR with the implementation plan."

## Prerequisites

- A git worktree with a dedicated branch already exists (created by the harness)
- An implementation plan has been produced (by the writing-plans skill)

## Steps

### 1. Commit the plan

Commit the spec and plan documents that were produced during brainstorming and planning:

```bash
git add docs/
git commit -m "docs: implementation plan for <feature>"
```

### 2. Push the branch

```bash
git push -u origin HEAD
```

### 3. Build the PR body

The PR body MUST include:

```markdown
## Summary

<1-2 sentence summary of what this task/issue implements>

## Implementation Plan

<Full contents of the implementation plan (copy from the plan document). Include all tasks with checkbox syntax so progress is visible in the PR.>

## Linked Issue

<If a GitHub issue or Linear issue URL is available, include it here: "Closes #N" or link>
```

### 4. Create the Draft PR

```bash
gh pr create --draft --title "<short title>" --body "$(cat <<'EOF'
<PR body from step 3>
EOF
)"
```

### 5. Report back

Send a message confirming the Draft PR was created, including the PR URL. Example:

> Draft PR created: https://github.com/owner/repo/pull/123
> Starting implementation now.

## After Draft PR

Proceed immediately to implementation (executing-plans or subagent-driven-development). As you complete plan tasks:

- Push commits to the branch (they appear in the PR automatically)
- When all tasks are done, mark the PR as ready: `gh pr ready`
