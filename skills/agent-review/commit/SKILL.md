---
name: commit
description: >-
  Git commit workflow with agent-review: draft Conventional Commits messages
  and land scoped work groups as separate commits. Use when drafting a commit
  message, running commit-chunks plans, or landing multiple small commits
  iteratively.
---

# Commit (agent-review)

Operator skills for **drafting and landing git commits** with agent-review.

## When to use

- Need a Conventional Commits message for the current diff
- User wants several independent groups committed iteratively
- A plan lists commit chunks (skill/config first, then work chunks)

## Sub-skills

| Path | Use when |
|------|----------|
| [commit-message/SKILL.md](commit-message/SKILL.md) | Draft Conventional Commits via CLI |
| [commit-chunks/SKILL.md](commit-chunks/SKILL.md) | Land scoped work groups as separate commits |

## Quick routing

| Situation | Load |
|-----------|------|
| Single commit message for staged diff | [commit-message/SKILL.md](commit-message/SKILL.md) |
| Multiple scoped commits with hook review per chunk | [commit-chunks/SKILL.md](commit-chunks/SKILL.md) |

If the hook blocks during commit-chunks, load
[remediation/remediate-all/SKILL.md](../remediation/remediate-all/SKILL.md).
For clearing findings without committing, load
[remediation/complete-feature/SKILL.md](../remediation/complete-feature/SKILL.md).
