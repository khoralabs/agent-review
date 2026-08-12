# Agent-review artifact layout

All paths below are relative to the **repository root** unless noted.

```text
.data/agent-review/                    # default outputDir
  reviews.jsonl                        # one index line per completed run (path relative)
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
```

`<runId>` looks like `20260811T212826Z-6237c56`.  
`<index>` is the zero-based finding index in that run.

With `--include-workstream`, later runs that share the same short-SHA suffix load sibling `reviews/<runId>/` folders (findings, remediations, prior diffs) as prompt context.

The `plan.md` `Source:` line points at `reviews/<runId>/run.json finding[<index>]`.
