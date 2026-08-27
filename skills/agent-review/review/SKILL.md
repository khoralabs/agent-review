---
name: review
description: >-
  Agent-review review skills: adversarial diff review (LLM-activated) and
  read-only commit-range history walks. Use when configuring the review agent,
  evaluating a from→to commit history, or mining historical findings.
---

# Review (agent-review)

Skills for **reviewing code** and **evaluating review history**. The operator
loads history-walk; the review LLM agent activates code-review via config.

## When to use

- Postmortem or mining findings across a commit range
- Understanding what review would have caught on past commits
- Configuring the adversarial review agent (code-review skill)

## Sub-skills

| Path | Use when |
|------|----------|
| [code-review/SKILL.md](code-review/SKILL.md) | Adversarial diff review (activated for LLM review agent) |
| [history-walk/SKILL.md](history-walk/SKILL.md) | Commit-range walk + finding catalog |

## Quick routing

| Situation | Load |
|-----------|------|
| Review agent activated skill (default packaged path) | [code-review/SKILL.md](code-review/SKILL.md) |
| Walk `from..to` and catalog historical findings | [history-walk/SKILL.md](history-walk/SKILL.md) |

Activated LLM skill for review defaults to `skills/agent-review/review/code-review`
inside the npm package. Do **not** activate the operator skill for review/analyst agents.
