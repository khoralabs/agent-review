import type { RegisteredAgent } from "@khoralabs/agent-capabilities";

export type AgentDefinition = {
  staticHash: string;
  agent: RegisteredAgent;
};
