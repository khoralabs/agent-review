import { describe, expect, test } from "bun:test";
import type { PersistedReviewResult } from "../schema/index.ts";
import {
  blockOnThreshold,
  hasBlockingFindings,
  severitiesAtOrAbove,
  severityRank,
} from "./findings.ts";

describe("severity threshold helpers", () => {
  test("severityRank orders error < warning < info", () => {
    expect(severityRank("error")).toBeLessThan(severityRank("warning"));
    expect(severityRank("warning")).toBeLessThan(severityRank("info"));
  });

  test("blockOnThreshold picks the least severe listed", () => {
    expect(blockOnThreshold(["error"])).toBe("error");
    expect(blockOnThreshold(["warning"])).toBe("warning");
    expect(blockOnThreshold(["error", "warning"])).toBe("warning");
    expect(blockOnThreshold(["info", "error"])).toBe("info");
    expect(blockOnThreshold([])).toBe("error");
  });

  test("severitiesAtOrAbove includes more severe levels", () => {
    expect(severitiesAtOrAbove("error")).toEqual(["error"]);
    expect(severitiesAtOrAbove("warning")).toEqual(["error", "warning"]);
    expect(severitiesAtOrAbove("info")).toEqual(["error", "warning", "info"]);
  });

  test("hasBlockingFindings treats blockOn as a threshold", () => {
    const withError: PersistedReviewResult = {
      summary: "x",
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
            task: "fix",
            rationale: "r",
            remediationPath: "reviews/r/remediations/0",
          },
        },
      ],
    };
    expect(hasBlockingFindings(withError, ["warning"])).toBe(true);
    expect(hasBlockingFindings(withError, ["error"])).toBe(true);

    const warningOnly: PersistedReviewResult = {
      summary: "x",
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
            task: "fix",
            rationale: "r",
            remediationPath: "reviews/r/remediations/0",
          },
        },
      ],
    };
    expect(hasBlockingFindings(warningOnly, ["error"])).toBe(false);
    expect(hasBlockingFindings(warningOnly, ["warning"])).toBe(true);
  });
});
