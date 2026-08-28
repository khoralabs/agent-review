---
name: workstream
description: >-
  Catalog intentional work under .data/agent-review/workstreams/: start/resume
  a workstream, write adr.md and todo.md, plan chunks.json, land via
  complete-feature (default) or commit-chunks when workstreams.autoCommit is
  true, link review runs under commits/, write retro.md (4Ls), and append
  work-log.jsonl before done. Use when beginning a feature or workstream,
  when the user mentions workstream catalog, active-workstream, retrospective,
  or tasks spanning multiple commits/reviews.
---

# Workstream catalog (operator)

Opt-in overlay for multi-commit work. **Reviews stay under `reviews/`** exactly
as before; workstreams only add catalog files and symlinks.

Full intended stream: [docs/adr/0001-workstream-catalog.md](../../../docs/adr/0001-workstream-catalog.md)
(in the agent-review package; after `init`, see the package or repo `docs/adr/`).
Retrospective: [docs/adr/0002-workstream-retro.md](../../../docs/adr/0002-workstream-retro.md).
Land modes: [docs/adr/0003-workstream-land-mode.md](../../../docs/adr/0003-workstream-land-mode.md).

## Layout

```text
<data-dir>/
  reviews/<runId>/…          # canonical (unchanged)
  workstreams.jsonl
  active-workstream          # plain text workstreamId, or absent
  workstreams/<workstreamId>/
    chunks.json
    adr.md
    todo.md
    work-log.jsonl
    retro.md                 # required before done (not created on start)
    commits/<runId> -> ../../../reviews/<runId>
```

`<workstreamId>` is `YYYYMMDDTHHMMSSZ-<shortSha>` (same scheme as review run ids).

## CLI map

```sh
bunx agent-review workstream start [--title "…"] [--message "…"]
bunx agent-review workstream resume <workstreamId>
bunx agent-review workstream link <runId> [--workstream-id <id>]
bunx agent-review workstream log --event note --message "…"
bunx agent-review workstream done [--message "…"]   # requires non-empty retro.md
bunx agent-review workstream done --force           # skip retro gate
```

## Config (`workstreams` object)

Read `.agent-review.json` before landing:

```json
"workstreams": {
  "autoCommit": false,
  "autoLink": true
}
```

| Key | Default | Meaning |
|-----|---------|---------|
| `autoCommit` | `false` | `false` → [complete-feature](../remediation/complete-feature/SKILL.md) (no git commit). `true` → [commit-chunks](../commit/commit-chunks/SKILL.md) (+ [remediate-all](../remediation/remediate-all/SKILL.md) on hook block). |
| `autoLink` | `true` | When `active-workstream` is set, symlink new reviews under `commits/`. Set `false` to require explicit `workstream link`. |

Legacy flat `workstreamAutoLink` still maps to `workstreams.autoLink` (nested wins if both set).

**Session override:** if the user asks to commit (or not) for this workstream, that wins over config for the session.

Link failures never fail the review.

## Operator stream (compose skills)

1. **Start** — `workstream start`; note the printed id.
2. **Decide** — fill `adr.md` using [documentation/adr](../documentation/adr/SKILL.md)
   (prefer this file while a workstream is active; keep `docs/adr/` for project-level ADRs).
3. **Plan** — edit `chunks.json` (kebab `key` per chunk, like finding keys) and
   [todo/SKILL.md](todo/SKILL.md) for `todo.md`.
4. **Land** — respect `workstreams.autoCommit` (or user override):
   - **`false` (default):** [complete-feature](../remediation/complete-feature/SKILL.md) — `run` / `status` / remediate until clean; **do not** `git commit`. `commits/` stays empty until a review runs while this workstream is active (user’s later commit-msg hook, explicit `run`, or `workstream link`).
   - **`true`:** [commit-chunks](../commit/commit-chunks/SKILL.md) — one chunk per commit; on hook block use [remediate-all](../remediation/remediate-all/SKILL.md). Never batch-skip commits. With `autoLink`, hook/review runs populate `commits/`.
   - Do **not** mark a chunk `done` or check off `todo.md` until that chunk’s land loop finished for the active mode.
5. **Log** — `workstream log` for progress (`started` | `note` | `artifact` |
   `status` | `done`).
6. **Retro** — load [retro/SKILL.md](retro/SKILL.md); write `retro.md` from the
   embedded Artifacts + 4Ls template (required before `done`). Be honest if
   `commits/` is empty.
7. **Close / switch** — `workstream done` clears active (fails without `retro.md`
   unless `--force`); `workstream resume <id>` restores an escape hatch.

## Sub-skills

| Path | Use when |
|------|----------|
| [todo/SKILL.md](todo/SKILL.md) | Maintain the workstream `todo.md` (todo-md) |
| [retro/SKILL.md](retro/SKILL.md) | Write `retro.md` (Artifacts + 4Ls) before done |

Do **not** activate this operator skill for the review/analyst LLMs.
