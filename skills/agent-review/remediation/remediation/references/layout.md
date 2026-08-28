# Agent-review artifact layout

All paths below are relative to the **repository root** unless noted.

```text
.data/agent-review/                    # default outputDir
  reviews.jsonl                        # one index line per completed run (path relative)
  findings.jsonl
  telemetry.jsonl                      # agent session / tool telemetry
  reviews/
    <runId>/                           # e.g. 20260811T212826Z-6237c56
      run.json                         # findings, hashes, exitCode, artifactPath (relative)
      diff.gz                          # gzipped unified diff (analyze handoff)
      remediations/                    # only when analyst remediates
        <index>/                       # zero-based finding index
          plan.md                      # lean remediation plan
          work-log.jsonl               # append-only agent progress (via `log` CLI)
          investigation.md             # optional — your notes
          changes.md                   # optional — change summary
          …
  workstreams.jsonl                    # opt-in: one line per start/done
  active-workstream                    # opt-in: plain text workstreamId (or absent)
  workstreams/
    <workstreamId>/                    # same id scheme as runId
      chunks.json                      # planned chunks (kebab keys)
      adr.md                           # workstream ADR
      todo.md                          # todo-md checklist
      work-log.jsonl                   # via `workstream log`
      retro.md                         # Artifacts + 4Ls; required before done (not on start)
      commits/
        <runId> -> ../../../reviews/<runId>   # symlink only
```

`<runId>` / `<workstreamId>` look like `20260811T212826Z-6237c56`.  
`<index>` is the zero-based finding index in that run.

**Reviews are always canonical under `reviews/`.** Workstreams are an opt-in
overlay: they never move or rename review directories. With `workstreamAutoLink`
(default true) and an `active-workstream` pointer (or `--workstream-id`), new
persisted reviews get a symlink under `workstreams/<id>/commits/`. Config key:
`workstreams.autoLink` (legacy flat `workstreamAutoLink` still accepted).

`workstream done` requires a non-empty `retro.md` unless `--force` (see
workstream/retro skill and ADR 0002). Land mode: `workstreams.autoCommit`
(default `false` → complete-feature; `true` → commit-chunks) — ADR 0003.

With `--include-workstream`, later runs that share the same short-SHA suffix load sibling `reviews/<runId>/` folders (findings, remediations, prior diffs) as prompt context.

The `plan.md` `Source:` line points at `reviews/<runId>/run.json finding[<index>]`.
