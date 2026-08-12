import { tool } from "@khoralabs/agent-capabilities";
import { z } from "zod";

import { assertInspectCommandAllowed, type InspectCommandPolicy } from "./command-policy.ts";
import { runJustBash } from "./just-bash-runner.ts";
import type { ReviewToolkitEnv } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 32_000;

export type InspectBashResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  denied?: boolean;
  reason?: string;
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

export function createInspectBashTool(policy: InspectCommandPolicy = {}) {
  const allowReadonlyGit = policy.allowReadonlyGit === true;
  return tool<
    "inspectBash",
    { command: string; timeoutMs?: number },
    InspectBashResult,
    ReviewToolkitEnv
  >({
    name: "inspectBash",
    description: allowReadonlyGit
      ? "Run a read-only command in just-bash OverlayFs (rg, cat, ls, find, head, and read-only git: status, log, diff, show, blame, rev-parse, shortlog). No host bash. Writes cannot reach the host. Mutating git is blocked."
      : "Run a read-only command in just-bash OverlayFs (e.g. rg, cat, ls, find, head). No host bash. Git and write/destructive commands are blocked; writes cannot reach the host.",
    instructions: allowReadonlyGit
      ? [
          "Use inspectBash to search the repo and run read-only git (status, log, diff, show, blame, rev-parse, shortlog).",
          "Never run mutating git (commit, push, add, reset, checkout, …) or write files.",
        ]
      : [
          "Use inspectBash to read surrounding code for the staged/commit diff.",
          "Never attempt git commands; the host already provided the diff.",
          "Never mutate files.",
        ],
    inputSchema: z.object({
      command: z
        .string()
        .min(1)
        .describe("Inspect-only command to run in just-bash at the repository root."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(60_000)
        .optional()
        .describe("Optional timeout in milliseconds (default 15000, max 60000)."),
    }),
    handler: async (ctx, input) => {
      const allowed = assertInspectCommandAllowed(input.command, policy);
      if (!allowed.ok) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: allowed.reason,
          denied: true,
          reason: allowed.reason,
        };
      }
      const cwd = ctx.env.cwd?.trim();
      if (cwd === undefined || cwd.length === 0) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "review cwd is not configured",
          denied: true,
          reason: "review cwd is not configured",
        };
      }
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      try {
        const result = await runJustBash({
          command: input.command,
          cwd,
          timeoutMs,
          allowReadonlyGit,
        });
        return {
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout: truncate(result.stdout, MAX_OUTPUT_CHARS),
          stderr: truncate(result.stderr, MAX_OUTPUT_CHARS),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: truncate(message, MAX_OUTPUT_CHARS),
        };
      }
    },
  });
}

export const inspectBashTool = createInspectBashTool();
export const commitMessageInspectBashTool = createInspectBashTool({
  allowReadonlyGit: true,
});
