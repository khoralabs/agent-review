---
name: agent-review
description: >-
  Operate @khoralabs/agent-review from a coding agent: run review/analyze,
  implement remediations from plan.md, draft Conventional Commits messages,
  maintain documentation (README, ADR, Diátaxis, changelog), remediate-all
  (remediate → commit → re-review) until blocking findings are gone,
  complete-feature (same via CLI without committing), walk a git commit range,
  land scoped work groups as separate commits (commit-chunks), or catalog a
  multi-commit workstream under workstreams/ (including a 4Ls retro before done).
  Use when a commit-msg hook blocks, when finishing a feature before commit,
  when working under .data/agent-review/, when drafting a commit message or
  maintaining docs, when clearing agent-review findings, when landing several
  small commits iteratively, when starting or resuming a workstream, when writing
  a workstream retrospective, or when evaluating a from→to commit history walk.
---

# Agent-review (operator)

Coding-agent skill for **driving** agent-review. Review and analyst agents stay
read-only; you implement fixes (and commit only when using remediate-all).

## When to use

- Husky / `commit-msg` exited `1` with remediations
- Finish a feature and clear findings **before** a manual commit (no commit)
- User points at `.data/agent-review/reviews/<runId>/`
- Need a Conventional Commits message for the current diff
- Maintain README, ADR, technical docs, or changelog
- Clear findings at/above config `blockOn` via remediate → commit → re-review
- Start or resume an opt-in workstream catalog (`workstreams/`)

## CLI map

From the repo root (`AI_GATEWAY_API_KEY` required except `log` / `status` /
`migrate` / `init` / `workstream`):

| Command | Purpose |
|---------|---------|
| `run` | Review then analyze (hooks use this) |
| `review` | Review only; prints `runId` on stdout |
| `analyze` | Triage `--run-id` |
| `status` | Blocking remediations for a run (default: latest); no LLM |
| `walk` | Review each commit in `from..to`; catalog + dedupe |
| `log` | Append remediation `work-log.jsonl` |
| `workstream` | Opt-in catalog: start / resume / link / log / done |
| `commit-message` | Draft Conventional Commits message (stdout) |
| `migrate` | Legacy layout → `reviews/` |
| `init` | Scaffold config, husky hook, operator skill |

```sh
bunx agent-review run --scope staged --include-workstream
bunx agent-review status
bunx agent-review status --json
bunx agent-review commit-message
bunx agent-review log --remediation <runId>/<index> --event done --message "…"
bunx agent-review workstream start --title "…"
bunx agent-review walk --from <rev> --output-dir .data/agent-review-walks
```

Default stop threshold matches config `blockOn` **and more severe** (e.g.
`blockOn: ["warning"]` treats `error` and `warning` as blocking). Override with
`status --min-severity warning`.

## Sub-skills (load as needed)

| Path | Use when |
|------|----------|
| [workstream/SKILL.md](workstream/SKILL.md) | Catalog intentional work under `workstreams/` |
| [remediation/SKILL.md](remediation/SKILL.md) | Fix findings: one plan, complete-feature, or remediate-all |
| [commit/SKILL.md](commit/SKILL.md) | Commit messages and commit-chunks landing |
| [documentation/SKILL.md](documentation/SKILL.md) | README, ADR, Diátaxis docs, changelog |
| [review/SKILL.md](review/SKILL.md) | Code review agent skill, history walks |

Activated LLM skill for review remains `skills/agent-review/review/code-review` in
`.agent-review.json`. Do **not** activate this operator skill for the review/analyst agents.
