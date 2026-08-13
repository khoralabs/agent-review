import type { RegisteredAgent, ToolPipelineHooks } from "@khoralabs/agent-capabilities";
import type { generateText, LanguageModel } from "ai";

import { defineAnalystAgent, ensureAgentRegistered } from "../agents/index.ts";
import { stampFindingFingerprints } from "../lib/artifacts.ts";
import { capabilitiesGenerateText, resolveGatewayModel } from "../lib/capabilities-generate.ts";
import type { CollectedDiff } from "../lib/git.ts";
import { joinSystemParts } from "../lib/instructions.ts";
import { mapPool } from "../lib/pool.ts";
import { renderRemediationPlanMd, writeRemediationPlan } from "../lib/remediations.ts";
import { withRetry } from "../lib/retry.ts";
import { logStatus } from "../lib/status.ts";
import {
  type AnalystDecision,
  type AnalystLlmOutput,
  analystLlmOutputSchema,
  type Finding,
  type PersistedFinding,
} from "../schema/index.ts";

export type AnalyzeFindingsInput = {
  cwd: string;
  /** OverlayFs root for inspectBash (defaults to `cwd`). */
  inspectCwd?: string;
  outputDir: string;
  runId: string;
  modelId: string;
  findings: Finding[];
  reviewSummary: string;
  diff: CollectedDiff;
  commitMessage?: string;
  pipelineHooks?: ToolPipelineHooks;
  generateTextFn?: typeof generateText;
  testModel?: boolean;
  /** Skip writing remediation dirs (unit tests). */
  skipArtifacts?: boolean;
  quiet?: boolean;
  /** Max concurrent analyst sessions (default 4). */
  analystConcurrency?: number;
  /** Prior same-HEAD review/remediation context (opt-in). */
  workstreamContext?: string;
  /** Formatted skill catalog + activated bodies. */
  skillSystem?: string;
  /** Formatted custom instructions from config. */
  instructionsSystem?: string;
};

export type AnalyzeFindingsResult = {
  findings: PersistedFinding[];
  /** Findings that failed structured output / triage. */
  failedIndexes: number[];
};

type TriageOneResult = {
  finding: Finding & { decision?: AnalystDecision };
  failed: boolean;
  verdict?: "ignore" | "remediate";
};

function stampDecision(
  llm: AnalystLlmOutput,
  identity: {
    agentId: string;
    agentName: string;
    staticHash: string;
    invocationHash: string;
  },
  remediationPath?: string,
): AnalystDecision {
  if (llm.verdict === "ignore") {
    return {
      ...identity,
      verdict: "ignore",
      rationale: llm.rationale,
    };
  }
  if (remediationPath === undefined) {
    throw new Error("remediationPath required for remediate verdict");
  }
  return {
    ...identity,
    verdict: "remediate",
    task: llm.task,
    rationale: llm.rationale,
    remediationPath,
  };
}

async function triageOneFinding(input: {
  finding: Finding;
  index: number;
  total: number;
  agent: RegisteredAgent;
  model: LanguageModel | string;
  cwd: string;
  inspectCwd?: string;
  outputDir: string;
  runId: string;
  reviewSummary: string;
  diff: CollectedDiff;
  commitMessage?: string;
  pipelineHooks?: ToolPipelineHooks;
  generateTextFn?: typeof generateText;
  skipArtifacts?: boolean;
  quiet?: boolean;
  workstreamContext?: string;
  skillSystem?: string;
  instructionsSystem?: string;
}): Promise<TriageOneResult> {
  const { finding, index: i, total } = input;
  const loc = finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;
  logStatus(
    input.quiet,
    `analyst working on finding ${i + 1}/${total} (${finding.severity} ${loc})…`,
  );
  const prompt = [
    "Triage the following review finding.",
    'Return structured output with verdict "ignore" or "remediate".',
    "Favor remediate for substantive quality findings (correctness, contracts, observability, security, missing confirmation) even if nothing is fully broken yet.",
    "Ignore only false positives, pure style, speculation, or issues already fixed by the diff/message.",
    'For ignore: { verdict: "ignore", rationale }.',
    'For remediate: { verdict: "remediate", task, rationale, steps } where steps is a non-empty string array of concrete actions.',
    "Keep fields short and concrete. Do not invent extra keys (no decision, comment, drivers, consequences).",
    "Prefer the finding and diff below; use inspectBash at most once if needed.",
    input.workstreamContext ?? null,
    input.commitMessage !== undefined ? `Commit message:\n${input.commitMessage}` : null,
    `Review summary: ${input.reviewSummary}`,
    `Finding[${i}]: ${finding.severity} at ${loc}${finding.rule ? ` [${finding.rule}]` : ""}`,
    finding.message,
    "",
    "Diff context (may be truncated):",
    input.diff.diff.slice(0, 40_000),
  ]
    .filter((part): part is string => part !== null)
    .join("\n");

  try {
    const generated = await withRetry(() =>
      capabilitiesGenerateText({
        agent: input.agent,
        env: { cwd: input.inspectCwd ?? input.cwd },
        pipelineHooks: input.pipelineHooks,
        runId: `${input.runId}-analyst-${i}`,
        model: input.model,
        system: joinSystemParts(input.skillSystem, input.instructionsSystem),
        prompt,
        outputSchema: analystLlmOutputSchema,
        maxSteps: 4,
        generateTextFn: input.generateTextFn,
      }),
    );

    if (generated.output === null || generated.output === undefined) {
      throw new Error(`analyst returned no structured output for finding[${i}]`);
    }
    const llm = analystLlmOutputSchema.parse(generated.output);
    const invocationHash = generated.link.invocationHash ?? generated.link.runtimeHash;
    const identity = {
      agentId: input.agent.agentId,
      agentName: input.agent.name,
      staticHash: generated.link.staticHash,
      invocationHash,
    };

    if (llm.verdict === "ignore") {
      logStatus(input.quiet, `analyst finding ${i + 1}/${total}: ignore`);
      return {
        finding: {
          ...finding,
          decision: stampDecision(llm, identity),
        },
        failed: false,
        verdict: "ignore",
      };
    }

    let remediationPath: string | undefined;
    if (input.skipArtifacts !== true) {
      const markdown = renderRemediationPlanMd({
        task: llm.task,
        runId: input.runId,
        findingIndex: i,
        invocationHash,
        agentId: input.agent.agentId,
        finding,
        reviewSummary: input.reviewSummary,
        llm,
      });
      const written = writeRemediationPlan({
        outputDir: input.outputDir,
        runId: input.runId,
        findingIndex: i,
        markdown,
      });
      remediationPath = written.relativePath;
    } else {
      remediationPath = `reviews/${input.runId}/remediations/${i}`;
    }

    logStatus(input.quiet, `analyst finding ${i + 1}/${total}: remediate (${llm.task})`);
    return {
      finding: {
        ...finding,
        decision: stampDecision(llm, identity, remediationPath),
      },
      failed: false,
      verdict: "remediate",
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logStatus(input.quiet, `analyst finding ${i + 1}/${total} failed: ${errMsg}`);
    return { finding: { ...finding }, failed: true };
  }
}

export async function analyzeFindings(input: AnalyzeFindingsInput): Promise<AnalyzeFindingsResult> {
  if (input.findings.length === 0) {
    logStatus(input.quiet, "analyst skipped (no findings)");
    return { findings: [], failedIndexes: [] };
  }

  const total = input.findings.length;
  const concurrency = Math.max(1, input.analystConcurrency ?? 4);
  logStatus(
    input.quiet,
    `analyst starting (${total} finding${total === 1 ? "" : "s"}, concurrency=${Math.min(concurrency, total)})…`,
  );

  const defined = await defineAnalystAgent();
  await ensureAgentRegistered(defined.agent);

  const model: LanguageModel | string = input.testModel
    ? input.modelId.trim() || "test-model"
    : resolveGatewayModel(input.modelId);

  const results = await mapPool(input.findings, concurrency, (finding, i) =>
    triageOneFinding({
      finding,
      index: i,
      total,
      agent: defined.agent,
      model,
      cwd: input.cwd,
      ...(input.inspectCwd !== undefined ? { inspectCwd: input.inspectCwd } : {}),
      outputDir: input.outputDir,
      runId: input.runId,
      reviewSummary: input.reviewSummary,
      diff: input.diff,
      commitMessage: input.commitMessage,
      pipelineHooks: input.pipelineHooks,
      generateTextFn: input.generateTextFn,
      skipArtifacts: input.skipArtifacts,
      quiet: input.quiet,
      workstreamContext: input.workstreamContext,
      skillSystem: input.skillSystem,
      instructionsSystem: input.instructionsSystem,
    }),
  );

  const persisted: Array<Finding & { decision?: AnalystDecision }> = [];
  const failedIndexes: number[] = [];
  let remediateCount = 0;
  let ignoreCount = 0;

  for (let i = 0; i < results.length; i++) {
    const row = results[i];
    if (row === undefined) continue;
    persisted.push(row.finding);
    if (row.failed) failedIndexes.push(i);
    else if (row.verdict === "remediate") remediateCount += 1;
    else if (row.verdict === "ignore") ignoreCount += 1;
  }

  logStatus(
    input.quiet,
    `analyst finished (remediate=${remediateCount}, ignore=${ignoreCount}, failed=${failedIndexes.length})`,
  );
  return {
    findings: stampFindingFingerprints(persisted),
    failedIndexes,
  };
}
