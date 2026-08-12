import type { DiffScope } from "./git.ts";

export type ResolveReviewedShortShaInput = {
  cwd: string;
  scope: DiffScope;
  commit?: string;
  base?: string;
  head?: string;
  /** Inject for tests. */
  revParseFn?: (rev: string, cwd: string) => Promise<string | undefined>;
};

export type ResolveReviewGitRefsInput = {
  cwd: string;
  scope: DiffScope;
  commit?: string;
  base?: string;
  head?: string;
  /** Full SHA rev-parse; inject for tests. */
  revParseFn?: (rev: string, cwd: string) => Promise<string | undefined>;
};

export type ReviewGitRefs = {
  /** Full SHA of HEAD at collect time (when resolvable). */
  gitHead?: string;
  /** Resolved full SHA when scope=commit. */
  commit?: string;
  /** Resolved full SHA when scope=range. */
  base?: string;
  /** Resolved full SHA when scope=range. */
  head?: string;
};

/**
 * Pure: which commit-ish to resolve for the run filename hash.
 */
export function reviewedRevForScope(input: {
  scope: DiffScope;
  commit?: string;
  head?: string;
}): string {
  if (input.scope === "commit") {
    return input.commit?.trim() || "HEAD";
  }
  if (input.scope === "range") {
    return input.head?.trim() || "HEAD";
  }
  return "HEAD";
}

/**
 * `YYYYMMDDTHHMMSSZ-<shortSha>` — sortable UTC run id / artifact stem.
 */
export function formatReviewRunId(date: Date, shortSha: string): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const mo = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  const h = date.getUTCHours().toString().padStart(2, "0");
  const mi = date.getUTCMinutes().toString().padStart(2, "0");
  const s = date.getUTCSeconds().toString().padStart(2, "0");
  const sha = sanitizeShaToken(shortSha);
  return `${y}${mo}${d}T${h}${mi}${s}Z-${sha}`;
}

function sanitizeShaToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "unknown";
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "-");
  return safe.length > 0 ? safe : "unknown";
}

async function defaultRevParseShort(rev: string, cwd: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", "--short", rev], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return undefined;
  const short = stdout.trim();
  return short.length > 0 ? short : undefined;
}

async function defaultRevParseFull(rev: string, cwd: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", rev], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return undefined;
  const full = stdout.trim();
  return full.length > 0 ? full : undefined;
}

/**
 * Resolve short SHA for the reviewed revision; falls back to `unknown` or `stdin`.
 */
export async function resolveReviewedShortSha(
  input: ResolveReviewedShortShaInput,
): Promise<string> {
  const revParse = input.revParseFn ?? defaultRevParseShort;
  const rev = reviewedRevForScope({
    scope: input.scope,
    commit: input.commit,
    head: input.head,
  });
  const short = await revParse(rev, input.cwd);
  if (short !== undefined) return sanitizeShaToken(short);
  if (input.scope === "stdin") return "stdin";
  return "unknown";
}

/**
 * Resolve full SHAs for join keys on run artifacts / indexes.
 */
export async function resolveReviewGitRefs(
  input: ResolveReviewGitRefsInput,
): Promise<ReviewGitRefs> {
  const revParse = input.revParseFn ?? defaultRevParseFull;
  const gitHead = await revParse("HEAD", input.cwd);
  const refs: ReviewGitRefs = {};
  if (gitHead !== undefined) refs.gitHead = gitHead;

  if (input.scope === "commit") {
    const rev = input.commit?.trim() || "HEAD";
    const commit = await revParse(rev, input.cwd);
    if (commit !== undefined) refs.commit = commit;
    return refs;
  }

  if (input.scope === "range") {
    const baseRev = input.base?.trim();
    const headRev = input.head?.trim() || "HEAD";
    if (baseRev !== undefined && baseRev.length > 0) {
      const base = await revParse(baseRev, input.cwd);
      if (base !== undefined) refs.base = base;
    }
    const head = await revParse(headRev, input.cwd);
    if (head !== undefined) refs.head = head;
  }

  return refs;
}
