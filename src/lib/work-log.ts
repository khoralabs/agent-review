import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { toRepoRelativePath } from "./artifacts.ts";
import { resolveOutputDir } from "./observability.ts";
import { PLAN_FILENAME, remediationRelativePath, reviewsRoot } from "./paths.ts";

export const workLogEventSchema = z.enum(["started", "note", "artifact", "status", "done"]);

export const workLogStatusSchema = z.enum(["proposed", "in_progress", "blocked", "done"]);

export const workLogEntryInputSchema = z
  .object({
    event: workLogEventSchema,
    message: z.string().min(1),
    artifact: z.string().min(1).optional(),
    status: workLogStatusSchema.optional(),
    agent: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.event === "artifact" && value.artifact === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "event=artifact requires --path (artifact relative path)",
        path: ["artifact"],
      });
    }
    if (value.event === "status" && value.status === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "event=status requires --status",
        path: ["status"],
      });
    }
  });

export type WorkLogEvent = z.infer<typeof workLogEventSchema>;
export type WorkLogStatus = z.infer<typeof workLogStatusSchema>;
export type WorkLogEntryInput = z.infer<typeof workLogEntryInputSchema>;

export type WorkLogEntry = WorkLogEntryInput & {
  at: string;
};

export type ResolveRemediationDirInput = {
  cwd: string;
  outputDir: string;
  remediation: string;
};

export type ResolveRemediationDirResult = {
  absoluteDir: string;
  relativeDir: string;
  planPath: string;
  workLogPath: string;
  relativeWorkLogPath: string;
};

function isUnderRoot(absolutePath: string, root: string): boolean {
  const resolved = path.resolve(absolutePath);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a remediation directory under `reviews/<runId>/remediations/<index>`.
 *
 * Accepts:
 * - `reviews/<runId>/remediations/<index>`
 * - `<runId>/<index>`
 * - absolute path under `reviews/`
 */
export function resolveRemediationDir(
  input: ResolveRemediationDirInput,
): ResolveRemediationDirResult {
  const raw = input.remediation.trim();
  if (raw.length === 0) throw new Error("--remediation is required");

  const outputDir = resolveOutputDir(input.cwd, input.outputDir);
  const root = reviewsRoot(outputDir);

  let absoluteDir: string;
  if (path.isAbsolute(raw)) {
    absoluteDir = path.resolve(raw);
  } else if (raw.startsWith("reviews/") || raw.startsWith(`reviews${path.sep}`)) {
    absoluteDir = path.resolve(outputDir, raw);
  } else {
    const normalized = raw.replace(/\\/g, "/");
    const parts = normalized.split("/").filter((p) => p.length > 0);
    if (parts.length === 2) {
      const [runId, index] = parts;
      if (runId !== undefined && index !== undefined && /^\d+$/.test(index)) {
        absoluteDir = path.join(outputDir, remediationRelativePath(runId, Number(index)));
      } else {
        absoluteDir = path.resolve(input.cwd, raw);
      }
    } else {
      absoluteDir = path.resolve(input.cwd, raw);
    }
  }

  absoluteDir = path.resolve(absoluteDir);
  if (!isUnderRoot(absoluteDir, root)) {
    throw new Error(`remediation path escapes reviews directory: ${absoluteDir}`);
  }

  const planPath = path.join(absoluteDir, PLAN_FILENAME);
  if (!existsSync(absoluteDir)) {
    throw new Error(`remediation directory not found: ${absoluteDir}`);
  }
  if (!existsSync(planPath)) {
    throw new Error(`remediation plan.md not found: ${planPath}`);
  }

  const workLogPath = path.join(absoluteDir, "work-log.jsonl");
  return {
    absoluteDir,
    relativeDir: toRepoRelativePath(input.cwd, absoluteDir),
    planPath,
    workLogPath,
    relativeWorkLogPath: toRepoRelativePath(input.cwd, workLogPath),
  };
}

export type AppendWorkLogInput = {
  cwd: string;
  outputDir: string;
  remediation: string;
  entry: WorkLogEntryInput;
  at?: Date;
};

export type AppendWorkLogResult = {
  entry: WorkLogEntry;
  workLogPath: string;
  relativeWorkLogPath: string;
  remediationDir: string;
  relativeRemediationDir: string;
};

export function appendWorkLog(input: AppendWorkLogInput): AppendWorkLogResult {
  const parsed = workLogEntryInputSchema.parse(input.entry);
  const resolved = resolveRemediationDir({
    cwd: input.cwd,
    outputDir: input.outputDir,
    remediation: input.remediation,
  });

  const status = parsed.event === "done" ? (parsed.status ?? "done") : parsed.status;

  const entry: WorkLogEntry = {
    at: (input.at ?? new Date()).toISOString(),
    event: parsed.event,
    message: parsed.message,
    ...(parsed.artifact !== undefined ? { artifact: parsed.artifact } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(parsed.agent !== undefined ? { agent: parsed.agent } : {}),
  };

  appendFileSync(resolved.workLogPath, `${JSON.stringify(entry)}\n`, "utf8");

  return {
    entry,
    workLogPath: resolved.workLogPath,
    relativeWorkLogPath: resolved.relativeWorkLogPath,
    remediationDir: resolved.absoluteDir,
    relativeRemediationDir: resolved.relativeDir,
  };
}
