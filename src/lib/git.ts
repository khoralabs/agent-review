export type DiffScope = "staged" | "unstaged" | "working" | "range" | "commit" | "stdin";

export type CollectDiffInput = {
  scope: DiffScope;
  base?: string;
  head?: string;
  /** Commit-ish for scope=commit (default HEAD). */
  commit?: string;
  cwd?: string;
  maxDiffBytes?: number;
  /** Pre-read stdin content when scope is stdin. */
  stdinText?: string;
};

export type CollectedDiff = {
  files: string[];
  diff: string;
  truncated: boolean;
  empty: boolean;
};

export type GitCommand = {
  nameStatus: string[];
  diff: string[];
};

/**
 * Pure helper: git argv for a scope (before root-commit fallback).
 * For `commit`, uses two-dot `<rev>^..<rev>`.
 */
export function gitArgsForScope(input: {
  scope: DiffScope;
  base?: string;
  head?: string;
  commit?: string;
}): GitCommand {
  if (input.scope === "staged") {
    return {
      nameStatus: ["diff", "--cached", "--name-status"],
      diff: ["diff", "--cached"],
    };
  }
  if (input.scope === "unstaged") {
    return {
      nameStatus: ["diff", "--name-status"],
      diff: ["diff"],
    };
  }
  if (input.scope === "working") {
    throw new Error("working scope uses multiple git invocations");
  }
  if (input.scope === "stdin") {
    throw new Error("stdin scope does not use git");
  }
  if (input.scope === "range") {
    const base = input.base?.trim();
    const head = input.head?.trim() || "HEAD";
    if (!base) throw new Error("--base is required for scope=range");
    const range = `${base}...${head}`;
    return {
      nameStatus: ["diff", "--name-status", range],
      diff: ["diff", range],
    };
  }
  if (input.scope === "commit") {
    const rev = input.commit?.trim() || "HEAD";
    const range = `${rev}^..${rev}`;
    return {
      nameStatus: ["diff", "--name-status", range],
      diff: ["diff", range],
    };
  }
  throw new Error(`unknown scope: ${String(input.scope)}`);
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || `exit ${exitCode}`}`);
  }
  return stdout;
}

async function tryRunGit(
  args: string[],
  cwd: string,
): Promise<{ ok: true; stdout: string } | { ok: false; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return { ok: false, stderr: stderr.trim() };
  return { ok: true, stdout };
}

function truncateDiff(diff: string, maxDiffBytes: number): { diff: string; truncated: boolean } {
  const bytes = Buffer.byteLength(diff, "utf8");
  if (bytes <= maxDiffBytes) return { diff, truncated: false };
  let cut = diff.slice(0, maxDiffBytes);
  const lastNl = cut.lastIndexOf("\n");
  if (lastNl > 0) cut = cut.slice(0, lastNl);
  return {
    diff: `${cut}\n\n[diff truncated at ${maxDiffBytes} bytes]`,
    truncated: true,
  };
}

function parseNameStatus(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\t/);
      return parts[parts.length - 1] ?? line;
    });
}

async function collectCommitDiff(
  rev: string,
  cwd: string,
): Promise<{ nameStatus: string; diffText: string }> {
  const cmds = gitArgsForScope({ scope: "commit", commit: rev });
  const diffResult = await tryRunGit(cmds.diff, cwd);
  if (diffResult.ok) {
    const nameStatus = await runGit(cmds.nameStatus, cwd);
    return { nameStatus, diffText: diffResult.stdout };
  }

  // Root commit: parent does not exist.
  const showPatch = await tryRunGit(["show", "--format=", "--patch", rev], cwd);
  if (!showPatch.ok) {
    throw new Error(`git diff for commit ${rev} failed: ${diffResult.stderr || showPatch.stderr}`);
  }
  const nameStatus = await runGit(
    ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", rev],
    cwd,
  );
  return { nameStatus, diffText: showPatch.stdout };
}

export async function collectDiff(input: CollectDiffInput): Promise<CollectedDiff> {
  const cwd = input.cwd ?? process.cwd();
  const maxDiffBytes = input.maxDiffBytes ?? 200_000;

  if (input.scope === "stdin") {
    const raw = input.stdinText ?? "";
    const { diff, truncated } = truncateDiff(raw, maxDiffBytes);
    const files = [
      ...new Set(
        [...raw.matchAll(/^\+\+\+\s+[ab]\/(.+)$/gm)].map((m) => m[1] ?? "").filter(Boolean),
      ),
    ];
    return { files, diff, truncated, empty: raw.trim().length === 0 };
  }

  let nameStatus = "";
  let diffText = "";

  if (input.scope === "staged") {
    const cmds = gitArgsForScope({ scope: "staged" });
    nameStatus = await runGit(cmds.nameStatus, cwd);
    diffText = await runGit(cmds.diff, cwd);
  } else if (input.scope === "unstaged") {
    const cmds = gitArgsForScope({ scope: "unstaged" });
    nameStatus = await runGit(cmds.nameStatus, cwd);
    diffText = await runGit(cmds.diff, cwd);
  } else if (input.scope === "working") {
    const stagedNames = await runGit(["diff", "--cached", "--name-status"], cwd);
    const unstagedNames = await runGit(["diff", "--name-status"], cwd);
    const stagedDiff = await runGit(["diff", "--cached"], cwd);
    const unstagedDiff = await runGit(["diff"], cwd);
    nameStatus = [stagedNames, unstagedNames].filter(Boolean).join("\n");
    diffText = [stagedDiff, unstagedDiff].filter((d) => d.trim().length > 0).join("\n");
  } else if (input.scope === "range") {
    const cmds = gitArgsForScope({
      scope: "range",
      base: input.base,
      head: input.head,
    });
    nameStatus = await runGit(cmds.nameStatus, cwd);
    diffText = await runGit(cmds.diff, cwd);
  } else if (input.scope === "commit") {
    const rev = input.commit?.trim() || "HEAD";
    const collected = await collectCommitDiff(rev, cwd);
    nameStatus = collected.nameStatus;
    diffText = collected.diffText;
  } else {
    throw new Error(`unknown scope: ${String(input.scope)}`);
  }

  const files = [...new Set(parseNameStatus(nameStatus))];
  const { diff, truncated } = truncateDiff(diffText, maxDiffBytes);
  return {
    files,
    diff,
    truncated,
    empty: files.length === 0 && diffText.trim().length === 0,
  };
}
