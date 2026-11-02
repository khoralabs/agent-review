import {
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import { createAgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import { trace } from "@opentelemetry/api";
import pino, { type Logger } from "pino";

export const DEFAULT_OUTPUT_DIR = ".data/agent-review";

export type ReviewObservability = {
  runId: string;
  outputDir: string;
  telemetryPath: string;
  logger: Logger;
  telemetry: AgentTelemetry;
};

/**
 * If `<cwd>/../.data` exists (or `<cwd>/.data` is not created yet in a sibling worktree
 * under a shared workspace that has `../.data`), ensure `<cwd>/.data` symlinks to `../.data`
 * so repo-relative paths stay `.data/agent-review/...` while sharing the parent `.data`.
 */
function ensureWorkspaceSharedDataLink(cwd: string): void {
  try {
    const resolvedCwd = path.resolve(cwd);
    const localData = path.join(resolvedCwd, ".data");
    const parentData = path.join(path.dirname(resolvedCwd), ".data");
    if (
      resolvedCwd !== path.dirname(resolvedCwd) &&
      isDirectory(parentData) &&
      !lstatExists(localData)
    ) {
      symlinkSync("../.data", localData, "dir");
    }
  } catch {
    // Best-effort
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function lstatExists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Realpath existing ancestors so missing leaf dirs still compare equal across a symlink. */
function resolveExisting(p: string): string {
  let current = path.resolve(p);
  const missing: string[] = [];
  while (true) {
    try {
      if (existsSync(current)) {
        return missing.length === 0
          ? realpathSync(current)
          : path.join(realpathSync(current), ...missing.reverse());
      }
    } catch {
      // fall through
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(p);
    missing.push(path.basename(current));
    current = parent;
  }
}

export function resolveOutputDir(cwd: string, outputDir?: string): string {
  ensureWorkspaceSharedDataLink(cwd);
  const raw = outputDir?.trim() || DEFAULT_OUTPUT_DIR;
  if (path.isAbsolute(raw)) {
    const localDefault = path.resolve(cwd, DEFAULT_OUTPUT_DIR);
    try {
      if (resolveExisting(localDefault) === resolveExisting(raw)) {
        return localDefault;
      }
    } catch {
      // ignore
    }
    return raw;
  }
  return path.resolve(cwd, raw);
}

/**
 * Pino → telemetry.jsonl + createAgentTelemetry.
 * JSONL destination listens at debug so capability_link hashes are recorded.
 * Does not write to stderr (CLI prints human-readable results separately).
 */
export function createReviewObservability(opts: {
  outputDir: string;
  runId: string;
  serviceName?: string;
}): ReviewObservability {
  const runId = opts.runId.trim();
  if (runId.length === 0) {
    throw new Error("createReviewObservability requires a non-empty runId");
  }
  const outputDir = opts.outputDir;
  mkdirSync(outputDir, { recursive: true });
  const telemetryPath = path.join(outputDir, "telemetry.jsonl");
  const fd = openSync(telemetryPath, "a");

  const serviceName = opts.serviceName ?? "agent-review";
  const logger = pino(
    {
      level: "debug",
      name: serviceName,
      base: { runId },
    },
    pino.destination({ dest: fd, sync: true }),
  );

  const tracer = trace.getTracer(serviceName);
  const telemetry = createAgentTelemetry({ logger, tracer });

  return { runId, outputDir, telemetryPath, logger, telemetry };
}
