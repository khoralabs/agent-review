---
name: todo
description: >-
  Maintain a todo-md checklist scoped to an agent-review workstream todo.md
  (not a repo-root TODO.md). Use when planning or checking off work under
  workstreams/<id>/todo.md, or when the user mentions todo-md inside a workstream.
---

# Workstream todo (todo-md)

Follow the [TODO.md standard](https://github.com/todo-md/todo-md) for markdown
todo files, **scoped to the active (or specified) workstream**:

`<output-dir>/workstreams/<workstreamId>/todo.md`

Do **not** create or edit a repository-root `TODO.md` for this skill unless the
user explicitly asks for a project-wide file.

## Format

Every file starts with `# TODO`. Optional top-level sections:

- `# TODO` — current work
- `# BACKLOG` — postponed
- `# DONE` — finished or declined items (optional archive)

Subheaders (`## Section`) group tasks.

### Task lines

| Marker | State |
|--------|--------|
| `- [ ] ` | open |
| `- [x] ` | done |
| `- [-] ` | declined |

Tasks are one-liners. Nest with indentation for subtasks:

```markdown
# TODO

## Content

- [ ] Add readme #example @owner
  - [ ] Create Pull Request

# BACKLOG

- [ ] Deferred item

# DONE

- [x] Finished item #prio1
- [-] Declined item
```

### Metadata

- Assign with `@USERNAME`
- Tag with `#TAG`

## Hierarchy (when listing across tools)

1. **Workstream** — folder name under `workstreams/`
2. **Section** — markdown subheader
3. **Task** — lines starting with `- [ ] `, `- [x] `, or `- [-] `

## Operator workflow

1. Resolve the target file: active workstream via `active-workstream`, or
   `--workstream-id` / user-specified path under `workstreams/`.
2. Keep tasks aligned with `chunks.json` keys (kebab-case) when a chunk owns
   check-offs.
3. Check off items as chunks land; move declined work to `- [-]` or `# DONE`.
4. Do not invent parallel todo systems outside this file while in a workstream.

## References

- [todo-md/todo-md](https://github.com/todo-md/todo-md) — markdown todo standard
