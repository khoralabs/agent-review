---
name: remediation
description: >-
  Clear agent-review findings: implement one plan.md, complete-feature loop
  (no commit), or remediate-all loop (remediate → commit → re-review). Use
  when fixing remediations under .data/agent-review/, after a blocked commit,
  or when finishing a feature before a manual commit.
---

# Remediation (agent-review)

Operator skills for **implementing fixes** and clearing blocking findings.
Review and analyst agents stay read-only; you implement changes.

## When to use

- Husky / `commit-msg` blocked with remediations
- User points at `.data/agent-review/reviews/<runId>/remediations/<index>/`
- Finish a feature and clear findings before the user commits manually
- Need the full remediate → commit → re-review loop

## Sub-skills

| Path | Use when |
|------|----------|
| [remediation/SKILL.md](remediation/SKILL.md) | Implementing one `plan.md` |
| [complete-feature/SKILL.md](complete-feature/SKILL.md) | CLI remediate loop **without** committing |
| [remediate-all/SKILL.md](remediate-all/SKILL.md) | Remediate → commit → re-review until clean |

## Quick routing

| Situation | Load |
|-----------|------|
| Single `plan.md` to implement | [remediation/SKILL.md](remediation/SKILL.md) |
| Clear findings; user will commit later | [complete-feature/SKILL.md](complete-feature/SKILL.md) |
| Blocked commit-msg hook; you commit fixes | [remediate-all/SKILL.md](remediate-all/SKILL.md) |

Commit step in remediate-all uses [commit/commit-message/SKILL.md](../commit/commit-message/SKILL.md).
