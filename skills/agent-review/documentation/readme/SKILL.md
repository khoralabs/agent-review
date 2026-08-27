---
name: readme
description: >-
  Standard README spec for README.md. Use when creating or auditing a README,
  fixing section order, aligning the short description with package.json or
  GitHub, adding Install/Usage/Contributing/License sections, or when the user
  mentions standard-readme or README compliance.
---

# README (agent-review)

Maintain `README.md` per the [Standard README spec](https://github.com/RichardLitt/standard-readme/blob/main/spec.md).
The spec targets open-source libraries; internal apps may omit optional sections but
must keep required sections in the prescribed order.

## When to use

- Creating a README for a new package or repo
- Auditing an existing README for section order and required content
- Short description mismatch with `package.json` or GitHub repo description
- Missing Install, Usage, Contributing, or License sections
- Broken links or code examples that do not match project lint rules

## Operator workflow

1. Confirm the file is named **`README.md`** (or `README.<lang>.md` for i18n per spec).
2. Walk sections **in order** (see skeleton below). Omit optional sections; do not reorder required ones.
3. Align the **short description** (≤120 characters) with the package manager `description` field and GitHub description when applicable.
4. Ensure the **Table of Contents** links every `##` heading (required unless README is under 100 lines).
5. Fix broken links; lint code examples the same way as project source.
6. Put **License** last. Use an [SPDX](https://spdx.org/licenses/) identifier.

For documentation-only repos (no functional code), **Install** and **Usage** may be omitted.

## Skeleton

```markdown
# Project Title _(package-name)_

<!-- optional: banner image, no heading -->

<!-- optional: badges, newline-delimited -->

Short description under 120 characters matching package.json description.

<!-- optional: long description paragraphs -->

## Table of Contents

- [Background](#background)
- [Install](#install)
- …

<!-- optional: ## Security -->

<!-- optional: ## Background -->

## Install

```sh
…
```

## Usage

```sh
…
```

<!-- optional: extra sections with their own titles -->

<!-- optional: ## API -->

<!-- optional: ## Maintainers -->

<!-- optional: ## Thanks -->

## Contributing

…

## License

SPDX-Identifier © Owner
```

---

The remainder of this file summarizes the [Standard README spec](https://github.com/RichardLitt/standard-readme/blob/main/spec.md).

# Standard README

## Compliance

A compliant README must satisfy all requirements below.

- Be called **README** with the appropriate extension (`.md` for Markdown).
- Be valid Markdown.
- Sections appear in the order given; optional sections may be omitted.
- Section titles match those listed (translate for non-English READMEs).
- Must not contain broken links.
- Code examples must be linted like the rest of the project.

## Section order

1. **Title** (required) — matches repo/folder/package name, or relevant title with repo name in italics in parentheses.
2. **Banner** (optional) — no heading; local image link; directly after title.
3. **Badges** (optional) — no heading; newline-delimited.
4. **Short Description** (required) — no heading; ≤120 chars; own line; matches package manager and GitHub description.
5. **Long Description** (optional) — no heading; explain name mismatches here if any.
6. **Table of Contents** (required unless &lt;100 lines) — links all `##` headings; starts after title/ToC headings.
7. **Security** (optional) — or in extra sections below Usage.
8. **Background** (optional) — motivation, dependencies, provenance.
9. **Install** (required by default) — code block; optional `Dependencies` subsection.
10. **Usage** (required by default) — code block; optional `CLI` subsection if CLI exists.
11. **Extra Sections** (optional) — 0+ titled sections between Usage and API.
12. **API** (optional) — exported functions/objects; may point to external `API.md`.
13. **Maintainers** (optional) — `Maintainer` or `Maintainers`; contact info.
14. **Thanks** (optional) — `Thanks`, `Credits`, or `Acknowledgements`.
15. **Contributing** (required) — where to ask questions; whether PRs accepted; requirements.
16. **License** (required, **last**) — SPDX identifier; owner; link to license file.

## Key requirements

### Short Description

- Must not start with `> `
- Must match `description` in `package.json` (npm) when applicable

### Table of Contents

- Must capture all level-two headings at minimum

### License

- Use SPDX identifier from [spdx.org/licenses](https://spdx.org/licenses/)
- Use `UNLICENSED` for unlicensed repos
- Use `SEE LICENSE IN <filename>` when needed

### Documentation repositories

Repos without functional code may omit **Install** and **Usage**.

## Full spec

Normative source: [Standard README spec](https://github.com/RichardLitt/standard-readme/blob/main/spec.md)
