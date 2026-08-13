---
name: loop
description: >-
  Loop remediate → commit → re-review with agent-review until status is
  clean at the configured severity threshold. Use after a blocked commit or
  when clearing remediations under .data/agent-review/.
---

# Agent-review remediation loop

Operator loop driven by you (coding agent) + the CLI. There is no in-package
auto-fixer.

## Stop condition

Stop when:

```sh
bunx agent-review status
```

exits `0` (no blocking remediations at the threshold), **or** a remediation
work-log is `blocked` and you cannot proceed without the user, **or** you have
completed **5** full passes without clearing blockers — then stop and ask the
user.

Default threshold = config `blockOn` and more severe. Override:

```sh
bunx agent-review status --min-severity warning
```

## Steps

1. **Review (or use the hook).** If you are not already inside a failed
   `commit-msg` run:

   ```sh
   bunx agent-review run \
     --scope staged --include-workstream
   ```

   The husky commit-msg hook *is* a `run` with `--include-workstream`. After a
   failed commit, call `status` (latest run) instead of re-running unless the
   working tree changed without a review.

2. **Inspect blockers.**

   ```sh
   bunx agent-review status
   # or: bunx agent-review status --json
   ```

   Exit `0` → done. Exit `1` → implement each listed remediation. Exit `2` →
   fix config / missing run.

3. **Remediate.** For each blocking remediation path from `status`, follow
   [../remediation/SKILL.md](../remediation/SKILL.md): open `plan.md`, implement
   steps, `log` progress, leave small artifacts, `log --event done`.

4. **Commit.** Stage your changes, draft a message, commit:

   ```sh
   bunx agent-review commit-message
   # copy stdout into:
   git commit -m "$(…message…)"
   ```

   Spec guidance: [../commit-message/SKILL.md](../commit-message/SKILL.md).

5. **Re-enter via the hook.** The commit-msg hook runs `run` again. That is the
   next review — do **not** set `"skip": true` in `.agent-review.json` on the
   final commit. After the hook finishes (success or fail), call `status`
   again and continue from step 2.

## Rules

- Stay scoped to open remediations; no drive-by refactors.
- Prefer `--include-workstream` on explicit `run` retries so prior same-HEAD
  plans stay in context.
- Work-log `done` ≠ review-clean; only `status` exit `0` (or a successful
  hook) means the loop is finished.
