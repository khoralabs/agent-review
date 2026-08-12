import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../config.ts";
import { runWalkPhase, type WalkStepResult } from "./walk-phase.ts";

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${stderr.trim()}`);
  }
  return stdout.trim();
}

async function makeRepo(): Promise<{
  dir: string;
  commits: [string, string, string];
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-walk-"));
  tmpDirs.push(dir);
  await git(dir, ["init"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test"]);
  const shas: string[] = [];
  for (const name of ["a", "b", "c"]) {
    fs.writeFileSync(path.join(dir, `${name}.txt`), `${name}\n`);
    await git(dir, ["add", `${name}.txt`]);
    await git(dir, ["commit", "-m", `add ${name}`]);
    shas.push(await git(dir, ["rev-parse", "HEAD"]));
  }
  const [a, b, c] = shas;
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error("expected 3 commits");
  }
  return { dir, commits: [a, b, c] };
}

describe("runWalkPhase", () => {
  test("empty range exits 0 and writes no steps", async () => {
    const { dir, commits } = await makeRepo();
    const outputDir = path.join(dir, ".data-walk");
    const outcome = await runWalkPhase({
      config: { ...DEFAULT_CONFIG, outputDir },
      from: commits[2],
      to: commits[2],
      cwd: dir,
      quiet: true,
      runCommitStepFn: async () => {
        throw new Error("should not run steps");
      },
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.artifact?.commits).toEqual([]);
    expect(outcome.walkIdStdout).toBeTruthy();
  });

  test("runs all commits via worker pool; catalog ignores completion order", async () => {
    const { dir, commits } = await makeRepo();
    const outputDir = path.join(dir, ".data-walk");
    const from = await git(dir, ["rev-parse", `${commits[0]}^`]).catch(async () => {
      // root has no parent — use empty tree parent via rev-list of first^..last
      // For root commit, from = commits[0] exclusive means start after first.
      return commits[0];
    });
    // Walk commits[1] and commits[2] (from = commits[0])
    const seenInspect: string[] = [];
    const started: string[] = [];
    const outcome = await runWalkPhase({
      config: { ...DEFAULT_CONFIG, outputDir },
      from: commits[0],
      to: commits[2],
      cwd: dir,
      concurrency: 2,
      quiet: true,
      runCommitStepFn: async ({ sha, inspectCwd, workerIndex }) => {
        started.push(sha);
        seenInspect.push(inspectCwd);
        // Stagger so both workers overlap.
        await Bun.sleep(workerIndex === 0 ? 30 : 5);
        const step: WalkStepResult = {
          commit: sha,
          runId: `run-${sha.slice(0, 7)}`,
          exitCode: 0,
          findingCount: sha === commits[1] ? 1 : 0,
          files: sha === commits[1] ? ["b.txt"] : ["c.txt"],
          findings:
            sha === commits[1]
              ? [
                  {
                    severity: "warning",
                    key: "demo-issue",
                    file: "b.txt",
                    message: "issue",
                    fingerprint: "f".repeat(64),
                  },
                ]
              : [],
          failed: false,
        };
        return step;
      },
    });

    expect(from).toBeTruthy();
    expect(outcome.exitCode).toBe(0);
    expect(outcome.artifact?.commits).toEqual([commits[1], commits[2]]);
    expect(started.sort()).toEqual([commits[1], commits[2]].sort());
    expect(outcome.artifact?.catalog).toHaveLength(1);
    expect(outcome.artifact?.catalog[0]?.status).toBe("unverified");
    expect(outcome.artifact?.catalog[0]?.occurrences[0]?.commit).toBe(commits[1]);
    // With runCommitStepFn, inspectCwd is repo cwd (no worktree).
    expect(seenInspect.every((p) => p === dir)).toBe(true);

    const walkJson = path.join(outputDir, "walks", outcome.walkId, "walk.json");
    expect(fs.existsSync(walkJson)).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "walks.jsonl"))).toBe(true);
  });

  test("step failure does not cancel siblings; exits 2 after full range", async () => {
    const { dir, commits } = await makeRepo();
    const outputDir = path.join(dir, ".data-walk");
    const outcome = await runWalkPhase({
      config: { ...DEFAULT_CONFIG, outputDir },
      from: commits[0],
      to: commits[2],
      cwd: dir,
      concurrency: 2,
      quiet: true,
      runCommitStepFn: async ({ sha }) => {
        if (sha === commits[1]) {
          return {
            commit: sha,
            exitCode: 2,
            findingCount: 0,
            files: [],
            findings: [],
            failed: true,
            error: "boom",
          };
        }
        return {
          commit: sha,
          runId: `run-${sha.slice(0, 7)}`,
          exitCode: 0,
          findingCount: 0,
          files: ["c.txt"],
          findings: [],
          failed: false,
        };
      },
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.artifact?.stepsFailed).toBe(1);
    expect(outcome.artifact?.steps).toHaveLength(2);
    expect(outcome.artifact?.steps.every((s) => s.commit.length > 0)).toBe(true);
  });
});
