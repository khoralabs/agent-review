---
name: complete-feature
description: >-
  Finish a feature before a manual commit: run agent-review via the CLI,
  remediate blocking findings, and re-run until status is clean — without
  committing. Use when the user wants findings cleared prior to committing
  themselves.
---

# Complete feature (no commit)

Drive `@khoralabs/agent-review` until findings at/above the severity threshold
are resolved, then **stop**. You never commit. Leave the working tree ready for
the user to commit manually.

This skill does **not** couple to husky, pre-commit, or commit-msg. If a project
wires review into those hooks, that is the user's concern on their later commit.

For remediate → **commit** → re-review after a blocked hook, use
[../remediate-all/SKILL.md](../remediate-all/SKILL.md).

When an agent-review **workstream** is active and `workstreams.autoCommit` is
`false` (default), prefer this skill for landing; see
[../../workstream/SKILL.md](../../workstream/SKILL.md).

## Stop condition

Stop when:

```sh
bunx agent-review status
```

exits `0` (no blocking remediations at the threshold), **or** a remediation
work-log is `blocked` and you cannot proceed without the user, **or** you have
completed **5** full passes without clearing blockers — then stop and report
remaining blockers.

Default threshold = config `blockOn` and more severe. If the user asked for a
stricter bar:

```sh
bunx agent-review status --min-severity warning
```

## Steps

1. **Choose scope.** Prefer `--scope working` (staged + unstaged). If that is
   unavailable or empty, stage the relevant changes and use `--scope staged`.
   Keep the same scope for every pass in this session.

2. **Run review via CLI** (not a git hook):

   ```sh
   bunx agent-review run --scope working --include-workstream
   ```

   On the first pass, `--include-workstream` is fine even with no prior run.

3. **Inspect blockers.**

   ```sh
   bunx agent-review status
   # or: bunx agent-review status --json
   ```

   Exit `0` → done (tell the user the tree is ready to commit). Exit `1` →
   remediate. Exit `2` → fix config / missing run.

4. **Remediate.** For each blocking remediation from `status`, follow
   [../remediation/SKILL.md](../remediation/SKILL.md): open `plan.md`, implement
   steps, `log` progress, leave small artifacts, `log --event done`.

5. **Re-run via CLI** on the same scope:

   ```sh
   bunx agent-review run --scope working --include-workstream
   ```

   Then return to step 3.

## Hard rules

- Do **not** `git commit`.
- Do **not** run `commit-message` for the purpose of committing.
- Do **not** set `"skip": true` (or otherwise disable review) in
  `.agent-review.json`.
- Do **not** instruct or assume hook re-entry; every review is an explicit
  `bunx agent-review run`.
- Stay scoped to open remediations; no drive-by refactors.
- Work-log `done` ≠ review-clean; only `status` exit `0` means finished.
