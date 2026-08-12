import { describe, expect, test } from "bun:test";
import {
  evaluateComposable,
  type ToolRuntimeContext,
  type ToolSpec,
} from "@khoralabs/agent-capabilities";

import { commitMessageToolkit, reviewToolkit } from "./_toolkit.ts";
import { assertInspectCommandAllowed } from "./command-policy.ts";
import type { ReviewToolkitEnv } from "./types.ts";

describe("assertInspectCommandAllowed", () => {
  test("allows common inspect commands", () => {
    for (const command of [
      "rg foo src",
      "cat package.json",
      "ls -la",
      "find . -name '*.ts'",
      "head -n 20 README.md",
      "wc -l src/review.ts",
    ]) {
      expect(assertInspectCommandAllowed(command)).toEqual({ ok: true });
    }
  });

  test("denies git commands", () => {
    for (const command of [
      "git status",
      "git show HEAD",
      "GIT_DIR=.git git log -1",
      "echo $(git rev-parse HEAD)",
      "/usr/bin/git diff",
      "ls && git status",
    ]) {
      const result = assertInspectCommandAllowed(command);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("git");
    }
  });

  test("denies write and destructive commands", () => {
    for (const command of [
      "rm -rf /tmp/x",
      "mv a b",
      "cp a b",
      "mkdir foo",
      "touch foo",
      "chmod 777 file",
      "echo x > file",
      "echo x >> file",
      "sed -i 's/a/b/' file",
      "npm install lodash",
      "bun add zod",
    ]) {
      const result = assertInspectCommandAllowed(command);
      expect(result.ok).toBe(false);
    }
  });

  test("denies empty command", () => {
    const result = assertInspectCommandAllowed("   ");
    expect(result.ok).toBe(false);
  });

  test("denies shell-escaped git and write commands", () => {
    for (const command of [
      "\\git status",
      'gi"t" status',
      "gi't' status",
      "\\rm -rf /tmp/x",
      "r\\m -rf /tmp/x",
      "'rm' -rf /tmp/x",
    ]) {
      const result = assertInspectCommandAllowed(command);
      expect(result.ok).toBe(false);
    }
    const allow = { allowReadonlyGit: true };
    expect(assertInspectCommandAllowed("\\git status", allow)).toEqual({
      ok: true,
    });
    expect(assertInspectCommandAllowed('gi"t" log -1', allow)).toEqual({
      ok: true,
    });
    const mutating = assertInspectCommandAllowed("\\git commit -m x", allow);
    expect(mutating.ok).toBe(false);
  });

  test("allowReadonlyGit permits inspect git and denies mutating git", () => {
    const allow = { allowReadonlyGit: true };
    for (const command of [
      "git status",
      "git log -5 --oneline",
      "git diff --cached",
      "git show HEAD",
      "git blame src/a.ts",
      "git rev-parse --short HEAD",
      "git shortlog -sn",
      "echo $(git rev-parse HEAD)",
      "ls && git status",
    ]) {
      expect(assertInspectCommandAllowed(command, allow)).toEqual({ ok: true });
    }
    for (const command of [
      "git commit -m x",
      "git push",
      "git add .",
      "git reset --hard",
      "git checkout main",
      "git rebase -i",
      "git stash",
      "git merge main",
    ]) {
      const result = assertInspectCommandAllowed(command, allow);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("git");
    }
  });
});

describe("inspectBashTool deny path", () => {
  async function inspectBashHandler() {
    const env: ReviewToolkitEnv = { cwd: "/tmp" };
    const { tools } = await evaluateComposable(reviewToolkit, { env });
    const spec = (tools as Record<string, ToolSpec | undefined>).inspectBash;
    if (spec === undefined) throw new Error("inspectBash not available");
    return spec.handler.bind(spec) as (
      ctx: ToolRuntimeContext<ReviewToolkitEnv>,
      input: { command: string; timeoutMs?: number },
    ) => Promise<{
      ok: boolean;
      denied?: boolean;
      stderr: string;
    }>;
  }

  test("returns denied result without needing a real cwd spawn for git", async () => {
    const handler = await inspectBashHandler();
    const result = await handler(
      { env: { cwd: "/tmp" }, agentId: "test", agentName: "test" },
      { command: "git status" },
    );
    expect(result.denied).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("git");
  });

  test("denies escaped git and rm before just-bash runs", async () => {
    const handler = await inspectBashHandler();
    for (const command of ["\\git status", 'gi"t" status', "\\rm -rf src"]) {
      const result = await handler(
        { env: { cwd: "/tmp" }, agentId: "test", agentName: "test" },
        { command },
      );
      expect(result.denied).toBe(true);
      expect(result.ok).toBe(false);
    }
  });

  test("returns denied for write redirects", async () => {
    const handler = await inspectBashHandler();
    const result = await handler(
      { env: { cwd: "/tmp" }, agentId: "test", agentName: "test" },
      { command: "echo hi > /tmp/out.txt" },
    );
    expect(result.denied).toBe(true);
    expect(result.ok).toBe(false);
  });

  test("commit-message toolkit allows read-only git", async () => {
    const env: ReviewToolkitEnv = { cwd: "/tmp" };
    const { tools } = await evaluateComposable(commitMessageToolkit, { env });
    const spec = (tools as Record<string, ToolSpec | undefined>).inspectBash;
    if (spec === undefined) throw new Error("inspectBash not available");
    const handler = spec.handler.bind(spec) as (
      ctx: ToolRuntimeContext<ReviewToolkitEnv>,
      input: { command: string },
    ) => Promise<{ ok: boolean; denied?: boolean; stderr: string }>;
    const denied = await handler(
      { env, agentId: "test", agentName: "test" },
      { command: "git commit -m x" },
    );
    expect(denied.denied).toBe(true);
    const allowed = await handler(
      { env, agentId: "test", agentName: "test" },
      { command: "git log -1 --oneline" },
    );
    expect(allowed.denied).not.toBe(true);
  });
});

describe("inspectBash just-bash runner", () => {
  test("runs inspect commands without host bash", async () => {
    const env: ReviewToolkitEnv = { cwd: import.meta.dir };
    const { tools } = await evaluateComposable(reviewToolkit, { env });
    const spec = (tools as Record<string, ToolSpec | undefined>).inspectBash;
    if (spec === undefined) throw new Error("inspectBash not available");
    const handler = spec.handler.bind(spec) as (
      ctx: ToolRuntimeContext<ReviewToolkitEnv>,
      input: { command: string },
    ) => Promise<{
      ok: boolean;
      stdout: string;
      stderr: string;
      denied?: boolean;
    }>;
    const result = await handler(
      { env, agentId: "test", agentName: "test" },
      { command: "printf hi" },
    );
    expect(result.denied).not.toBe(true);
    expect(result.stderr).toBe("");
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("hi");
  });
});
