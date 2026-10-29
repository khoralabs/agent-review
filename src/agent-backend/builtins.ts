import { cliAgentBackendFactory } from "./backends/cli.ts";
import { llmAgentBackendFactory } from "./backends/llm.ts";
import { listAgentBackendIds, registerAgentBackendFactory } from "./registry.ts";

/** Register built-in agent backends (safe to call repeatedly). */
export function registerBuiltInAgentBackends(): void {
  registerAgentBackendFactory(llmAgentBackendFactory);
  registerAgentBackendFactory(cliAgentBackendFactory);
}

/** Ensure built-ins exist after clearAgentBackendFactoriesForTests. */
export function ensureBuiltInAgentBackends(): void {
  if (!listAgentBackendIds().includes("llm")) {
    registerBuiltInAgentBackends();
  }
}
