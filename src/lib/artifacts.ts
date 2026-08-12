import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PersistedFinding, PersistedReviewResult } from "../schema/index.ts";
import type { SkillDiagnostic } from "../skills/types.ts";
import { findingFingerprint } from "./finding-fingerprint.ts";
import type { DiffScope } from "./git.ts";
import { runArtifactPath, runDiffGzipPath, runDir } from "./paths.ts";

export type ReviewRunArtifact = {
  runId: string;
  scope: DiffScope;
  /** Full SHA of HEAD at collect/persist time. */
  gitHead?: string;
  commit?: string;
  base?: string;
  head?: string;
  staticHash?: string;
  runtimeHash?: string;
  invocationHash?: string;
  exitCode: 0 | 1 | 2;
  ok: boolean;
  summary: string;
  findings: PersistedFinding[];
  files: string[];
  model: string;
  /**
   * In-memory unified diff (loaded from `reviews/<runId>/diff.gz`).
   * Not written into the JSON artifact.
   */
  diff?: string;
  /** True when a gzipped sidecar was written / is expected. */
  diffGzip?: boolean;
  commitMessage?: string;
  truncated?: boolean;
  empty?: boolean;
  error?: string;
  diagnostics: SkillDiagnostic[];
  recordedAt: string;
  /** Repo-root–relative path to this run JSON. */
  artifactPath: string;
};

export type PersistReviewArtifactsInput = {
  /** Repo root used to compute relative artifact paths. */
  cwd: string;
  outputDir: string;
  runId: string;
  scope: DiffScope;
  gitHead?: string;
  commit?: string;
  base?: string;
  head?: string;
  staticHash?: string;
  runtimeHash?: string;
  invocationHash?: string;
  exitCode: 0 | 1 | 2;
  result?: PersistedReviewResult;
  files?: string[];
  model: string;
  diff?: string;
  commitMessage?: string;
  truncated?: boolean;
  empty?: boolean;
  error?: string;
  diagnostics: SkillDiagnostic[];
};

export type WriteRunArtifactResult = {
  artifact: ReviewRunArtifact;
  /** Absolute filesystem path to the run JSON. */
  runPath: string;
  /** Repo-root–relative path to the run JSON. */
  relativeRunPath: string;
  diffGzipPath?: string;
  relativeDiffGzipPath?: string;
};

export type PersistReviewArtifactsResult = WriteRunArtifactResult & {
  reviewsPath: string;
  relativeReviewsPath: string;
  findingsPath: string;
  relativeFindingsPath: string;
};

/** Normalize to a stable repo-relative path (POSIX separators). */
export function toRepoRelativePath(cwd: string, absolutePath: string): string {
  const rel = path.relative(path.resolve(cwd), path.resolve(absolutePath));
  const normalized = rel.split(path.sep).join("/");
  return normalized.length === 0 ? "." : normalized;
}

export { runArtifactPath, runDiffGzipPath, runDir } from "./paths.ts";

/**
 * Ensure each finding has a host fingerprint (and a string key for legacy rows).
 */
export function stampFindingFingerprints(
  findings: Array<{
    severity: PersistedFinding["severity"];
    key?: string;
    file: string;
    line?: number;
    message: string;
    rule?: string;
    fingerprint?: string;
    decision?: PersistedFinding["decision"];
  }>,
): Array<PersistedFinding & { fingerprint: string }> {
  return findings.map((f) => {
    const key = typeof f.key === "string" ? f.key : "";
    return {
      severity: f.severity,
      key,
      file: f.file,
      ...(f.line !== undefined ? { line: f.line } : {}),
      message: f.message,
      ...(f.rule !== undefined ? { rule: f.rule } : {}),
      fingerprint: findingFingerprint({
        key,
        file: f.file,
        rule: f.rule,
      }),
      ...(f.decision !== undefined ? { decision: f.decision } : {}),
    };
  });
}

export function writeDiffGzip(outputDir: string, runId: string, diff: string): string {
  mkdirSync(runDir(outputDir, runId), { recursive: true });
  const diffPath = runDiffGzipPath(outputDir, runId);
  writeFileSync(diffPath, Bun.gzipSync(Buffer.from(diff, "utf8")));
  return diffPath;
}

export function readDiffGzip(outputDir: string, runId: string): string | undefined {
  const diffPath = runDiffGzipPath(outputDir, runId);
  if (!existsSync(diffPath)) return undefined;
  const compressed = readFileSync(diffPath);
  return Buffer.from(Bun.gunzipSync(compressed)).toString("utf8");
}

function buildReviewRunArtifact(
  input: PersistReviewArtifactsInput,
  relativeRunPath: string,
  recordedAt: string,
  opts: { diffGzip: boolean },
): ReviewRunArtifact {
  const findings = stampFindingFingerprints(input.result?.findings ?? []);
  return {
    runId: input.runId,
    scope: input.scope,
    ...(input.gitHead !== undefined ? { gitHead: input.gitHead } : {}),
    ...(input.commit !== undefined ? { commit: input.commit } : {}),
    ...(input.base !== undefined ? { base: input.base } : {}),
    ...(input.head !== undefined ? { head: input.head } : {}),
    ...(input.staticHash !== undefined ? { staticHash: input.staticHash } : {}),
    ...(input.runtimeHash !== undefined ? { runtimeHash: input.runtimeHash } : {}),
    ...(input.invocationHash !== undefined ? { invocationHash: input.invocationHash } : {}),
    exitCode: input.exitCode,
    ok: input.exitCode === 0,
    summary: input.result?.summary ?? (input.error ? "error" : ""),
    findings,
    files: input.files ?? [],
    model: input.model,
    ...(opts.diffGzip ? { diffGzip: true } : {}),
    ...(input.commitMessage !== undefined ? { commitMessage: input.commitMessage } : {}),
    ...(input.truncated !== undefined ? { truncated: input.truncated } : {}),
    ...(input.empty !== undefined ? { empty: input.empty } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    diagnostics: input.diagnostics,
    recordedAt,
    artifactPath: relativeRunPath,
  };
}

/** Overwrite `reviews/<runId>/run.json` (and optional `diff.gz`) without appending reviews.jsonl. */
export function writeRunArtifact(input: PersistReviewArtifactsInput): WriteRunArtifactResult {
  const dir = runDir(input.outputDir, input.runId);
  mkdirSync(dir, { recursive: true });
  const runPath = runArtifactPath(input.outputDir, input.runId);
  const relativeRunPath = toRepoRelativePath(input.cwd, runPath);
  const recordedAt = new Date().toISOString();

  let diffGzipPath: string | undefined;
  let relativeDiffGzipPath: string | undefined;
  const diffText = input.diff;
  const hasDiff = diffText !== undefined;
  if (hasDiff) {
    diffGzipPath = writeDiffGzip(input.outputDir, input.runId, diffText);
    relativeDiffGzipPath = toRepoRelativePath(input.cwd, diffGzipPath);
  }

  const onDisk = buildReviewRunArtifact(input, relativeRunPath, recordedAt, {
    diffGzip: hasDiff,
  });
  writeFileSync(runPath, `${JSON.stringify(onDisk, null, 2)}\n`, "utf8");

  const artifact: ReviewRunArtifact =
    hasDiff && diffText !== undefined ? { ...onDisk, diff: diffText } : onDisk;
  return {
    artifact,
    runPath,
    relativeRunPath,
    ...(diffGzipPath !== undefined ? { diffGzipPath } : {}),
    ...(relativeDiffGzipPath !== undefined ? { relativeDiffGzipPath } : {}),
  };
}

export function appendReviewsIndex(input: {
  cwd: string;
  outputDir: string;
  artifact: ReviewRunArtifact;
  runPath: string;
}): { reviewsPath: string; relativeReviewsPath: string } {
  const reviewsPath = path.join(input.outputDir, "reviews.jsonl");
  const relativeReviewsPath = toRepoRelativePath(input.cwd, reviewsPath);
  const relativeRunPath = toRepoRelativePath(input.cwd, input.runPath);
  const indexLine = {
    runId: input.artifact.runId,
    scope: input.artifact.scope,
    gitHead: input.artifact.gitHead,
    commit: input.artifact.commit,
    base: input.artifact.base,
    head: input.artifact.head,
    staticHash: input.artifact.staticHash,
    runtimeHash: input.artifact.runtimeHash,
    invocationHash: input.artifact.invocationHash,
    exitCode: input.artifact.exitCode,
    ok: input.artifact.ok,
    summary: input.artifact.summary,
    error: input.artifact.error,
    path: relativeRunPath,
    recordedAt: input.artifact.recordedAt,
  };
  appendFileSync(reviewsPath, `${JSON.stringify(indexLine)}\n`, "utf8");
  return { reviewsPath, relativeReviewsPath };
}

export function appendFindingsIndex(input: {
  cwd: string;
  outputDir: string;
  artifact: ReviewRunArtifact;
  runPath: string;
}): { findingsPath: string; relativeFindingsPath: string } {
  const findingsPath = path.join(input.outputDir, "findings.jsonl");
  const relativeFindingsPath = toRepoRelativePath(input.cwd, findingsPath);
  const relativeRunPath = toRepoRelativePath(input.cwd, input.runPath);
  for (const finding of input.artifact.findings) {
    const line = {
      runId: input.artifact.runId,
      fingerprint: finding.fingerprint,
      key: finding.key,
      severity: finding.severity,
      file: finding.file,
      ...(finding.line !== undefined ? { line: finding.line } : {}),
      ...(finding.rule !== undefined ? { rule: finding.rule } : {}),
      ...(finding.decision?.verdict !== undefined ? { verdict: finding.decision.verdict } : {}),
      ...(input.artifact.gitHead !== undefined ? { gitHead: input.artifact.gitHead } : {}),
      ...(input.artifact.staticHash !== undefined ? { staticHash: input.artifact.staticHash } : {}),
      recordedAt: input.artifact.recordedAt,
      path: relativeRunPath,
    };
    appendFileSync(findingsPath, `${JSON.stringify(line)}\n`, "utf8");
  }
  return { findingsPath, relativeFindingsPath };
}

export function persistReviewArtifacts(
  input: PersistReviewArtifactsInput,
): PersistReviewArtifactsResult {
  const written = writeRunArtifact(input);
  const { reviewsPath, relativeReviewsPath } = appendReviewsIndex({
    cwd: input.cwd,
    outputDir: input.outputDir,
    artifact: written.artifact,
    runPath: written.runPath,
  });
  const { findingsPath, relativeFindingsPath } = appendFindingsIndex({
    cwd: input.cwd,
    outputDir: input.outputDir,
    artifact: written.artifact,
    runPath: written.runPath,
  });
  return {
    ...written,
    reviewsPath,
    relativeReviewsPath,
    findingsPath,
    relativeFindingsPath,
  };
}

export function loadRunArtifact(outputDir: string, runId: string): ReviewRunArtifact {
  const id = runId.trim();
  if (id.length === 0) throw new Error("runId is required");
  const runPath = runArtifactPath(outputDir, id);
  let raw: string;
  try {
    raw = readFileSync(runPath, "utf8");
  } catch (err) {
    const wrapped = new Error(`run artifact not found: ${runPath}`) as Error & {
      code?: string;
    };
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      typeof (err as { code: unknown }).code === "string"
    ) {
      wrapped.code = (err as { code: string }).code;
    }
    throw wrapped;
  }
  const parsed = JSON.parse(raw) as ReviewRunArtifact & { diff?: string };
  if (parsed.runId !== id) {
    throw new Error(`run artifact runId mismatch: expected ${id}, got ${parsed.runId}`);
  }
  const { diff: inlineDiff, ...withoutInlineDiff } = parsed;
  const fromGzip = readDiffGzip(outputDir, id);
  if (fromGzip !== undefined) {
    return { ...withoutInlineDiff, diff: fromGzip, diffGzip: true };
  }
  if (parsed.diffGzip === true) {
    throw new Error(`diffGzip sidecar missing for run ${id}: ${runDiffGzipPath(outputDir, id)}`);
  }
  // Legacy runs stored plaintext diff inline (no gzip sidecar).
  if (typeof inlineDiff === "string" && inlineDiff.length > 0) {
    return { ...withoutInlineDiff, diff: inlineDiff };
  }
  return withoutInlineDiff;
}
