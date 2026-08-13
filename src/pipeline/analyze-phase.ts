import type { RegisteredAgent } from "@khoralabs/agent-capabilities";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import type { generateText } from "ai";

import { defineAnalystAgent, ensureAgentRegistered } from "../agents/index.ts";
import type { AgentReviewConfig } from "../config.ts";
import { writeAgentSnapshotIfAbsent } from "../lib/agent-snapshot.ts";
import {
  loadRunArtifact,
  type PersistReviewArtifactsResult,
  persistReviewArtifacts,
  type ReviewRunArtifact,
  toRepoRelativePath,
} from "../lib/artifacts.ts";
import { exitCodeForFindings, formatFindingsTable } from "../lib/findings.ts";
import type { CollectedDiff } from "../lib/git.ts";
import { loadInstructionsPrompt } from "../lib/instructions.ts";
import { createReviewObservability, resolveOutputDir } from "../lib/observability.ts";
import { logStatus } from "../lib/status.ts";
import { loadWorkstreamPrompt } from "../lib/workstream.ts";
import type { PersistedReviewResult } from "../schema/index.ts";
import { loadSkillPrompt } from "../skills/index.ts";
import { analyzeFindings } from "./analyze.ts";

export type RunAnalyzePhaseInput = {
  config: AgentReviewConfig;
  runId: string;
  cwd?: string;
  /** OverlayFs root for inspectBash (defaults to `cwd`). */
  inspectCwd?: string;
  commitMessage?: string;
  generateTextFn?: typeof generateText;
  skipArtifacts?: boolean;
  quiet?: boolean;
  /** When set, skip loading run.json from disk. */
  artifact?: ReviewRunArtifact;
};

export type RunAnalyzePhaseResult = {
  exitCode: 0 | 1 | 2;
  result?: PersistedReviewResult;
  runId: string;
  message: string;
  artifacts?: PersistReviewArtifactsResult;
  telemetryPath?: string;
};

function diffFromArtifact(artifact: ReviewRunArtifact): CollectedDiff {
  const files = artifact.files ?? [];
  const diff = artifact.diff ?? "";
  const truncated = artifact.truncated ?? false;
  const empty = artifact.empty ?? (files.length === 0 && diff.length === 0);
  return { files, diff, truncated, empty };
}

export async function runAnalyzePhase(input: RunAnalyzePhaseInput): Promise<RunAnalyzePhaseResult> {
  const cwd = input.cwd ?? process.cwd();
  const outputDir = resolveOutputDir(cwd, input.config.outputDir);
  const runId = input.runId.trim();
  if (runId.length === 0) {
    return {
      exitCode: 2,
      runId: "",
      message: "analyze requires --run-id",
    };
  }

  const skipObs = input.skipArtifacts === true;
  const quiet = input.quiet ?? skipObs;

  let artifact: ReviewRunArtifact;
  if (input.artifact !== undefined) {
    artifact = input.artifact;
  } else {
    try {
      artifact = loadRunArtifact(outputDir, runId);
    } catch (err) {
      return {
        exitCode: 2,
        runId,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const obs = skipObs
    ? undefined
    : createReviewObservability({
        outputDir,
        runId,
        serviceName: "agent-review-analyst",
      });

  let agent: RegisteredAgent | undefined;
  const telemetry: AgentTelemetry | undefined = obs?.telemetry;
  let sessionStarted = false;
  let result: PersistedReviewResult | undefined;
  let exitCode: 0 | 1 | 2 = 2;
  let message = "";
  let error: string | undefined;

  logStatus(quiet, `analyze ${runId} started`);

  try {
    const defined = await defineAnalystAgent();
    await ensureAgentRegistered(defined.agent);
    if (!skipObs) {
      await writeAgentSnapshotIfAbsent(outputDir, defined.agent);
    }
    agent = defined.agent;

    const sessionInput = {
      runId,
      scope: artifact.scope,
      commit: artifact.commit,
    };

    if (telemetry?.sessionHooks.onStart) {
      await telemetry.sessionHooks.onStart({
        agent,
        input: sessionInput,
      });
      sessionStarted = true;
    }

    const findings = artifact.findings ?? [];
    const summary = artifact.summary ?? "";
    const diff = diffFromArtifact(artifact);
    const commitMessage = input.commitMessage?.trim() || artifact.commitMessage || undefined;

    if (findings.length === 0) {
      result = { summary: summary || "No findings.", findings: [] };
      exitCode = 0;
      message = result.summary;
      logStatus(quiet, "analyst skipped (no findings)");
    } else {
      const skills = loadSkillPrompt(input.config, cwd);
      if (skills.error !== undefined) {
        exitCode = 2;
        error = skills.error;
        result = { summary, findings };
        message = error;
        logStatus(quiet, error);
        return finalize();
      }
      const instructions = await loadInstructionsPrompt(input.config, cwd);
      if (instructions.error !== undefined) {
        exitCode = 2;
        error = instructions.error;
        result = { summary, findings };
        message = error;
        logStatus(quiet, error);
        return finalize();
      }
      const workstreamContext =
        input.config.includeWorkstream === true
          ? loadWorkstreamPrompt({ outputDir, runId })
          : undefined;
      const analyzed = await analyzeFindings({
        cwd,
        ...(input.inspectCwd !== undefined ? { inspectCwd: input.inspectCwd } : {}),
        outputDir,
        runId,
        modelId: input.config.model.analyze,
        findings,
        reviewSummary: summary,
        diff,
        ...(commitMessage !== undefined ? { commitMessage } : {}),
        ...(workstreamContext !== undefined ? { workstreamContext } : {}),
        ...(skills.system.length > 0 ? { skillSystem: skills.system } : {}),
        ...(instructions.system.length > 0 ? { instructionsSystem: instructions.system } : {}),
        pipelineHooks: telemetry?.pipelineHooks,
        generateTextFn: input.generateTextFn,
        testModel: input.generateTextFn !== undefined,
        skipArtifacts: skipObs,
        quiet,
        analystConcurrency: input.config.analystConcurrency,
      });
      result = { summary, findings: analyzed.findings };
      if (analyzed.failedIndexes.length > 0) {
        exitCode = 2;
        error = `analyst failed on finding(s) ${analyzed.failedIndexes.join(", ")}`;
        logStatus(quiet, error);
      } else {
        exitCode = exitCodeForFindings(result, input.config.blockOn);
      }
      const table = formatFindingsTable(result.findings);
      message = [`${result.summary}`, "", table].join("\n");
      if (error !== undefined) {
        message = `${message}\n\n${error}`;
      }
    }

    logStatus(
      quiet,
      `analyze complete (exit ${exitCode}${exitCode === 1 ? ", blocking remediations" : ""})`,
    );

    if (telemetry?.sessionHooks.onAfterRun && agent) {
      await telemetry.sessionHooks.onAfterRun({
        agent,
        input: sessionInput,
        context: { sessionId: runId },
        output: result,
      });
      sessionStarted = false;
    }

    return finalize();
  } catch (err) {
    exitCode = 2;
    error = err instanceof Error ? err.message : String(err);
    message = error;
    // Keep review findings on failure.
    result = {
      summary: artifact.summary ?? "error",
      findings: artifact.findings ?? [],
    };
    logStatus(quiet, `analyze failed: ${error}`);
    if (sessionStarted && telemetry?.sessionHooks.onError && agent) {
      try {
        await telemetry.sessionHooks.onError({
          agent,
          input: { runId, scope: artifact.scope },
          context: { sessionId: runId },
          error: err,
        });
      } catch {
        /* ignore */
      }
      sessionStarted = false;
    }
    return finalize();
  }

  function finalize(): RunAnalyzePhaseResult {
    let artifacts: PersistReviewArtifactsResult | undefined;
    let telemetryPath: string | undefined;

    if (!skipObs) {
      try {
        artifacts = persistReviewArtifacts({
          cwd,
          outputDir,
          runId,
          scope: artifact.scope,
          gitHead: artifact.gitHead,
          commit: artifact.commit,
          base: artifact.base,
          head: artifact.head,
          staticHash: artifact.staticHash,
          runtimeHash: artifact.runtimeHash,
          invocationHash: artifact.invocationHash,
          exitCode,
          result,
          files: artifact.files,
          model: input.config.model.analyze,
          diff: artifact.diff,
          commitMessage: artifact.commitMessage,
          truncated: artifact.truncated,
          empty: artifact.empty,
          error,
          diagnostics: artifact.diagnostics ?? [],
        });
        telemetryPath = obs?.telemetryPath;
        const relativePaths = [
          artifacts.relativeRunPath,
          artifacts.relativeReviewsPath,
          ...(artifacts.relativeDiffGzipPath !== undefined ? [artifacts.relativeDiffGzipPath] : []),
          ...(telemetryPath !== undefined ? [toRepoRelativePath(cwd, telemetryPath)] : []),
        ];
        message = `${message}\n\nartifacts:\n${relativePaths.map((p) => `- ${p}`).join("\n")}`;
      } catch (persistErr) {
        const persistMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        message = `${message}\n\n(failed to persist artifacts: ${persistMsg})`;
      }
    }

    return {
      exitCode,
      result,
      runId,
      message,
      artifacts,
      telemetryPath,
    };
  }
}
