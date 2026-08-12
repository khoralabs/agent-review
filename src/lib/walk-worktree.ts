import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export const WALK_WORKTREES_DIRNAME = "worktrees";

export function walkWorktreePath(outputDir: string, index: number): string {
  return path.join(outputDir, WALK_WORKTREES_DIRNAME, `walk-${index}`);
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
  return { stdout, stderr, exitCode };
}

/**
 * Drop a walk worktree path from Git metadata and the filesystem.
 * Handles interrupted runs where the directory was deleted but Git still
 * lists the worktree (and the inverse: orphaned dirs without metadata).
 */
async function clearWalkWorktree(repoCwd: string, wtPath: string): Promise<void> {
  await runGit(["worktree", "remove", "--force", wtPath], repoCwd);
  if (existsSync(wtPath)) {
    rmSync(wtPath, { recursive: true, force: true });
  }
  await runGit(["worktree", "prune"], repoCwd);
}

export type WalkWorktreePool = {
  paths: string[];
  checkout(workerIndex: number, sha: string): Promise<void>;
  dispose(): Promise<void>;
};

/**
 * Create N detached worktrees under `<outputDir>/worktrees/walk-<i>`.
 * `repoCwd` must be the main repository checkout (not a worktree).
 */
export async function createWalkWorktreePool(input: {
  repoCwd: string;
  outputDir: string;
  size: number;
  /** Initial detach target (usually `to` / HEAD). */
  startRev: string;
}): Promise<WalkWorktreePool> {
  const size = Math.max(1, Math.floor(input.size));
  const paths: string[] = [];
  mkdirSync(path.join(input.outputDir, WALK_WORKTREES_DIRNAME), {
    recursive: true,
  });

  try {
    for (let i = 0; i < size; i++) {
      const wtPath = walkWorktreePath(input.outputDir, i);
      await clearWalkWorktree(input.repoCwd, wtPath);
      const add = await runGit(
        ["worktree", "add", "--detach", wtPath, input.startRev],
        input.repoCwd,
      );
      if (add.exitCode !== 0) {
        throw new Error(
          `git worktree add failed for walk-${i}: ${add.stderr.trim() || add.stdout.trim() || `exit ${add.exitCode}`}`,
        );
      }
      paths.push(wtPath);
    }
  } catch (err) {
    await removeWalkWorktrees(input.repoCwd, paths);
    throw err;
  }

  return {
    paths,
    async checkout(workerIndex: number, sha: string): Promise<void> {
      const wtPath = paths[workerIndex];
      if (wtPath === undefined) {
        throw new Error(`invalid walk worktree index: ${workerIndex}`);
      }
      const result = await runGit(["-C", wtPath, "checkout", "--detach", sha], input.repoCwd);
      if (result.exitCode !== 0) {
        throw new Error(
          `git checkout --detach ${sha} failed in walk-${workerIndex}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
        );
      }
    },
    async dispose(): Promise<void> {
      await removeWalkWorktrees(input.repoCwd, paths);
    },
  };
}

async function removeWalkWorktrees(repoCwd: string, paths: readonly string[]): Promise<void> {
  for (const wtPath of paths) {
    await clearWalkWorktree(repoCwd, wtPath);
  }
}
