import type { AgentBackendFactory } from "./types.ts";

const factories = new Map<string, AgentBackendFactory>();

export function registerAgentBackendFactory(factory: AgentBackendFactory): void {
  const id = factory.id.trim();
  if (id.length === 0) {
    throw new Error("agent backend factory id is required");
  }
  factories.set(id, factory);
}

export function getAgentBackendFactory(backendId: string): AgentBackendFactory {
  if (typeof backendId !== "string") {
    throw new Error("agent.backend must be a string");
  }
  const id = backendId.trim();
  if (id.length === 0) {
    throw new Error("agent.backend is required");
  }
  const factory = factories.get(id);
  if (factory === undefined) {
    const known = listAgentBackendIds();
    const hint = known.length > 0 ? known.join(", ") : "(none registered)";
    throw new Error(`Unknown agent backend "${id}". Known: ${hint}`);
  }
  return factory;
}

export function listAgentBackendIds(): string[] {
  return [...factories.keys()].sort();
}

/** Test helper: clear registry. Built-ins re-register on next resolve. */
export function clearAgentBackendFactoriesForTests(): void {
  factories.clear();
}
