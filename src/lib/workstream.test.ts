import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeDiffGzip, writeRunArtifact } from "./artifacts.ts";
import {
  formatWorkstreamContext,
  listWorkstreamRunIds,
  loadWorkstreamPrompt,
  parseRunIdShortSha,
} from "./workstream.ts";

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

function writeSibling(
  dir: string,
  runId: string,
  opts: {
    summary?: string;
    message?: string;
    diff?: string;
    remediate?: boolean;
  } = {},
): void {
  writeRunArtifact({
    cwd: dir,
    outputDir: dir,
    runId,
    scope: "staged",
    exitCode: 1,
    result: {
      summary: opts.summary ?? "blocked",
      findings: [
        {
          severity: "error",
          key: "test-issue",
          file: "src/a.ts",
          line: 1,
          message: opts.message ?? "null deref",
          rule: "correctness",
          decision:
            opts.remediate === false
              ? {
                  agentId: "a",
                  agentName: "A",
                  staticHash: "s",
                  invocationHash: "i",
                  verdict: "ignore",
                  rationale: "noise",
                }
              : {
                  agentId: "a",
                  agentName: "A",
                  staticHash: "s",
                  invocationHash: "i",
                  verdict: "remediate",
                  task: "Add a null guard",
                  rationale: "real bug",
                  remediationPath: `reviews/${runId}/remediations/0`,
                },
        },
      ],
    },
    files: ["src/a.ts"],
    model: "test",
    diff: opts.diff ?? "diff --git a/src/a.ts b/src/a.ts\n+bad",
    commitMessage: "feat: example",
    diagnostics: [],
  });
}

describe("parseRunIdShortSha", () => {
  test("reads suffix after Z-", () => {
    expect(parseRunIdShortSha("20260811T235344Z-b360a71")).toBe("b360a71");
    expect(parseRunIdShortSha("nope")).toBeUndefined();
  });
});

describe("listWorkstreamRunIds / formatWorkstreamContext", () => {
  test("matches same sha, ignores other shas and current run", () => {
    const dir = makeTmp("agent-review-ws-");
    writeSibling(dir, "20260811T100000Z-abc1234");
    writeSibling(dir, "20260811T110000Z-abc1234");
    writeSibling(dir, "20260811T090000Z-zzzzzzz");
    fs.mkdirSync(path.join(dir, "reviews", "20260811T120000Z-abc1234"), {
      recursive: true,
    });

    expect(listWorkstreamRunIds(dir, "abc1234", "20260811T120000Z-abc1234")).toEqual([
      "20260811T100000Z-abc1234",
      "20260811T110000Z-abc1234",
    ]);
    expect(listWorkstreamRunIds(dir, "unknown")).toEqual([]);
    expect(listWorkstreamRunIds(dir, "stdin")).toEqual([]);
  });

  test("formats findings, remediations, and truncated diff", () => {
    const dir = makeTmp("agent-review-ws-");
    const runId = "20260811T100000Z-abc1234";
    writeSibling(dir, runId, { remediate: true });
    const rem = path.join(dir, "reviews", runId, "remediations", "0");
    fs.mkdirSync(rem, { recursive: true });
    fs.writeFileSync(path.join(rem, "plan.md"), "# Add a null guard\n");
    fs.writeFileSync(
      path.join(rem, "work-log.jsonl"),
      `${JSON.stringify({ event: "done", status: "done", message: "guard landed" })}\n`,
    );
    fs.writeFileSync(path.join(rem, "changes.md"), "Added optional chaining.\n");
    fs.writeFileSync(path.join(rem, "tests.txt"), "bun test ./a.test.ts\npass\n");

    const text = formatWorkstreamContext({
      outputDir: dir,
      shortSha: "abc1234",
      runIds: [runId],
    });
    expect(text).toBeDefined();
    expect(text).toContain("<prior_workstream_history>");
    expect(text).toContain("</prior_workstream_history>");
    expect(text).toContain("Prior review workstream for the same HEAD abc1234");
    expect(text).toContain("null deref");
    expect(text).toContain("remediate: Add a null guard");
    expect(text).toContain("Add a null guard");
    expect(text).not.toContain("Status: done");
    expect(text).toContain("Work log: done — done — guard landed");
    expect(text).toContain("Added optional chaining");
    expect(text).toContain("diff --git a/src/a.ts");
  });

  test("loadWorkstreamPrompt returns undefined with no siblings", () => {
    const dir = makeTmp("agent-review-ws-");
    writeDiffGzip(dir, "20260811T120000Z-abc1234", "x");
    expect(
      loadWorkstreamPrompt({
        outputDir: dir,
        runId: "20260811T120000Z-abc1234",
        shortSha: "abc1234",
      }),
    ).toBeUndefined();
  });

  test("does not warn when a sibling run.json is missing", () => {
    const dir = makeTmp("agent-review-ws-");
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0] ?? ""));
    };
    try {
      const text = formatWorkstreamContext({
        outputDir: dir,
        shortSha: "abc1234",
        runIds: ["20260811T100000Z-abc1234"],
      });
      expect(text).toBeUndefined();
      expect(warnings).toEqual([]);
    } finally {
      console.warn = orig;
    }
  });

  test("warns when sibling run.json is present but invalid", () => {
    const dir = makeTmp("agent-review-ws-");
    const runId = "20260811T100000Z-abc1234";
    fs.mkdirSync(path.join(dir, "reviews", runId), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "reviews", runId, "run.json"),
      `${JSON.stringify({
        runId: "other-id",
        scope: "staged",
        exitCode: 0,
        ok: true,
        summary: "x",
        findings: [],
        files: [],
        model: "test",
        diagnostics: [],
        recordedAt: "2026-08-12T00:00:00.000Z",
        artifactPath: "reviews/other-id/run.json",
      })}\n`,
    );
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0] ?? ""));
    };
    try {
      const text = formatWorkstreamContext({
        outputDir: dir,
        shortSha: "abc1234",
        runIds: [runId],
      });
      expect(text).toBeUndefined();
      expect(warnings.some((line) => line.includes("load run"))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });
});
