import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { toRepoRelativePath } from "./artifacts.ts";
import { resolveOutputDir } from "./observability.ts";
import {
  activeWorkstreamPath,
  CHUNKS_JSON_FILENAME,
  runDir,
  WORK_LOG_FILENAME,
  WORKSTREAM_ADR_FILENAME,
  WORKSTREAM_COMMITS_DIRNAME,
  WORKSTREAM_TODO_FILENAME,
  workstreamCommitLinkPath,
  workstreamCommitsDir,
  workstreamDir,
  workstreamsIndexPath,
  workstreamsRoot,
} from "./paths.ts";
import { formatReviewRunId } from "./run-id.ts";
import { type WorkLogEntry, type WorkLogEntryInput, workLogEntryInputSchema } from "./work-log.ts";
import { parseRunIdShortSha } from "./workstream.ts";

export type WorkstreamStatus = "active" | "done";

function assertSafeCatalogId(id: string, label: string): void {
  if (id.length === 0) throw new Error(`${label} is required`);
  if (id === "." || id === ".." || id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`invalid ${label}: ${id}`);
  }
}

export type WorkstreamIndexLine = {
  workstreamId: string;
  title?: string;
  gitHead?: string;
  shortSha: string;
  status: WorkstreamStatus;
  path: string;
  recordedAt: string;
};

export type StartWorkstreamInput = {
  cwd: string;
  outputDir: string;
  shortSha: string;
  gitHead?: string;
  title?: string;
  at?: Date;
};

export type StartWorkstreamResult = {
  workstreamId: string;
  absoluteDir: string;
  relativeDir: string;
  indexPath: string;
  relativeIndexPath: string;
};

const EMPTY_CHUNKS_JSON = `${JSON.stringify({ chunks: [] }, null, 2)}\n`;

const ADR_SKELETON = `# ADR: Workstream decision

## Status

Proposed

## Context

What forces and facts motivate this workstream?

## Decision

We will …

## Consequences

### Positive

- …

### Negative

- …

### Neutral

- …
`;

const TODO_SKELETON = `# TODO

## Plan

- [ ] Define chunks in chunks.json
- [ ] Capture ADR decision
`;

function isUnderRoot(absolutePath: string, root: string): boolean {
  const resolved = path.resolve(absolutePath);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function readActiveWorkstreamId(outputDir: string): string | undefined {
  const pointer = activeWorkstreamPath(outputDir);
  if (!existsSync(pointer)) return undefined;
  const raw = readFileSync(pointer, "utf8").trim();
  return raw.length > 0 ? raw : undefined;
}

export function writeActiveWorkstreamId(outputDir: string, workstreamId: string): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(activeWorkstreamPath(outputDir), `${workstreamId}\n`, "utf8");
}

export function clearActiveWorkstreamId(outputDir: string, onlyIf?: string): boolean {
  const pointer = activeWorkstreamPath(outputDir);
  if (!existsSync(pointer)) return false;
  const current = readActiveWorkstreamId(outputDir);
  if (onlyIf !== undefined && current !== onlyIf) return false;
  unlinkSync(pointer);
  return true;
}

export function resolveWorkstreamDir(input: {
  cwd: string;
  outputDir: string;
  workstreamId: string;
}): {
  workstreamId: string;
  absoluteDir: string;
  relativeDir: string;
  workLogPath: string;
  relativeWorkLogPath: string;
} {
  const id = input.workstreamId.trim();
  assertSafeCatalogId(id, "workstream id");

  const outputDir = resolveOutputDir(input.cwd, input.outputDir);
  const absoluteDir = workstreamDir(outputDir, id);
  if (!existsSync(absoluteDir)) {
    throw new Error(`workstream directory not found: ${absoluteDir}`);
  }
  if (!isUnderRoot(absoluteDir, workstreamsRoot(outputDir))) {
    throw new Error(`workstream path escapes workstreams directory: ${absoluteDir}`);
  }

  const workLogPath = path.join(absoluteDir, WORK_LOG_FILENAME);
  return {
    workstreamId: id,
    absoluteDir,
    relativeDir: toRepoRelativePath(input.cwd, absoluteDir),
    workLogPath,
    relativeWorkLogPath: toRepoRelativePath(input.cwd, workLogPath),
  };
}

export function resolveWorkstreamIdOrActive(input: {
  cwd: string;
  outputDir: string;
  workstreamId?: string;
}): string {
  const outputDir = resolveOutputDir(input.cwd, input.outputDir);
  const explicit = input.workstreamId?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const active = readActiveWorkstreamId(outputDir);
  if (active === undefined) {
    throw new Error("no active workstream; pass --workstream-id or run workstream start/resume");
  }
  return active;
}

function appendWorkstreamsIndex(input: {
  cwd: string;
  outputDir: string;
  line: WorkstreamIndexLine;
}): { indexPath: string; relativeIndexPath: string } {
  const indexPath = workstreamsIndexPath(input.outputDir);
  mkdirSync(input.outputDir, { recursive: true });
  appendFileSync(indexPath, `${JSON.stringify(input.line)}\n`, "utf8");
  return {
    indexPath,
    relativeIndexPath: toRepoRelativePath(input.cwd, indexPath),
  };
}

export function startWorkstream(input: StartWorkstreamInput): StartWorkstreamResult {
  const outputDir = resolveOutputDir(input.cwd, input.outputDir);
  const at = input.at ?? new Date();
  const workstreamId = formatReviewRunId(at, input.shortSha);
  const absoluteDir = workstreamDir(outputDir, workstreamId);

  if (existsSync(absoluteDir)) {
    throw new Error(`workstream already exists: ${workstreamId}`);
  }

  mkdirSync(path.join(absoluteDir, WORKSTREAM_COMMITS_DIRNAME), { recursive: true });
  writeFileSync(path.join(absoluteDir, CHUNKS_JSON_FILENAME), EMPTY_CHUNKS_JSON, "utf8");
  writeFileSync(path.join(absoluteDir, WORKSTREAM_ADR_FILENAME), ADR_SKELETON, "utf8");
  writeFileSync(path.join(absoluteDir, WORKSTREAM_TODO_FILENAME), TODO_SKELETON, "utf8");
  writeFileSync(path.join(absoluteDir, WORK_LOG_FILENAME), "", "utf8");

  const relativeDir = toRepoRelativePath(input.cwd, absoluteDir);
  const title = input.title?.trim();
  const { indexPath, relativeIndexPath } = appendWorkstreamsIndex({
    cwd: input.cwd,
    outputDir,
    line: {
      workstreamId,
      ...(title !== undefined && title.length > 0 ? { title } : {}),
      ...(input.gitHead !== undefined ? { gitHead: input.gitHead } : {}),
      shortSha: input.shortSha,
      status: "active",
      path: relativeDir,
      recordedAt: at.toISOString(),
    },
  });

  writeActiveWorkstreamId(outputDir, workstreamId);

  return {
    workstreamId,
    absoluteDir,
    relativeDir,
    indexPath,
    relativeIndexPath,
  };
}

export function resumeWorkstream(input: { cwd: string; outputDir: string; workstreamId: string }): {
  workstreamId: string;
  relativeDir: string;
} {
  const resolved = resolveWorkstreamDir(input);
  const outputDir = resolveOutputDir(input.cwd, input.outputDir);
  writeActiveWorkstreamId(outputDir, resolved.workstreamId);
  return { workstreamId: resolved.workstreamId, relativeDir: resolved.relativeDir };
}

export function doneWorkstream(input: {
  cwd: string;
  outputDir: string;
  workstreamId?: string;
  message?: string;
  agent?: string;
  at?: Date;
}): {
  workstreamId: string;
  clearedActive: boolean;
  relativeWorkLogPath?: string;
} {
  const outputDir = resolveOutputDir(input.cwd, input.outputDir);
  const id = resolveWorkstreamIdOrActive({
    cwd: input.cwd,
    outputDir,
    workstreamId: input.workstreamId,
  });
  const resolved = resolveWorkstreamDir({ cwd: input.cwd, outputDir, workstreamId: id });

  const entry = appendWorkstreamWorkLog({
    cwd: input.cwd,
    outputDir,
    workstreamId: id,
    entry: {
      event: "done",
      message: input.message?.trim() || "workstream done",
      status: "done",
      ...(input.agent !== undefined ? { agent: input.agent } : {}),
    },
    at: input.at,
  });

  appendWorkstreamsIndex({
    cwd: input.cwd,
    outputDir,
    line: {
      workstreamId: id,
      shortSha: parseRunIdShortSha(id) ?? id,
      status: "done",
      path: resolved.relativeDir,
      recordedAt: (input.at ?? new Date()).toISOString(),
    },
  });

  const clearedActive = clearActiveWorkstreamId(outputDir, id);
  return {
    workstreamId: id,
    clearedActive,
    relativeWorkLogPath: entry.relativeWorkLogPath,
  };
}

export type LinkReviewToWorkstreamInput = {
  cwd: string;
  outputDir: string;
  workstreamId: string;
  runId: string;
};

export type LinkReviewToWorkstreamResult = {
  workstreamId: string;
  runId: string;
  linkPath: string;
  relativeLinkPath: string;
  created: boolean;
};

/**
 * Create `workstreams/<id>/commits/<runId>` → `reviews/<runId>` (relative symlink).
 * Idempotent when the link already points at the same target.
 */
export function linkReviewToWorkstream(
  input: LinkReviewToWorkstreamInput,
): LinkReviewToWorkstreamResult {
  const outputDir = resolveOutputDir(input.cwd, input.outputDir);
  const runId = input.runId.trim();
  assertSafeCatalogId(runId, "runId");

  const resolved = resolveWorkstreamDir({
    cwd: input.cwd,
    outputDir,
    workstreamId: input.workstreamId,
  });

  const reviewAbsolute = runDir(outputDir, runId);
  if (!existsSync(reviewAbsolute)) {
    throw new Error(`review directory not found: ${reviewAbsolute}`);
  }

  mkdirSync(workstreamCommitsDir(outputDir, resolved.workstreamId), { recursive: true });
  const linkPath = workstreamCommitLinkPath(outputDir, resolved.workstreamId, runId);
  const relativeTarget = path.relative(path.dirname(linkPath), reviewAbsolute);
  const expectedResolved = path.resolve(path.dirname(linkPath), relativeTarget);

  if (existsSync(linkPath) || isSymlink(linkPath)) {
    if (isSymlink(linkPath)) {
      const currentTarget = readlinkSync(linkPath);
      const currentResolved = path.resolve(path.dirname(linkPath), currentTarget);
      let healthy = false;
      try {
        healthy = existsSync(linkPath) && currentResolved === expectedResolved;
      } catch {
        healthy = false;
      }
      if (healthy) {
        return {
          workstreamId: resolved.workstreamId,
          runId,
          linkPath,
          relativeLinkPath: toRepoRelativePath(input.cwd, linkPath),
          created: false,
        };
      }
      unlinkSync(linkPath);
    } else {
      throw new Error(`commit link path exists and is not a symlink: ${linkPath}`);
    }
  }

  symlinkSync(relativeTarget, linkPath);
  return {
    workstreamId: resolved.workstreamId,
    runId,
    linkPath,
    relativeLinkPath: toRepoRelativePath(input.cwd, linkPath),
    created: true,
  };
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Opt-in post-persist link. Never throws; returns undefined when nothing to link.
 */
export function maybeLinkReviewToWorkstream(input: {
  cwd: string;
  outputDir: string;
  runId: string;
  /** Explicit --workstream-id (wins over active). */
  workstreamId?: string;
  /** Config workstreamAutoLink; ignored when workstreamId is explicit. */
  autoLink: boolean;
}): LinkReviewToWorkstreamResult | undefined {
  try {
    const outputDir = resolveOutputDir(input.cwd, input.outputDir);
    const explicit = input.workstreamId?.trim();
    let workstreamId: string | undefined;
    if (explicit !== undefined && explicit.length > 0) {
      workstreamId = explicit;
    } else if (input.autoLink) {
      workstreamId = readActiveWorkstreamId(outputDir);
    }
    if (workstreamId === undefined) return undefined;
    return linkReviewToWorkstream({
      cwd: input.cwd,
      outputDir,
      workstreamId,
      runId: input.runId,
    });
  } catch {
    return undefined;
  }
}

export type AppendWorkstreamWorkLogInput = {
  cwd: string;
  outputDir: string;
  workstreamId: string;
  entry: WorkLogEntryInput;
  at?: Date;
};

export type AppendWorkstreamWorkLogResult = {
  entry: WorkLogEntry;
  workLogPath: string;
  relativeWorkLogPath: string;
  workstreamDir: string;
  relativeWorkstreamDir: string;
};

export function appendWorkstreamWorkLog(
  input: AppendWorkstreamWorkLogInput,
): AppendWorkstreamWorkLogResult {
  const parsed = workLogEntryInputSchema.parse(input.entry);
  const resolved = resolveWorkstreamDir({
    cwd: input.cwd,
    outputDir: input.outputDir,
    workstreamId: input.workstreamId,
  });

  const status = parsed.event === "done" ? (parsed.status ?? "done") : parsed.status;
  const entry: WorkLogEntry = {
    at: (input.at ?? new Date()).toISOString(),
    event: parsed.event,
    message: parsed.message,
    ...(parsed.artifact !== undefined ? { artifact: parsed.artifact } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(parsed.agent !== undefined ? { agent: parsed.agent } : {}),
  };

  appendFileSync(resolved.workLogPath, `${JSON.stringify(entry)}\n`, "utf8");

  return {
    entry,
    workLogPath: resolved.workLogPath,
    relativeWorkLogPath: resolved.relativeWorkLogPath,
    workstreamDir: resolved.absoluteDir,
    relativeWorkstreamDir: resolved.relativeDir,
  };
}
