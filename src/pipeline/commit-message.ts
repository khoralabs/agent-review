import type { ToolPipelineHooks } from "@khoralabs/agent-capabilities";
import type { generateText, LanguageModel } from "ai";

import { defineCommitMessageAgent, ensureAgentRegistered } from "../agents/index.ts";
import { capabilitiesGenerateText, resolveGatewayModel } from "../lib/capabilities-generate.ts";
import type { CollectedDiff } from "../lib/git.ts";
import { type CommitMessageOutput, commitMessageOutputSchema } from "../schema/index.ts";

export type RunCommitMessageAgentInput = {
  cwd: string;
  runId: string;
  modelId: string;
  diff: CollectedDiff;
  skillSystem: string;
  pipelineHooks?: ToolPipelineHooks;
  generateTextFn?: typeof generateText;
  testModel?: boolean;
};

export type RunCommitMessageAgentResult = {
  result: CommitMessageOutput;
  staticHash: string;
  runtimeHash: string;
  invocationHash?: string;
  agent: Awaited<ReturnType<typeof defineCommitMessageAgent>>["agent"];
};

export async function runCommitMessageAgent(
  input: RunCommitMessageAgentInput,
): Promise<RunCommitMessageAgentResult> {
  const defined = await defineCommitMessageAgent();
  await ensureAgentRegistered(defined.agent);

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

  const model: LanguageModel | string = input.testModel
    ? input.modelId.trim() || "test-model"
    : resolveGatewayModel(input.modelId);

  const generated = await capabilitiesGenerateText({
    agent: defined.agent,
    env: { cwd: input.cwd },
    pipelineHooks: input.pipelineHooks,
    runId: input.runId,
    model,
    system: input.skillSystem,
    prompt,
    outputSchema: commitMessageOutputSchema,
    generateTextFn: input.generateTextFn,
  });

  if (generated.output === null || generated.output === undefined) {
    throw new Error("model returned no structured output");
  }
  const result = commitMessageOutputSchema.parse(generated.output);
  return {
    result,
    staticHash: generated.link.staticHash,
    runtimeHash: generated.link.runtimeHash,
    invocationHash: generated.link.invocationHash,
    agent: defined.agent,
  };
}
