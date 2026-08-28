# ADR 0001: Opt-in workstream catalog

## Status

Accepted

## Context

agent-review already catalogs each review under `reviews/<runId>/` and indexes
findings for hooks and remediations. Operators (and coding agents) also need a
place to record **intent** across multiple commits: architecture decision,
planned chunks, a living todo list, and a work-level progress log.

Putting that material inside a single review directory couples planning to one
hook run and would change the existing review layout. Requiring a workstream for
every commit would break backwards compatibility for hooks and repos that only
want adversarial review.

Forces in tension:

- Preserve `reviews/` as the sole canonical store for run artifacts
- Give agents a formal, machine-readable workstream home that composes existing
  skills (ADR, commit-chunks, remediation loops)
- Keep the CLI small; planning stays skill-driven, not a second product surface

## Decision

We will add an **opt-in `workstreams/` catalog** as a sibling of `reviews/` and
`agents/` under the configured output directory.

- Workstream ids reuse `YYYYMMDDTHHMMSSZ-<shortSha>` (`formatReviewRunId`).
- Each workstream directory holds `chunks.json`, `adr.md`, `todo.md`,
  `work-log.jsonl`, and `commits/` (relative symlinks to existing
  `reviews/<runId>/` directories only).
- Index with `workstreams.jsonl` and an `active-workstream` pointer.
- Minimal CLI: `workstream start|resume|link|log|done`. Config
  `workstreamAutoLink` (default true) auto-symlinks after persist when a
  pointer (or `--workstream-id`) is present; link failures never fail the review.
- Ship a `workstream` operator skill (plus scoped todo-md) via `init`. Agents
  fill ADR/chunks/todo and land work via existing commit-chunks / remediation
  skills — no `workstream plan` command.

## Consequences

### Positive

- Hooks and standalone reviews behave identically when workstream CLI is unused
- Multi-commit intent is catalogued without relocating review artifacts
- Skills compose into a full stream without enlarging the CLI

### Negative

- Operators must remember to `start` / `done` / `resume` the active pointer
- Symlinks and an extra index are another layout surface to document

### Neutral

- Project-level ADRs remain under `docs/adr/`; per-workstream decisions use
  `workstreams/<id>/adr.md`

## Intended operator stream

1. `workstream start` → stubs + active pointer + `workstreams.jsonl`
2. Fill `adr.md` (Nygard) and `todo.md` (todo-md); plan `chunks.json` (kebab keys)
3. Implement and land via commit-chunks; remediate-all / complete-feature as needed
4. Reviews continue under `reviews/`; auto or explicit link under `commits/`
5. `workstream log` for progress; `done` clears active; `resume` restores it

## References

- Operator skill: `skills/agent-review/workstream/SKILL.md`
- Layout: `skills/agent-review/remediation/remediation/references/layout.md`
- [todo-md](https://github.com/todo-md/todo-md)
