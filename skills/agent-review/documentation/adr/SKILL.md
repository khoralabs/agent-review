---
name: adr
description: >-
  Architecture Decision Records (Nygard template) per adr.github.io. Use when
  documenting architecturally significant decisions, creating or updating ADRs,
  superseding prior decisions, or when the user mentions ADR, architecture
  decision log, or design rationale.
---

# Architecture Decision Records (agent-review)

Capture **one architecturally significant decision** per file. Follow the Nygard
template from [Documenting Architecture Decisions](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions),
as catalogued at [adr.github.io](https://adr.github.io).

For decisions needing options analysis, metadata, or longer rationale, consider
[MADR](https://adr.github.io/madr/) instead.

## When to use

- A choice has a measurable effect on architecture or system quality
- Technology, integration, or design trade-offs should be preserved for the team
- Consequences of one decision will inform later decisions

## Do not use

- Trivial or easily reversible preferences with no architectural impact
- Decisions already captured adequately elsewhere
- Implementation details that belong in code comments or API docs

## Layout

**Workstream-scoped:** when an agent-review workstream is active (or the user
points at `workstreams/<id>/`), write or update that directory’s **`adr.md`**
for the workstream decision. Same Nygard sections; one file per workstream.

**Project-level:** detect an existing decision log first:

- `docs/adr/`
- `doc/adr/`
- `docs/decisions/`

If none exists, create **`docs/adr/`**.

File naming for project ADRs: **`NNNN-kebab-title.md`** (zero-padded), e.g.
`0001-use-postgres-for-events.md`.

## Status lifecycle

| Status | Meaning |
|--------|---------|
| `Proposed` | Draft; stakeholders have not agreed |
| `Accepted` | Agreed and in effect |
| `Rejected` | Considered and not adopted |
| `Deprecated` | No longer recommended |
| `Superseded by ADR-NNNN` | Replaced by a later ADR |

Update status when merged or when a later ADR reverses the decision. **Supersede**
rather than rewrite accepted ADRs.

## Operator workflow

1. Pick the next number; create `docs/adr/NNNN-short-title.md` with status `Proposed`.
2. **Context** — value-neutral facts and forces (technological, political, social, project-local). Call out tensions.
3. **Decision** — active voice: “We will …”. One decision per ADR.
4. **Consequences** — positive, negative, and neutral impacts on the team and project.
5. When agreed, set status to `Accepted`. If reversed later, mark `Superseded by ADR-XXXX` and link forward.

Keep ADRs short — ideally one screen of content.

## Skeleton

```markdown
# ADR 0001: Short noun phrase title

## Status

Proposed

## Context

What forces and facts motivate this decision? What is at tension?

## Decision

We will …

## Consequences

### Positive

- …

### Negative

- …

### Neutral

- …
```

## References

- [adr.github.io](https://adr.github.io) — definitions, decision log concept, tooling
- [Documenting Architecture Decisions (Michael Nygard, 2011)](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions) — original Nygard template
- [MADR](https://adr.github.io/madr/) — optional richer format for complex decisions

---

The remainder of this file summarizes guidance from [adr.github.io](https://adr.github.io).

# ADR concepts

## Definitions

An **Architectural Decision (AD)** is a justified design choice addressing an
architecturally significant requirement. An **Architecturally Significant Requirement (ASR)**
has a measurable effect on architecture and quality. An **ADR** captures a single AD
and its rationale. The collection of ADRs in a project is its **decision log**.

## Nygard template sections

### Title

Short noun phrase, e.g. “ADR 1: Deployment on Ruby on Rails 3.0.10”.

### Status

`proposed`, `accepted`, `rejected`, `deprecated`, or `superseded` (with reference to replacement).

### Context

Forces at play — technological, political, social, project-local. Value-neutral language.

### Decision

Response to the forces. Full sentences, active voice: “We will …”.

### Consequences

Resulting context after the decision. List positive, negative, and neutral consequences.

## Principles

- One ADR describes one significant decision for a specific project.
- Consequences of one ADR often become context for subsequent ADRs.
- Decision logs are living documents — update status and consequences as understanding evolves.
