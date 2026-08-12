import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AnalystLlmRemediate, Finding } from "../schema/index.ts";
import { PLAN_FILENAME, remediationRelativePath } from "./paths.ts";

export { remediationDirName, remediationRelativePath } from "./paths.ts";

export type RenderRemediationPlanInput = {
  task: string;
  runId: string;
  findingIndex: number;
  invocationHash: string;
  agentId: string;
  finding: Finding;
  reviewSummary: string;
  llm: AnalystLlmRemediate;
  date?: Date;
};

/** Remediation workstream markdown — lean plan from analyst triage. */
export function renderRemediationPlanMd(input: RenderRemediationPlanInput): string {
  const date = (input.date ?? new Date()).toISOString().slice(0, 10);
  const hashShort = input.invocationHash.slice(0, 12);
  const loc =
    input.finding.line !== undefined
      ? `${input.finding.file}:${input.finding.line}`
      : input.finding.file;
  const rule = input.finding.rule ? ` (${input.finding.rule})` : "";
  const steps = input.llm.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  return `# ${input.task}

- Date: ${date}
- Deciders: ${input.agentId} (${hashShort})
- Source: reviews/${input.runId}/run.json finding[${input.findingIndex}]

## Context

${input.finding.severity} at ${loc}${rule}: ${input.finding.message}

Review summary: ${input.reviewSummary}

## Why remediate

${input.llm.rationale}

## Steps

${steps}
`;
}

export function writeRemediationPlan(input: {
  outputDir: string;
  runId: string;
  findingIndex: number;
  markdown: string;
}): { absoluteDir: string; relativePath: string; planPath: string } {
  const relativePath = remediationRelativePath(input.runId, input.findingIndex);
  const absoluteDir = path.join(input.outputDir, relativePath);
  mkdirSync(absoluteDir, { recursive: true });
  const planPath = path.join(absoluteDir, PLAN_FILENAME);
  writeFileSync(
    planPath,
    input.markdown.endsWith("\n") ? input.markdown : `${input.markdown}\n`,
    "utf8",
  );
  return { absoluteDir, relativePath, planPath };
}
