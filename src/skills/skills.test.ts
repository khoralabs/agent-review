import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatActivatedSkills,
  formatSkillCatalog,
  loadSkillPrompt,
  parseSkillMarkdown,
  selectActivatedSkills,
  validateSkillName,
} from "./index.ts";

describe("validateSkillName", () => {
  test("accepts spec-compliant names", () => {
    expect(validateSkillName("code-review")).toBeUndefined();
    expect(validateSkillName("pdf")).toBeUndefined();
  });

  test("rejects invalid names", () => {
    expect(validateSkillName("Code-Review")).toBeDefined();
    expect(validateSkillName("-pdf")).toBeDefined();
    expect(validateSkillName("pdf-")).toBeDefined();
    expect(validateSkillName("pdf--processing")).toBeDefined();
    expect(validateSkillName("")).toBeDefined();
  });
});

describe("parseSkillMarkdown", () => {
  test("parses valid SKILL.md and enforces dir name match in strict mode", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-parse-"));
    const skillDir = path.join(dir, "code-review");
    fs.mkdirSync(skillDir);
    const skillPath = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(
      skillPath,
      `---
name: code-review
description: Reviews diffs for bugs. Use when reviewing code changes.
---

# Body
`,
    );

    const ok = parseSkillMarkdown(fs.readFileSync(skillPath, "utf8"), skillPath, {
      strict: true,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.skill.name).toBe("code-review");
      expect(ok.skill.body).toContain("# Body");
    }

    const mismatchPath = path.join(dir, "other", "SKILL.md");
    fs.mkdirSync(path.dirname(mismatchPath));
    fs.writeFileSync(
      mismatchPath,
      `---
name: code-review
description: Reviews diffs for bugs. Use when reviewing code changes.
---

body
`,
    );
    const bad = parseSkillMarkdown(fs.readFileSync(mismatchPath, "utf8"), mismatchPath, {
      strict: true,
    });
    expect(bad.ok).toBe(false);
  });

  test("rejects missing description", () => {
    const result = parseSkillMarkdown(
      `---
name: code-review
description: ""
---

x
`,
      "/tmp/code-review/SKILL.md",
      { strict: true },
    );
    expect(result.ok).toBe(false);
  });
});

describe("format + selectActivatedSkills", () => {
  test("catalog vs activated body", () => {
    const skill = {
      name: "code-review",
      description: "Reviews diffs",
      body: "Do a careful review.",
      location: "/repo/skills/code-review/SKILL.md",
      dirName: "code-review",
      frontmatter: { name: "code-review", description: "Reviews diffs" },
    };
    const catalog = formatSkillCatalog([skill]);
    expect(catalog).toContain("<available_skills>");
    expect(catalog).toContain("code-review");
    expect(catalog).not.toContain("Do a careful review");

    const activated = formatActivatedSkills([skill]);
    expect(activated).toContain("Do a careful review");
    expect(activated).toContain('name="code-review"');

    const selected = selectActivatedSkills([skill], ["./skills/code-review"], "/repo");
    expect(selected).toHaveLength(1);
  });
});

describe("loadSkillPrompt", () => {
  test("formats catalog and activated body", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-load-"));
    const skillDir = path.join(dir, "conventional-commits");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: conventional-commits
description: Conventional Commits 1.0.0 for planning and commit messages.
---

# Spec body
`,
    );
    const loaded = loadSkillPrompt({ skills: [skillDir], skillsDirs: [] }, dir);
    expect(loaded.error).toBeUndefined();
    expect(loaded.system).toContain("<available_skills>");
    expect(loaded.system).toContain("conventional-commits");
    expect(loaded.system).toContain("# Spec body");
  });
});
