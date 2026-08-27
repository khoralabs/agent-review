---
name: documentation
description: >-
  Maintain project documentation: README (Standard README spec), Architecture
  Decision Records, Diátaxis technical docs, and Keep a Changelog CHANGELOG.md.
  Use when writing or auditing README, ADR, docs site content, or changelog
  entries, or when the user mentions documentation structure or doc maintenance.
---

# Documentation (agent-review)

Operator skills for **maintaining project documentation**. Load the sub-skill that
matches the artifact you are writing or auditing.

## When to use

- README audit, creation, or section compliance
- Recording or updating an architecture decision
- Writing or reorganizing technical docs (tutorials, how-tos, reference, explanation)
- Changelog updates or release notes

## Sub-skills

| Path | Artifact | Source |
|------|----------|--------|
| [readme/SKILL.md](readme/SKILL.md) | `README.md` | [Standard README spec](https://github.com/RichardLitt/standard-readme/blob/main/spec.md) |
| [adr/SKILL.md](adr/SKILL.md) | `docs/adr/*.md` | [adr.github.io](https://adr.github.io) (Nygard template) |
| [diataxis/SKILL.md](diataxis/SKILL.md) | docs site / pages | [diataxis.fr](https://diataxis.fr) |
| [changelog/SKILL.md](changelog/SKILL.md) | `CHANGELOG.md` | [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) |

## Quick routing

| User need | Load |
|-----------|------|
| Fix or write README sections | [readme/SKILL.md](readme/SKILL.md) |
| Document a design/architecture choice | [adr/SKILL.md](adr/SKILL.md) |
| Page mixes teaching + reference, or docs feel cluttered | [diataxis/SKILL.md](diataxis/SKILL.md) |
| Unreleased notes or release cut | [changelog/SKILL.md](changelog/SKILL.md) |

Changelog work pairs with [commit/commit-message/SKILL.md](../commit/commit-message/SKILL.md)
(Conventional Commits) at release time.
