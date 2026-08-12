import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { FindingSeverity } from "../schema/index.ts";
import { loadRunArtifact, type ReviewRunArtifact, toRepoRelativePath } from "./artifacts.ts";
import {
  blockOnThreshold,
  formatFindingsTable,
  hasBlockingFindings,
  severitiesAtOrAbove,
} from "./findings.ts";
import { resolveOutputDir } from "./observability.ts";
import { PLAN_FILENAME, remediationRelativePath, runDir } from "./paths.ts";

export type RemediationStatusRow = {
  index: number;
  relativeDir: string;
  planPath: string;
  /** True when plan.md is absent under the remediation directory. */
  planMissing: boolean;
  blocking: boolean;
  severity?: FindingSeverity;
  lastWorkLog?: string;
};

export type StatusReport = {
  runId: string;
  relativeRunPath: string;
  minSeverity: FindingSeverity;
  blocking: boolean;
  findingsTable: string;
  remediations: RemediationStatusRow[];
  summary: string;
};

export function loadLatestRunId(outputDir: string): string | undefined {
  const reviewsPath = path.join(outputDir, "reviews.jsonl");
  if (!existsSync(reviewsPath)) return undefined;
  const lines = readFileSync(reviewsPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    try {
      const row = JSON.parse(line) as { runId?: unknown };
      if (typeof row.runId === "string" && row.runId.trim().length > 0) {
        return row.runId.trim();
      }
    } catch {}
  }
  return undefined;
}

function lastWorkLogSummary(workLogPath: string): string | undefined {
  if (!existsSync(workLogPath)) return undefined;
  const lines = readFileSync(workLogPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) return undefined;
  try {
    const row = JSON.parse(last) as {
      event?: string;
      status?: string;
      message?: string;
    };
    const bits = [row.event, row.status, row.message].filter(
      (bit): bit is string => typeof bit === "string" && bit.length > 0,
    );
    return bits.length > 0 ? bits.join(" — ") : last;
  } catch {
    return last;
  }
}

function listRemediationIndexes(outputDir: string, runId: string): number[] {
  const remRoot = path.join(runDir(outputDir, runId), "remediations");
  if (!existsSync(remRoot)) return [];
  const indexes: number[] = [];
  for (const entry of readdirSync(remRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const plan = path.join(remRoot, entry.name, PLAN_FILENAME);
    if (!existsSync(plan)) continue;
    indexes.push(Number(entry.name));
  }
  return indexes.sort((a, b) => a - b);
}

export function resolveStatusMinSeverity(input: {
  blockOn: FindingSeverity[];
  minSeverity?: FindingSeverity;
}): FindingSeverity {
  return input.minSeverity ?? blockOnThreshold(input.blockOn);
}

export function buildStatusReport(input: {
  cwd: string;
  outputDir: string;
  artifact: ReviewRunArtifact;
  minSeverity: FindingSeverity;
}): StatusReport {
  const { cwd, outputDir, artifact, minSeverity } = input;
  const blockOn = severitiesAtOrAbove(minSeverity);
  const result = {
    summary: artifact.summary,
    findings: artifact.findings,
  };
  const blocking = hasBlockingFindings(result, blockOn);
  const blockers = new Set(blockOn);
  const onDisk = new Set(listRemediationIndexes(outputDir, artifact.runId));
  const remediations: RemediationStatusRow[] = [];

  for (let index = 0; index < artifact.findings.length; index++) {
    const finding = artifact.findings[index];
    if (finding === undefined) continue;
    const findingBlocking =
      blockers.has(finding.severity) &&
      (finding.decision === undefined || finding.decision.verdict === "remediate");
    const planExists = onDisk.has(index);
    // Always list blocking findings (even without plan.md); keep on-disk rows too.
    if (!findingBlocking && !planExists) continue;

    const absoluteDir = path.join(outputDir, remediationRelativePath(artifact.runId, index));
    const absolutePlan = path.join(absoluteDir, PLAN_FILENAME);
    remediations.push({
      index,
      relativeDir: toRepoRelativePath(cwd, absoluteDir),
      planPath: toRepoRelativePath(cwd, absolutePlan),
      planMissing: !planExists,
      blocking: findingBlocking,
      severity: finding.severity,
      lastWorkLog: lastWorkLogSummary(path.join(absoluteDir, "work-log.jsonl")),
    });
  }

  return {
    runId: artifact.runId,
    relativeRunPath: artifact.artifactPath,
    minSeverity,
    blocking,
    findingsTable: formatFindingsTable(artifact.findings),
    remediations,
    summary: artifact.summary,
  };
}

export function formatStatusReport(report: StatusReport): string {
  const lines = [
    `runId: ${report.runId}`,
    `minSeverity: ${report.minSeverity}`,
    `blocking: ${report.blocking ? "yes" : "no"}`,
    "",
    report.findingsTable,
    "",
    "Remediations:",
  ];
  if (report.remediations.length === 0) {
    lines.push("(none)");
  } else {
    for (const row of report.remediations) {
      const sev = row.severity ?? "?";
      const log = row.lastWorkLog ?? "—";
      const flag = row.blocking ? "blocking" : "ok";
      const missing = row.planMissing ? " (plan missing)" : "";
      lines.push(`- [${flag}] ${row.index} ${sev} ${row.relativeDir}${missing} | ${log}`);
    }
  }
  return lines.join("\n");
}

export function loadStatusArtifact(input: { cwd: string; outputDir: string; runId?: string }): {
  artifact: ReviewRunArtifact;
  outputDir: string;
} {
  const resolvedOutput = resolveOutputDir(input.cwd, input.outputDir);
  const runId = input.runId?.trim() || loadLatestRunId(resolvedOutput);
  if (runId === undefined || runId.length === 0) {
    throw new Error("no runId: pass --run-id or ensure reviews.jsonl has an entry");
  }
  return {
    artifact: loadRunArtifact(resolvedOutput, runId),
    outputDir: resolvedOutput,
  };
}
