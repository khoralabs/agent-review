# ADR 0002: Workstream retrospective before done

## Status

Accepted

## Context

The workstream catalog ([ADR 0001](./0001-workstream-catalog.md)) records intent and linked reviews, but `workstream done` previously cleared the active pointer without requiring a look back at those artifacts.

[retrospective.md](https://retrospective.md) frames retros as listening rather than scorekeeping. For section structure, teams widely use the **4Ls** (Liked, Learned, Lacked, Longed for), introduced by Mary Gorman and Ellen Gottesdiener in 2010.

We want agents to analyze on-disk evidence before closeout, without adding a `workstream retro` CLI verb (planning stays skill-driven).

## Decision

We will:

1. Ship `skills/agent-review/workstream/retro/SKILL.md` with an **embedded** Artifacts + 4Ls markdown template, citing [Gorman/Gottesdiener](https://ebgconsulting.com/blog/the-4ls-a-retrospective-technique/) and [retrospective.md](https://retrospective.md) for tone. The citation does not replace the template.
2. Write retros to `workstreams/<id>/retro.md` (not stubbed on start).
3. Require a non-empty `retro.md` for `workstream done`, with `--force` to skip.

## Consequences

### Positive

- Closeout includes artifact-grounded reflection when following the skill
- 4Ls remains a citable, familiar format for operators and agents

### Negative

- `done` fails until `retro.md` exists (or `--force`)
- Another skill leaf to discover and maintain

### Neutral

- Package ADR 0001 remains the catalog layout decision; this ADR owns the retro gate

## References

- Mary Gorman and Ellen Gottesdiener, [The 4L’s: A Retrospective Technique](https://ebgconsulting.com/blog/the-4ls-a-retrospective-technique/) (2010)
- [retrospective.md](https://retrospective.md)
- Operator skill: `skills/agent-review/workstream/retro/SKILL.md`
