import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfigFile, modelsFor, parseArgs, parseModelConfig, resolveConfig } from "./config.ts";

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
    expect(cfg.model).toEqual(modelsFor("google/gemini-3.5-flash"));
    expect(cfg.skip).toBe(false);
    expect(cfg.instructions).toEqual([]);
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

  test("parses workstream subcommands and --workstream-id", () => {
    const start = parseArgs(["workstream", "start", "--title", "Feat"]);
    expect(start.command).toBe("workstream");
    expect(start.workstreamSubcommand).toBe("start");
    expect(start.title).toBe("Feat");

    const resume = parseArgs(["workstream", "resume", "20260101T000000Z-abc"]);
    expect(resume.workstreamSubcommand).toBe("resume");
    expect(resume.workstreamId).toBe("20260101T000000Z-abc");

    const link = parseArgs([
      "workstream",
      "link",
      "20260101T000001Z-abc",
      "--workstream-id",
      "20260101T000000Z-abc",
    ]);
    expect(link.workstreamSubcommand).toBe("link");
    expect(link.linkRunId).toBe("20260101T000001Z-abc");
    expect(link.workstreamId).toBe("20260101T000000Z-abc");

    const log = parseArgs(["workstream", "log", "--event", "note", "--message", "hi"]);
    expect(log.workstreamSubcommand).toBe("log");
    expect(log.event).toBe("note");
    expect(log.message).toBe("hi");

    const review = parseArgs(["review", "--workstream-id", "ws-1"]);
    expect(review.workstreamId).toBe("ws-1");
  });

  test("workstreams defaults and nested/flat compat", () => {
    const defaults = resolveConfig({ cwd: "/tmp/does-not-exist-agent-review" });
    expect(defaults.workstreams).toEqual({ autoCommit: false, autoLink: true });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-cfg-"));
    fs.writeFileSync(
      path.join(dir, ".agent-review.json"),
      JSON.stringify({ workstreamAutoLink: false }),
      "utf8",
    );
    expect(resolveConfig({ cwd: dir }).workstreams.autoLink).toBe(false);

    fs.writeFileSync(
      path.join(dir, ".agent-review.json"),
      JSON.stringify({
        workstreamAutoLink: false,
        workstreams: { autoCommit: true, autoLink: true },
      }),
      "utf8",
    );
    const nestedWins = resolveConfig({ cwd: dir });
    expect(nestedWins.workstreams).toEqual({ autoCommit: true, autoLink: true });

    const overridden = resolveConfig({
      cwd: dir,
      workstreams: { autoCommit: false },
    });
    expect(overridden.workstreams.autoCommit).toBe(false);
    expect(overridden.workstreams.autoLink).toBe(true);
  });

  test("parseModelConfig accepts string and partial object", () => {
    expect(parseModelConfig("acme/one")).toEqual(modelsFor("acme/one"));
    expect(parseModelConfig({ analyze: "acme/analyst" })).toEqual({
      review: "google/gemini-3.5-flash",
      analyze: "acme/analyst",
      commitMessage: "google/gemini-3.5-flash",
    });
    expect(() => parseModelConfig({ review: "" })).toThrow(/model\.review/);
    expect(() => parseModelConfig({ weird: "x" })).toThrow(/unknown key/);
  });

  test("resolveConfig loads instructions from file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-cfg-instr-"));
    fs.writeFileSync(
      path.join(dir, ".agent-review.json"),
      `${JSON.stringify({
        instructions: ["Be terse.", "docs/*.md"],
      })}\n`,
    );
    const cfg = resolveConfig({ cwd: dir });
    expect(cfg.instructions).toEqual(["Be terse.", "docs/*.md"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("resolveConfig loads string model and skip from file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-cfg-"));
    fs.writeFileSync(
      path.join(dir, ".agent-review.json"),
      JSON.stringify({ model: "vendor/shared", skip: true }),
    );
    const cfg = resolveConfig({ cwd: dir });
    expect(cfg.model).toEqual(modelsFor("vendor/shared"));
    expect(cfg.skip).toBe(true);
  });

  test("resolveConfig loads object model; --model overrides all", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-cfg-"));
    fs.writeFileSync(
      path.join(dir, ".agent-review.json"),
      JSON.stringify({
        model: {
          review: "vendor/review",
          analyze: "vendor/analyze",
        },
      }),
    );
    const fromFile = resolveConfig({ cwd: dir });
    expect(fromFile.model).toEqual({
      review: "vendor/review",
      analyze: "vendor/analyze",
      commitMessage: "google/gemini-3.5-flash",
    });

    const args = parseArgs(["review", "--model", "cli/override"]);
    const overridden = resolveConfig({ ...args, cwd: dir });
    expect(overridden.model).toEqual(modelsFor("cli/override"));
  });

  test("loadConfigFile rejects invalid skip", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-cfg-"));
    const configPath = path.join(dir, ".agent-review.json");
    fs.writeFileSync(configPath, JSON.stringify({ skip: "yes" }));
    expect(() => loadConfigFile(configPath)).toThrow(/skip must be a boolean/);
  });

  test("parseArgs ignores bare -- separators", () => {
    const args = parseArgs(["status", "--", "--run-id", "abc", "--json"]);
    expect(args.command).toBe("status");
    expect(args.runId).toBe("abc");
    expect(args.json).toBe(true);
  });

  test("AGENT_REVIEW_MODEL and SKIP_AGENT_REVIEW env overrides", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-cfg-"));
    fs.writeFileSync(
      path.join(dir, ".agent-review.json"),
      JSON.stringify({ model: "vendor/file", skip: false }),
    );

    const prevModel = process.env.AGENT_REVIEW_MODEL;
    const prevSkip = process.env.SKIP_AGENT_REVIEW;
    try {
      process.env.AGENT_REVIEW_MODEL = "vendor/env";
      process.env.SKIP_AGENT_REVIEW = "1";
      const cfg = resolveConfig({ cwd: dir });
      expect(cfg.model).toEqual(modelsFor("vendor/env"));
      expect(cfg.skip).toBe(true);

      const cliWins = resolveConfig({ cwd: dir, model: "vendor/cli" });
      expect(cliWins.model).toEqual(modelsFor("vendor/cli"));
    } finally {
      if (prevModel === undefined) delete process.env.AGENT_REVIEW_MODEL;
      else process.env.AGENT_REVIEW_MODEL = prevModel;
      if (prevSkip === undefined) delete process.env.SKIP_AGENT_REVIEW;
      else process.env.SKIP_AGENT_REVIEW = prevSkip;
    }
  });
});
