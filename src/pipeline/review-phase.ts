import type { RegisteredAgent } from "@khoralabs/agent-capabilities";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import type { generateText } from "ai";

import { defineReviewAgent, ensureAgentRegistered } from "../agents/index.ts";
import type { AgentReviewConfig } from "../config.ts";
import { writeAgentSnapshotIfAbsent } from "../lib/agent-snapshot.ts";
import {
  type PersistReviewArtifactsResult,
  persistReviewArtifacts,
  stampFindingFingerprints,
  toRepoRelativePath,
  writeRunArtifact,
} from "../lib/artifacts.ts";
import { resolveCommitMessage } from "../lib/commit-message.ts";
import { formatFindingsTable } from "../lib/findings.ts";
import { type CollectedDiff, collectDiff, type DiffScope } from "../lib/git.ts";
import { createReviewObservability, resolveOutputDir } from "../lib/observability.ts";
import {
  formatReviewRunId,
  type ResolveReviewedShortShaInput,
  type ResolveReviewGitRefsInput,
  type ReviewGitRefs,
  resolveReviewedShortSha,
  resolveReviewGitRefs,
} from "../lib/run-id.ts";
import { logStatus } from "../lib/status.ts";
import { loadWorkstreamPrompt } from "../lib/workstream.ts";
import type { PersistedReviewResult } from "../schema/index.ts";
import { loadSkillPrompt, type SkillDiagnostic } from "../skills/index.ts";
import { runReviewAgent } from "./review.ts";

export type RunReviewPhaseInput = {
  config: AgentReviewConfig;
  scope?: DiffScope;
  base?: string;
  head?: string;
  commit?: string;
  cwd?: string;
  /** OverlayFs root for inspectBash (defaults to `cwd`). */
  inspectCwd?: string;
  stdinText?: string;
  commitMessage?: string;
  commitMessageFile?: string;
  generateTextFn?: typeof generateText;
  collectDiffFn?: typeof collectDiff;
  /** Inject for tests. */
  revParseFn?: ResolveReviewedShortShaInput["revParseFn"];
  /** Inject for tests (full SHA). */
  gitRevParseFn?: ResolveReviewGitRefsInput["revParseFn"];
  skipArtifacts?: boolean;
  quiet?: boolean;
};

export type RunReviewPhaseResult = {
  exitCode: 0 | 2;
  result?: PersistedReviewResult;
  diff?: CollectedDiff;
  staticHash?: string;
  runtimeHash?: string;
  invocationHash?: string;
  gitHead?: string;
  /** Resolved commit SHA when scope=commit. */
  commit?: string;
  /** Resolved base SHA when scope=range. */
  base?: string;
  /** Resolved head SHA when scope=range. */
  head?: string;
  runId: string;
  diagnostics: SkillDiagnostic[];
  message: string;
  /** Printed on stdout by CLI for orchestrator handoff. */
  runIdStdout?: string;
  artifacts?:
    | PersistReviewArtifactsResult
    | {
        runPath: string;
        relativeRunPath: string;
        relativeDiffGzipPath?: string;
      };
  telemetryPath?: string;
  /** True when analyze should be skipped (empty diff or zero findings). */
  skipAnalyze: boolean;
  commitMessage?: string;
};

type MutableState = {
  runId: string;
  agent?: RegisteredAgent;
  telemetry?: AgentTelemetry;
  sessionStarted: boolean;
  staticHash?: string;
  runtimeHash?: string;
  invocationHash?: string;
  gitRefs: ReviewGitRefs;
  diff?: CollectedDiff;
  result?: PersistedReviewResult;
  commitMessage?: string;
  exitCode: 0 | 2;
  message: string;
  error?: string;
  skipAnalyze: boolean;
};

export async function runReviewPhase(input: RunReviewPhaseInput): Promise<RunReviewPhaseResult> {
  const cwd = input.cwd ?? process.cwd();
  const scope = input.scope ?? input.config.defaultScope;
  const commit = scope === "commit" ? input.commit?.trim() || "HEAD" : input.commit;
  const diagnostics: SkillDiagnostic[] = [];
  const outputDir = resolveOutputDir(cwd, input.config.outputDir);

  const shortSha = await resolveReviewedShortSha({
    cwd,
    scope,
    commit,
    base: input.base,
    head: input.head,
    ...(input.revParseFn !== undefined ? { revParseFn: input.revParseFn } : {}),
  });
  const gitRefs = await resolveReviewGitRefs({
    cwd,
    scope,
    commit,
    base: input.base,
    head: input.head,
    ...(input.gitRevParseFn !== undefined ? { revParseFn: input.gitRevParseFn } : {}),
  });
  const runId = formatReviewRunId(new Date(), shortSha);

  const skipObs = input.skipArtifacts === true;
  const quiet = input.quiet ?? skipObs;
  const obs = skipObs
    ? undefined
    : createReviewObservability({
        outputDir,
        runId,
        serviceName: "bloom-agent-review",
      });

  const state: MutableState = {
    runId,
    sessionStarted: false,
    exitCode: 2,
    message: "",
    skipAnalyze: true,
    gitRefs,
  };

  logStatus(quiet, `review ${runId} started (scope=${scope})`);

  try {
    const collect = input.collectDiffFn ?? collectDiff;
    logStatus(quiet, "collecting diff…");
    const diff = await collect({
      scope,
      base: input.base,
      head: input.head,
      commit,
      cwd,
      maxDiffBytes: input.config.maxDiffBytes,
      stdinText: input.stdinText,
    });
    state.diff = diff;

    if (diff.empty) {
      state.exitCode = 0;
      state.message = "No changes to review.";
      state.skipAnalyze = true;
      logStatus(quiet, "no changes to review");
      return finalize({ appendIndex: true });
    }

    logStatus(
      quiet,
      `diff ready (${diff.files.length} file${diff.files.length === 1 ? "" : "s"}${diff.truncated ? ", truncated" : ""})`,
    );

    const skills = loadSkillPrompt(input.config, cwd);
    diagnostics.push(...skills.diagnostics);
    if (skills.error !== undefined) {
      state.exitCode = 2;
      state.error = skills.error;
      state.message = skills.error;
      return finalize({ appendIndex: true });
    }

    const telemetry = obs?.telemetry;
    state.telemetry = telemetry;
    const sessionInput = {
      scope,
      commit,
      base: input.base,
      head: input.head,
      runId,
    };

    const commitMessage = await resolveCommitMessage({
      cwd,
      scope,
      commit,
      message: input.commitMessage,
      messageFile: input.commitMessageFile,
    });
    state.commitMessage = commitMessage;

    const testModel = input.generateTextFn !== undefined;

    const previewAgent = await defineReviewAgent();
    await ensureAgentRegistered(previewAgent.agent);
    if (!skipObs) {
      await writeAgentSnapshotIfAbsent(outputDir, previewAgent.agent);
    }
    state.agent = previewAgent.agent;
    state.staticHash = previewAgent.staticHash;

    if (telemetry?.sessionHooks.onStart) {
      await telemetry.sessionHooks.onStart({
        agent: previewAgent.agent,
        input: sessionInput,
      });
      state.sessionStarted = true;
    }

    logStatus(quiet, "review agent starting…");
    const workstreamContext =
      input.config.includeWorkstream === true
        ? loadWorkstreamPrompt({ outputDir, runId, shortSha })
        : undefined;
    const reviewed = await runReviewAgent({
      cwd,
      ...(input.inspectCwd !== undefined ? { inspectCwd: input.inspectCwd } : {}),
      runId,
      modelId: input.config.model,
      diff,
      ...(commitMessage !== undefined ? { commitMessage } : {}),
      ...(workstreamContext !== undefined ? { workstreamContext } : {}),
      discoveredSkills: skills.discovered,
      activatedSkills: skills.activated,
      pipelineHooks: telemetry?.pipelineHooks,
      generateTextFn: input.generateTextFn,
      testModel,
    });

    state.agent = reviewed.agent;
    state.staticHash = reviewed.staticHash;
    state.runtimeHash = reviewed.runtimeHash;
    state.invocationHash = reviewed.invocationHash;

    const findingCount = reviewed.result.findings.length;
    logStatus(
      quiet,
      `review agent finished (${findingCount} finding${findingCount === 1 ? "" : "s"})`,
    );

    state.result = {
      summary: reviewed.result.summary,
      findings: stampFindingFingerprints(reviewed.result.findings),
    };
    state.exitCode = 0;
    state.skipAnalyze = findingCount === 0;
    const table = formatFindingsTable(reviewed.result.findings);
    state.message = [`${reviewed.result.summary}`, "", table].join("\n");

    if (telemetry?.sessionHooks.onAfterRun && state.agent) {
      await telemetry.sessionHooks.onAfterRun({
        agent: state.agent,
        input: sessionInput,
        context: { sessionId: runId },
        output: state.result,
      });
      state.sessionStarted = false;
    }

    // With findings: checkpoint only (analyze appends index). Zero findings: final persist.
    return finalize({ appendIndex: findingCount === 0 });
  } catch (err) {
    state.exitCode = 2;
    state.error = err instanceof Error ? err.message : String(err);
    state.message = state.error;
    state.skipAnalyze = true;
    logStatus(quiet, `review failed: ${state.error}`);
    if (state.sessionStarted && state.telemetry?.sessionHooks.onError && state.agent) {
      try {
        await state.telemetry.sessionHooks.onError({
          agent: state.agent,
          input: { scope, commit, runId },
          context: { sessionId: runId },
          error: err,
        });
      } catch {
        /* ignore hook errors */
      }
      state.sessionStarted = false;
    }
    return finalize({ appendIndex: true });
  }

  function finalize(opts: { appendIndex: boolean }): RunReviewPhaseResult {
    let artifacts:
      | PersistReviewArtifactsResult
      | {
          runPath: string;
          relativeRunPath: string;
          relativeDiffGzipPath?: string;
        }
      | undefined;
    let telemetryPath: string | undefined;

    if (!skipObs) {
      try {
        const persistInput = {
          cwd,
          outputDir,
          runId: state.runId,
          scope,
          gitHead: state.gitRefs.gitHead,
          commit: state.gitRefs.commit ?? commit,
          base: state.gitRefs.base ?? input.base,
          head: state.gitRefs.head ?? input.head,
          staticHash: state.staticHash,
          runtimeHash: state.runtimeHash,
          invocationHash: state.invocationHash,
          exitCode: state.exitCode,
          result: state.result,
          files: state.diff?.files,
          model: input.config.model,
          diff: state.diff?.diff,
          commitMessage: state.commitMessage,
          truncated: state.diff?.truncated,
          empty: state.diff?.empty,
          error: state.error,
          diagnostics,
        };
        artifacts = opts.appendIndex
          ? persistReviewArtifacts(persistInput)
          : writeRunArtifact(persistInput);
        if (!opts.appendIndex) {
          logStatus(quiet, "review findings written");
        }
        telemetryPath = obs?.telemetryPath;
        const relativePaths = [
          artifacts.relativeRunPath,
          ...("relativeReviewsPath" in artifacts && artifacts.relativeReviewsPath !== undefined
            ? [artifacts.relativeReviewsPath]
            : []),
          ...(artifacts.relativeDiffGzipPath !== undefined ? [artifacts.relativeDiffGzipPath] : []),
          ...(telemetryPath !== undefined ? [toRepoRelativePath(cwd, telemetryPath)] : []),
        ];
        state.message = `${state.message}\n\nartifacts:\n${relativePaths.map((p) => `- ${p}`).join("\n")}`;
      } catch (persistErr) {
        const persistMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        state.message = `${state.message}\n\n(failed to persist artifacts: ${persistMsg})`;
      }
    }

    return {
      exitCode: state.exitCode,
      result: state.result,
      diff: state.diff,
      staticHash: state.staticHash,
      runtimeHash: state.runtimeHash,
      invocationHash: state.invocationHash,
      gitHead: state.gitRefs.gitHead,
      commit: state.gitRefs.commit ?? commit,
      base: state.gitRefs.base ?? input.base,
      head: state.gitRefs.head ?? input.head,
      runId: state.runId,
      diagnostics,
      message: state.message,
      runIdStdout: state.exitCode === 0 ? state.runId : undefined,
      artifacts,
      telemetryPath,
      skipAnalyze: state.skipAnalyze,
      commitMessage: state.commitMessage,
    };
  }
}
