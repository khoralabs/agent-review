import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  packagedExampleConfigPath,
  packagedOperatorSkillPath,
  resolvePackageRoot,
} from "./package-root.ts";

export type InitOptions = {
  cwd?: string;
  force?: boolean;
  /** Injectable for tests. */
  runSkillsCli?: (
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) => { exitCode: number; stdout: string; stderr: string };
};

export type InitResult = {
  configPath: string;
  configWritten: boolean;
  hookPath: string;
  hookWritten: boolean;
  skillPath: string;
  skillWritten: boolean;
  messages: string[];
};

const COMMIT_MSG_HOOK = `#!/usr/bin/env sh
set -e
cd "$(git rev-parse --show-toplevel)"
bunx agent-review run --scope staged --include-workstream --message-file "$1"
`;

function writeIfNeeded(dest: string, contents: string, force: boolean, mode?: number): boolean {
  if (existsSync(dest) && !force) return false;
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, contents, mode !== undefined ? { mode } : undefined);
  if (mode !== undefined) {
    try {
      chmodSync(dest, mode);
    } catch {
      // Best-effort: some filesystems ignore or reject chmod after write.
    }
  }
  return true;
}

function defaultSkillsCliRunner(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv },
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bunx", "skills", ...args], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function installOperatorSkill(opts: {
  cwd: string;
  force: boolean;
  runSkillsCli: NonNullable<InitOptions["runSkillsCli"]>;
}): boolean {
  const skillPath = path.join(opts.cwd, ".agents", "skills", "agent-review");
  if (existsSync(skillPath) && !opts.force) return false;

  const packageRoot = resolvePackageRoot();
  const leaf = packagedOperatorSkillPath();
  if (!existsSync(path.join(leaf, "SKILL.md"))) {
    throw new Error(`operator skill not found at ${leaf}`);
  }

  if (opts.force && existsSync(skillPath)) {
    const remove = opts.runSkillsCli(["remove", "agent-review", "-y"], { cwd: opts.cwd });
    if (remove.exitCode !== 0) {
      console.warn(
        `skills remove exited ${remove.exitCode}: ${remove.stderr.trim() || remove.stdout.trim()}`,
      );
    }
  }

  const add = opts.runSkillsCli(["add", packageRoot, "--skill", "agent-review", "-y"], {
    cwd: opts.cwd,
  });
  if (add.exitCode !== 0) {
    throw new Error(
      `bunx skills add failed (${add.exitCode}): ${add.stderr.trim() || add.stdout.trim()}`,
    );
  }
  if (!existsSync(path.join(skillPath, "SKILL.md"))) {
    throw new Error(
      `bunx skills add reported success but ${skillPath}/SKILL.md is missing:\n${add.stdout}\n${add.stderr}`,
    );
  }
  return true;
}

/** Scaffold config, husky commit-msg hook, and operator skill for a consumer repo. */
export function runInit(options: InitOptions = {}): InitResult {
  const cwd = options.cwd ?? process.cwd();
  const force = options.force === true;
  const messages: string[] = [];
  const runSkillsCli = options.runSkillsCli ?? defaultSkillsCliRunner;

  const configPath = path.join(cwd, ".agent-review.json");
  const examplePath = packagedExampleConfigPath();
  const example = existsSync(examplePath)
    ? readFileSync(examplePath, "utf8")
    : `${JSON.stringify(
        {
          model: "google/gemini-3.5-flash",
          skillsDirs: [".agents/skills"],
          blockOn: ["error"],
          maxDiffBytes: 200000,
          defaultScope: "staged",
          outputDir: ".data/agent-review",
          analystConcurrency: 4,
          includeWorkstream: false,
          skip: false,
        },
        null,
        2,
      )}\n`;
  const configWritten = writeIfNeeded(configPath, example, force);
  messages.push(
    configWritten
      ? `wrote ${path.relative(cwd, configPath) || ".agent-review.json"}`
      : `kept existing ${path.relative(cwd, configPath) || ".agent-review.json"} (use --force to overwrite)`,
  );

  const hookPath = path.join(cwd, ".husky", "commit-msg");
  let hookWritten = false;
  if (existsSync(path.join(cwd, ".husky")) || force) {
    mkdirSync(path.join(cwd, ".husky"), { recursive: true });
    hookWritten = writeIfNeeded(hookPath, COMMIT_MSG_HOOK, force, 0o755);
    messages.push(
      hookWritten
        ? `wrote ${path.relative(cwd, hookPath)}`
        : `kept existing ${path.relative(cwd, hookPath)} (use --force to overwrite)`,
    );
  } else {
    messages.push("skipped husky commit-msg (no .husky/; run bunx husky then re-run init)");
  }

  const skillPath = path.join(cwd, ".agents", "skills", "agent-review");
  const skillWritten = installOperatorSkill({ cwd, force, runSkillsCli });
  messages.push(
    skillWritten
      ? `installed operator skill at ${path.relative(cwd, skillPath)}`
      : `kept existing ${path.relative(cwd, skillPath)} (use --force to overwrite)`,
  );

  messages.push("");
  messages.push("Next steps:");
  messages.push("  1. Add AI_GATEWAY_API_KEY to .env");
  messages.push("  2. Optional package.json scripts:");
  messages.push('       "agent-review": "agent-review",');
  messages.push('       "review": "agent-review run --scope staged --include-workstream"');
  messages.push("  3. Commit with husky enabled to run the review pipeline");

  return {
    configPath,
    configWritten,
    hookPath,
    hookWritten,
    skillPath,
    skillWritten,
    messages,
  };
}
