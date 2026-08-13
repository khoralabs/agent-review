import { mkdirSync, openSync } from "node:fs";
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

export function resolveOutputDir(cwd: string, outputDir?: string): string {
  const raw = outputDir?.trim() || DEFAULT_OUTPUT_DIR;
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
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
