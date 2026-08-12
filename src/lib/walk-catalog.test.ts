import { describe, expect, test } from "bun:test";

import type { PersistedFinding } from "../schema/index.ts";
import { findingFingerprint } from "./finding-fingerprint.ts";
import { buildWalkCatalog, type WalkStepForCatalog } from "./walk-catalog.ts";

function finding(input: {
  key: string;
  file: string;
  message: string;
  severity?: "error" | "warning" | "info";
  rule?: string;
  decision?: "ignore" | "remediate";
}): PersistedFinding {
  const fingerprint = findingFingerprint({
    key: input.key,
    file: input.file,
    rule: input.rule,
  });
  const base: PersistedFinding = {
    severity: input.severity ?? "warning",
    key: input.key,
    file: input.file,
    message: input.message,
    fingerprint,
    ...(input.rule !== undefined ? { rule: input.rule } : {}),
  };
  if (input.decision === "ignore") {
    return {
      ...base,
      decision: {
        verdict: "ignore",
        rationale: "test",
        agentId: "a",
        agentName: "analyst",
        staticHash: "s",
        invocationHash: "i",
      },
    };
  }
  if (input.decision === "remediate") {
    return {
      ...base,
      decision: {
        verdict: "remediate",
        task: "fix",
        rationale: "test",
        remediationPath: "reviews/r/remediations/0",
        agentId: "a",
        agentName: "analyst",
        staticHash: "s",
        invocationHash: "i",
      },
    };
  }
  return base;
}

describe("buildWalkCatalog", () => {
  test("groups by host fingerprint across commits", () => {
    const steps: WalkStepForCatalog[] = [
      {
        commit: "c1",
        runId: "r1",
        files: ["a.ts"],
        findings: [
          finding({
            key: "null-deref",
            file: "a.ts",
            message: "first wording",
          }),
        ],
      },
      {
        commit: "c2",
        runId: "r2",
        files: ["a.ts"],
        findings: [
          finding({
            key: "null-deref",
            file: "a.ts",
            message: "different wording same key",
          }),
        ],
      },
    ];
    const catalog = buildWalkCatalog(steps);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.occurrences).toHaveLength(2);
    expect(catalog[0]?.firstSeen).toBe("c1");
    expect(catalog[0]?.lastSeen).toBe("c2");
    expect(catalog[0]?.message).toBe("different wording same key");
  });

  test("resolved when a later commit touches the file without re-finding", () => {
    const steps: WalkStepForCatalog[] = [
      {
        commit: "c1",
        runId: "r1",
        files: ["a.ts"],
        findings: [
          finding({
            key: "leak",
            file: "a.ts",
            message: "leak",
            severity: "error",
          }),
        ],
      },
      {
        commit: "c2",
        runId: "r2",
        files: ["a.ts"],
        findings: [],
      },
    ];
    const catalog = buildWalkCatalog(steps);
    expect(catalog[0]?.status).toBe("resolved");
    expect(catalog[0]?.resolvedByCommit).toBe("c2");
  });

  test("unresolved when still present on tip", () => {
    const steps: WalkStepForCatalog[] = [
      {
        commit: "c1",
        runId: "r1",
        files: ["a.ts"],
        findings: [finding({ key: "leak", file: "a.ts", message: "m1" })],
      },
      {
        commit: "c2",
        runId: "r2",
        files: ["a.ts"],
        findings: [finding({ key: "leak", file: "a.ts", message: "m2" })],
      },
    ];
    const catalog = buildWalkCatalog(steps);
    expect(catalog[0]?.status).toBe("unresolved");
    expect(catalog[0]?.resolvedByCommit).toBeUndefined();
  });

  test("unresolved when last file-touching commit still has the finding", () => {
    const steps: WalkStepForCatalog[] = [
      {
        commit: "c1",
        runId: "r1",
        files: ["a.ts"],
        findings: [finding({ key: "leak", file: "a.ts", message: "m1" })],
      },
      {
        commit: "c2",
        runId: "r2",
        files: ["b.ts"],
        findings: [finding({ key: "leak", file: "a.ts", message: "m2" })],
      },
    ];
    const catalog = buildWalkCatalog(steps);
    expect(catalog[0]?.status).toBe("unresolved");
  });

  test("unverified when no later commit touches the file and not on tip", () => {
    const steps: WalkStepForCatalog[] = [
      {
        commit: "c1",
        runId: "r1",
        files: ["a.ts"],
        findings: [finding({ key: "leak", file: "a.ts", message: "m" })],
      },
      {
        commit: "c2",
        runId: "r2",
        files: ["b.ts"],
        findings: [],
      },
    ];
    const catalog = buildWalkCatalog(steps);
    expect(catalog[0]?.status).toBe("unverified");
  });

  test("occurrences use step commit SHA not gitHead", () => {
    const steps: WalkStepForCatalog[] = [
      {
        commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runId: "r1",
        files: ["a.ts"],
        findings: [finding({ key: "x", file: "a.ts", message: "m" })],
      },
    ];
    const catalog = buildWalkCatalog(steps);
    expect(catalog[0]?.occurrences[0]?.commit).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });
});
