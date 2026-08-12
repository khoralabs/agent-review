import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../config.ts";
import { runStatusPhase } from "./status-phase.ts";

describe("runStatusPhase", () => {
  test("reports blocking remediations for a fixture run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-status-phase-"));
    const outputDir = path.join(dir, ".data/agent-review");
    const runId = "20260812T010000Z-deadbee";
    const runPath = path.join(outputDir, "reviews", runId);
    fs.mkdirSync(path.join(runPath, "remediations", "0"), { recursive: true });
    const artifact = {
      runId,
      scope: "staged",
      exitCode: 1,
      ok: false,
      summary: "blocked",
      findings: [
        {
          severity: "error",
          key: "test-issue",
          file: "x.ts",
          message: "bad",
          decision: {
            agentId: "a",
            agentName: "A",
            staticHash: "s",
            invocationHash: "i",
            verdict: "remediate",
            task: "Fix",
            rationale: "r",
            remediationPath: `reviews/${runId}/remediations/0`,
          },
        },
      ],
      files: ["x.ts"],
      model: "test",
      diagnostics: [],
      recordedAt: "2026-08-12T01:00:00.000Z",
      artifactPath: `.data/agent-review/reviews/${runId}/run.json`,
    };
    fs.writeFileSync(path.join(runPath, "run.json"), JSON.stringify(artifact));
    fs.writeFileSync(path.join(runPath, "remediations", "0", "plan.md"), "# Fix\n");
    fs.appendFileSync(
      path.join(outputDir, "reviews.jsonl"),
      `${JSON.stringify({ runId, path: artifact.artifactPath })}\n`,
    );

    const outcome = await runStatusPhase({
      config: { ...DEFAULT_CONFIG, outputDir: ".data/agent-review" },
      cwd: dir,
      json: true,
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.report?.blocking).toBe(true);
    expect(outcome.message).toContain(runId);
  });
});
