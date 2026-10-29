import { registerBuiltInAgentBackends } from "./builtins.ts";

registerBuiltInAgentBackends();

export {
  cliAgentBackendFactory,
  collectCliJsonCandidates,
  createCliAgentBackend,
  parseCliStdout,
} from "./backends/cli.ts";
export { createLlmAgentBackend, llmAgentBackendFactory } from "./backends/llm.ts";
export {
  ensureBuiltInAgentBackends,
  registerBuiltInAgentBackends,
} from "./builtins.ts";
export {
  clearAgentBackendFactoriesForTests,
  getAgentBackendFactory,
  listAgentBackendIds,
  registerAgentBackendFactory,
} from "./registry.ts";
export { type ResolveAgentBackendInput, resolveAgentBackend } from "./resolve.ts";
export {
  type AgentBackend,
  type AgentBackendConfig,
  type AgentBackendCreateContext,
  type AgentBackendFactory,
  type AgentRole,
  type AgentRunLink,
  type AgentRunRequest,
  type AgentRunResult,
  type CliAgentBackendConfig,
  DEFAULT_AGENT_BACKEND_CONFIG,
} from "./types.ts";
