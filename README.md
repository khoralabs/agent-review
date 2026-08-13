# `@khoralabs/agent-review`

Capabilities-based, read-only code review + analyst triage for staged diffs, commits, branch ranges, or piped PR diffs. Extensible via [Agent Skills](https://agentskills.io/specification) (`SKILL.md`). Requires [Bun](https://bun.sh).

Review and analyze are **adversarial quality-seeking**: they look for ways a change weakens the system or misses a concrete improvement (correctness, contracts, observability, tests, security, design)—while still filtering noise. The `run` command orchestrates review then analyze (used by the commit-msg hook). Coding agents use the operator skill with `status`, `log`, and `commit-message`.

## Quickstart (consumer repos)

```sh
bun add -d @khoralabs/agent-review
bunx husky   # if you do not already use husky
bunx agent-review init
# add AI_GATEWAY_API_KEY to .env
bunx agent-review run --scope staged --message "feat: …"
```

`init` writes `.agent-review.json`, a husky `commit-msg` hook (`bunx agent-review run …`), and **copies** the operator skill to `.agents/skills/agent-review` (no `node_modules` symlink).

Suggested `package.json` scripts:

```json
{
  "scripts": {
    "agent-review": "agent-review",
    "review": "agent-review run --scope staged --include-workstream"
  }
}
```

Activated review skill defaults to the **packaged** `skills/agent-review/code-review` path inside this package—you do not need to set `skills` in config unless you override it.

## CLI

```sh
# Full pipeline (review then analyze) — commit-msg hook uses this
agent-review run --scope staged --message "feat: …"

# Retry after a blocked commit: attach prior same-HEAD reviews + remediations
agent-review run --scope staged --include-workstream --message "feat: …"

# Review only (prints runId on stdout)
agent-review review --scope staged --message "feat: …"

# Analyze a prior review
agent-review analyze --run-id 20260811T204647Z-6b2d895

# Analyze with higher analyst parallelism
agent-review analyze --run-id 20260811T204647Z-6b2d895 --analyst-concurrency 8

# Walk commits from→to (separate output dir recommended)
agent-review walk \
  --from origin/main --to HEAD \
  --output-dir .data/agent-review-walks \
  --concurrency 4

# Blocking remediations for the latest run (no LLM)
agent-review status
agent-review status --json
agent-review status --run-id 20260811T204647Z-6b2d895 --min-severity warning

# Append a remediation work-log entry (no AI_GATEWAY_API_KEY required)
agent-review log \
  --remediation 20260811T212826Z-6237c56/0 \
  --event note \
  --message "Root cause confirmed"

# Draft a Conventional Commits message for the staged diff
agent-review commit-message

# Scaffold config + hook + operator skill
agent-review init
agent-review init --force

# Migrate a legacy runs/ + remediations/ data dir to reviews/
agent-review migrate --output-dir .data/agent-review

# Review the last commit (message loaded from git log)
agent-review run --scope commit --commit HEAD
# or simply:
agent-review run --commit HEAD

# PR / pre-merge
agent-review run --scope range --base origin/main --head HEAD

# Piped diff
gh pr diff 123 | agent-review review --scope stdin

# Review + analyze without writing artifacts
agent-review run --scope staged --no-emit
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

- Bun `>=1.1`
- `AI_GATEWAY_API_KEY` — Vercel AI Gateway (required for `run` / `review` / `analyze` / `commit-message` / `walk`). See [`.env.example`](./.env.example).
- Optional `AGENT_REVIEW_MODEL` — override all agent models for this process (CLI `--model` still wins)
- Optional `SKIP_AGENT_REVIEW=1` — skip `run` / `review` / `analyze` / `walk` without editing tracked config (overrides `skip` in `.agent-review.json`)

## Husky hooks

**Consumers** (from `agent-review init`):

```sh
bunx agent-review run --scope staged --include-workstream --message-file "$1"
```

**This repo** (development):

- **`pre-commit`** — Biome (`bun run format:check`); blocks on warnings or errors.
- **`commit-msg`** — `bun ./bin/agent-review run --scope staged --include-workstream --message-file "$1"`

Requires `.env` with `AI_GATEWAY_API_KEY` and a repo-root [`.agent-review.json`](./.agent-review.json).

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

Ship skill: [`skills/agent-review/SKILL.md`](./skills/agent-review/SKILL.md) (remediation, commit-message, loop, history-walk, and code-review sub-skills).

Prefer `bunx agent-review init` (copies into `.agents/skills/agent-review`). For local development of this package you can instead symlink:

```sh
mkdir -p .agents/skills
ln -sfn ../../skills/agent-review .agents/skills/agent-review
```

This skill is for **coding agents** operating the CLI — not for the review agent’s activated `skills` list. The packaged activated review skill is `skills/agent-review/code-review` inside the npm package. History walks use [`skills/agent-review/history-walk`](./skills/agent-review/history-walk/SKILL.md).

## Config

Repo root [`.agent-review.json`](./.agent-review.json). Start from the packaged example via `agent-review init` or:

```sh
cp node_modules/@khoralabs/agent-review/.agent-review.example.json .agent-review.json
```

Fields:

- `model` — gateway model id for all agents (string), or an object `{ review, analyze, commitMessage }` with optional keys (missing keys use the default). Overrides (highest wins): CLI `--model` → `AGENT_REVIEW_MODEL` → config file.
- `skip` — when `true`, exit `0` without reviewing for `run` / `review` / `analyze` / `walk` (`status` / `log` / `migrate` / `commit-message` / `init` are not skipped). Prefer `SKIP_AGENT_REVIEW=1` for local bypass. Env wins over config.
- `skills` — skill directories to **activate** (tier 2). Omit to use the packaged code-review skill.
- `skillsDirs` — roots to **discover** for the catalog (tier 1); typically `.agents/skills`
- `instructions` — extra system text for review / analyze / commit-message: literal strings and/or cwd-relative paths/globs to `.md` / `.txt` files (expanded with Bun.Glob). Example: `["Prefer citing tests.", "docs/review-style.md", ".agents/instructions/**/*.txt"]`
- `blockOn` — severity **threshold**: listed severities and **more severe** can exit `1` when the analyst verdict is `remediate` (default `["error"]`)
- `defaultScope` — `staged` \| `unstaged` \| `working` \| `range` \| `commit` \| `stdin`
- `outputDir` — artifact directory (default `.data/agent-review`)
- `analystConcurrency` — max parallel analyst triage sessions (default `4`)
- `includeWorkstream` — when `true`, attach prior same-HEAD runs to prompts (default `false`; CLI / hook: `--include-workstream`)
- `--no-emit` — CLI-only; skip writing pipeline artifacts

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Clean / empty diff / skipped / all threshold findings ignored by analyst / log success / status clean / walk steps all ok / init ok |
| 1 | At least one threshold finding with analyst verdict `remediate` (analyze / run / status) |
| 2 | Config / skill / LLM / log / status validation failure / walk setup or step failure |

Review-only exits `0` on success (findings allowed) or `2` on failure.

## Release

Publish via GitHub Actions (`workflow_dispatch` on [`.github/workflows/release.yml`](./.github/workflows/release.yml)): choose semver + npm dist-tag. Staging script: `bun run stage-release -- <version>`.
