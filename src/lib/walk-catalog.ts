import type { FindingSeverity, PersistedFinding } from "../schema/index.ts";
import { findingFingerprint } from "./finding-fingerprint.ts";
import { severityRank } from "./findings.ts";

export type WalkStepForCatalog = {
  /** Full commit SHA (ancestry order when building). */
  commit: string;
  runId?: string;
  files: string[];
  findings: PersistedFinding[];
  /** True when this step failed and has no usable findings. */
  failed?: boolean;
};

export type WalkCatalogOccurrence = {
  commit: string;
  runId: string;
  findingIndex: number;
  severity: FindingSeverity;
  line?: number;
  message: string;
  decision?: "ignore" | "remediate";
  remediationPath?: string;
};

export type WalkCatalogEntry = {
  fingerprint: string;
  key: string;
  file: string;
  rule?: string;
  message: string;
  maxSeverity: FindingSeverity;
  occurrences: WalkCatalogOccurrence[];
  firstSeen: string;
  lastSeen: string;
  status: "unresolved" | "resolved" | "unverified";
  resolvedByCommit?: string;
};

function fingerprintOf(finding: PersistedFinding): string {
  if (typeof finding.fingerprint === "string" && finding.fingerprint.length > 0) {
    return finding.fingerprint;
  }
  return findingFingerprint({
    key: finding.key,
    file: finding.file,
    rule: finding.rule,
  });
}

function pickMaxSeverity(a: FindingSeverity, b: FindingSeverity): FindingSeverity {
  return severityRank(a) <= severityRank(b) ? a : b;
}

function normalizePath(file: string): string {
  return file.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Build a deduped finding ledger from ancestry-ordered walk steps.
 */
export function buildWalkCatalog(steps: readonly WalkStepForCatalog[]): WalkCatalogEntry[] {
  const byFp = new Map<
    string,
    {
      entry: WalkCatalogEntry;
      occurrenceCommits: Set<string>;
    }
  >();

  for (const step of steps) {
    if (step.failed === true) continue;
    const runId = step.runId ?? "";
    step.findings.forEach((finding, findingIndex) => {
      const fp = fingerprintOf(finding);
      const decision =
        finding.decision?.verdict === "ignore" || finding.decision?.verdict === "remediate"
          ? finding.decision.verdict
          : undefined;
      const remediationPath =
        finding.decision?.verdict === "remediate" ? finding.decision.remediationPath : undefined;
      const occurrence: WalkCatalogOccurrence = {
        commit: step.commit,
        runId,
        findingIndex,
        severity: finding.severity,
        ...(finding.line !== undefined ? { line: finding.line } : {}),
        message: finding.message,
        ...(decision !== undefined ? { decision } : {}),
        ...(remediationPath !== undefined ? { remediationPath } : {}),
      };

      const existing = byFp.get(fp);
      if (existing === undefined) {
        byFp.set(fp, {
          occurrenceCommits: new Set([step.commit]),
          entry: {
            fingerprint: fp,
            key: finding.key,
            file: finding.file,
            ...(finding.rule !== undefined ? { rule: finding.rule } : {}),
            message: finding.message,
            maxSeverity: finding.severity,
            occurrences: [occurrence],
            firstSeen: step.commit,
            lastSeen: step.commit,
            status: "unresolved",
          },
        });
        return;
      }

      existing.occurrenceCommits.add(step.commit);
      existing.entry.occurrences.push(occurrence);
      existing.entry.lastSeen = step.commit;
      existing.entry.message = finding.message;
      existing.entry.maxSeverity = pickMaxSeverity(existing.entry.maxSeverity, finding.severity);
      if (finding.rule !== undefined) existing.entry.rule = finding.rule;
    });
  }

  const commitOrder = steps.map((s) => s.commit);
  const commitIndex = new Map(commitOrder.map((sha, i) => [sha, i]));
  const filesByCommit = new Map(steps.map((s) => [s.commit, new Set(s.files.map(normalizePath))]));
  const tip = commitOrder[commitOrder.length - 1];

  const entries: WalkCatalogEntry[] = [];
  for (const { entry, occurrenceCommits } of byFp.values()) {
    const file = normalizePath(entry.file);
    const lastSeenIdx = commitIndex.get(entry.lastSeen) ?? -1;

    let status: WalkCatalogEntry["status"] = "unverified";
    let resolvedByCommit: string | undefined;

    for (let i = lastSeenIdx + 1; i < commitOrder.length; i++) {
      const later = commitOrder[i];
      if (later === undefined) continue;
      if (filesByCommit.get(later)?.has(file) !== true) continue;
      if (!occurrenceCommits.has(later)) {
        status = "resolved";
        resolvedByCommit = later;
        break;
      }
    }

    if (status !== "resolved") {
      if (tip !== undefined && occurrenceCommits.has(tip)) {
        status = "unresolved";
      } else {
        // No later file-touch cleared it (would be resolved above) and not on tip.
        status = "unverified";
      }
    }

    entries.push({
      ...entry,
      status,
      ...(resolvedByCommit !== undefined ? { resolvedByCommit } : {}),
    });
  }

  return entries.sort((a, b) => {
    const sev = severityRank(a.maxSeverity) - severityRank(b.maxSeverity);
    if (sev !== 0) return sev;
    return a.fingerprint.localeCompare(b.fingerprint);
  });
}

export function formatWalkCatalogSummary(input: {
  walkId: string;
  from: string;
  to: string;
  commitCount: number;
  stepsFailed: number;
  entries: readonly WalkCatalogEntry[];
}): string {
  const counts = {
    unresolved: 0,
    resolved: 0,
    unverified: 0,
  };
  const bySeverity: Record<FindingSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const e of input.entries) {
    counts[e.status] += 1;
    bySeverity[e.maxSeverity] += 1;
  }
  const lines = [
    `# Walk ${input.walkId}`,
    "",
    `- Range: \`${input.from}..${input.to}\``,
    `- Commits: ${input.commitCount}`,
    `- Steps failed: ${input.stepsFailed}`,
    `- Catalog entries: ${input.entries.length}`,
    "",
    "## Status",
    "",
    `- unresolved: ${counts.unresolved}`,
    `- resolved: ${counts.resolved}`,
    `- unverified: ${counts.unverified}`,
    "",
    "## Max severity",
    "",
    `- error: ${bySeverity.error}`,
    `- warning: ${bySeverity.warning}`,
    `- info: ${bySeverity.info}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}
