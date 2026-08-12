import {
  captureAgentSnapshotEnvelope,
  type RegisteredAgent,
  type ToolPipelineHooks,
} from "@khoralabs/agent-capabilities";
import { toolMapToAiTools } from "@khoralabs/agent-capabilities-ai-sdk";
import { type FlexibleSchema, generateText, type LanguageModel, Output, stepCountIs } from "ai";
import type { z } from "zod";

import type { ReviewToolkitEnv } from "../tools/types.ts";

export const DEFAULT_MAX_STEPS = 16;

export type CapabilitiesGenerateInput<T> = {
  agent: RegisteredAgent;
  env: ReviewToolkitEnv;
  pipelineHooks?: ToolPipelineHooks;
  runId: string;
  model: LanguageModel | string;
  system: string;
  prompt: string;
  outputSchema: z.ZodType<T> | FlexibleSchema<T>;
  maxSteps?: number;
  maxOutputTokens?: number;
  generateTextFn?: typeof generateText;
};

export type CapabilitiesGenerateResult<T> = {
  output: T | undefined | null;
  link: {
    staticHash: string;
    runtimeHash: string;
    invocationHash?: string;
  };
  toolRefs: Array<{ toolKey?: string; key?: string; toolHash: string }>;
};

export function resolveGatewayModel(modelId: string): LanguageModel {
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("AI_GATEWAY_API_KEY environment variable not set");
  }
  const id = modelId.trim();
  if (id.length === 0) throw new Error("model is required");
  return id;
}

/**
 * Shared capture → AI SDK tools → generateText(Output.object) loop.
 */
export async function capabilitiesGenerateText<T>(
  input: CapabilitiesGenerateInput<T>,
): Promise<CapabilitiesGenerateResult<T>> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const pipelineHooks = input.pipelineHooks;

  const capture = await captureAgentSnapshotEnvelope({
    agent: input.agent,
    ctx: {
      env: input.env,
      agentId: input.agent.agentId,
      agentName: input.agent.name,
      ...(pipelineHooks !== undefined ? { pipelineHooks } : {}),
    },
    invocationContext: { runId: input.runId },
    sessionContext: { sessionId: input.runId },
  });

  const aiTools = toolMapToAiTools(capture.evaluatedTools, {
    env: input.env,
    resolvedPolicies: new Map(),
    ...(pipelineHooks !== undefined ? { pipelineHooks } : {}),
  });

  const system = [capture.instructions, input.system]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");

  const runGenerateText = input.generateTextFn ?? generateText;
  const resultBase = {
    link: capture.link,
    toolRefs: capture.toolRefs,
  };

  try {
    const llm = await runGenerateText({
      model: input.model,
      system,
      prompt: input.prompt,
      tools: aiTools,
      stopWhen: stepCountIs(maxSteps),
      prepareStep: ({ stepNumber }) => {
        if (stepNumber >= maxSteps - 1) {
          return { toolChoice: "none" as const };
        }
        return undefined;
      },
      output: Output.object({ schema: input.outputSchema as never }),
      maxOutputTokens: input.maxOutputTokens ?? 8192,
    });

    return {
      ...resultBase,
      output: llm.output as T | null | undefined,
    };
  } catch (err) {
    const recovered = tryRecoverStructuredOutput(err, input.outputSchema);
    if (recovered !== undefined) {
      return { ...resultBase, output: recovered };
    }
    throw err;
  }
}

/** Strip optional ``` / ```json fences around model JSON text. */
export function stripMarkdownJsonFence(text: string): string {
  const trimmed = text.trim();
  const matched = trimmed.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i);
  if (matched?.[1] !== undefined) return matched[1].trim();
  return trimmed;
}

export function tryRecoverStructuredOutput<T>(
  err: unknown,
  schema: CapabilitiesGenerateInput<T>["outputSchema"],
): T | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const text = "text" in err && typeof err.text === "string" ? err.text : null;
  if (text === null || text.trim().length === 0) return undefined;
  if (!("parse" in schema) || typeof schema.parse !== "function") {
    return undefined;
  }
  const candidates = [text, stripMarkdownJsonFence(text)];
  for (const candidate of candidates) {
    try {
      const json: unknown = JSON.parse(candidate);
      return schema.parse(json) as T;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}
