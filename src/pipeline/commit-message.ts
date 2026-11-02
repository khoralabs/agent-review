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
import { joinSystemParts } from "../lib/instructions.ts";
import { DEFAULT_LLM_CONFIG } from "../llm/index.ts";
import { type CommitMessageOutput, commitMessageOutputSchema } from "../schema/index.ts";

export type RunCommitMessageAgentInput = {
  cwd: string;
  runId: string;
  modelId: string;
  llm?: LlmConfig;
  agent?: AgentBackendConfig;
  backend?: AgentBackend;
  diff: CollectedDiff;
  skillSystem: string;
  /** Formatted custom instructions from config. */
  instructionsSystem?: string;
  pipelineHooks?: ToolPipelineHooks;
  generateTextFn?: typeof generateText;
  testModel?: boolean;
};

export type RunCommitMessageAgentResult = {
  result: CommitMessageOutput;
  staticHash: string;
  runtimeHash: string;
  invocationHash?: string;
  agentId: string;
  agentName: string;
  agent?: Awaited<
    ReturnType<typeof import("../agents/index.ts").defineCommitMessageAgent>
  >["agent"];
};

export async function runCommitMessageAgent(
  input: RunCommitMessageAgentInput,
): Promise<RunCommitMessageAgentResult> {
  const fileList =
    input.diff.files.length > 0
      ? input.diff.files.map((f) => `- ${f}`).join("\n")
      : "(no file paths)";
  const prompt = [
    "Draft a Conventional Commits 1.0.0 message for these changes.",
    "Use inspectBash for surrounding code and read-only git history when helpful, then return { message }.",
    "Do not keep inspecting once you have enough context.",
    input.diff.truncated ? "Note: the diff was truncated." : null,
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
    role: "commitMessage",
    runId: input.runId,
    cwd: input.cwd,
    system: joinSystemParts(input.skillSystem, input.instructionsSystem),
    prompt,
    outputSchema: commitMessageOutputSchema,
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
