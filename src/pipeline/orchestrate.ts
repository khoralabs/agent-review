import path from "node:path";

import type { AgentReviewConfig } from "../config.ts";
import { loadRunArtifact, type ReviewRunArtifact, runArtifactPath } from "../lib/artifacts.ts";
import type { CollectedDiff, DiffScope } from "../lib/git.ts";
import { resolveOutputDir } from "../lib/observability.ts";
import { logStatus } from "../lib/status.ts";
import { type RunAnalyzePhaseResult, runAnalyzePhase } from "./analyze-phase.ts";
import {
  type RunReviewPhaseInput,
  type RunReviewPhaseResult,
  runReviewPhase,
} from "./review-phase.ts";

export type SpawnCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SpawnCliFn = (args: {
  command: "review" | "analyze";
  argv: string[];
  cwd: string;
}) => Promise<SpawnCliResult>;

export type OrchestrateInput = {
  /** Flags after the subcommand (e.g. --scope staged --message-file …). */
  argv: string[];
  cwd?: string;
  outputDir?: string;
  quiet?: boolean;
  spawnCliFn?: SpawnCliFn;
  /** Absolute path to cli.ts; defaults to this package's cli. */
  cliPath?: string;
};

export type OrchestrateResult = {
  exitCode: 0 | 1 | 2;
  message: string;
  runId?: string;
};

export type OrchestrateInProcessInput = Omit<RunReviewPhaseInput, "skipArtifacts">;

export type OrchestrateInProcessResult = OrchestrateResult & {
  review: RunReviewPhaseResult;
  analyze?: RunAnalyzePhaseResult;
};

export function artifactFromReview(input: {
  review: RunReviewPhaseResult;
  config: AgentReviewConfig;
  scope: DiffScope;
  commit?: string;
  base?: string;
  head?: string;
}): ReviewRunArtifact {
  const { review, config } = input;
  const diff: CollectedDiff | undefined = review.diff;
  return {
    runId: review.runId,
    scope: input.scope,
    ...(review.gitHead !== undefined ? { gitHead: review.gitHead } : {}),
    commit: review.commit ?? input.commit,
    base: review.base ?? input.base,
    head: review.head ?? input.head,
    staticHash: review.staticHash,
    runtimeHash: review.runtimeHash,
    invocationHash: review.invocationHash,
    exitCode: review.exitCode,
    ok: review.exitCode === 0,
    summary: review.result?.summary ?? "",
    findings: review.result?.findings ?? [],
    files: diff?.files ?? [],
    model: config.model,
    diff: diff?.diff,
    commitMessage: review.commitMessage,
    truncated: diff?.truncated,
    empty: diff?.empty,
    diagnostics: review.diagnostics,
    recordedAt: new Date().toISOString(),
    artifactPath: `reviews/${review.runId}/run.json`,
  };
}

/**
 * Run review then analyze in-process with no disk writes.
 * Used by `run --no-emit`.
 */
export async function orchestrateInProcess(
  input: OrchestrateInProcessInput,
): Promise<OrchestrateInProcessResult> {
  const cwd = input.cwd ?? process.cwd();
  const quiet = input.quiet ?? false;
  const scope = input.scope ?? input.config.defaultScope;
  const commit = scope === "commit" ? input.commit?.trim() || "HEAD" : input.commit;

  logStatus(quiet, "orchestrator: starting review…");
  const review = await runReviewPhase({
    ...input,
    cwd,
    scope,
    skipArtifacts: true,
    quiet,
  });

  if (review.exitCode !== 0) {
    return {
      exitCode: review.exitCode,
      runId: review.runId,
      message: review.message,
      review,
    };
  }

  if (review.skipAnalyze) {
    logStatus(quiet, `orchestrator: skipping analyze (run ${review.runId})`);
    return {
      exitCode: 0,
      runId: review.runId,
      message: `review complete (run ${review.runId}); analyze skipped`,
      review,
    };
  }

  logStatus(quiet, `orchestrator: starting analyze for ${review.runId}…`);
  const artifact = artifactFromReview({
    review,
    config: input.config,
    scope,
    commit,
    base: input.base,
    head: input.head,
  });
  const analyze = await runAnalyzePhase({
    config: input.config,
    runId: review.runId,
    cwd,
    ...(input.inspectCwd !== undefined ? { inspectCwd: input.inspectCwd } : {}),
    commitMessage: review.commitMessage,
    generateTextFn: input.generateTextFn,
    skipArtifacts: true,
    quiet,
    artifact,
  });

  return {
    exitCode: analyze.exitCode,
    runId: review.runId,
    message: analyze.message,
    review,
    analyze,
  };
}

function defaultCliPath(): string {
  return path.join(import.meta.dir, "..", "cli.ts");
}

export async function defaultSpawnCli(input: {
  command: "review" | "analyze";
  argv: string[];
  cwd: string;
  cliPath?: string;
}): Promise<SpawnCliResult> {
  const cliPath = input.cliPath ?? defaultCliPath();
  const proc = Bun.spawn(["bun", "run", cliPath, input.command, ...input.argv], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "inherit",
    env: process.env,
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { exitCode, stdout, stderr: "" };
}

/** First non-empty trimmed line of stdout is the runId. */
export function parseRunIdFromStdout(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

/**
 * Spawn `review` then `analyze --run-id <id>` as separate CLI processes.
 * Skips analyze when review fails or produces zero findings / empty diff.
 */
export async function orchestrateViaCli(input: OrchestrateInput): Promise<OrchestrateResult> {
  const cwd = input.cwd ?? process.cwd();
  const quiet = input.quiet ?? false;
  const spawn: SpawnCliFn =
    input.spawnCliFn ??
    ((args) =>
      defaultSpawnCli({
        ...args,
        ...(input.cliPath !== undefined ? { cliPath: input.cliPath } : {}),
      }));

  logStatus(quiet, "orchestrator: starting review…");
  const reviewed = await spawn({
    command: "review",
    argv: input.argv,
    cwd,
  });

  const reviewExit = reviewed.exitCode as 0 | 1 | 2;
  if (reviewExit !== 0) {
    return {
      exitCode: reviewExit === 1 ? 2 : reviewExit,
      runId: parseRunIdFromStdout(reviewed.stdout),
      message: reviewed.stderr.trim() || "review failed",
    };
  }

  const runId = parseRunIdFromStdout(reviewed.stdout);
  if (runId === undefined) {
    return {
      exitCode: 2,
      message: "orchestrator: review succeeded but printed no runId",
    };
  }

  const outputDir = resolveOutputDir(cwd, input.outputDir);
  let skipAnalyze = false;
  try {
    const artifact = loadRunArtifact(outputDir, runId);
    skipAnalyze = artifact.empty === true || (artifact.findings?.length ?? 0) === 0;
  } catch {
    skipAnalyze = false;
  }

  if (skipAnalyze) {
    logStatus(quiet, `orchestrator: skipping analyze (run ${runId})`);
    return {
      exitCode: 0,
      runId,
      message: `review complete (run ${runId}); analyze skipped`,
    };
  }

  logStatus(quiet, `orchestrator: starting analyze for ${runId}…`);
  const analyzeArgv = ["--run-id", runId, ...input.argv];
  const analyzed = await spawn({
    command: "analyze",
    argv: analyzeArgv,
    cwd,
  });

  const analyzeExit = analyzed.exitCode;
  const exitCode: 0 | 1 | 2 =
    analyzeExit === 0 || analyzeExit === 1 || analyzeExit === 2 ? analyzeExit : 2;

  return {
    exitCode,
    runId,
    message: analyzed.stderr.trim() || `analyze finished (exit ${exitCode})`,
  };
}

export { runArtifactPath };
