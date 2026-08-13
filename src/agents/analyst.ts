import { createRegisteredAgent } from "@khoralabs/agent-capabilities";

import { reviewToolkit } from "../tools/_toolkit.ts";
import { CONVENTIONAL_COMMITS_SPEC } from "./conventional-commits.ts";
import type { AgentDefinition } from "./types.ts";

export const ANALYST_AGENT_ID = "agent-review-analyst";

export type AnalystAgentDefinition = AgentDefinition;

const ANALYST_INSTRUCTIONS = [
  "You are a skeptical but quality-seeking triage analyst for code-review findings.",
  "Decide whether each finding justifies remediation work, or should be ignored.",
  "Remediate when the finding is a concrete quality win — not only when something is already broken — especially correctness, contracts, observability/telemetry, security, missing confirmation, and brittle design.",
  "Ignore only false positives, pure style nits, speculation, or issues already addressed by the diff or commit message.",
  "Prefer the finding text, review summary, and provided diff; do not explore the repo unless necessary.",
  "Use inspectBash at most once if surrounding context is missing; never run git or mutate files.",
  "Choose remediate only when the finding is concrete, actionable, and high-signal enough to block or track as a workstream — do not rubber-stamp every nit.",
  "Write verdicts and plans in Simplified Technical English (ASD-STE100).",
  "Always finish with structured output using verdict ignore|remediate — do not end on a tool call.",
];

export async function defineAnalystAgent(): Promise<AnalystAgentDefinition> {
  const { staticHash, agent } = await createRegisteredAgent({
    agentId: ANALYST_AGENT_ID,
    name: "Agent Review Analyst",
    instructions: [CONVENTIONAL_COMMITS_SPEC, ...ANALYST_INSTRUCTIONS],
    context: { role: "agent-review-analyst" },
    rootComposable: reviewToolkit,
  });
  return { staticHash, agent };
}
