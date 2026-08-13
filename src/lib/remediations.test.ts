import { describe, expect, test } from "bun:test";

import { remediationDirName, renderRemediationPlanMd } from "./remediations.ts";

describe("remediations helpers", () => {
  test("remediationDirName is the finding index", () => {
    expect(remediationDirName("20260811T120000Z-abc1234", 2)).toBe("2");
  });

  test("renderRemediationPlanMd uses lean sections", () => {
    const md = renderRemediationPlanMd({
      task: "Fix CRLF paths",
      runId: "run1",
      findingIndex: 0,
      invocationHash: "abcdef0123456789",
      agentId: "agent-review-analyst",
      finding: {
        severity: "error",
        key: "test-issue",
        file: "git.ts",
        line: 10,
        message: "CRLF leak",
        rule: "crlf",
      },
      reviewSummary: "one issue",
      llm: {
        verdict: "remediate",
        task: "Fix CRLF paths",
        rationale: "breaks matching",
        steps: ["strip \\r from captures"],
      },
      date: new Date("2026-08-11T00:00:00.000Z"),
    });
    expect(md).toContain("# Fix CRLF paths");
    expect(md).not.toContain("Status:");
    expect(md).toContain("- Date: 2026-08-11");
    expect(md).toContain("## Context");
    expect(md).toContain("## Why remediate");
    expect(md).toContain("breaks matching");
    expect(md).toContain("## Steps");
    expect(md).toContain("1. strip \\r from captures");
    expect(md).toContain("Source: reviews/run1/run.json finding[0]");
  });
});
