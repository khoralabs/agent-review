import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { stageRelease } from "./stage-release.ts";

describe("stageRelease", () => {
  let releaseDir: string | undefined;

  afterEach(() => {
    if (releaseDir !== undefined && existsSync(releaseDir)) {
      rmSync(releaseDir, { recursive: true, force: true });
      releaseDir = undefined;
    }
  });

  test("stages bin, src, skills, and publishable package.json", async () => {
    const workspaceRoot = path.resolve(import.meta.dir, "..");
    releaseDir = mkdtempSync(path.join(os.tmpdir(), "agent-review-stage-"));
    const result = await stageRelease({
      workspaceRoot,
      version: "0.0.0-test",
      releaseDir,
    });
    expect(result.releaseDir).toBe(releaseDir);
    expect(existsSync(path.join(result.releaseDir, "bin", "agent-review"))).toBe(true);
    expect(existsSync(path.join(result.releaseDir, "src", "cli.ts"))).toBe(true);
    expect(
      existsSync(path.join(result.releaseDir, "skills", "agent-review", "code-review", "SKILL.md")),
    ).toBe(true);
    expect(existsSync(path.join(result.releaseDir, ".agent-review.example.json"))).toBe(true);
    expect(existsSync(path.join(result.releaseDir, "LICENSE"))).toBe(true);

    const pkg = JSON.parse(await Bun.file(path.join(result.releaseDir, "package.json")).text()) as {
      version: string;
      private?: boolean;
      bin?: { "agent-review"?: string };
      dependencies?: Record<string, string>;
      scripts?: unknown;
      devDependencies?: unknown;
    };
    expect(pkg.version).toBe("0.0.0-test");
    expect(pkg.private).toBeUndefined();
    expect(pkg.bin?.["agent-review"]).toBe("./bin/agent-review");
    expect(pkg.dependencies?.["@khoralabs/agent-capabilities"]).toBeDefined();
    expect(pkg.scripts).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
  });
});
