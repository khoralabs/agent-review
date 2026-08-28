---
name: workstream
description: >-
  Catalog intentional work under .data/agent-review/workstreams/: start/resume
  a workstream, write adr.md and todo.md, plan chunks.json, land via
  commit-chunks, link review runs under commits/, and append work-log.jsonl.
  Use when beginning a feature or workstream, when the user mentions workstream
  catalog, active-workstream, or tasks spanning multiple commits/reviews.
---

# Workstream catalog (operator)

Opt-in overlay for multi-commit work. **Reviews stay under `reviews/`** exactly
as before; workstreams only add catalog files and symlinks.

Full intended stream: [docs/adr/0001-workstream-catalog.md](../../../docs/adr/0001-workstream-catalog.md)
(in the agent-review package; after `init`, see the package or repo `docs/adr/`).

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
    commits/<runId> -> ../../../reviews/<runId>
```

`<workstreamId>` is `YYYYMMDDTHHMMSSZ-<shortSha>` (same scheme as review run ids).

## CLI map

```sh
bunx agent-review workstream start [--title "…"] [--message "…"]
bunx agent-review workstream resume <workstreamId>
bunx agent-review workstream link <runId> [--workstream-id <id>]
bunx agent-review workstream log --event note --message "…"
bunx agent-review workstream done [--message "…"]
```

Config `workstreamAutoLink` (default `true`): when `active-workstream` is set,
`run` / `review` / `analyze` add a commits/ symlink after writing `reviews/`.
Pass `--workstream-id` to target a specific catalog entry (overrides active).
Set `workstreamAutoLink: false` to require explicit `workstream link`.

Link failures never fail the review.

## Operator stream (compose skills)

1. **Start** — `workstream start`; note the printed id.
2. **Decide** — fill `adr.md` using [documentation/adr](../documentation/adr/SKILL.md)
   (prefer this file while a workstream is active; keep `docs/adr/` for project-level ADRs).
3. **Plan** — edit `chunks.json` (kebab `key` per chunk, like finding keys) and
   [todo/SKILL.md](todo/SKILL.md) for `todo.md`.
4. **Land** — [commit-chunks](../commit/commit-chunks/SKILL.md); on hook block use
   [remediate-all](../remediation/remediate-all/SKILL.md). Without committing:
   [complete-feature](../remediation/complete-feature/SKILL.md).
5. **Log** — `workstream log` for progress (`started` | `note` | `artifact` |
   `status` | `done`).
6. **Close / switch** — `workstream done` clears active; `workstream resume <id>`
   restores an escape hatch.

## Sub-skills

| Path | Use when |
|------|----------|
| [todo/SKILL.md](todo/SKILL.md) | Maintain the workstream `todo.md` (todo-md) |

Do **not** activate this operator skill for the review/analyst LLMs.
