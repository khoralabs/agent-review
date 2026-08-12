import type { AgentReviewConfig } from "../config.ts";
import {
  buildStatusReport,
  formatStatusReport,
  loadStatusArtifact,
  resolveStatusMinSeverity,
  type StatusReport,
} from "../lib/status-report.ts";
import type { FindingSeverity } from "../schema/index.ts";

export type RunStatusPhaseInput = {
  config: AgentReviewConfig;
  cwd: string;
  runId?: string;
  minSeverity?: FindingSeverity;
  json?: boolean;
};

export type RunStatusPhaseResult = {
  exitCode: 0 | 1 | 2;
  message: string;
  report?: StatusReport;
};

export async function runStatusPhase(input: RunStatusPhaseInput): Promise<RunStatusPhaseResult> {
  try {
    const { artifact, outputDir } = loadStatusArtifact({
      cwd: input.cwd,
      outputDir: input.config.outputDir,
      runId: input.runId,
    });
    const minSeverity = resolveStatusMinSeverity({
      blockOn: input.config.blockOn,
      minSeverity: input.minSeverity,
    });
    const report = buildStatusReport({
      cwd: input.cwd,
      outputDir,
      artifact,
      minSeverity,
    });
    const message =
      input.json === true ? JSON.stringify(report, null, 2) : formatStatusReport(report);
    return {
      exitCode: report.blocking ? 1 : 0,
      message,
      report,
    };
  } catch (err) {
    return {
      exitCode: 2,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
