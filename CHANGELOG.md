# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `readme` operator skill for [Standard README](https://github.com/RichardLitt/standard-readme/blob/main/spec.md) compliance
- `adr` operator skill for Architecture Decision Records ([adr.github.io](https://adr.github.io), Nygard template)
- `diataxis` operator skill for [Diátaxis](https://diataxis.fr) technical documentation quadrants
- `changelog` operator skill for Keep a Changelog 1.1.0 + SemVer release notes
- `complete-feature` operator skill: remediate → re-review via the CLI until clean, without committing
- `remediate-all` operator skill (remediate → commit → re-review until blocking findings are gone)

### Changed

- Grouped documentation operator skills under `skills/agent-review/documentation/` (readme, adr, diataxis, changelog) with a router `documentation/SKILL.md`
- Renamed the `loop` operator skill to `remediate-all` (skill path and name)

### Removed

- `skills/agent-review/loop` — use `skills/agent-review/remediate-all` instead

## [0.1.1] - 2026-08-13

### Added

- Configurable `instructions` for review, analyze, and commit-message agents (literal strings or cwd-relative paths/globs to `.md`/`.txt` files)

### Changed

- Analyst and review agents no longer embed the ASD-STE100 body; STE100 is referenced by name and can be supplied via `instructions`

## [0.1.0] - 2026-08-13

### Added

- Initial public release of `@khoralabs/agent-review`: capabilities-based review and analyst triage CLI, `init`, per-purpose model config, and packaged operator skills

[unreleased]: https://github.com/khoralabs/agent-review/compare/agent-review-v0.1.1...HEAD
[0.1.1]: https://github.com/khoralabs/agent-review/compare/agent-review-v0.1.0...agent-review-v0.1.1
[0.1.0]: https://github.com/khoralabs/agent-review/releases/tag/agent-review-v0.1.0
