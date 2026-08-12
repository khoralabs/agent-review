import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ReviewRunArtifact } from "./artifacts.ts";
import {
  buildStatusReport,
  formatStatusReport,
  loadLatestRunId,
  resolveStatusMinSeverity,
} from "./status-report.ts";

function writeFixture(dir: string): ReviewRunArtifact {
  const outputDir = path.join(dir, ".data/agent-review");
  const runId = "20260812T000000Z-abc1234";
  const runPath = path.join(outputDir, "reviews", runId);
  fs.mkdirSync(path.join(runPath, "remediations", "0"), { recursive: true });
  const artifact: ReviewRunArtifact = {
    runId,
    scope: "staged",
    exitCode: 1,
    ok: false,
    summary: "one issue",
    findings: [
      {
        severity: "error",
        key: "test-issue",
        file: "a.ts",
        message: "bug",
        decision: {
          agentId: "a",
          agentName: "A",
          staticHash: "s",
          invocationHash: "i",
          verdict: "remediate",
          task: "Fix bug",
          rationale: "r",
          remediationPath: `reviews/${runId}/remediations/0`,
        },
      },
    ],
    files: ["a.ts"],
    model: "test",
    diagnostics: [],
    recordedAt: "2026-08-12T00:00:00.000Z",
    artifactPath: `.data/agent-review/reviews/${runId}/run.json`,
  };
  fs.writeFileSync(path.join(runPath, "run.json"), JSON.stringify(artifact), "utf8");
  fs.writeFileSync(path.join(runPath, "remediations", "0", "plan.md"), "# Fix bug\n", "utf8");
  fs.writeFileSync(
    path.join(runPath, "remediations", "0", "work-log.jsonl"),
    `${JSON.stringify({ at: "2026-08-12T00:00:01.000Z", event: "started", message: "Picked up" })}\n`,
    "utf8",
  );
  fs.mkdirSync(outputDir, { recursive: true });
  fs.appendFileSync(
    path.join(outputDir, "reviews.jsonl"),
    `${JSON.stringify({ runId, path: artifact.artifactPath })}\n`,
    "utf8",
  );
  return artifact;
}

describe("status-report helpers", () => {
  test("loadLatestRunId reads last reviews.jsonl entry", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-status-"));
    const artifact = writeFixture(dir);
    const outputDir = path.join(dir, ".data/agent-review");
    expect(loadLatestRunId(outputDir)).toBe(artifact.runId);
  });

  test("resolveStatusMinSeverity defaults from blockOn", () => {
    expect(resolveStatusMinSeverity({ blockOn: ["error"] })).toBe("error");
    expect(
      resolveStatusMinSeverity({
        blockOn: ["error"],
        minSeverity: "warning",
      }),
    ).toBe("warning");
  });

  test("buildStatusReport marks blocking remediations", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-status-"));
    const artifact = writeFixture(dir);
    const outputDir = path.join(dir, ".data/agent-review");
    const report = buildStatusReport({
      cwd: dir,
      outputDir,
      artifact,
      minSeverity: "error",
    });
    expect(report.blocking).toBe(true);
    expect(report.remediations).toHaveLength(1);
    expect(report.remediations[0]?.blocking).toBe(true);
    expect(report.remediations[0]?.planMissing).toBe(false);
    expect(report.remediations[0]?.lastWorkLog).toContain("started");
  });

  test("buildStatusReport lists blocking findings when plan.md is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-status-"));
    const outputDir = path.join(dir, ".data/agent-review");
    const runId = "20260812T000000Z-missing0";
    const artifact: ReviewRunArtifact = {
      runId,
      scope: "staged",
      exitCode: 1,
      ok: false,
      summary: "missing plan",
      findings: [
        {
          severity: "error",
          key: "test-issue",
          file: "a.ts",
          message: "bug",
          decision: {
            agentId: "a",
            agentName: "A",
            staticHash: "s",
            invocationHash: "i",
            verdict: "remediate",
            task: "Fix bug",
            rationale: "r",
            remediationPath: `reviews/${runId}/remediations/0`,
          },
        },
      ],
      files: ["a.ts"],
      model: "test",
      diagnostics: [],
      recordedAt: "2026-08-12T00:00:00.000Z",
      artifactPath: `.data/agent-review/reviews/${runId}/run.json`,
    };
    const report = buildStatusReport({
      cwd: dir,
      outputDir,
      artifact,
      minSeverity: "error",
    });
    expect(report.blocking).toBe(true);
    expect(report.remediations).toHaveLength(1);
    expect(report.remediations[0]?.index).toBe(0);
    expect(report.remediations[0]?.blocking).toBe(true);
    expect(report.remediations[0]?.planMissing).toBe(true);
    expect(formatStatusReport(report)).toContain("plan missing");
  });
});
