import path from "node:path";

/** Top-level directory under outputDir that holds per-run folders. */
export const REVIEWS_DIRNAME = "reviews";

/** Content-addressed agent capability snapshots. */
export const AGENTS_DIRNAME = "agents";

/** History-walk bundles. */
export const WALKS_DIRNAME = "walks";

/** Opt-in workstream catalog (sibling of reviews/). */
export const WORKSTREAMS_DIRNAME = "workstreams";

/** Filename for the run JSON inside `reviews/<runId>/`. */
export const RUN_JSON_FILENAME = "run.json";

/** Filename for the gzipped diff sidecar inside `reviews/<runId>/`. */
export const DIFF_GZIP_FILENAME = "diff.gz";

/** Filename for the remediation plan. */
export const PLAN_FILENAME = "plan.md";

/** Planned commit chunks inside a workstream dir. */
export const CHUNKS_JSON_FILENAME = "chunks.json";

/** Per-workstream ADR stub. */
export const WORKSTREAM_ADR_FILENAME = "adr.md";

/** Per-workstream todo-md file. */
export const WORKSTREAM_TODO_FILENAME = "todo.md";

/** Append-only work-log under a workstream or remediation. */
export const WORK_LOG_FILENAME = "work-log.jsonl";

/** Symlink dir of review runIds under a workstream. */
export const WORKSTREAM_COMMITS_DIRNAME = "commits";

/** Top-level active workstream pointer filename under outputDir. */
export const ACTIVE_WORKSTREAM_FILENAME = "active-workstream";

/** Top-level workstream index JSONL under outputDir. */
export const WORKSTREAMS_JSONL_FILENAME = "workstreams.jsonl";

export function reviewsRoot(outputDir: string): string {
  return path.join(outputDir, REVIEWS_DIRNAME);
}

export function workstreamsRoot(outputDir: string): string {
  return path.join(outputDir, WORKSTREAMS_DIRNAME);
}

export function workstreamDir(outputDir: string, workstreamId: string): string {
  return path.join(workstreamsRoot(outputDir), workstreamId);
}

export function activeWorkstreamPath(outputDir: string): string {
  return path.join(outputDir, ACTIVE_WORKSTREAM_FILENAME);
}

export function workstreamsIndexPath(outputDir: string): string {
  return path.join(outputDir, WORKSTREAMS_JSONL_FILENAME);
}

export function workstreamCommitsDir(outputDir: string, workstreamId: string): string {
  return path.join(workstreamDir(outputDir, workstreamId), WORKSTREAM_COMMITS_DIRNAME);
}

export function workstreamCommitLinkPath(
  outputDir: string,
  workstreamId: string,
  runId: string,
): string {
  return path.join(workstreamCommitsDir(outputDir, workstreamId), runId);
}

export function walksRoot(outputDir: string): string {
  return path.join(outputDir, WALKS_DIRNAME);
}

export function walkDir(outputDir: string, walkId: string): string {
  return path.join(walksRoot(outputDir), walkId);
}

export function agentsDir(outputDir: string): string {
  return path.join(outputDir, AGENTS_DIRNAME);
}

export function agentSnapshotPath(outputDir: string, staticHash: string): string {
  return path.join(agentsDir(outputDir), `${staticHash}.json.gz`);
}

/** Pre-gzip legacy path; still treated as present for write-once. */
export function agentSnapshotLegacyPath(outputDir: string, staticHash: string): string {
  return path.join(agentsDir(outputDir), `${staticHash}.json`);
}

export function runDir(outputDir: string, runId: string): string {
  return path.join(reviewsRoot(outputDir), runId);
}

export function runArtifactPath(outputDir: string, runId: string): string {
  return path.join(runDir(outputDir, runId), RUN_JSON_FILENAME);
}

export function runDiffGzipPath(outputDir: string, runId: string): string {
  return path.join(runDir(outputDir, runId), DIFF_GZIP_FILENAME);
}

/** OutputDir-relative remediation dir: `reviews/<runId>/remediations/<index>`. */
export function remediationRelativePath(runId: string, index: number): string {
  return path.join(REVIEWS_DIRNAME, runId, "remediations", String(index));
}

/** Directory name segment for a remediation (index only). */
export function remediationDirName(_runId: string, index: number): string {
  return String(index);
}

export function remediationPlanPath(absoluteRemediationDir: string): string {
  return path.join(absoluteRemediationDir, PLAN_FILENAME);
}
