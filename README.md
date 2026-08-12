# `@khoralabs/agent-review`

Capabilities-based, read-only code review + analyst triage for staged diffs, commits, branch ranges, or piped PR diffs. Extensible via [Agent Skills](https://agentskills.io/specification) (`SKILL.md`).

The **host** collects the unified diff with git. Agents never invoke host `bash`/`sh`. `inspectBash` runs in a [just-bash](https://github.com/vercel-labs/just-bash) OverlayFs (host-readonly; inspect builtins only). Git and write/destructive commands are blocked by policy before execution. An **analyst agent** then triages each finding (`ignore` vs `remediate`), signing decisions with its identity and `invocationHash`. Remediations get a lean `plan.md` under `reviews/<runId>/remediations/<index>/`. The **commit-message agent** (`commit-message` CLI) drafts a Conventional Commits message; its inspect tool allows read-only git (argv-spawned, hooks/pager disabled) in addition to search. Conventional Commits 1.0.0 and ASD-STE100 are inlined into agent instructions (not activated Cursor skills).

Review and analyze are **adversarial quality-seeking**: they actively look for ways a change weakens the system or misses a concrete improvement (correctness, contracts, observability, tests, security, design)—not only obvious breakage—while still filtering noise.
Review and analyze run as **separate CLI processes**. The `run` command orchestrates them back-to-back (used by the commit-msg hook). `--no-emit` runs them in-process instead and skips disk writes. Coding agents use the operator skill [`skills/agent-review`](./skills/agent-review/SKILL.md) with `status`, `log`, and `commit-message`.

Package layout: `agents/` (capability defs), `pipeline/` (phases + orchestrator), `tools/`, `skills/`, `schema/`, `lib/` (shared host utilities including `capabilities-generate`).

## Usage

```sh
# Full pipeline (review then analyze) — commit-msg hook uses this
bun run --filter @khoralabs/agent-review run -- --scope staged --message "feat: …"

# Retry after a blocked commit: attach prior same-HEAD reviews + remediations
bun run --filter @khoralabs/agent-review run -- \
  --scope staged --include-workstream --message "feat: …"

# Review only (prints runId on stdout)
bun run --filter @khoralabs/agent-review review -- --scope staged --message "feat: …"

# Analyze a prior review
bun run --filter @khoralabs/agent-review analyze -- --run-id 20260811T204647Z-6b2d895

# Analyze with higher analyst parallelism
bun run --filter @khoralabs/agent-review analyze -- \
  --run-id 20260811T204647Z-6b2d895 --analyst-concurrency 8

# Walk commits from→to (separate output dir recommended)
bun run --filter @khoralabs/agent-review walk -- \
  --from origin/main --to HEAD \
  --output-dir .data/agent-review-walks \
  --concurrency 4

# Blocking remediations for the latest run (no LLM)
bun run --filter @khoralabs/agent-review status
bun run --filter @khoralabs/agent-review status -- --json
bun run --filter @khoralabs/agent-review status -- --run-id 20260811T204647Z-6b2d895 --min-severity warning

# Append a remediation work-log entry (no AI_GATEWAY_API_KEY required)
bun run --filter @khoralabs/agent-review log -- \
  --remediation 20260811T212826Z-6237c56/0 \
  --event note \
  --message "Root cause confirmed"

# Draft a Conventional Commits message for the staged diff
bun run --filter @khoralabs/agent-review commit-message
# or: bun run --filter @khoralabs/agent-review run -- commit-message
# optional: --scope staged|unstaged|working|commit

# Migrate a legacy runs/ + remediations/ data dir to reviews/
bun run --filter @khoralabs/agent-review migrate -- --output-dir .data/agent-review

# Review the last commit (message loaded from git log)
bun run --filter @khoralabs/agent-review run -- --scope commit --commit HEAD
# or simply:
bun run --filter @khoralabs/agent-review run -- --commit HEAD

# PR / pre-merge
bun run --filter @khoralabs/agent-review run -- --scope range --base origin/main --head HEAD

# Piped diff
gh pr diff 123 | bun run --filter @khoralabs/agent-review review -- --scope stdin

# Review + analyze without writing artifacts
bun run --filter @khoralabs/agent-review run -- --scope staged --no-emit
```

### Status (`status`)

No LLM. Reads `run.json` (+ remediations) for `--run-id` or the latest `reviews.jsonl` entry.

| Flag | Required | Notes |
|------|----------|-------|
| `--run-id` | no | Defaults to last `reviews.jsonl` line |
| `--min-severity` | no | `error` \| `warning` \| `info`; default = least severe in config `blockOn` |
| `--json` | no | Machine-readable report on stdout |
| `--output-dir` | no | Default `.data/agent-review` |

Threshold semantics: `blockOn: ["warning"]` (or `--min-severity warning`) treats **error and warning** as blocking. Exit `0` if none blocking, `1` if blocking remediations remain, `2` if the run is missing/invalid.

### Work-log (`log`)

Appends one JSON line to `<output-dir>/reviews/<runId>/remediations/<index>/work-log.jsonl`. The remediation directory must already contain `plan.md`.

| Flag | Required | Notes |
|------|----------|-------|
| `--remediation` | yes | `<runId>/<index>`, `reviews/…/remediations/…`, or absolute path under `reviews/` |
| `--event` | yes | `started` \| `note` \| `artifact` \| `status` \| `done` |
| `--message` | yes | Human-readable entry text |
| `--path` | for `artifact` | Path relative to the remediation directory |
| `--status` | for `status` | `proposed` \| `in_progress` \| `blocked` \| `done` |
| `--agent` | no | Optional caller label |
| `--output-dir` | no | Default `.data/agent-review` |

On success, stdout prints the **repo-root–relative** `work-log.jsonl` path.

## Requirements

- `AI_GATEWAY_API_KEY` — Vercel AI Gateway (required for `run` / `review` / `analyze` / `commit-message` / `walk`)
- Optional `AGENT_REVIEW_MODEL` — override model id
- `SKIP_AGENT_REVIEW=1` — skip (exit 0) for review pipeline commands (`status` / `log` / `migrate` / `commit-message` are not skipped)

## Artifacts

Every run (success, blocking findings, or errors) writes under `.data/agent-review/` (configurable via `outputDir` / `--output-dir`). Paths recorded inside JSON / JSONL are **relative to the repository root**. Pass `--no-emit` to skip all of those writes (`run` still executes review then analyze in-process). `log` and `migrate` reject `--no-emit`.

| Path | Contents |
|------|----------|
| `reviews/<YYYYMMDDTHHMMSSZ>-<shortSha>/run.json` | Full run record (`artifactPath` relative, findings with `key`/`fingerprint`, `gitHead`, hashes, error) |
| `reviews/<YYYYMMDDTHHMMSSZ>-<shortSha>/diff.gz` | Gzipped unified diff for analyze handoff |
| `reviews/<runId>/remediations/<index>/plan.md` | Lean remediation plan when analyst verdict is `remediate` |
| `reviews/<runId>/remediations/<index>/work-log.jsonl` | Append-only agent progress log (`log` CLI) |
| `agents/<staticHash>.json.gz` | Content-addressed **static** agent capability snapshot (write-once, gzipped). Runtime/invocation **content** is not stored (PII risk); `staticHash` / `runtimeHash` / `invocationHash` remain link metadata on runs/decisions for attribution. |
| `reviews.jsonl` | One compact index line per completed run (`path` relative, includes `gitHead`) |
| `findings.jsonl` | One index line per finding (`fingerprint`, `key`, verdict, …) |
| `walks/<walkId>/walk.json` | History-walk manifest + catalog (from `walk` CLI) |
| `walks/<walkId>/catalog.json` | Deduped findings (`unresolved` / `resolved` / `unverified`) |
| `walks/<walkId>/summary.md` | Human-readable walk counts |
| `walks.jsonl` | One index line per completed walk |
| `telemetry.jsonl` | agent-capabilities-otel / pino lines (`staticHash`, `runtimeHash`, …) |

## Operator skill (Cursor / Claude Code)

Ship skill: [`skills/agent-review/SKILL.md`](./skills/agent-review/SKILL.md) (remediation, commit-message, and loop sub-skills). Install:

```sh
mkdir -p .agents/skills
ln -s ../../packages/agent-review/skills/agent-review .agents/skills/agent-review
```

(From the `agent-network` repo root; adjust the relative link if your checkout layout differs.)

This skill is for **coding agents** operating the CLI — not for the review agent’s activated `skills` list in `.agent-review.json`. Activated review skill remains `skills/agent-review/code-review`. History walks use the operator sub-skill [`skills/agent-review/history-walk`](./skills/agent-review/history-walk/SKILL.md).

## Config

Repo root `.agent-review.json`:

- `skills` — skill directories to **activate** for the review, analyst, and commit-message agents (tier 2 bodies)
- `skillsDirs` — roots to **discover** for the catalog (tier 1)
- `blockOn` — severity **threshold**: listed severities and **more severe** can exit `1` when the analyst verdict is `remediate` (default `["error"]`)
- `defaultScope` — `staged` \| `unstaged` \| `working` \| `range` \| `commit` \| `stdin`
- `outputDir` — artifact directory (default `.data/agent-review`)
- `analystConcurrency` — max parallel analyst triage sessions (default `4`)
- `includeWorkstream` — when `true`, attach prior same-HEAD runs (findings, remediations, diffs) to review and analyze prompts (default `false`; CLI: `--include-workstream`)
- `--no-emit` — CLI-only; skip writing pipeline artifacts (`run` still reviews then analyzes in-process)

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Clean / empty diff / skipped / all threshold findings ignored by analyst / log success / status clean / walk steps all ok |
| 1 | At least one threshold finding with analyst verdict `remediate` (analyze / run / status) |
| 2 | Config / skill / LLM / log / status validation failure / walk setup or step failure |

Review-only exits `0` on success (findings allowed) or `2` on failure.
