import type { ToolPipelineHooks } from "@khoralabs/agent-capabilities";
import type { generateText } from "ai";

import {
  type AgentBackend,
  type AgentBackendConfig,
  DEFAULT_AGENT_BACKEND_CONFIG,
  resolveAgentBackend,
} from "../agent-backend/index.ts";
import type { LlmConfig } from "../config.ts";
import type { CollectedDiff } from "../lib/git.ts";
import { DEFAULT_LLM_CONFIG } from "../llm/index.ts";
import { type ReviewResult, reviewResultSchema } from "../schema/index.ts";
import { formatSkillSystem, type SkillRecord } from "../skills/index.ts";

export type RunReviewAgentInput = {
  cwd: string;
  /** OverlayFs root for inspectBash (defaults to `cwd`). */
  inspectCwd?: string;
  runId: string;
  modelId: string;
  llm?: LlmConfig;
  agent?: AgentBackendConfig;
  /** Injected backend (tests); skips resolveAgentBackend. */
  backend?: AgentBackend;
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
  agentId: string;
  agentName: string;
  agent?: Awaited<ReturnType<typeof import("../agents/index.ts").defineReviewAgent>>["agent"];
};

export async function runReviewAgent(input: RunReviewAgentInput): Promise<RunReviewAgentResult> {
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

  const backend =
    input.backend ??
    resolveAgentBackend({
      agent: input.agent ?? DEFAULT_AGENT_BACKEND_CONFIG,
      llm: input.llm ?? DEFAULT_LLM_CONFIG,
      ...(input.generateTextFn !== undefined ? { generateTextFn: input.generateTextFn } : {}),
      ...(input.testModel !== undefined ? { testModel: input.testModel } : {}),
    });

  const generated = await backend.run({
    role: "review",
    runId: input.runId,
    cwd: input.cwd,
    ...(input.inspectCwd !== undefined ? { inspectCwd: input.inspectCwd } : {}),
    system,
    prompt,
    outputSchema: reviewResultSchema,
    modelId: input.modelId,
    ...(input.pipelineHooks !== undefined ? { pipelineHooks: input.pipelineHooks } : {}),
  });

  return {
    result: generated.output,
    staticHash: generated.link.staticHash,
    runtimeHash: generated.link.runtimeHash,
    invocationHash: generated.link.invocationHash,
    agentId: generated.agentId,
    agentName: generated.agentName,
    ...(generated.agent !== undefined ? { agent: generated.agent } : {}),
  };
}
