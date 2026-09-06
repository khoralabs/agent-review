import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PACKAGE_NAME,
  publishSkills,
  redactSecret,
  SKILL_DEST_NAME,
  type SkillSource,
  SOURCE_REPO,
  syncSkillDirectory,
} from "./publish-skills.ts";

describe("redactSecret", () => {
  test("replaces every occurrence of the secret", () => {
    expect(redactSecret("clone failed: ghp_abc in url ghp_abc", "ghp_abc")).toBe(
      "clone failed: *** in url ***",
    );
  });
});

describe("syncSkillDirectory", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  test("replaces dest wholesale and writes skill-source.json", () => {
    root = mkdtempSync(path.join(os.tmpdir(), "publish-skills-sync-"));
    const sourceDir = path.join(root, "source");
    const destDir = path.join(root, "dest");
    mkdirSync(path.join(sourceDir, "nested"), { recursive: true });
    writeFileSync(path.join(sourceDir, "SKILL.md"), "# root\n");
    writeFileSync(path.join(sourceDir, "nested", "SKILL.md"), "# nested\n");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(path.join(destDir, "stale.md"), "gone\n");

    const skillSource: SkillSource = {
      sourceRepo: SOURCE_REPO,
      packageName: PACKAGE_NAME,
      version: "1.2.3",
      sourceCommit: "abc123",
    };
    const result = syncSkillDirectory({ sourceDir, destDir, skillSource });

    expect(existsSync(path.join(destDir, "stale.md"))).toBe(false);
    expect(readFileSync(path.join(destDir, "SKILL.md"), "utf8")).toBe("# root\n");
    expect(readFileSync(path.join(destDir, "nested", "SKILL.md"), "utf8")).toBe("# nested\n");
    expect(result.skillSourcePath).toBe(path.join(destDir, "skill-source.json"));
    expect(JSON.parse(readFileSync(result.skillSourcePath, "utf8"))).toEqual(skillSource);
  });
});

describe("publishSkills", () => {
  let skillsRepo: string | undefined;

  afterEach(() => {
    if (skillsRepo !== undefined && existsSync(skillsRepo)) {
      rmSync(skillsRepo, { recursive: true, force: true });
      skillsRepo = undefined;
    }
  });

  test("skips when token is unset", async () => {
    const workspaceRoot = path.resolve(import.meta.dir, "..");
    const result = await publishSkills({
      workspaceRoot,
      version: "0.0.0-test",
      sourceCommit: "deadbeef",
      token: "",
    });
    expect(result).toEqual({ status: "skipped", reason: "token_unset" });
  });

  test("syncs into a local skills checkout and commits", async () => {
    skillsRepo = mkdtempSync(path.join(os.tmpdir(), "skills-checkout-"));
    await Bun.$`git -C ${skillsRepo} init`.quiet();
    writeFileSync(path.join(skillsRepo, "README.md"), "# skills\n");
    await Bun.$`git -C ${skillsRepo} add README.md`.quiet();
    await Bun.$`git -C ${skillsRepo} -c user.name=test -c user.email=test@example.com commit -m init`.quiet();

    const workspaceRoot = path.resolve(import.meta.dir, "..");
    const result = await publishSkills({
      workspaceRoot,
      version: "9.9.9",
      sourceCommit: "abc",
      skillsRepoDir: skillsRepo,
    });
    expect(result.status).toBe("published");
    if (result.status === "published") {
      expect(result.commitMessage).toBe(`chore(skills): ${PACKAGE_NAME}@9.9.9`);
    }
    expect(existsSync(path.join(skillsRepo, SKILL_DEST_NAME, "SKILL.md"))).toBe(true);
    const provenance = JSON.parse(
      readFileSync(path.join(skillsRepo, SKILL_DEST_NAME, "skill-source.json"), "utf8"),
    ) as SkillSource;
    expect(provenance.version).toBe("9.9.9");
    expect(provenance.sourceCommit).toBe("abc");
    expect(provenance.packageName).toBe(PACKAGE_NAME);

    const second = await publishSkills({
      workspaceRoot,
      version: "9.9.9",
      sourceCommit: "abc",
      skillsRepoDir: skillsRepo,
    });
    expect(second.status).toBe("unchanged");
  });
});
