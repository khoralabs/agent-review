import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../config.ts";
import { runReviewPhase } from "./review-phase.ts";

const tmpDirs: string[] = [];

function makeTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("inspectCwd plumbing", () => {
  test("artifacts write under repo cwd outputDir, not inspectCwd", async () => {
    const repo = makeTmp("agent-review-repo-");
    const inspect = makeTmp("agent-review-inspect-");
    const outputDir = path.join(repo, ".data-agent-review");

    const outcome = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir,
      },
      scope: "staged",
      cwd: repo,
      inspectCwd: inspect,
      revParseFn: async () => "abc1234",
      gitRevParseFn: async (rev) => (rev === "HEAD" ? "a".repeat(40) : undefined),
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+ok",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "clean",
          findings: [],
        },
      })) as never,
    });

    expect(outcome.exitCode).toBe(0);
    expect(fs.existsSync(path.join(outputDir, "reviews"))).toBe(true);
    expect(fs.existsSync(path.join(inspect, ".data-agent-review"))).toBe(false);
    expect(fs.readdirSync(inspect)).toEqual([]);
  });
});
