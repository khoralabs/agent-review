---
name: commit-chunks
description: >-
  Land a list of scoped work groups as separate git commits: implement one
  chunk, stage only that chunk, draft with agent-review commit-message, commit,
  read the hook terminal, then remediate-all until status is clean. Use when
  the user wants several small changes committed iteratively, or after a
  commit-chunks plan. Skip work that cannot be proven without a browser.
---

# Commit chunks

Operator loop: one scoped chunk per commit. Load
[commit-message/SKILL.md](../../commit/commit-message/SKILL.md) when drafting the
message and [remediate-all/SKILL.md](../../remediation/remediate-all/SKILL.md) if the hook
blocks. For clearing findings **without** committing, use
[complete-feature/SKILL.md](../../remediation/complete-feature/SKILL.md).

## When to use

- User asked to land several independent groups over multiple commits
- A plan lists commit groups (skill/config first, then work chunks)
- A workstream is active: drive from that workstream’s `chunks.json` / `todo.md`
  when `workstreams.autoCommit` is true (or the user asked to commit)
- After finishing one chunk, before starting the next

## Do not start

Do **not** implement work that cannot be proven without user intervention in a
browser (layout, toast vs chat overlap, visual banners). Leave those items
unchecked and skip the chunk.

## Workstream source of truth

When `active-workstream` is set (or the user names a workstream id), treat
`workstreams/<id>/chunks.json` as the chunk list and check off matching items in
`todo.md` ([workstream/todo](../../workstream/todo/SKILL.md)). Update chunk
`status` as each lands. Log progress with
`bunx agent-review workstream log …`.

## Stop condition

Stop the overall list when every **allowed** chunk is committed and
`bunx agent-review status` exits `0` for the latest run.

Stop a remediate-all inner loop when status is clean, a work-log is `blocked`,
or **5** passes fail — then ask the user.

Threshold = config `blockOn` and more severe. Do **not** pass
`--min-severity` unless the user asked for a different bar.

## Loop (one chunk)

1. **Implement only this chunk.** No unrelated files (`todo.md` only if this
   chunk owns those check-offs; never `.env`).

2. **Stage only that chunk.**

   ```sh
   git add <paths-for-this-chunk>
   git status
   git diff --cached
   ```

3. **Draft and commit.**

   ```sh
   bunx agent-review commit-message
   git commit -m "$(…message from stdout…)"
   ```

   Follow Conventional Commits ([commit-message/SKILL.md](../../commit/commit-message/SKILL.md)).
   If `commit-message` fails (gateway), draft the message yourself from the
   staged diff. Do **not** set `"skip": true` in `.agent-review.json`.

4. **Read the commit-msg hook terminal.** A successful hook with no findings
   is enough to continue. If the hook failed or listed remediations, the commit
   was **cancelled** — remediate findings, then **re-run step 3** (`git commit`)
   after `status` is clean. Follow
   [remediate-all/SKILL.md](../../remediation/remediate-all/SKILL.md) (status → implement
   `plan.md` → commit → status).

5. **Next chunk.** Only after status is clean (or the hook succeeded with no
   blocking remediations). Repeat from step 1.

## Rules

- One concern per commit; do not batch unrelated groups.
- Stay scoped; no drive-by refactors.
- Work-log `done` ≠ review-clean; only `status` exit `0` (or a successful
  hook with no blockers) means the inner loop is finished.
