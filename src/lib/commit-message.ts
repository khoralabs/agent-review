import fs from "node:fs";

import type { DiffScope } from "./git.ts";

/**
 * Strip git commit-template comment lines (`# …`) and trim.
 */
export function normalizeCommitMessage(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function readCommitMessageFile(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  return normalizeCommitMessage(raw);
}

export type ResolveCommitMessageInput = {
  cwd: string;
  scope: DiffScope;
  commit?: string;
  /** Explicit message text (wins over file / git). */
  message?: string;
  /** Path to COMMIT_EDITMSG-style file. */
  messageFile?: string;
  /** Inject for tests. */
  gitLogMessageFn?: (rev: string, cwd: string) => Promise<string | undefined>;
};

async function defaultGitLogMessage(rev: string, cwd: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "log", "-1", "--format=%B", rev], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return undefined;
  const text = normalizeCommitMessage(stdout);
  return text.length > 0 ? text : undefined;
}

/**
 * Resolve intended / reviewed commit message for prompt context.
 * Prefer explicit `--message` / `--message-file`; for `scope=commit` fall back to `git log`.
 */
export async function resolveCommitMessage(
  input: ResolveCommitMessageInput,
): Promise<string | undefined> {
  const explicit = input.message?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return normalizeCommitMessage(explicit);
  }

  const filePath = input.messageFile?.trim();
  if (filePath !== undefined && filePath.length > 0) {
    try {
      const fromFile = readCommitMessageFile(filePath);
      if (fromFile.length > 0) return fromFile;
    } catch {
      /* missing file — fall through */
    }
  }

  if (input.scope === "commit") {
    const rev = input.commit?.trim() || "HEAD";
    const gitLog = input.gitLogMessageFn ?? defaultGitLogMessage;
    return gitLog(rev, input.cwd);
  }

  return undefined;
}
