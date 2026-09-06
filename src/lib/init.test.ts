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

  test("writes config, hook, and operator skill via skills CLI", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-init-"));
    const cwd = dir;
    fs.mkdirSync(path.join(cwd, ".husky"), { recursive: true });
    const calls: string[][] = [];
    const runSkillsCli = (args: string[]) => {
      calls.push([...args]);
      const skillPath = path.join(cwd, ".agents", "skills", "agent-review");
      if (args[0] === "remove") {
        fs.rmSync(skillPath, { recursive: true, force: true });
        return { exitCode: 0, stdout: "removed", stderr: "" };
      }
      fs.mkdirSync(skillPath, { recursive: true });
      fs.writeFileSync(path.join(skillPath, "SKILL.md"), "# agent-review\n");
      return { exitCode: 0, stdout: "installed", stderr: "" };
    };

    const result = runInit({ cwd, runSkillsCli });
    expect(result.configWritten).toBe(true);
    expect(result.hookWritten).toBe(true);
    expect(result.skillWritten).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".agent-review.json"))).toBe(true);
    const hookPath = path.join(cwd, ".husky", "commit-msg");
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.statSync(hookPath).mode & 0o111).not.toBe(0);
    expect(fs.existsSync(path.join(cwd, ".agents", "skills", "agent-review", "SKILL.md"))).toBe(
      true,
    );
    expect(calls[0]?.[0]).toBe("add");
    expect(calls[0]).toContain("--skill");
    expect(calls[0]).toContain("agent-review");

    const again = runInit({ cwd, runSkillsCli });
    expect(again.configWritten).toBe(false);
    expect(again.hookWritten).toBe(false);
    expect(again.skillWritten).toBe(false);

    const forced = runInit({ cwd, force: true, runSkillsCli });
    expect(forced.configWritten).toBe(true);
    expect(calls.some((c) => c[0] === "remove")).toBe(true);
  });
});
