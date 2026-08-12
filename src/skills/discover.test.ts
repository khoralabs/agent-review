import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { discoverSkills } from "./discover.ts";

describe("discoverSkills", () => {
  test("discovers SKILL.md children under skillsDirs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-discover-"));
    const skillDir = path.join(root, "code-review");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: code-review
description: Reviews diffs for bugs. Use when reviewing code changes.
---

# Review
`,
    );

    const result = discoverSkills({
      cwd: root,
      skillsDirs: ["."],
      skillPaths: [],
      strictPaths: true,
    });

    expect(result.skills.map((s) => s.name)).toContain("code-review");
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(false);
  });
});
