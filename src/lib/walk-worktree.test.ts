import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWalkWorktreePool, walkWorktreePath } from "./walk-worktree.ts";

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

async function makeRepo(): Promise<{ dir: string; head: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-wt-"));
  tmpDirs.push(dir);
  await git(dir, ["init"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  await git(dir, ["add", "a.txt"]);
  await git(dir, ["commit", "-m", "add a"]);
  const head = await git(dir, ["rev-parse", "HEAD"]);
  return { dir, head };
}

describe("createWalkWorktreePool", () => {
  test("recreates after interrupted run left stale Git metadata", async () => {
    const { dir, head } = await makeRepo();
    const outputDir = path.join(dir, ".data-walk");
    const pool = await createWalkWorktreePool({
      repoCwd: dir,
      outputDir,
      size: 1,
      startRev: head,
    });
    const wtPath = walkWorktreePath(outputDir, 0);
    expect(fs.existsSync(wtPath)).toBe(true);

    // Simulate interrupt: delete the directory without git worktree remove.
    fs.rmSync(wtPath, { recursive: true, force: true });
    expect(fs.existsSync(wtPath)).toBe(false);

    const pool2 = await createWalkWorktreePool({
      repoCwd: dir,
      outputDir,
      size: 1,
      startRev: head,
    });
    expect(fs.existsSync(walkWorktreePath(outputDir, 0))).toBe(true);
    await pool2.dispose();
    // First pool dispose is a no-op cleanup of already-cleared path.
    await pool.dispose();
  });
});
