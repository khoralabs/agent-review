import type { ToolPipelineHooks } from "@khoralabs/agent-capabilities";
import type { generateText, LanguageModel } from "ai";

import { defineReviewAgent, ensureAgentRegistered } from "../agents/index.ts";
import { capabilitiesGenerateText, resolveGatewayModel } from "../lib/capabilities-generate.ts";
import type { CollectedDiff } from "../lib/git.ts";
import { type ReviewResult, reviewResultSchema } from "../schema/index.ts";
import { formatSkillSystem, type SkillRecord } from "../skills/index.ts";

export type RunReviewAgentInput = {
  cwd: string;
  /** OverlayFs root for inspectBash (defaults to `cwd`). */
  inspectCwd?: string;
  runId: string;
  modelId: string;
  diff: CollectedDiff;
  commitMessage?: string;
  discoveredSkills: SkillRecord[];
  activatedSkills: SkillRecord[];
  /** Formatted custom instructions from config. */
  instructionsSystem?: string;
  pipelineHooks?: ToolPipelineHooks;
  generateTextFn?: typeof generateText;
  testModel?: boolean;
  /** Prior same-HEAD review/remediation context (opt-in). */
  workstreamContext?: string;
};

export type RunReviewAgentResult = {
  result: ReviewResult;
  staticHash: string;
  runtimeHash: string;
  invocationHash?: string;
  agent: Awaited<ReturnType<typeof defineReviewAgent>>["agent"];
};

export async function runReviewAgent(input: RunReviewAgentInput): Promise<RunReviewAgentResult> {
  const defined = await defineReviewAgent();
  await ensureAgentRegistered(defined.agent);

  const system = [
    formatSkillSystem(input.discoveredSkills, input.activatedSkills),
    input.instructionsSystem ?? "",
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");

  const fileList =
    input.diff.files.length > 0
      ? input.diff.files.map((f) => `- ${f}`).join("\n")
      : "(no file paths)";
  const prompt = [
    "Adversarial quality review of the following changes: seek regressions and high-value improvements (correctness, contracts, observability, tests, security, design), not only obvious breakage.",
    "Use inspectBash sparingly for surrounding context (a few targeted reads), then return structured findings.",
    "Do not keep inspecting once you have enough context — finish with the findings object.",
    "Consider whether the commit message accurately reflects the diff when a message is provided.",
    input.workstreamContext ?? null,
    input.diff.truncated ? "Note: the diff was truncated." : null,
    input.commitMessage !== undefined
      ? ["Commit message:", input.commitMessage, ""].join("\n")
      : null,
    "Files:",
    fileList,
    "",
    "Unified diff:",
    input.diff.diff,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");

  const model: LanguageModel | string = input.testModel
    ? input.modelId.trim() || "test-model"
    : resolveGatewayModel(input.modelId);

  const generated = await capabilitiesGenerateText({
    agent: defined.agent,
    env: { cwd: input.inspectCwd ?? input.cwd },
    pipelineHooks: input.pipelineHooks,
    runId: input.runId,
    model,
    system,
    prompt,
    outputSchema: reviewResultSchema,
    generateTextFn: input.generateTextFn,
  });

  if (generated.output === null || generated.output === undefined) {
    throw new Error("model returned no structured output");
  }
  const result = reviewResultSchema.parse(generated.output);
  return {
    result,
    staticHash: generated.link.staticHash,
    runtimeHash: generated.link.runtimeHash,
    invocationHash: generated.link.invocationHash,
    agent: defined.agent,
  };
}
