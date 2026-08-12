import { describe, expect, test } from "bun:test";

import { parseArgs, resolveConfig } from "./config.ts";

describe("parseArgs / resolveConfig", () => {
  test("parses scope and skills flags", () => {
    const args = parseArgs([
      "review",
      "--scope",
      "range",
      "--base",
      "origin/main",
      "--skills",
      "./a,./b",
      "--message",
      "feat: test",
      "--message-file",
      ".git/COMMIT_EDITMSG",
    ]);
    expect(args.command).toBe("review");
    expect(args.scope).toBe("range");
    expect(args.base).toBe("origin/main");
    expect(args.skills).toEqual(["./a", "./b"]);
    expect(args.commitMessage).toBe("feat: test");
    expect(args.commitMessageFile).toBe(".git/COMMIT_EDITMSG");
  });

  test("parses commit-message command", () => {
    const args = parseArgs(["commit-message", "--scope", "staged"]);
    expect(args.command).toBe("commit-message");
    expect(args.scope).toBe("staged");
  });

  test("parses status command flags", () => {
    const args = parseArgs([
      "status",
      "--run-id",
      "20260812T000000Z-abc",
      "--min-severity",
      "warning",
      "--json",
    ]);
    expect(args.command).toBe("status");
    expect(args.runId).toBe("20260812T000000Z-abc");
    expect(args.minSeverity).toBe("warning");
    expect(args.json).toBe(true);
  });

  test("defaults command to run and parses --run-id", () => {
    const bare = parseArgs(["--scope", "staged"]);
    expect(bare.command).toBe("run");
    const analyze = parseArgs(["analyze", "--run-id", "abc"]);
    expect(analyze.command).toBe("analyze");
    expect(analyze.runId).toBe("abc");
  });

  test("parses log command flags", () => {
    const args = parseArgs([
      "log",
      "--remediation",
      "run-0",
      "--event",
      "note",
      "--message",
      "hello",
      "--path",
      "notes.md",
      "--status",
      "in_progress",
      "--agent",
      "cursor",
    ]);
    expect(args.command).toBe("log");
    expect(args.remediation).toBe("run-0");
    expect(args.event).toBe("note");
    expect(args.message).toBe("hello");
    expect(args.path).toBe("notes.md");
    expect(args.status).toBe("in_progress");
    expect(args.agent).toBe("cursor");
  });

  test("--commit implies commit scope when scope omitted", () => {
    const args = parseArgs(["--commit", "HEAD"]);
    expect(args.commit).toBe("HEAD");
    const cfg = resolveConfig({
      ...args,
      cwd: "/tmp/does-not-exist-agent-review",
    });
    expect(cfg.defaultScope).toBe("commit");
  });

  test("resolveConfig uses defaults when no file", () => {
    const cfg = resolveConfig({ cwd: "/tmp/does-not-exist-agent-review" });
    expect(cfg.defaultScope).toBe("staged");
    expect(cfg.blockOn).toEqual(["error"]);
    expect(cfg.skills.length).toBeGreaterThan(0);
    expect(cfg.analystConcurrency).toBe(4);
  });

  test("parses --analyst-concurrency", () => {
    const args = parseArgs(["analyze", "--run-id", "x", "--analyst-concurrency", "8"]);
    expect(args.analystConcurrency).toBe(8);
    const cfg = resolveConfig({
      ...args,
      cwd: "/tmp/does-not-exist-agent-review",
    });
    expect(cfg.analystConcurrency).toBe(8);
  });

  test("parses --no-emit", () => {
    const off = parseArgs(["run", "--scope", "staged"]);
    expect(off.noEmit).toBeUndefined();
    const args = parseArgs(["run", "--scope", "staged", "--no-emit"]);
    expect(args.noEmit).toBe(true);
  });

  test("parses --include-workstream and defaults off", () => {
    const off = resolveConfig({ cwd: "/tmp/does-not-exist-agent-review" });
    expect(off.includeWorkstream).toBe(false);
    const args = parseArgs(["run", "--scope", "staged", "--include-workstream"]);
    expect(args.includeWorkstream).toBe(true);
    const cfg = resolveConfig({
      ...args,
      cwd: "/tmp/does-not-exist-agent-review",
    });
    expect(cfg.includeWorkstream).toBe(true);
  });
});
