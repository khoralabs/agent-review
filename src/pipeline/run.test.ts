import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  COMMIT_MESSAGE_AGENT_ID,
  defineCommitMessageAgent,
  defineReviewAgent,
  REVIEW_AGENT_ID,
} from "../agents/index.ts";
import { DEFAULT_CONFIG } from "../config.ts";
import { writeRunArtifact } from "../lib/artifacts.ts";
import { exitCodeForFindings, hasBlockingFindings } from "../lib/findings.ts";
import type { PersistedReviewResult } from "../schema/index.ts";
import { runAnalyzePhase } from "./analyze-phase.ts";
import { runCommitMessagePhase } from "./commit-message-phase.ts";
import {
  orchestrateInProcess,
  orchestrateViaCli,
  parseRunIdFromStdout,
  type SpawnCliFn,
} from "./orchestrate.ts";
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

function writePriorRun(dir: string, runId: string): void {
  writeRunArtifact({
    cwd: dir,
    outputDir: dir,
    runId,
    scope: "staged",
    exitCode: 1,
    result: {
      summary: "blocked",
      findings: [
        {
          severity: "error",
          key: "test-issue",
          file: "src/a.ts",
          line: 1,
          message: "prior null deref",
          decision: {
            agentId: "a",
            agentName: "A",
            staticHash: "s",
            invocationHash: "i",
            verdict: "remediate",
            task: "Add a null guard",
            rationale: "real",
            remediationPath: `reviews/${runId}/remediations/0`,
          },
        },
      ],
    },
    files: ["src/a.ts"],
    model: "test",
    diff: "diff --git a/src/a.ts b/src/a.ts\n+bad",
    diagnostics: [],
  });
  const rem = path.join(dir, "reviews", runId, "remediations", "0");
  fs.mkdirSync(rem, { recursive: true });
  fs.writeFileSync(path.join(rem, "plan.md"), "# Add a null guard\n");
}

describe("findings gate", () => {
  test("blocks only when blockOn severity is remediate (or undecided)", () => {
    const undecided: PersistedReviewResult = {
      summary: "issues",
      findings: [
        {
          severity: "warning",
          key: "test-issue",
          file: "a.ts",
          message: "nits",
        },
        { severity: "error", key: "test-issue", file: "b.ts", message: "bug" },
      ],
    };
    expect(hasBlockingFindings(undecided, ["error"])).toBe(true);
    expect(exitCodeForFindings(undecided, ["error"])).toBe(1);

    const ignored: PersistedReviewResult = {
      summary: "issues",
      findings: [
        {
          severity: "error",
          key: "test-issue",
          file: "b.ts",
          message: "bug",
          decision: {
            agentId: "a",
            agentName: "A",
            staticHash: "s",
            invocationHash: "i",
            verdict: "ignore",
            rationale: "false positive",
          },
        },
      ],
    };
    expect(hasBlockingFindings(ignored, ["error"])).toBe(false);
    expect(exitCodeForFindings(ignored, ["error"])).toBe(0);

    const remediate: PersistedReviewResult = {
      summary: "issues",
      findings: [
        {
          severity: "error",
          key: "test-issue",
          file: "b.ts",
          message: "bug",
          decision: {
            agentId: "a",
            agentName: "A",
            staticHash: "s",
            invocationHash: "i",
            verdict: "remediate",
            task: "fix bug",
            rationale: "real",
            remediationPath: "reviews/x/remediations/0",
          },
        },
      ],
    };
    expect(exitCodeForFindings(remediate, ["error"])).toBe(1);

    const warningRemediate: PersistedReviewResult = {
      summary: "warn",
      findings: [
        {
          severity: "warning",
          key: "test-issue",
          file: "a.ts",
          message: "nit",
          decision: {
            agentId: "a",
            agentName: "A",
            staticHash: "s",
            invocationHash: "i",
            verdict: "remediate",
            task: "fix nit",
            rationale: "worth it",
            remediationPath: "reviews/x/remediations/0",
          },
        },
      ],
    };
    expect(exitCodeForFindings(warningRemediate, ["error"])).toBe(0);
  });
});

describe("defineReviewAgent", () => {
  test("registers inspect toolkit agent with stable id", async () => {
    const a = await defineReviewAgent();
    const b = await defineReviewAgent();
    expect(a.agent.agentId).toBe(REVIEW_AGENT_ID);
    expect(a.staticHash).toBe(b.staticHash);
    expect(a.staticHash.length).toBeGreaterThan(0);
  });
});

describe("defineCommitMessageAgent", () => {
  test("registers a dedicated agent id and toolkit", async () => {
    const a = await defineCommitMessageAgent();
    const b = await defineCommitMessageAgent();
    expect(a.agent.agentId).toBe(COMMIT_MESSAGE_AGENT_ID);
    expect(a.staticHash).toBe(b.staticHash);
    expect(a.staticHash.length).toBeGreaterThan(0);
  });
});

describe("runCommitMessagePhase", () => {
  test("exits 2 on empty diff without calling the model", async () => {
    const outcome = await runCommitMessagePhase({
      config: { ...DEFAULT_CONFIG, skills: [], skillsDirs: [] },
      scope: "staged",
      collectDiffFn: async () => ({
        files: [],
        diff: "",
        truncated: false,
        empty: true,
      }),
      generateTextFn: async () => {
        throw new Error("should not call model");
      },
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain("No changes");
  });

  test("returns a conventional commit message and includes skill system", async () => {
    const dir = makeTmp("agent-review-cmsg-");
    const skillDir = path.join(dir, "conventional-commits");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: conventional-commits
description: Conventional Commits 1.0.0 for planning and commit messages.
---

# MUST prefix with type
`,
    );
    let system = "";
    let prompt = "";
    const outcome = await runCommitMessagePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [skillDir],
        skillsDirs: [],
      },
      scope: "staged",
      cwd: dir,
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+ok",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async (args: { system?: string; prompt?: string }) => {
        system = args.system ?? "";
        prompt = args.prompt ?? "";
        return { output: { message: "feat(a): add ok path" } };
      }) as never,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.commitMessage).toBe("feat(a): add ok path");
    expect(system).toContain("Commits MUST be prefixed with a type");
    expect(system).toContain("conventional-commits");
    expect(system).toContain("MUST prefix with type");
    expect(prompt).toContain("Unified diff:");
  });
});

describe("runReviewPhase", () => {
  test("exits 0 on empty diff without calling the model", async () => {
    const outcome = await runReviewPhase({
      config: { ...DEFAULT_CONFIG, skills: [] },
      scope: "staged",
      skipArtifacts: true,
      collectDiffFn: async () => ({
        files: [],
        diff: "",
        truncated: false,
        empty: true,
      }),
      generateTextFn: async () => {
        throw new Error("should not call model");
      },
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.skipAnalyze).toBe(true);
    expect(outcome.message).toContain("No changes");
  });

  test("includes commit message in the model prompt", async () => {
    let prompt = "";
    let system = "";
    await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
      },
      scope: "staged",
      commitMessage: "feat: wire commit message into review",
      skipArtifacts: true,
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+ok",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async (args: { prompt?: string; system?: string }) => {
        prompt = args.prompt ?? "";
        system = args.system ?? "";
        return {
          output: { summary: "ok", findings: [] },
        };
      }) as never,
    });
    expect(prompt).toContain("Commit message:");
    expect(prompt).toContain("feat: wire commit message into review");
    expect(system).toContain("Commits MUST be prefixed with a type");
  });

  test("includes workstream context only when includeWorkstream is set", async () => {
    const dir = makeTmp("agent-review-ws-rev-");
    writePriorRun(dir, "20260811T100000Z-abc1234");

    const collect = async () => ({
      files: ["src/a.ts"],
      diff: "diff --git a/src/a.ts b/src/a.ts\n+ok",
      truncated: false,
      empty: false,
    });
    const revParseFn = async () => "abc1234";

    let offPrompt = "";
    await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        includeWorkstream: false,
      },
      scope: "staged",
      cwd: dir,
      skipArtifacts: true,
      collectDiffFn: collect,
      revParseFn,
      generateTextFn: (async (args: { prompt?: string }) => {
        offPrompt = args.prompt ?? "";
        return { output: { summary: "ok", findings: [] } };
      }) as never,
    });
    expect(offPrompt).not.toContain("Prior review workstream");

    let onPrompt = "";
    await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        includeWorkstream: true,
      },
      scope: "staged",
      cwd: dir,
      skipArtifacts: true,
      collectDiffFn: collect,
      revParseFn,
      generateTextFn: (async (args: { prompt?: string }) => {
        onPrompt = args.prompt ?? "";
        return { output: { summary: "ok", findings: [] } };
      }) as never,
    });
    expect(onPrompt).toContain("Prior review workstream");
    expect(onPrompt).toContain("prior null deref");
    expect(onPrompt).toContain("Add a null guard");
  });

  test("checkpoints findings with diff for analyze handoff", async () => {
    const dir = makeTmp("agent-review-rev-");
    const outcome = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
      },
      scope: "staged",
      cwd: dir,
      commitMessage: "feat: handoff",
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+bad",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "found a bug",
          findings: [
            {
              severity: "warning",
              key: "test-issue",
              file: "src/a.ts",
              line: 1,
              message: "observability gap",
            },
          ],
        },
      })) as never,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.skipAnalyze).toBe(false);
    expect(outcome.runIdStdout).toBe(outcome.runId);
    expect(fs.existsSync(path.join(dir, "reviews.jsonl"))).toBe(false);

    const runPath = path.join(dir, "reviews", outcome.runId, "run.json");
    const onDisk = JSON.parse(fs.readFileSync(runPath, "utf8")) as {
      diff?: string;
      diffGzip?: boolean;
      artifactPath?: string;
      commitMessage?: string;
      findings: Array<{ message: string }>;
    };
    expect(onDisk.diff).toBeUndefined();
    expect(onDisk.diffGzip).toBe(true);
    expect(onDisk.artifactPath).toBe(`reviews/${outcome.runId}/run.json`);
    expect(onDisk.commitMessage).toBe("feat: handoff");
    expect(onDisk.findings).toHaveLength(1);
    expect(onDisk.findings[0]).toMatchObject({
      key: "test-issue",
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(fs.existsSync(path.join(dir, "reviews", outcome.runId, "diff.gz"))).toBe(true);
    const agents = fs.readdirSync(path.join(dir, "agents"));
    expect(agents.some((name) => name.endsWith(".json.gz"))).toBe(true);
  });
});

describe("runAnalyzePhase", () => {
  test("returns exit 1 when analyst remediates a blockOn finding", async () => {
    const dir = makeTmp("agent-review-an-");
    const reviewed = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      scope: "staged",
      cwd: dir,
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+bad",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "found a bug",
          findings: [
            {
              severity: "error",
              key: "test-issue",
              file: "src/a.ts",
              line: 1,
              message: "null deref",
            },
          ],
        },
      })) as never,
    });
    expect(reviewed.exitCode).toBe(0);

    const outcome = await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      runId: reviewed.runId,
      cwd: dir,
      generateTextFn: (async () => ({
        output: {
          verdict: "remediate",
          task: "Fix null deref",
          rationale: "real bug",
          steps: ["add guard"],
        },
      })) as never,
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.result?.findings[0]?.decision?.verdict).toBe("remediate");
    expect(fs.existsSync(path.join(dir, "reviews.jsonl"))).toBe(true);
  });

  test("accepts an in-memory artifact and skipArtifacts without writing", async () => {
    const dir = makeTmp("agent-review-mem-");
    const reviewed = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      scope: "staged",
      cwd: dir,
      skipArtifacts: true,
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+bad",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "found a bug",
          findings: [
            {
              severity: "error",
              key: "test-issue",
              file: "src/a.ts",
              line: 1,
              message: "null deref",
            },
          ],
        },
      })) as never,
    });
    expect(reviewed.exitCode).toBe(0);
    expect(fs.existsSync(path.join(dir, "reviews"))).toBe(false);

    const outcome = await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      runId: reviewed.runId,
      cwd: dir,
      skipArtifacts: true,
      artifact: {
        runId: reviewed.runId,
        scope: "staged",
        exitCode: 0,
        ok: true,
        summary: reviewed.result?.summary ?? "",
        findings: reviewed.result?.findings ?? [],
        files: reviewed.diff?.files ?? [],
        model: "test",
        diff: reviewed.diff?.diff,
        diagnostics: reviewed.diagnostics,
        recordedAt: new Date().toISOString(),
        artifactPath: `reviews/${reviewed.runId}/run.json`,
      },
      generateTextFn: (async () => ({
        output: {
          verdict: "remediate",
          task: "Fix null deref",
          rationale: "real bug",
          steps: ["add guard"],
        },
      })) as never,
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.result?.findings[0]?.decision?.verdict).toBe("remediate");
    expect(fs.existsSync(path.join(dir, "reviews"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "reviews.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "telemetry.jsonl"))).toBe(false);
  });

  test("returns exit 0 when analyst ignores a blockOn finding", async () => {
    const dir = makeTmp("agent-review-ign-");
    const reviewed = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      scope: "staged",
      cwd: dir,
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+bad",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "found a bug",
          findings: [
            {
              severity: "error",
              key: "test-issue",
              file: "src/a.ts",
              line: 1,
              message: "null deref",
            },
          ],
        },
      })) as never,
    });

    const outcome = await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      runId: reviewed.runId,
      cwd: dir,
      generateTextFn: (async () => ({
        output: {
          verdict: "ignore",
          rationale: "false positive",
        },
      })) as never,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.findings[0]?.decision?.verdict).toBe("ignore");
  });

  test("keeps review findings when analyst throws", async () => {
    const dir = makeTmp("agent-review-fail-");
    const reviewed = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
      },
      scope: "staged",
      cwd: dir,
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+bad",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "found a bug",
          findings: [
            {
              severity: "warning",
              key: "test-issue",
              file: "src/a.ts",
              line: 1,
              message: "observability gap",
            },
          ],
        },
      })) as never,
    });

    const outcome = await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
      },
      runId: reviewed.runId,
      cwd: dir,
      generateTextFn: (async () => {
        throw new Error("No object generated: response did not match schema.");
      }) as never,
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.result?.findings).toHaveLength(1);
    expect(outcome.result?.findings[0]?.message).toBe("observability gap");
    expect(outcome.result?.findings[0]?.decision).toBeUndefined();

    const runPath = outcome.artifacts?.runPath;
    expect(runPath).toBeDefined();
    if (runPath === undefined) throw new Error("expected runPath");
    const artifact = JSON.parse(fs.readFileSync(runPath, "utf8")) as {
      findings: Array<{ message: string }>;
      error?: string;
    };
    expect(artifact.findings).toHaveLength(1);
    expect(artifact.error).toContain("analyst failed on finding(s) 0");
  });

  test("writes plan.md under reviews/<runId>/remediations/<index>", async () => {
    const dir = makeTmp("agent-review-rem-");
    const reviewed = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      scope: "staged",
      cwd: dir,
      collectDiffFn: async () => ({
        files: ["a.ts"],
        diff: "diff --git a/a.ts b/a.ts\n+x",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "bug",
          findings: [
            {
              severity: "error",
              key: "test-issue",
              file: "a.ts",
              message: "broken",
            },
          ],
        },
      })) as never,
    });

    const outcome = await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      runId: reviewed.runId,
      cwd: dir,
      generateTextFn: (async () => ({
        output: {
          verdict: "remediate",
          task: "Fix broken",
          rationale: "must fix",
          steps: ["edit a.ts"],
        },
      })) as never,
    });
    expect(outcome.exitCode).toBe(1);
    const decision = outcome.result?.findings[0]?.decision;
    expect(decision?.verdict).toBe("remediate");
    if (decision?.verdict !== "remediate") throw new Error("expected remediate");
    const planPath = path.join(dir, decision.remediationPath, "plan.md");
    expect(fs.existsSync(planPath)).toBe(true);
    const md = fs.readFileSync(planPath, "utf8");
    expect(md).toContain("# Fix broken");
    expect(md).toContain("## Context");
    expect(md).toContain("## Why remediate");
    expect(md).toContain("## Steps");
    expect(md).toContain("1. edit a.ts");
  });

  test("continues when one finding fails structured output", async () => {
    const dir = makeTmp("agent-review-partial-");
    const reviewed = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      scope: "staged",
      cwd: dir,
      collectDiffFn: async () => ({
        files: ["a.ts", "b.ts"],
        diff: "diff --git a/a.ts b/a.ts\n+x\ndiff --git a/b.ts b/b.ts\n+y",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "two findings",
          findings: [
            {
              severity: "error",
              key: "test-issue",
              file: "a.ts",
              message: "bug a",
            },
            {
              severity: "warning",
              key: "test-issue",
              file: "b.ts",
              message: "nit b",
            },
          ],
        },
      })) as never,
    });

    let analyzeCalls = 0;
    const outcome = await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
        analystConcurrency: 1,
      },
      runId: reviewed.runId,
      cwd: dir,
      generateTextFn: (async () => {
        analyzeCalls += 1;
        if (analyzeCalls === 1) {
          throw new Error("No object generated: response did not match schema.");
        }
        return {
          output: {
            verdict: "ignore",
            rationale: "style only",
          },
        };
      }) as never,
    });

    expect(analyzeCalls).toBe(2);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.result?.findings).toHaveLength(2);
    expect(outcome.result?.findings[0]?.decision).toBeUndefined();
    expect(outcome.result?.findings[1]?.decision?.verdict).toBe("ignore");
    expect(outcome.message).toContain("analyst failed on finding(s) 0");
  });

  test("analyst pool preserves finding order under concurrency", async () => {
    const dir = makeTmp("agent-review-pool-");
    const reviewed = await runReviewPhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      scope: "staged",
      cwd: dir,
      collectDiffFn: async () => ({
        files: ["a.ts", "b.ts", "c.ts"],
        diff: "diff --git a/a.ts b/a.ts\n+x",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => ({
        output: {
          summary: "three findings",
          findings: [
            {
              severity: "warning",
              key: "test-issue",
              file: "a.ts",
              message: "a",
            },
            {
              severity: "warning",
              key: "test-issue",
              file: "b.ts",
              message: "b",
            },
            {
              severity: "warning",
              key: "test-issue",
              file: "c.ts",
              message: "c",
            },
          ],
        },
      })) as never,
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const outcome = await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
        analystConcurrency: 2,
      },
      runId: reviewed.runId,
      cwd: dir,
      generateTextFn: (async (opts: { prompt?: string }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Bun.sleep(40);
        inFlight -= 1;
        const prompt = opts.prompt ?? "";
        const match = prompt.match(/Finding\[(\d+)\]/);
        const idx = match?.[1] ?? "?";
        return {
          output: {
            verdict: "ignore",
            rationale: `finding ${idx}`,
          },
        };
      }) as never,
    });

    expect(outcome.exitCode).toBe(0);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(outcome.result?.findings.map((f) => f.message)).toEqual(["a", "b", "c"]);
    expect(
      outcome.result?.findings.map((f) =>
        f.decision?.verdict === "ignore" ? f.decision.rationale : undefined,
      ),
    ).toEqual(["finding 0", "finding 1", "finding 2"]);
  });

  test("includes workstream context only when includeWorkstream is set", async () => {
    const dir = makeTmp("agent-review-ws-an-");
    writePriorRun(dir, "20260811T100000Z-abc1234");
    writeRunArtifact({
      cwd: dir,
      outputDir: dir,
      runId: "20260811T120000Z-abc1234",
      scope: "staged",
      exitCode: 0,
      result: {
        summary: "still issues",
        findings: [
          {
            severity: "error",
            key: "test-issue",
            file: "src/a.ts",
            message: "still broken",
          },
        ],
      },
      files: ["src/a.ts"],
      model: "test",
      diff: "diff --git a/src/a.ts b/src/a.ts\n+retry",
      diagnostics: [],
    });

    let offPrompt = "";
    await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        includeWorkstream: false,
      },
      runId: "20260811T120000Z-abc1234",
      cwd: dir,
      generateTextFn: (async (args: { prompt?: string }) => {
        offPrompt = args.prompt ?? "";
        return {
          output: {
            verdict: "ignore",
            rationale: "already fixed",
          },
        };
      }) as never,
    });
    expect(offPrompt).not.toContain("Prior review workstream");

    let onPrompt = "";
    await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        includeWorkstream: true,
      },
      runId: "20260811T120000Z-abc1234",
      cwd: dir,
      generateTextFn: (async (args: { prompt?: string }) => {
        onPrompt = args.prompt ?? "";
        return {
          output: {
            verdict: "ignore",
            rationale: "already fixed",
          },
        };
      }) as never,
    });
    expect(onPrompt).toContain("Prior review workstream");
    expect(onPrompt).toContain("prior null deref");
    expect(onPrompt).toContain("Add a null guard");
  });

  test("includes activated skill body in analyst system only when configured", async () => {
    const dir = makeTmp("agent-review-skill-an-");
    const skillDir = path.join(dir, "conventional-commits");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: conventional-commits
description: Conventional Commits 1.0.0 for planning and commit messages.
---

# MUST use type feat or fix
`,
    );
    writeRunArtifact({
      cwd: dir,
      outputDir: dir,
      runId: "20260811T120000Z-abc1234",
      scope: "staged",
      exitCode: 0,
      result: {
        summary: "still issues",
        findings: [
          {
            severity: "error",
            key: "test-issue",
            file: "src/a.ts",
            message: "still broken",
          },
        ],
      },
      files: ["src/a.ts"],
      model: "test",
      diff: "diff --git a/src/a.ts b/src/a.ts\n+retry",
      diagnostics: [],
    });

    let offSystem = "";
    await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
      },
      runId: "20260811T120000Z-abc1234",
      cwd: dir,
      generateTextFn: (async (args: { system?: string }) => {
        offSystem = args.system ?? "";
        return {
          output: { verdict: "ignore", rationale: "already fixed" },
        };
      }) as never,
    });
    expect(offSystem).not.toContain("MUST use type feat or fix");
    expect(offSystem).toContain("Commits MUST be prefixed with a type");

    let onSystem = "";
    await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [skillDir],
        skillsDirs: [],
        outputDir: dir,
      },
      runId: "20260811T120000Z-abc1234",
      cwd: dir,
      generateTextFn: (async (args: { system?: string }) => {
        onSystem = args.system ?? "";
        return {
          output: { verdict: "ignore", rationale: "already fixed" },
        };
      }) as never,
    });
    expect(onSystem).toContain("conventional-commits");
    expect(onSystem).toContain("MUST use type feat or fix");
  });

  test("includes config instructions in analyst system", async () => {
    const dir = makeTmp("agent-review-instr-an-");
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs", "style.md"), "CUSTOM_INSTRUCTION_MARKER\n");
    writeRunArtifact({
      cwd: dir,
      outputDir: dir,
      runId: "20260811T120000Z-abc1234",
      scope: "staged",
      exitCode: 0,
      result: {
        summary: "still issues",
        findings: [
          {
            severity: "error",
            key: "test-issue",
            file: "src/a.ts",
            message: "still broken",
          },
        ],
      },
      files: ["src/a.ts"],
      model: "test",
      diff: "diff --git a/src/a.ts b/src/a.ts\n+retry",
      diagnostics: [],
    });

    let system = "";
    await runAnalyzePhase({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        instructions: ["Prefer short plans.", "docs/style.md"],
        outputDir: dir,
      },
      runId: "20260811T120000Z-abc1234",
      cwd: dir,
      generateTextFn: (async (args: { system?: string }) => {
        system = args.system ?? "";
        return {
          output: { verdict: "ignore", rationale: "already fixed" },
        };
      }) as never,
    });
    expect(system).toContain("# Custom instructions");
    expect(system).toContain("Prefer short plans.");
    expect(system).toContain("CUSTOM_INSTRUCTION_MARKER");
  });
});

describe("orchestrateViaCli", () => {
  test("parseRunIdFromStdout takes first non-empty line", () => {
    expect(parseRunIdFromStdout("\n  run-abc  \nextra\n")).toBe("run-abc");
    expect(parseRunIdFromStdout("")).toBeUndefined();
  });

  test("spawns review then analyze and propagates analyze exit", async () => {
    const calls: Array<{ command: string; argv: string[] }> = [];
    const spawnCliFn: SpawnCliFn = async ({ command, argv }) => {
      calls.push({ command, argv });
      if (command === "review") {
        return { exitCode: 0, stdout: "run-test-1\n", stderr: "review ok\n" };
      }
      return { exitCode: 1, stdout: "", stderr: "blocking\n" };
    };

    const dir = makeTmp("agent-review-orch-");
    fs.mkdirSync(path.join(dir, "reviews", "run-test-1"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "reviews", "run-test-1", "run.json"),
      `${JSON.stringify({
        runId: "run-test-1",
        scope: "staged",
        exitCode: 0,
        ok: true,
        summary: "bug",
        findings: [{ severity: "error", key: "test-issue", file: "a.ts", message: "x" }],
        files: ["a.ts"],
        model: "test",
        diagnostics: [],
        recordedAt: new Date().toISOString(),
        artifactPath: "reviews/run-test-1/run.json",
      })}\n`,
    );

    const outcome = await orchestrateViaCli({
      argv: ["--scope", "staged", "--include-workstream", "--output-dir", dir],
      cwd: dir,
      outputDir: dir,
      quiet: true,
      spawnCliFn,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe("review");
    expect(calls[0]?.argv).toContain("--include-workstream");
    expect(calls[1]?.command).toBe("analyze");
    expect(calls[1]?.argv).toContain("--run-id");
    expect(calls[1]?.argv).toContain("run-test-1");
    expect(calls[1]?.argv).toContain("--include-workstream");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.runId).toBe("run-test-1");
  });

  test("does not call analyze when review fails", async () => {
    const calls: string[] = [];
    const spawnCliFn: SpawnCliFn = async ({ command }) => {
      calls.push(command);
      return { exitCode: 2, stdout: "", stderr: "boom" };
    };
    const outcome = await orchestrateViaCli({
      argv: ["--scope", "staged"],
      quiet: true,
      spawnCliFn,
    });
    expect(calls).toEqual(["review"]);
    expect(outcome.exitCode).toBe(2);
  });

  test("skips analyze when review has zero findings", async () => {
    const calls: string[] = [];
    const dir = makeTmp("agent-review-skip-");
    fs.mkdirSync(path.join(dir, "reviews", "run-empty"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "reviews", "run-empty", "run.json"),
      `${JSON.stringify({
        runId: "run-empty",
        scope: "staged",
        exitCode: 0,
        ok: true,
        summary: "clean",
        findings: [],
        files: ["a.ts"],
        model: "test",
        diagnostics: [],
        recordedAt: new Date().toISOString(),
        artifactPath: "reviews/run-empty/run.json",
      })}\n`,
    );

    const spawnCliFn: SpawnCliFn = async ({ command }) => {
      calls.push(command);
      return { exitCode: 0, stdout: "run-empty\n", stderr: "" };
    };

    const outcome = await orchestrateViaCli({
      argv: ["--output-dir", dir],
      cwd: dir,
      outputDir: dir,
      quiet: true,
      spawnCliFn,
    });
    expect(calls).toEqual(["review"]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.runId).toBe("run-empty");
  });
});

describe("orchestrateInProcess", () => {
  test("runs analyze without writing pipeline data", async () => {
    const dir = makeTmp("agent-review-noemit-");
    let calls = 0;
    const outcome = await orchestrateInProcess({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
        blockOn: ["error"],
      },
      scope: "staged",
      cwd: dir,
      quiet: true,
      collectDiffFn: async () => ({
        files: ["src/a.ts"],
        diff: "diff --git a/src/a.ts b/src/a.ts\n+bad",
        truncated: false,
        empty: false,
      }),
      generateTextFn: (async () => {
        calls += 1;
        if (calls === 1) {
          return {
            output: {
              summary: "found a bug",
              findings: [
                {
                  severity: "error",
                  key: "test-issue",
                  file: "src/a.ts",
                  line: 1,
                  message: "null deref",
                },
              ],
            },
          };
        }
        return {
          output: {
            verdict: "remediate",
            task: "Fix null deref",
            rationale: "real bug",
            steps: ["add guard"],
          },
        };
      }) as never,
    });

    expect(calls).toBe(2);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.analyze).toBeDefined();
    expect(outcome.analyze?.result?.findings[0]?.decision?.verdict).toBe("remediate");
    expect(fs.existsSync(path.join(dir, "reviews"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "reviews.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "telemetry.jsonl"))).toBe(false);
  });

  test("skips analyze on empty diff without writing", async () => {
    const dir = makeTmp("agent-review-noemit-empty-");
    const outcome = await orchestrateInProcess({
      config: {
        ...DEFAULT_CONFIG,
        skills: [],
        skillsDirs: [],
        outputDir: dir,
      },
      scope: "staged",
      cwd: dir,
      quiet: true,
      collectDiffFn: async () => ({
        files: [],
        diff: "",
        truncated: false,
        empty: true,
      }),
      generateTextFn: async () => {
        throw new Error("should not call model");
      },
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.analyze).toBeUndefined();
    expect(outcome.message).toContain("analyze skipped");
    expect(fs.existsSync(path.join(dir, "reviews"))).toBe(false);
  });
});
