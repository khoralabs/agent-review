# ADR 0003: Workstream land modes (autoCommit)

## Status

Accepted

## Context

Workstream landing previously said “use commit-chunks, or complete-feature without committing” without a machine-readable default. Agents sometimes batched implementation without commits, leaving `commits/` empty even when a workstream was active and `autoLink` was on.

Users differ: some want agents to commit and clear hooks before the next chunk; others refuse auto-commit and only want findings cleared in the working tree.

## Decision

We will nest workstream settings under `.agent-review.json`:

```json
"workstreams": {
  "autoCommit": false,
  "autoLink": true
}
```

- **`autoCommit` default `false`:** operators land via complete-feature (no `git commit`).
- **`autoCommit: true`:** operators land via commit-chunks; remediate-all on hook block.
- **`autoLink`:** former top-level `workstreamAutoLink` (compat: flat key still accepted; nested wins).
- User chat override for a single session beats config.
- No new CLI land verb — skill + config only.

## Consequences

### Positive

- Explicit default that matches users who do not want agent commits
- Opt-in path fills `commits/` when hooks/reviews run under an active workstream

### Negative

- Default mode will not populate `commits/` until someone commits or runs review while active
- Agents must read config before landing

### Neutral

- ADR 0001 remains the catalog layout; ADR 0002 remains the retro gate

## References

- Operator skill: `skills/agent-review/workstream/SKILL.md`
- [complete-feature](../../skills/agent-review/remediation/complete-feature/SKILL.md)
- [commit-chunks](../../skills/agent-review/commit/commit-chunks/SKILL.md)
