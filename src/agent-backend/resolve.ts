import { ensureBuiltInAgentBackends } from "./builtins.ts";
import { getAgentBackendFactory } from "./registry.ts";
import type { AgentBackend, AgentBackendConfig, AgentBackendCreateContext } from "./types.ts";
import { DEFAULT_AGENT_BACKEND_CONFIG } from "./types.ts";

export type ResolveAgentBackendInput = AgentBackendCreateContext;

/**
 * Look up `agent.backend` and construct a runner instance.
 * Defaults to the `llm` reference backend.
 */
export function resolveAgentBackend(input: ResolveAgentBackendInput): AgentBackend {
  ensureBuiltInAgentBackends();
  const agent: AgentBackendConfig = {
    ...DEFAULT_AGENT_BACKEND_CONFIG,
    ...input.agent,
    ...(input.agent?.cli !== undefined ? { cli: { ...input.agent.cli } } : {}),
  };
  const factory = getAgentBackendFactory(agent.backend);
  return factory.create({ ...input, agent });
}
