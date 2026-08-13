import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runInit } from "./init.ts";
import { packagedCodeReviewSkillPath, resolvePackageRoot } from "./package-root.ts";

describe("package-root", () => {
  test("resolves this package and packaged code-review skill", () => {
    const root = resolvePackageRoot();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      name?: string;
    };
    expect(pkg.name).toBe("@khoralabs/agent-review");
    const skill = packagedCodeReviewSkillPath();
    expect(fs.existsSync(path.join(skill, "SKILL.md"))).toBe(true);
  });
});

describe("runInit", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test("writes config, hook, and operator skill copy", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-init-"));
    fs.mkdirSync(path.join(dir, ".husky"), { recursive: true });
    const result = runInit({ cwd: dir });
    expect(result.configWritten).toBe(true);
    expect(result.hookWritten).toBe(true);
    expect(result.skillWritten).toBe(true);
    expect(fs.existsSync(path.join(dir, ".agent-review.json"))).toBe(true);
    const hookPath = path.join(dir, ".husky", "commit-msg");
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.statSync(hookPath).mode & 0o111).not.toBe(0);
    expect(fs.existsSync(path.join(dir, ".agents", "skills", "agent-review", "SKILL.md"))).toBe(
      true,
    );

    const again = runInit({ cwd: dir });
    expect(again.configWritten).toBe(false);
    expect(again.hookWritten).toBe(false);
    expect(again.skillWritten).toBe(false);

    const forced = runInit({ cwd: dir, force: true });
    expect(forced.configWritten).toBe(true);
  });
});
