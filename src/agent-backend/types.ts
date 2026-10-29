import type { RegisteredAgent, ToolPipelineHooks } from "@khoralabs/agent-capabilities";
import type { generateText } from "ai";
import type { z } from "zod";

import type { LlmConfig } from "../llm/types.ts";

/** Pipeline role that invokes a structured agent task. */
export type AgentRole = "review" | "analyze" | "commitMessage";

/** CLI subprocess settings when `agent.backend` is `cli`. */
export type CliAgentBackendConfig = {
  command: string;
  args?: string[];
  /** Kill the process after this many ms (default 600_000). */
  timeoutMs?: number;
  /** Extra env merged over `process.env`. */
  env?: Record<string, string>;
};

/** Config slice selecting and tuning the agent runner. */
export type AgentBackendConfig = {
  /** Backend id: `llm` (default) or `cli`. */
  backend: string;
  cli?: CliAgentBackendConfig;
};

export const DEFAULT_AGENT_BACKEND_CONFIG: AgentBackendConfig = {
  backend: "llm",
};

export type AgentRunLink = {
  staticHash: string;
  runtimeHash: string;
  invocationHash?: string;
};

export type AgentRunRequest<T> = {
  role: AgentRole;
  runId: string;
  cwd: string;
  /** OverlayFs root for inspectBash (llm backend; defaults to `cwd`). */
  inspectCwd?: string;
  system: string;
  prompt: string;
  outputSchema: z.ZodType<T>;
  maxSteps?: number;
  pipelineHooks?: ToolPipelineHooks;
  /** Model id for the llm backend (ignored by cli). */
  modelId?: string;
};

export type AgentRunResult<T> = {
  output: T;
  link: AgentRunLink;
  agentId: string;
  agentName: string;
  /** Present for the llm reference backend (capabilities agent). */
  agent?: RegisteredAgent;
};

/** Pluggable runner for review / analyze / commit-message tasks. */
export type AgentBackend = {
  id: string;
  run<T>(request: AgentRunRequest<T>): Promise<AgentRunResult<T>>;
};

/** Context passed when constructing a backend instance from config. */
export type AgentBackendCreateContext = {
  /** When omitted, defaults to `llm`. */
  agent?: AgentBackendConfig;
  llm: LlmConfig;
  /** Test injection for the llm backend. */
  generateTextFn?: typeof generateText;
  testModel?: boolean;
};

export type AgentBackendFactory = {
  id: string;
  create(ctx: AgentBackendCreateContext): AgentBackend;
};
