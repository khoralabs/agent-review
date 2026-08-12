import { z } from "zod";

import type { AnalystDecision } from "./analyst.ts";

export const findingSeveritySchema = z.enum(["error", "warning", "info"]);

/** LLM-facing finding (no analyst decision / host fingerprint). */
export const findingSchema = z.object({
  severity: findingSeveritySchema,
  /** Stable kebab-case id for the underlying issue in `file` (not a message paraphrase). */
  key: z.string().min(1),
  file: z.string(),
  line: z.number().int().positive().optional(),
  message: z.string(),
  rule: z.string().optional(),
});

export const reviewResultSchema = z.object({
  findings: z.array(findingSchema),
  summary: z.string(),
});

export type FindingSeverity = z.infer<typeof findingSeveritySchema>;
export type Finding = z.infer<typeof findingSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;

/** Persisted finding may include an analyst decision after triage. */
export type PersistedFinding = Finding & {
  /** Host sha256 of normalized key + file + rule (stamped when writing artifacts). */
  fingerprint?: string;
  decision?: AnalystDecision;
};

export type PersistedReviewResult = {
  summary: string;
  findings: PersistedFinding[];
};
