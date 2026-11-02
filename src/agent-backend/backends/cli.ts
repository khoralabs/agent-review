import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  stripMarkdownJsonFence,
  tryRecoverStructuredOutput,
} from "../../lib/capabilities-generate.ts";
import type {
  AgentBackend,
  AgentBackendCreateContext,
  AgentBackendFactory,
  AgentRunRequest,
  AgentRunResult,
  CliAgentBackendConfig,
} from "../types.ts";

const DEFAULT_TIMEOUT_MS = 600_000;
const TASK_FILE_PLACEHOLDER = "{{taskFile}}";

const CLI_AGENT_ID = "agent-review-cli";
const CLI_AGENT_NAME = "CLI agent";

function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function schemaToJsonSchema(schema: z.ZodType<unknown>): unknown {
  return z.toJSONSchema(schema);
}

function buildTaskBundle(input: {
  role: string;
  cwd: string;
  system: string;
  prompt: string;
  jsonSchema: unknown;
}): string {
  return [
    `# agent-review task (${input.role})`,
    "",
    "You are running as an external review agent invoked by agent-review.",
    "Complete the task below, then respond with **JSON only** matching the schema.",
    "Do not wrap the JSON in markdown fences unless required by your CLI; prefer raw JSON on stdout.",
    "",
    `Working directory: ${input.cwd}`,
    "",
    "## System",
    input.system.trim().length > 0 ? input.system : "(none)",
    "",
    "## Prompt",
    input.prompt,
    "",
    "## Output JSON Schema",
    "```json",
    JSON.stringify(input.jsonSchema, null, 2),
    "```",
    "",
  ].join("\n");
}

function expandArgs(args: string[], taskFile: string): string[] {
  return args.map((a) =>
    a.includes(TASK_FILE_PLACEHOLDER) ? a.split(TASK_FILE_PLACEHOLDER).join(taskFile) : a,
  );
}

const FENCED_JSON_RE = /```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/gi;

/** Collect plausible JSON strings from mixed CLI stdout (logs + fences + raw). */
export function collectCliJsonCandidates(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  const candidates: string[] = [trimmed, stripMarkdownJsonFence(trimmed)];

  FENCED_JSON_RE.lastIndex = 0;
  let fenceMatch: RegExpExecArray | null = FENCED_JSON_RE.exec(trimmed);
  while (fenceMatch !== null) {
    const body = fenceMatch[1]?.trim();
    if (body !== undefined && body.length > 0) candidates.push(body);
    fenceMatch = FENCED_JSON_RE.exec(trimmed);
  }

  // Try every `{…` suffix (last-first) so nested objects do not steal the
  // outer payload when logs precede structured JSON.
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i] !== "{") continue;
    const fromBrace = trimmed
      .slice(i)
      .replace(/```\s*$/u, "")
      .trim();
    if (fromBrace.length > 0) candidates.push(fromBrace);
  }

  return [...new Set(candidates.filter((c) => c.length > 0))];
}

/** Parse structured output from CLI stdout (exported for unit tests). */
export function parseCliStdout<T>(stdout: string, schema: z.ZodType<T>): T {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error("cli agent returned empty stdout");
  }
  for (const candidate of collectCliJsonCandidates(trimmed)) {
    try {
      const json: unknown = JSON.parse(candidate);
      return schema.parse(json);
    } catch {
      // try next
    }
  }
  const recovered = tryRecoverStructuredOutput(
    { text: trimmed },
    schema as z.ZodType<T> & { parse: (v: unknown) => T },
  );
  if (recovered !== undefined) return recovered;
  throw new Error("cli agent stdout did not match output schema");
}

const KILL_GRACE_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCliProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  stdin: string;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([input.command, ...input.args], {
    cwd: input.cwd,
    env: input.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(input.stdin);
  proc.stdin.end();

  const streamsDone = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));

  if (input.timeoutMs <= 0) {
    return streamsDone;
  }

  let timedOut = false;
  let termTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    termTimer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // already exited
      }
      killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already exited
        }
        // Bound stream drain so hung pipes cannot block forever after kill.
        void Promise.race([streamsDone, sleep(500)]).finally(() => {
          reject(new Error(`cli agent timed out after ${input.timeoutMs}ms`));
        });
      }, KILL_GRACE_MS);
    }, input.timeoutMs);
  });

  try {
    const result = await Promise.race([streamsDone, timeoutPromise]);
    if (timedOut) {
      throw new Error(`cli agent timed out after ${input.timeoutMs}ms`);
    }
    return result;
  } finally {
    if (termTimer !== undefined) clearTimeout(termTimer);
    if (killTimer !== undefined) clearTimeout(killTimer);
  }
}

export function createCliAgentBackend(ctx: AgentBackendCreateContext): AgentBackend {
  const cli = ctx.agent?.cli;
  if (cli === undefined || typeof cli.command !== "string" || cli.command.trim().length === 0) {
    throw new Error('agent.backend "cli" requires agent.cli.command');
  }
  const config: CliAgentBackendConfig = {
    command: cli.command.trim(),
    ...(cli.args !== undefined ? { args: cli.args } : {}),
    ...(cli.timeoutMs !== undefined ? { timeoutMs: cli.timeoutMs } : {}),
    ...(cli.env !== undefined ? { env: cli.env } : {}),
  };

  return {
    id: "cli",
    async run<T>(request: AgentRunRequest<T>): Promise<AgentRunResult<T>> {
      const jsonSchema = schemaToJsonSchema(request.outputSchema as z.ZodType<unknown>);
      const taskText = buildTaskBundle({
        role: request.role,
        cwd: request.cwd,
        system: request.system,
        prompt: request.prompt,
        jsonSchema,
      });

      const staticHash = sha256Hex(
        JSON.stringify({
          command: config.command,
          args: config.args ?? [],
          schema: jsonSchema,
        }),
      );
      const runtimeHash = sha256Hex(`${staticHash}:${request.runId}:${request.role}`);
      const invocationHash = sha256Hex(`${runtimeHash}:${Date.now()}`);

      const tmp = await mkdtemp(path.join(tmpdir(), "agent-review-cli-"));
      const taskFile = path.join(tmp, "task.md");
      try {
        await writeFile(taskFile, taskText, "utf8");
        const rawArgs = config.args ?? [];
        const useTaskFile = rawArgs.some((a) => a.includes(TASK_FILE_PLACEHOLDER));
        const args = useTaskFile ? expandArgs(rawArgs, taskFile) : rawArgs;
        const stdin = useTaskFile ? "" : taskText;

        const { stdout, stderr, exitCode } = await runCliProcess({
          command: config.command,
          args,
          cwd: request.cwd,
          env: {
            ...process.env,
            ...(config.env ?? {}),
            AGENT_REVIEW_ROLE: request.role,
            AGENT_REVIEW_RUN_ID: request.runId,
            AGENT_REVIEW_TASK_FILE: taskFile,
          },
          stdin,
          timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });

        if (exitCode !== 0) {
          const errTail = stderr.trim().slice(-2000);
          throw new Error(
            `cli agent exited ${exitCode}${errTail.length > 0 ? `: ${errTail}` : ""}`,
          );
        }

        const output = parseCliStdout(stdout, request.outputSchema);
        return {
          output,
          link: { staticHash, runtimeHash, invocationHash },
          agentId: CLI_AGENT_ID,
          agentName: CLI_AGENT_NAME,
        };
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

export const cliAgentBackendFactory: AgentBackendFactory = {
  id: "cli",
  create: createCliAgentBackend,
};
