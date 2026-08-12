import { z } from "zod";

const analystIdentityFields = {
  agentId: z.string().min(1),
  agentName: z.string().min(1),
  staticHash: z.string().min(1),
  invocationHash: z.string().min(1),
};

export const analystDecisionIgnoreSchema = z.object({
  ...analystIdentityFields,
  verdict: z.literal("ignore"),
  rationale: z.string().min(1),
});

export const analystDecisionRemediateSchema = z.object({
  ...analystIdentityFields,
  verdict: z.literal("remediate"),
  task: z.string().min(1),
  rationale: z.string().min(1),
  remediationPath: z.string().min(1),
});

export const analystDecisionSchema = z.discriminatedUnion("verdict", [
  analystDecisionIgnoreSchema,
  analystDecisionRemediateSchema,
]);

export type AnalystDecision = z.infer<typeof analystDecisionSchema>;

/** LLM output before host stamps identity / remediationPath. */
export const analystLlmIgnoreSchema = z.object({
  verdict: z.literal("ignore"),
  rationale: z.string().min(1),
});

/** Keep remediate output small — Gemini structured output is unreliable on large required objects. */
export const analystLlmRemediateSchema = z.object({
  verdict: z.literal("remediate"),
  /** Short actionable title for the workstream. */
  task: z.string().min(1),
  /** Why this finding should be fixed (not ignored). */
  rationale: z.string().min(1),
  /** Ordered concrete steps to implement the fix. */
  steps: z.array(z.string().min(1)).min(1),
});

export const analystLlmOutputSchema = z.discriminatedUnion("verdict", [
  analystLlmIgnoreSchema,
  analystLlmRemediateSchema,
]);

export type AnalystLlmOutput = z.infer<typeof analystLlmOutputSchema>;
export type AnalystLlmRemediate = z.infer<typeof analystLlmRemediateSchema>;
