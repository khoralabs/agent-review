import type { FindingSeverity, PersistedFinding, PersistedReviewResult } from "../schema/index.ts";

const SEVERITY_ORDER: FindingSeverity[] = ["error", "warning", "info"];

/** Lower rank = more severe. */
export function severityRank(severity: FindingSeverity): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}

/**
 * Least severe severity listed in `blockOn` (highest rank).
 * Empty / invalid → `error`.
 */
export function blockOnThreshold(blockOn: FindingSeverity[]): FindingSeverity {
  if (blockOn.length === 0) return "error";
  let maxRank = -1;
  let least: FindingSeverity = "error";
  for (const severity of blockOn) {
    const rank = severityRank(severity);
    if (rank > maxRank) {
      maxRank = rank;
      least = severity;
    }
  }
  return least;
}

/** Severities at or above `min` (more severe or equal). */
export function severitiesAtOrAbove(min: FindingSeverity): FindingSeverity[] {
  const maxRank = severityRank(min);
  return SEVERITY_ORDER.filter((severity) => severityRank(severity) <= maxRank);
}

/** True when a finding at/above the blockOn threshold still needs remediation. */
export function hasBlockingFindings(
  result: PersistedReviewResult,
  blockOn: FindingSeverity[],
): boolean {
  const blockers = new Set(severitiesAtOrAbove(blockOnThreshold(blockOn)));
  return result.findings.some((f) => {
    if (!blockers.has(f.severity)) return false;
    if (f.decision === undefined) return true;
    return f.decision.verdict === "remediate";
  });
}

export function formatFindingsTable(
  findings: Array<{
    severity: FindingSeverity;
    file: string;
    line?: number;
    message: string;
    rule?: string;
    decision?: PersistedFinding["decision"];
  }>,
): string {
  if (findings.length === 0) return "No findings.";
  const sorted = [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const lines = ["Severity | Location | Finding | Decision", "---|---|---|---"];
  for (const f of sorted) {
    const loc = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
    const msg = f.rule ? `[${f.rule}] ${f.message}` : f.message;
    const decision = f.decision?.verdict ?? "—";
    lines.push(`${f.severity} | ${loc} | ${msg} | ${decision}`);
  }
  return lines.join("\n");
}

/** Exit code: 0 clean, 1 blocking remediate findings. */
export function exitCodeForFindings(
  result: PersistedReviewResult,
  blockOn: FindingSeverity[],
): 0 | 1 {
  return hasBlockingFindings(result, blockOn) ? 1 : 0;
}
