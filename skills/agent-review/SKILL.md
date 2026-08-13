---
name: agent-review
description: >-
  Operate @khoralabs/agent-review from a coding agent: run review/analyze,
  implement remediations from plan.md, draft Conventional Commits messages,
  maintain Keep a Changelog CHANGELOG.md notes, remediate-all (remediate →
  commit → re-review) until blocking findings are gone, complete-feature
  (same via CLI without committing, before a manual commit), or walk a git
  commit range to catalog historical findings.
  Use when a commit-msg hook blocks, when finishing a feature before commit,
  when working under .data/agent-review/, when drafting a commit message or
  changelog for this repo, when clearing agent-review findings, or when
  evaluating a from→to commit history walk.
---

# Agent-review (operator)

Coding-agent skill for **driving** agent-review. Review and analyst agents stay
read-only; you implement fixes (and commit only when using remediate-all).

## When to use

- Husky / `commit-msg` exited `1` with remediations
- Finish a feature and clear findings **before** a manual commit (no commit)
- User points at `.data/agent-review/reviews/<runId>/`
- Need a Conventional Commits message for the current diff
- Need Keep a Changelog updates (`CHANGELOG.md`, Unreleased, release cut)
- Clear findings at/above config `blockOn` via remediate → commit → re-review

## CLI map

From the repo root (`AI_GATEWAY_API_KEY` required except `log` / `status` /
`migrate` / `init`):

| Command | Purpose |
|---------|---------|
| `run` | Review then analyze (hooks use this) |
| `review` | Review only; prints `runId` on stdout |
| `analyze` | Triage `--run-id` |
| `status` | Blocking remediations for a run (default: latest); no LLM |
| `walk` | Review each commit in `from..to`; catalog + dedupe |
| `log` | Append remediation `work-log.jsonl` |
| `commit-message` | Draft Conventional Commits message (stdout) |
| `migrate` | Legacy layout → `reviews/` |
| `init` | Scaffold config, husky hook, operator skill |

```sh
bunx agent-review run --scope staged --include-workstream
bunx agent-review status
bunx agent-review status --json
bunx agent-review commit-message
bunx agent-review log --remediation <runId>/<index> --event done --message "…"
bunx agent-review walk --from <rev> --output-dir .data/agent-review-walks
```

Default stop threshold matches config `blockOn` **and more severe** (e.g.
`blockOn: ["warning"]` treats `error` and `warning` as blocking). Override with
`status --min-severity warning`.

## Sub-skills (load as needed)

| Path | Use when |
|------|----------|
| [code-review/SKILL.md](code-review/SKILL.md) | Adversarial diff review (activated for LLM agents) |
| [remediate-all/SKILL.md](remediate-all/SKILL.md) | Remediate → commit → re-review until clean |
| [complete-feature/SKILL.md](complete-feature/SKILL.md) | CLI remediate loop without committing |
| [remediation/SKILL.md](remediation/SKILL.md) | Implementing one `plan.md` |
| [commit-message/SKILL.md](commit-message/SKILL.md) | Spec + drafting via CLI |
| [changelog/SKILL.md](changelog/SKILL.md) | Keep a Changelog 1.1.0 + SemVer release notes |
| [history-walk/SKILL.md](history-walk/SKILL.md) | Commit-range walk + catalog |

Activated LLM skill for review remains `skills/agent-review/code-review` in `.agent-review.json`.
Do **not** activate this operator skill for the review/analyst agents.
