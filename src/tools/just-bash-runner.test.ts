import { describe, expect, test } from "bun:test";

import { assertReadonlyGitArgs, runJustBash } from "./just-bash-runner.ts";

const cwd = import.meta.dir;

describe("runJustBash", () => {
  test("runs inspect builtins without host bash", async () => {
    const result = await runJustBash({
      command: "printf hi",
      cwd,
      timeoutMs: 5_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hi");
  });

  test("does not register host bash or destructive builtins", async () => {
    const bash = await runJustBash({
      command: "bash -lc 'echo pwned'",
      cwd,
      timeoutMs: 5_000,
    });
    expect(bash.exitCode).not.toBe(0);
    expect(`${bash.stdout}${bash.stderr}`).not.toContain("pwned");

    const rm = await runJustBash({
      command: "rm -rf .",
      cwd,
      timeoutMs: 5_000,
    });
    expect(rm.exitCode).not.toBe(0);
  });

  test("git is absent unless allowReadonlyGit", async () => {
    const denied = await runJustBash({
      command: "git status",
      cwd,
      timeoutMs: 5_000,
    });
    expect(denied.exitCode).not.toBe(0);

    const allowed = await runJustBash({
      command: "git rev-parse --is-inside-work-tree",
      cwd,
      timeoutMs: 5_000,
      allowReadonlyGit: true,
    });
    expect(allowed.exitCode === 0 || allowed.stderr.length > 0).toBe(true);
  });
});

describe("assertReadonlyGitArgs", () => {
  test("allows read-only git without injection flags", () => {
    expect(assertReadonlyGitArgs(["status"])).toEqual({ ok: true });
    expect(assertReadonlyGitArgs(["log", "-p", "--oneline"])).toEqual({
      ok: true,
    });
    expect(assertReadonlyGitArgs(["diff", "--cached"])).toEqual({ ok: true });
  });

  test("rejects config, pager, and repo-retarget flags", () => {
    for (const args of [
      ["-c", "core.pager=id", "status"],
      ["--config", "core.pager=id", "status"],
      ["--exec-path=/tmp", "status"],
      ["--git-dir=/tmp/evil.git", "log"],
      ["--work-tree=/tmp", "status"],
      ["--paginate", "status"],
      ["-p", "status"],
      ["diff", "--ext-diff"],
      ["-C", "/tmp", "status"],
    ]) {
      const result = assertReadonlyGitArgs(args);
      expect(result.ok).toBe(false);
    }
  });
});

describe("runJustBash git flag injection", () => {
  test("blocks host git option injection", async () => {
    const result = await runJustBash({
      command: "git -c core.pager=true status",
      cwd,
      timeoutMs: 5_000,
      allowReadonlyGit: true,
    });
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("not allowed");
  });
});
