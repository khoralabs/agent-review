---
name: history-walk
description: >-
  Walk git history with agent-review: review each commit from→to in
  parallel, catalog findings by host fingerprint, and read resolved vs
  unresolved remediations. Use for postmortems or mining review value across
  a commit range.
---

# Agent-review history walk

Read-only historical evaluation. The CLI reviews every commit in `from..to`
(exclusive `from`, inclusive `to`), catalogs findings by host `fingerprint`
(`key` + `file` + `rule`), and classifies each as `unresolved` / `resolved` /
`unverified`. It does **not** apply remediations mid-walk.

## When to use

- Postmortem / “what would review have caught on these commits?”
- Comparing review-on-commit vs later fixes
- Mining recurring `key`s for future coding-agent skills

## Invoke

Prefer a **separate** `--output-dir` so walk artifacts do not interleave with
hook reviews:

```sh
bunx agent-review walk \
  --from <rev> \
  --to HEAD \
  --output-dir .data/agent-review-walks \
  --concurrency 4
```

| Flag | Notes |
|------|--------|
| `--from` | Required; exclusive start |
| `--to` | Inclusive end (default `HEAD`) |
| `--output-dir` | Isolate walk data (reviews, findings.jsonl, walks/) |
| `--concurrency` | Parallel commit reviews (default: config `analystConcurrency`) |
| `--max-commits` | Cap after `rev-list` |
| `--json` | Machine-readable summary on stderr + `walkId` on stdout |
| `--keep-worktree` | Leave `<output-dir>/worktrees/walk-*` for debug |
| `--no-emit` | Skip disk writes (still attempts every commit) |

Stdout prints `walkId`. Exit `0` if every step succeeded; `2` on setup failure
or if any step failed **after** the full range was attempted. Findings never
gate exit.

## Read results

Under `<output-dir>/walks/<walkId>/`:

| File | Role |
|------|------|
| `walk.json` | Range, commits, per-step runIds, catalog |
| `steps.jsonl` | Completion-order step log |
| `catalog.json` | Deduped ledger by `fingerprint` |
| `summary.md` | Counts by status / severity |

Per-commit runs still land under `<output-dir>/reviews/<runId>/` with the usual
`findings.jsonl` index (walk-scoped when `output-dir` is isolated).

Catalog `occurrences[].commit` is the **reviewed full SHA** (`run.json`
`commit`), not main-checkout `gitHead`.

## After the walk

Apply remediations only if the user asks—typically on a branch **after**
current HEAD. Do not rewrite walked history.
