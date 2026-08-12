/**
 * List full commit SHAs in `from..to` (exclusive from, inclusive to), oldest first.
 */
export async function listCommitsInRange(input: {
  cwd: string;
  from: string;
  to: string;
  maxCommits?: number;
  /** Inject for tests. */
  revListFn?: (from: string, to: string, cwd: string) => Promise<string[]>;
}): Promise<string[]> {
  const from = input.from.trim();
  const to = input.to.trim();
  if (from.length === 0) throw new Error("--from is required");
  if (to.length === 0) throw new Error("--to must be a non-empty revision");

  const revList =
    input.revListFn ??
    (async (f: string, t: string, cwd: string) => {
      const proc = Bun.spawn(["git", "rev-list", "--reverse", `${f}..${t}`], {
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
        throw new Error(`git rev-list ${f}..${t} failed: ${stderr.trim() || `exit ${exitCode}`}`);
      }
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    });

  let commits = await revList(from, to, input.cwd);
  const max = input.maxCommits;
  if (max !== undefined && Number.isInteger(max) && max >= 0) {
    commits = commits.slice(0, max);
  }
  return commits;
}

export function formatWalkId(input: { date: Date; fromShort: string; toShort: string }): string {
  const y = input.date.getUTCFullYear().toString().padStart(4, "0");
  const mo = (input.date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = input.date.getUTCDate().toString().padStart(2, "0");
  const h = input.date.getUTCHours().toString().padStart(2, "0");
  const mi = input.date.getUTCMinutes().toString().padStart(2, "0");
  const s = input.date.getUTCSeconds().toString().padStart(2, "0");
  const from = sanitizeWalkToken(input.fromShort);
  const to = sanitizeWalkToken(input.toShort);
  return `${y}${mo}${d}T${h}${mi}${s}Z-${from}..${to}`;
}

function sanitizeWalkToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "unknown";
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "-");
  return safe.length > 0 ? safe : "unknown";
}

export async function resolveShortSha(rev: string, cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--short", rev], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return sanitizeWalkToken(rev);
  const short = stdout.trim();
  return short.length > 0 ? sanitizeWalkToken(short) : sanitizeWalkToken(rev);
}

export async function resolveFullSha(rev: string, cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", rev], {
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
    throw new Error(`git rev-parse ${rev} failed: ${stderr.trim() || `exit ${exitCode}`}`);
  }
  const full = stdout.trim();
  if (full.length === 0) throw new Error(`git rev-parse ${rev} returned empty`);
  return full;
}
