---
name: changelog
description: >-
  Keep a Changelog 1.1.0 and Semantic Versioning for CHANGELOG.md. Use when
  writing or updating a changelog, preparing a release, moving Unreleased
  entries into a version section, documenting breaking changes or deprecations,
  or when the user mentions CHANGELOG, release notes, or Keep a Changelog.
---

# Changelogs (agent-review)

Maintain `CHANGELOG.md` for humans. Prefer notable user-facing differences over
commit-log dumps. Pair with [commit-message/SKILL.md](../../commit/commit-message/SKILL.md)
(Conventional Commits) and SemVer when cutting versions.

## When to use

- Adding notes under `## [Unreleased]`
- Cutting a release: move Unreleased → `## [X.Y.Z] - YYYY-MM-DD`
- Documenting deprecations, removals, or breaking changes
- Reviewing whether a PR should update the changelog

## Operator workflow

1. Prefer file name **`CHANGELOG.md`** at the package or repo root consumers expect.
2. Keep an **`## [Unreleased]`** section at the top; append bullets there during
   development.
3. At release time:
   - Choose the SemVer bump from the change types (especially breaking /
     removals).
   - Rename/move Unreleased content into `## [X.Y.Z] - YYYY-MM-DD` (ISO 8601 date).
   - Leave a fresh empty `## [Unreleased]` above it.
   - Update compare links at the bottom of the file when the project uses them.
4. Omit empty `###` subsections (no “Added” with zero bullets).
5. Do **not** paste raw `git log` output. Curate notable changes across commits.
6. Always call out **Deprecated**, **Removed**, and breaking behavior clearly.

Yanked release heading form:

```markdown
## [0.0.5] - 2014-12-13 [YANKED]
```

## Skeleton

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- …

### Fixed

- …

## [1.0.0] - 2026-08-13

### Added

- …

[unreleased]: https://github.com/OWNER/REPO/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/OWNER/REPO/releases/tag/v1.0.0
```

---

The remainder of this file is the [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
guidance (guiding principles, change types, maintenance, and anti-patterns).

# Keep a Changelog 1.1.0

## What is a changelog?

A changelog is a file which contains a curated, chronologically ordered list of
notable changes for each version of a project.

## Why keep a changelog?

To make it easier for users and contributors to see precisely what notable
changes have been made between each release (or version) of the project.

## Guiding principles

- Changelogs are **for humans**, not machines.
- There should be an entry for every single version.
- The same types of changes should be grouped.
- Versions and sections should be linkable.
- The latest version comes first.
- The release date of each version is displayed.
- Mention whether you follow Semantic Versioning.

## Types of changes

- **Added** for new features.
- **Changed** for changes in existing functionality.
- **Deprecated** for soon-to-be removed features.
- **Removed** for now removed features.
- **Fixed** for any bug fixes.
- **Security** in case of vulnerabilities.

## How can I reduce the effort required to maintain a changelog?

Keep an `Unreleased` section at the top to track upcoming changes.

This serves two purposes:

- People can see what changes they might expect in upcoming releases
- At release time, you can move the `Unreleased` section changes into a new
  release version section.

## Anti-patterns

### Commit log diffs

Using commit log diffs as changelogs is a bad idea: they're full of noise.
Things like merge commits, commits with obscure titles, documentation changes,
etc.

The purpose of a commit is to document a step in the evolution of the source
code. Some projects clean up commits, some don't.

The purpose of a changelog entry is to document the noteworthy difference, often
across multiple commits, to communicate them clearly to end users.

### Ignoring deprecations

When people upgrade from one version to another, it should be painfully clear
when something will break. It should be possible to upgrade to a version that
lists deprecations, remove what's deprecated, then upgrade to the version where
the deprecations become removals.

If you do nothing else, list deprecations, removals, and any breaking changes in
the changelog.

### Confusing dates

Use ISO 8601 dates: `YYYY-MM-DD` (e.g. `2017-07-17`). Year, month, day — largest
to smallest units — avoids regional month/day ambiguity.

### Inconsistent changes

A changelog which only mentions some of the changes can be as dangerous as not
having a changelog. Important changes should be mentioned. With a good changelog
as the source of truth comes the responsibility to update it consistently.

## Yanked releases

Yanked releases are versions that had to be pulled because of a serious bug or
security issue. They should appear in the changelog:

```markdown
## [0.0.5] - 2014-12-13 [YANKED]
```

The `[YANKED]` tag is loud for a reason.

## File name

Call it `CHANGELOG.md`. Some projects use `HISTORY`, `NEWS`, or `RELEASES`;
prefer `CHANGELOG.md` so consumers can find it consistently.

## Rewriting

It is OK to improve a changelog after the fact (missing releases, forgotten
breaking changes). Prefer accuracy for consumers over never editing past
sections.
