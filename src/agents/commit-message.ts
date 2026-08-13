import { createRegisteredAgent } from "@khoralabs/agent-capabilities";

import { commitMessageToolkit } from "../tools/_toolkit.ts";
import { CONVENTIONAL_COMMITS_SPEC } from "./conventional-commits.ts";
import type { AgentDefinition } from "./types.ts";

export const COMMIT_MESSAGE_AGENT_ID = "agent-review-commit-message";

export type CommitMessageAgentDefinition = AgentDefinition;

const COMMIT_MESSAGE_INSTRUCTIONS = [
  "You draft Conventional Commits 1.0.0 messages for the current change.",
  "Follow Conventional Commits 1.0.0 (included in these instructions).",
  "Start from the host-provided unified diff and file list.",
  "Use inspectBash to search the repo (rg, cat, ls) and run read-only git (status, log, diff, show, blame, rev-parse, shortlog) when that context would improve type, scope, or description.",
  "Never mutate the repository: no git commit/push/add/reset/checkout, no file writes.",
  "After inspecting, always finish with structured output { message } — do not end on a tool call.",
  "message is the full commit message only: type[optional scope][optional !]: description, optional body, optional footers. No quotes, no commentary.",
];

export async function defineCommitMessageAgent(): Promise<CommitMessageAgentDefinition> {
  const { staticHash, agent } = await createRegisteredAgent({
    agentId: COMMIT_MESSAGE_AGENT_ID,
    name: "Agent Review Commit Message",
    instructions: [CONVENTIONAL_COMMITS_SPEC, ...COMMIT_MESSAGE_INSTRUCTIONS],
    context: { role: "agent-review-commit-message" },
    rootComposable: commitMessageToolkit,
  });
  return { staticHash, agent };
}
