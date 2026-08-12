import { Bash, type CommandName, defineCommand, OverlayFs } from "just-bash";

import { assertInspectCommandAllowed, type CommandPolicyResult } from "./command-policy.ts";

const INSPECT_COMMANDS: CommandName[] = [
  "echo",
  "cat",
  "printf",
  "ls",
  "pwd",
  "readlink",
  "head",
  "tail",
  "wc",
  "stat",
  "grep",
  "fgrep",
  "egrep",
  "rg",
  "sed",
  "awk",
  "sort",
  "uniq",
  "cut",
  "tr",
  "find",
  "basename",
  "dirname",
  "jq",
  "yq",
  "diff",
  "file",
  "which",
  "xargs",
  "true",
  "false",
  "help",
];

export type JustBashExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunJustBashInput = {
  command: string;
  cwd: string;
  timeoutMs: number;
  allowReadonlyGit?: boolean;
};

async function spawnArgv(
  argv: [string, ...string[]],
  cwd: string,
  timeoutMs: number,
): Promise<JustBashExecResult> {
  const proc = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PAGER: "cat",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) {
      return {
        stdout,
        stderr: `${stderr}\n${argv[0]} timed out after ${timeoutMs}ms`,
        exitCode: 124,
      };
    }
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

const FORBIDDEN_GIT_OPTIONS = new Set([
  "-c",
  "--config",
  "--exec-path",
  "--git-dir",
  "--work-tree",
  "--paginate",
  "--ext-diff",
  "--textconv",
  "-C",
  "--namespace",
  "--super-prefix",
  "--git-common-dir",
]);

function gitOptionName(arg: string): string {
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    return (eq === -1 ? arg : arg.slice(0, eq)).toLowerCase();
  }
  if (arg.startsWith("-") && arg.length > 1) return arg.slice(0, 2);
  return arg;
}

/** Reject git flags that can run host commands or retarget the repo. */
export function assertReadonlyGitArgs(args: string[]): CommandPolicyResult {
  let seenSubcommand = false;
  for (const raw of args) {
    if (raw === "--") break;
    if (!raw.startsWith("-")) {
      seenSubcommand = true;
      continue;
    }
    const name = gitOptionName(raw);
    if (name === "-p" && !seenSubcommand) {
      return {
        ok: false,
        reason: "git flag -p is not allowed before a subcommand (pager)",
      };
    }
    if (FORBIDDEN_GIT_OPTIONS.has(name)) {
      return { ok: false, reason: `git flag ${name} is not allowed` };
    }
  }
  return assertInspectCommandAllowed(`git ${args.join(" ")}`, {
    allowReadonlyGit: true,
  });
}

function createReadonlyGitCommand(hostCwd: string, timeoutMs: number) {
  return defineCommand("git", async (args) => {
    const allowed = assertReadonlyGitArgs(args);
    if (!allowed.ok) {
      return { stdout: "", stderr: allowed.reason, exitCode: 126 };
    }
    const sub = args.find((arg) => arg !== "--" && !arg.startsWith("-"));
    const aliasOverride =
      sub !== undefined && /^[a-z0-9-]+$/i.test(sub)
        ? (["-c", `alias.${sub}=${sub}`] as const)
        : [];
    return spawnArgv(
      [
        "git",
        "--no-pager",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.pager=cat",
        "-c",
        "diff.external=",
        ...aliasOverride,
        ...args,
      ],
      hostCwd,
      timeoutMs,
    );
  });
}

/** Agent shell: just-bash OverlayFs only. Never host bash/sh. */
export async function runJustBash(input: RunJustBashInput): Promise<JustBashExecResult> {
  const overlay = new OverlayFs({ root: input.cwd, readOnly: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const bash = new Bash({
      fs: overlay,
      cwd: overlay.getMountPoint(),
      commands: INSPECT_COMMANDS,
      customCommands:
        input.allowReadonlyGit === true
          ? [createReadonlyGitCommand(input.cwd, input.timeoutMs)]
          : [],
      executionLimits: { maxExecutionTimeMs: input.timeoutMs },
      // Bun cannot apply just-bash's Node module-hook patches.
      defenseInDepth: false,
    });
    const result = await bash.exec(input.command, {
      signal: controller.signal,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } finally {
    clearTimeout(timer);
  }
}
