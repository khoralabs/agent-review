---
name: diataxis
description: >-
  Diátaxis framework for technical documentation: tutorials, how-to guides,
  reference, and explanation. Use when writing or reorganizing docs, classifying
  documentation by user need, fixing pages that mix teaching with reference, or
  when the user mentions diataxis, doc structure, or documentation quadrants.
---

# Diátaxis (agent-review)

Organize and write technical documentation per [Diátaxis](https://diataxis.fr):
four distinct forms responding to four user needs. Use the **compass** to classify
content before writing or moving pages.

## When to use

- Writing new documentation and unsure which form it should take
- Reorganizing docs that feel cluttered or hard to navigate
- A page tries to teach, explain, and reference at once
- Splitting or merging documentation sections

## The compass

From [The compass](https://diataxis.fr/compass/). Ask: **action or cognition?**
**acquisition or application?**

| If the content… | …and serves the user's… | …then it belongs to… |
|-----------------|-------------------------|----------------------|
| informs action | acquisition of skill | a **tutorial** |
| informs action | application of skill | a **how-to guide** |
| informs cognition | application of skill | **reference** |
| informs cognition | acquisition of skill | **explanation** |

## Quadrant rules

### Tutorials ([tutorials](https://diataxis.fr/tutorials/))

- A **lesson** — guided, practical, safe success for the learner
- User **does** something under instruction; goal is skill and confidence, not a deliverable
- Minimal explanation inline; link to explanation docs for depth
- Example: “Let's create a simple game in Python”

### How-to guides ([how-to guides](https://diataxis.fr/how-to-guides/))

- Addresses a **real-world goal or problem** with practical steps
- Assumes a **competent** user at work, not a student learning basics
- Example: “How to configure frame profiling” or “Troubleshooting deployment problems”

### Reference ([reference](https://diataxis.fr/reference/))

- **Technical description** — accurate, complete, neutral facts
- Serves the user at **work**; structure mirrors the system being described
- No opinions, no teaching, no step-by-step goals
- Example: API signatures, CLI flags, configuration keys

### Explanation ([explanation](https://diataxis.fr/explanation/))

- **Context and background** — answers “why?”
- Serves **study**, not work; may contain opinions and perspectives
- Example: “Secure communication using HTTPS encryption”

## Anti-patterns

- Tutorial overloaded with theory → move explanation to a linked page
- How-to that teaches fundamentals → write a tutorial instead
- Reference with narrative or opinions → split into reference + explanation
- One page mixing two or more quadrants → split by compass classification

## Operator workflow

From [How to use Diátaxis](https://diataxis.fr/how-to-use-diataxis/):

1. Look at the documentation in front of you (existing page or blank slate).
2. Ask: **is there any way it could be improved?**
3. Decide **one** small improvement — classify with the compass, move a section, or rewrite one paragraph.
4. Do that thing. Repeat.

Suggested layout (adapt to existing repo structure):

```text
docs/
  tutorials/
  how-to/
  reference/
  explanation/
```

Do not force a restructure if the project already has a working convention — apply the compass to **content**, not just folders.

## References

- [diataxis.fr](https://diataxis.fr) — home
- [Start here](https://diataxis.fr/start-here/) — five-minute primer
- [The map](https://diataxis.fr/map/) — relationships between quadrants
- [The compass](https://diataxis.fr/compass/) — classification decision table
- [Quality](https://diataxis.fr/quality/) — quality principles
- [Tutorials vs how-to guides](https://diataxis.fr/tutorials-how-to/)
- [Reference vs explanation](https://diataxis.fr/reference-explanation/)

---

The remainder of this file summarizes core ideas from [Diátaxis](https://diataxis.fr).

# Diátaxis overview

Diátaxis solves problems related to documentation **content** (what to write),
**style** (how to write it), and **architecture** (how to organize it).

## The four kinds

Crossing quadrant boundaries is at the heart of most documentation problems.
Each kind has a different purpose and must be written differently:

- **Tutorials** — practical lessons for skill acquisition
- **How-to guides** — directions for competent users solving real problems
- **Reference** — neutral technical descriptions for work
- **Explanation** — background and context for study

## The map

Tutorials and how-to guides concern what the user **does** (action).
Reference and explanation concern what the user **knows** (cognition).

Tutorials and explanation serve **acquisition** of skill (study).
How-to guides and reference serve **application** of skill (work).

See [The map](https://diataxis.fr/map/) for the full diagram.

## Working principle

Diátaxis is pragmatic: one improvement at a time. You do not need to reorganize
an entire docs site in one pass. Classify, improve one thing, repeat.
