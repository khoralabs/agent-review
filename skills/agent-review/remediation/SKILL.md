---
name: remediation
description: >-
  Explains agent-review remediations: how review/analyze produce
  reviews/<runId>/remediations/<index>/plan.md, how to reason about and implement a
  remediation, which artifacts to leave in that directory, and how to append
  progress with the agent-review log CLI (work-log.jsonl). Use when fixing
  agent-review findings, working under .data/agent-review/reviews/, or
  updating a remediation workstream.
---

# Agent-review remediation

## When to use

Use this skill whenever you are implementing or investigating a finding that the analyst marked `remediate`, or when the user points you at a remediation directory / `plan.md`.

## Pipeline context

1. **Review** collects a git diff and produces findings (plus a gzipped sidecar `diff.gz`).
2. **Analyze** triages each finding: `ignore` or `remediate`.
3. For `remediate`, the host writes:

```text
<data-dir>/reviews/<runId>/
  run.json
  diff.gz
  remediations/<index>/
    plan.md          # lean triage plan (source of truth for the work)
    work-log.jsonl   # append-only progress log (via CLI)
    …your artifacts… # investigation notes, change summaries, evidence
```

Paths stored in run JSON / `reviews.jsonl` are **repo-root–relative** (e.g. `.data/agent-review/reviews/<runId>/run.json`).

Load [references/layout.md](references/layout.md) if you need the full directory map.

## How to pick up a remediation

1. Prefer `bunx agent-review status` (or `--json`) to list
   blocking remediations for the latest (or `--run-id`) run.
2. Open `plan.md` in the remediation directory.
3. Read **Context**, **Why remediate**, and **Steps**.
4. Follow `Source: reviews/<runId>/run.json finding[N]` to the run artifact if you need the original finding text or related files list.
5. Do **not** invent a competing plan. If the written plan is wrong, log why (`note`) and update `plan.md` steps deliberately. Progress lives in `work-log.jsonl`.

For the full remediate → commit → re-review loop, load [../remediate-all/SKILL.md](../remediate-all/SKILL.md). For clearing findings without committing, load [../complete-feature/SKILL.md](../complete-feature/SKILL.md).

## Reasoning rules

- Stay scoped to the finding and the chosen remediation outcome.
- Prefer evidence (code reads, failing tests, reproduction) over speculation.
- Finish the listed **Steps** (and add a short confirmation note in the work log) before declaring done.
- Keep code changes minimal and reviewable; avoid drive-by refactors.
- Never commit secrets, raw API keys, or huge binary dumps into the remediation folder.

## Artifacts to leave in the remediation directory

Add small, purposeful files next to `plan.md`, for example:

| File | Purpose |
|------|---------|
| `investigation.md` | What you checked, root cause |
| `changes.md` | Summary of code changes / PR notes |
| `evidence.md` or `tests.txt` | Commands run and key output |

Log every meaningful artifact with the CLI (`event=artifact`).

## Work-log CLI

Append JSONL entries with the package `log` command (no `AI_GATEWAY_API_KEY` required):

```sh
# Start work
bunx agent-review log \
  --remediation <runId>/<index> \
  --event started \
  --message "Picked up remediation" \
  --agent cursor

# Progress note
bunx agent-review log \
  --remediation <runId>/<index> \
  --event note \
  --message "Root cause: missing telemetry.linkCapture after capabilities refactor"

# Record an artifact you added under the remediation dir
bunx agent-review log \
  --remediation reviews/<runId>/remediations/<index> \
  --event artifact \
  --path investigation.md \
  --message "Wrote investigation notes"

# Status update
bunx agent-review log \
  --remediation <runId>/<index> \
  --event status \
  --status in_progress \
  --message "Implementing fix"

# Complete
bunx agent-review log \
  --remediation <runId>/<index> \
  --event done \
  --message "Fix landed; confirmation checks passed"
```

`--remediation` accepts `<runId>/<index>`, `reviews/…/remediations/…`, or an absolute path under `reviews/`. Default output dir is `.data/agent-review` (override with `--output-dir` / config).

On success the CLI prints the **repo-relative** path to `work-log.jsonl` on stdout.

### Events

| event | Required flags | Notes |
|-------|----------------|-------|
| `started` | `--message` | Begin a work session |
| `note` | `--message` | Progress / findings |
| `artifact` | `--message` `--path` | `--path` is relative to the remediation dir |
| `status` | `--message` `--status` | `proposed` \| `in_progress` \| `blocked` \| `done` |
| `done` | `--message` | Sets `status` to `done` if omitted |

Do not add or maintain a `Status:` line in `plan.md` (legacy plans may still have one; ignore it). Status is the work log.

## Done criteria

- Code + tests satisfy `plan.md` **Steps**.
- Relevant artifacts exist in the remediation directory and are logged.
- Final `log --event done` entry written.
