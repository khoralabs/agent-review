import {
  type AgentRegistry,
  createAgentRegistry,
  type RegisteredAgent,
} from "@khoralabs/agent-capabilities";

let registry: AgentRegistry | undefined;

export function getAgentRegistry(): AgentRegistry {
  if (registry === undefined) registry = createAgentRegistry();
  return registry;
}

export async function ensureAgentRegistered(agent: RegisteredAgent): Promise<void> {
  const reg = getAgentRegistry();
  if (!reg.has(agent.agentId)) {
    await reg.register(agent);
  }
}
