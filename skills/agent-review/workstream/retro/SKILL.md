---
name: retro
description: >-
  Write a workstream retrospective to retro.md before workstream done: inventory
  artifacts (adr, chunks, todo, commits, work-log) then reflect with 4Ls (Liked,
  Learned, Lacked, Longed for). Use when closing a workstream, when the user asks
  for a workstream retro, or when done fails because retro.md is missing.
---

# Workstream retrospective (4Ls)

Before `workstream done`, look again at what this workstream produced. Prefer
**listening** over scorekeeping ([retrospective.md](https://retrospective.md)):
record what happened and what you understand now—not victory or failure.

Section structure uses the **4Ls** (Liked, Learned, Lacked, Longed for) from
Mary Gorman and Ellen Gottesdiener (2010), plus a required **Artifacts**
inventory grounded in on-disk evidence.

## When to use

- Immediately before `bunx agent-review workstream done`
- User asks for a workstream retrospective or “look back” on a workstream
- `workstream done` exited `2` because `retro.md` is missing

## Do not use

- Mid-workstream status notes (use `workstream log` / `todo.md`)
- Project-level retros unrelated to a `workstreams/<id>/` catalog entry

## Operator workflow

1. Resolve the workstream dir (active `active-workstream`, or user / `--workstream-id`).
2. **Read** (do not invent):
   - `adr.md`
   - `todo.md`
   - `chunks.json`
   - `work-log.jsonl`
   - each `commits/<runId>/run.json` (via symlink into `reviews/`)
3. Write **`retro.md`** in that workstream dir using the template below.
4. Cite concrete evidence (chunk keys, runIds, finding counts, log themes).
5. Then close: `bunx agent-review workstream done [--message "…"]`.

Escape hatch (skip retro): `workstream done --force` — use only when the user
explicitly allows skipping.

## Template

Copy into `workstreams/<workstreamId>/retro.md` and fill from artifacts:

```markdown
# Retrospective

## Artifacts

Summarize what this workstream produced (read the catalog; do not invent):

- ADR decision (one line + status)
- Chunks: keys and final status from `chunks.json`
- Todo: open / done / declined counts from `todo.md`
- Commits linked: list `commits/` → runIds; for each, note exit/ok and finding count from `run.json` when present
- Work-log: notable `started` / `blocked` / `done` themes (not a full dump)

## Liked

What worked well in the plan, process, or outcomes.

## Learned

What the artifacts taught (surprises, false assumptions, useful patterns).

## Lacked

Gaps: missing checks, unclear chunks, remediations that dragged, docs that never landed.

## Longed for

Concrete carry-forwards for the *next* workstream (actionable, not slogans).

## Closing

One short paragraph: listening summary, not a scorecard.
```

## Rules

- Evidence first: every claim should trace to an artifact you read.
- Lacked = gaps in the period reviewed; Longed for = wishes for what comes next.
- No blame theater; keep the Closing paragraph short.

## References

- Mary Gorman and Ellen Gottesdiener, [The 4L’s: A Retrospective Technique](https://ebgconsulting.com/blog/the-4ls-a-retrospective-technique/) (2010) — canonical 4Ls
- [retrospective.md](https://retrospective.md) — listening tone for looking back
- Parent: [workstream/SKILL.md](../SKILL.md)
