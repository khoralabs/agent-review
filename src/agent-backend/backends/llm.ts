import {
  defineAnalystAgent,
  defineCommitMessageAgent,
  defineReviewAgent,
  ensureAgentRegistered,
} from "../../agents/index.ts";
import { capabilitiesGenerateText } from "../../lib/capabilities-generate.ts";
import { DEFAULT_LLM_CONFIG, resolveLanguageModel } from "../../llm/index.ts";
import type {
  AgentBackend,
  AgentBackendCreateContext,
  AgentBackendFactory,
  AgentRole,
  AgentRunRequest,
  AgentRunResult,
} from "../types.ts";

async function defineRoleAgent(role: AgentRole) {
  switch (role) {
    case "review":
      return defineReviewAgent();
    case "analyze":
      return defineAnalystAgent();
    case "commitMessage":
      return defineCommitMessageAgent();
  }
}

export function createLlmAgentBackend(ctx: AgentBackendCreateContext): AgentBackend {
  const llm = ctx.llm ?? DEFAULT_LLM_CONFIG;
  return {
    id: "llm",
    async run<T>(request: AgentRunRequest<T>): Promise<AgentRunResult<T>> {
      const defined = await defineRoleAgent(request.role);
      await ensureAgentRegistered(defined.agent);

      const modelId = request.modelId?.trim() || "test-model";
      const model =
        ctx.testModel === true
          ? modelId
          : resolveLanguageModel(modelId, llm, request.inspectCwd ?? request.cwd);

      const generated = await capabilitiesGenerateText({
        agent: defined.agent,
        env: { cwd: request.inspectCwd ?? request.cwd },
        ...(request.pipelineHooks !== undefined ? { pipelineHooks: request.pipelineHooks } : {}),
        runId: request.runId,
        model,
        system: request.system,
        prompt: request.prompt,
        outputSchema: request.outputSchema,
        ...(request.maxSteps !== undefined ? { maxSteps: request.maxSteps } : {}),
        ...(ctx.generateTextFn !== undefined ? { generateTextFn: ctx.generateTextFn } : {}),
      });

      if (generated.output === null || generated.output === undefined) {
        throw new Error("model returned no structured output");
      }
      const output = request.outputSchema.parse(generated.output);
      return {
        output,
        link: generated.link,
        agentId: defined.agent.agentId,
        agentName: defined.agent.name,
        agent: defined.agent,
      };
    },
  };
}

export const llmAgentBackendFactory: AgentBackendFactory = {
  id: "llm",
  create: createLlmAgentBackend,
};
