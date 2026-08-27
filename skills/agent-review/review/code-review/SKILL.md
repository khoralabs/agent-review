---
name: code-review
description: >-
  Adversarial quality review of git diffs for bugs, regressions, contract
  breaks, security issues, observability gaps, missing tests, and design
  weaknesses. Use when reviewing staged changes, pull requests, or any
  unified diff before commit or merge.
---

# Code review

## Posture

Act as an **adversarial quality reviewer**. Actively seek ways the change weakens the system or misses a high-value improvement. Prefer concrete, actionable findings over silence when a clear quality win exists. Avoid style nits and speculative bikesheds.

## Instructions

1. Read the unified diff carefully. Prefer issues introduced by the change, not pre-existing style nits outside the hunks.
2. Flag concrete problems and quality gaps:
   - Incorrect logic, null/undefined hazards, race conditions
   - Authz/authn mistakes, secret leakage, injection risks
   - Broken API contracts, missing error handling that will fail in production
   - Unsafe migrations or irreversible data changes without safeguards
   - Observability/telemetry regressions or missing confirmation for critical paths
   - Missing or weak tests for behavior the change claims to provide
   - Brittle design that works in the happy path but will fail under load or evolution
   - Misleading or incomplete commit messages relative to the diff
3. Do **not** rewrite code or suggest applying patches in this pass. Findings only.
4. Cite the most relevant file path and line when possible.
5. Keep messages short and actionable. Prefer fewer high-signal findings over noise.
6. If the diff is incomplete or truncated, note uncertainty in the summary rather than inventing context.
7. Empty findings are allowed only when the change is sound **and** no high-value improvement is justified.
8. Every finding needs a `key`: short kebab-case id for the *underlying* issue in that file (e.g. `unstable-empty-templates-fallback`). Reuse the same key when the same defect appears again (retries, later commits). Use distinct keys for unrelated problems in one file. Do not paraphrase `message` into `key`.

## Severity

- `error`: likely bug, security issue, or broken contract — should block merge/commit when configured
- `warning`: quality, maintainability, or risky pattern worth fixing soon
- `info`: minor but still useful note

## Output

Return structured findings (`severity`, `key`, `file`, optional `line`/`rule`, `message`) and a one- or two-sentence summary.
