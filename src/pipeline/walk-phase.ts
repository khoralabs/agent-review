import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { generateText } from "ai";

import type { AgentReviewConfig } from "../config.ts";
import { loadRunArtifact, type ReviewRunArtifact, toRepoRelativePath } from "../lib/artifacts.ts";
import { resolveOutputDir } from "../lib/observability.ts";
import { walkDir, walksRoot } from "../lib/paths.ts";
import { mapPool } from "../lib/pool.ts";
import { logStatus } from "../lib/status.ts";
import {
  buildWalkCatalog,
  formatWalkCatalogSummary,
  type WalkCatalogEntry,
  type WalkStepForCatalog,
} from "../lib/walk-catalog.ts";
import {
  formatWalkId,
  listCommitsInRange,
  resolveFullSha,
  resolveShortSha,
} from "../lib/walk-commits.ts";
import { createWalkWorktreePool } from "../lib/walk-worktree.ts";
import { runAnalyzePhase } from "./analyze-phase.ts";
import { runReviewPhase } from "./review-phase.ts";

export type RunWalkPhaseInput = {
  config: AgentReviewConfig;
  from: string;
  to?: string;
  cwd?: string;
  concurrency?: number;
  maxCommits?: number;
  keepWorktree?: boolean;
  skipArtifacts?: boolean;
  quiet?: boolean;
  json?: boolean;
  generateTextFn?: typeof generateText;
  /** Inject for tests. */
  listCommitsFn?: typeof listCommitsInRange;
  /** Inject for tests — skip real worktrees. */
  createWorktreePoolFn?: typeof createWalkWorktreePool;
  /** Inject for tests — override per-commit review+analyze. */
  runCommitStepFn?: (input: {
    sha: string;
    inspectCwd: string;
    workerIndex: number;
  }) => Promise<WalkStepResult>;
};

export type WalkStepResult = {
  commit: string;
  runId?: string;
  exitCode: 0 | 1 | 2;
  findingCount: number;
  files: string[];
  findings: ReviewRunArtifact["findings"];
  error?: string;
  failed: boolean;
};

export type WalkArtifact = {
  walkId: string;
  from: string;
  to: string;
  fromResolved: string;
  toResolved: string;
  commits: string[];
  concurrency: number;
  steps: Array<{
    commit: string;
    runId?: string;
    exitCode: 0 | 1 | 2;
    findingCount: number;
    error?: string;
    failed: boolean;
  }>;
  stepsFailed: number;
  catalog: WalkCatalogEntry[];
  startedAt: string;
  finishedAt: string;
  artifactPath: string;
};

export type RunWalkPhaseResult = {
  exitCode: 0 | 2;
  walkId: string;
  message: string;
  /** Printed on stdout by CLI. */
  walkIdStdout?: string;
  artifact?: WalkArtifact;
};

export async function runWalkPhase(input: RunWalkPhaseInput): Promise<RunWalkPhaseResult> {
  const cwd = input.cwd ?? process.cwd();
  const outputDir = resolveOutputDir(cwd, input.config.outputDir);
  const fromRaw = input.from.trim();
  const toRaw = (input.to ?? "HEAD").trim();
  const quiet = input.quiet ?? false;
  const skipArtifacts = input.skipArtifacts === true;
  const concurrency = Math.max(
    1,
    Math.floor(input.concurrency ?? input.config.analystConcurrency ?? 4),
  );

  let fromResolved: string;
  let toResolved: string;
  try {
    fromResolved = await resolveFullSha(fromRaw, cwd);
    toResolved = await resolveFullSha(toRaw, cwd);
  } catch (err) {
    return {
      exitCode: 2,
      walkId: "",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const listFn = input.listCommitsFn ?? listCommitsInRange;
  let commits: string[];
  try {
    commits = await listFn({
      cwd,
      from: fromResolved,
      to: toResolved,
      ...(input.maxCommits !== undefined ? { maxCommits: input.maxCommits } : {}),
    });
  } catch (err) {
    return {
      exitCode: 2,
      walkId: "",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const fromShort = await resolveShortSha(fromResolved, cwd);
  const toShort = await resolveShortSha(toResolved, cwd);
  const startedAt = new Date();
  const walkId = formatWalkId({
    date: startedAt,
    fromShort,
    toShort,
  });

  if (commits.length === 0) {
    const finishedAt = new Date();
    const artifact = emptyWalkArtifact({
      walkId,
      from: fromRaw,
      to: toRaw,
      fromResolved,
      toResolved,
      concurrency,
      startedAt,
      finishedAt,
      cwd,
      outputDir,
    });
    if (!skipArtifacts) {
      writeWalkBundle({
        cwd,
        outputDir,
        artifact,
        stepsJsonl: [],
      });
    }
    logStatus(quiet, `walk ${walkId}: empty range`);
    return {
      exitCode: 0,
      walkId,
      walkIdStdout: walkId,
      message: `walk complete (empty range ${fromRaw}..${toRaw})`,
      artifact,
    };
  }

  logStatus(
    quiet,
    `walk ${walkId} started (${commits.length} commit${commits.length === 1 ? "" : "s"}, concurrency=${Math.min(concurrency, commits.length)})`,
  );

  const createPool = input.createWorktreePoolFn ?? createWalkWorktreePool;
  const poolSize = Math.min(concurrency, commits.length);
  let pool: Awaited<ReturnType<typeof createWalkWorktreePool>> | null = null;
  try {
    if (input.runCommitStepFn === undefined) {
      pool = await createPool({
        repoCwd: cwd,
        outputDir,
        size: poolSize,
        startRev: toResolved,
      });
    }
  } catch (err) {
    return {
      exitCode: 2,
      walkId,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const stepByCommit = new Map<string, WalkStepResult>();
  const stepsJsonl: string[] = [];

  try {
    // Sticky worker indexes so each in-flight job owns a worktree.
    const freeWorkers: number[] = Array.from({ length: poolSize }, (_, i) => i);

    await mapPool(commits, poolSize, async (sha) => {
      const workerIndex = freeWorkers.pop();
      if (workerIndex === undefined) {
        stepByCommit.set(sha, {
          commit: sha,
          exitCode: 2,
          findingCount: 0,
          files: [],
          findings: [],
          failed: true,
          error: "walk worker pool exhausted",
        });
        return;
      }
      try {
        let step: WalkStepResult;
        try {
          if (input.runCommitStepFn !== undefined) {
            step = await input.runCommitStepFn({
              sha,
              inspectCwd: cwd,
              workerIndex,
            });
          } else if (pool !== null) {
            await pool.checkout(workerIndex, sha);
            const inspectCwd = pool.paths[workerIndex] ?? cwd;
            step = await runOneCommitStep({
              config: input.config,
              cwd,
              inspectCwd,
              sha,
              skipArtifacts,
              quiet: true,
              generateTextFn: input.generateTextFn,
            });
          } else {
            step = {
              commit: sha,
              exitCode: 2,
              findingCount: 0,
              files: [],
              findings: [],
              failed: true,
              error: "walk worktree pool missing",
            };
          }
        } catch (err) {
          step = {
            commit: sha,
            exitCode: 2,
            findingCount: 0,
            files: [],
            findings: [],
            failed: true,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        stepByCommit.set(sha, step);
        const line = JSON.stringify({
          commit: step.commit,
          runId: step.runId,
          exitCode: step.exitCode,
          findingCount: step.findingCount,
          failed: step.failed,
          ...(step.error !== undefined ? { error: step.error } : {}),
          recordedAt: new Date().toISOString(),
        });
        stepsJsonl.push(line);
        logStatus(
          quiet,
          `walk step ${sha.slice(0, 7)} ${step.failed ? "failed" : "ok"} (findings=${step.findingCount})`,
        );
      } finally {
        freeWorkers.push(workerIndex);
      }
    });
  } finally {
    if (pool !== null && input.keepWorktree !== true) {
      await pool.dispose();
    }
  }

  const orderedSteps: WalkStepResult[] = commits.map((sha) => {
    const step = stepByCommit.get(sha);
    if (step !== undefined) return step;
    return {
      commit: sha,
      exitCode: 2,
      findingCount: 0,
      files: [],
      findings: [],
      failed: true,
      error: "step did not complete",
    };
  });

  const catalogSteps: WalkStepForCatalog[] = orderedSteps.map((s) => ({
    commit: s.commit,
    runId: s.runId,
    files: s.files,
    findings: s.findings,
    failed: s.failed,
  }));
  const catalog = buildWalkCatalog(catalogSteps);
  const stepsFailed = orderedSteps.filter((s) => s.failed).length;
  const finishedAt = new Date();

  const relativeWalkPath = toRepoRelativePath(
    cwd,
    path.join(walkDir(outputDir, walkId), "walk.json"),
  );
  const artifact: WalkArtifact = {
    walkId,
    from: fromRaw,
    to: toRaw,
    fromResolved,
    toResolved,
    commits,
    concurrency: poolSize,
    steps: orderedSteps.map((s) => ({
      commit: s.commit,
      ...(s.runId !== undefined ? { runId: s.runId } : {}),
      exitCode: s.exitCode,
      findingCount: s.findingCount,
      failed: s.failed,
      ...(s.error !== undefined ? { error: s.error } : {}),
    })),
    stepsFailed,
    catalog,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    artifactPath: relativeWalkPath,
  };

  if (!skipArtifacts) {
    writeWalkBundle({
      cwd,
      outputDir,
      artifact,
      stepsJsonl,
    });
  }

  const summary = formatWalkCatalogSummary({
    walkId,
    from: fromRaw,
    to: toRaw,
    commitCount: commits.length,
    stepsFailed,
    entries: catalog,
  });

  const exitCode: 0 | 2 = stepsFailed > 0 ? 2 : 0;
  logStatus(quiet, `walk ${walkId} finished (failed=${stepsFailed}, catalog=${catalog.length})`);

  const message =
    input.json === true
      ? JSON.stringify(
          {
            walkId,
            exitCode,
            stepsFailed,
            commitCount: commits.length,
            catalog,
            steps: artifact.steps,
            artifactPath: artifact.artifactPath,
          },
          null,
          2,
        )
      : [`walk complete (run ${walkId})`, "", summary.trimEnd()].join("\n");

  return {
    exitCode,
    walkId,
    walkIdStdout: walkId,
    message,
    artifact,
  };
}

async function runOneCommitStep(input: {
  config: AgentReviewConfig;
  cwd: string;
  inspectCwd: string;
  sha: string;
  skipArtifacts: boolean;
  quiet: boolean;
  generateTextFn?: typeof generateText;
}): Promise<WalkStepResult> {
  try {
    const review = await runReviewPhase({
      config: input.config,
      scope: "commit",
      commit: input.sha,
      cwd: input.cwd,
      inspectCwd: input.inspectCwd,
      skipArtifacts: input.skipArtifacts,
      quiet: input.quiet,
      generateTextFn: input.generateTextFn,
    });

    if (review.exitCode === 2) {
      return {
        commit: review.commit ?? input.sha,
        runId: review.runId,
        exitCode: 2,
        findingCount: review.result?.findings.length ?? 0,
        files: review.diff?.files ?? [],
        findings: review.result?.findings ?? [],
        failed: true,
        error: review.message,
      };
    }

    if (review.skipAnalyze) {
      return {
        commit: review.commit ?? input.sha,
        runId: review.runId,
        exitCode: 0,
        findingCount: review.result?.findings.length ?? 0,
        files: review.diff?.files ?? [],
        findings: review.result?.findings ?? [],
        failed: false,
      };
    }

    const analyze = await runAnalyzePhase({
      config: input.config,
      runId: review.runId,
      cwd: input.cwd,
      inspectCwd: input.inspectCwd,
      commitMessage: review.commitMessage,
      skipArtifacts: input.skipArtifacts,
      quiet: input.quiet,
      generateTextFn: input.generateTextFn,
    });

    let artifact: ReviewRunArtifact | undefined;
    if (!input.skipArtifacts) {
      try {
        const outputDir = resolveOutputDir(input.cwd, input.config.outputDir);
        artifact = loadRunArtifact(outputDir, review.runId);
      } catch {
        /* fall through to phase results */
      }
    }

    const findings =
      artifact?.findings ?? analyze.result?.findings ?? review.result?.findings ?? [];
    const files = artifact?.files ?? review.diff?.files ?? [];
    const commit = artifact?.commit ?? review.commit ?? input.sha;
    const failed = analyze.exitCode === 2;

    return {
      commit,
      runId: review.runId,
      exitCode: analyze.exitCode,
      findingCount: findings.length,
      files,
      findings,
      failed,
      ...(failed ? { error: analyze.message } : {}),
    };
  } catch (err) {
    return {
      commit: input.sha,
      exitCode: 2,
      findingCount: 0,
      files: [],
      findings: [],
      failed: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function emptyWalkArtifact(input: {
  walkId: string;
  from: string;
  to: string;
  fromResolved: string;
  toResolved: string;
  concurrency: number;
  startedAt: Date;
  finishedAt: Date;
  cwd: string;
  outputDir: string;
}): WalkArtifact {
  const relativeWalkPath = toRepoRelativePath(
    input.cwd,
    path.join(walkDir(input.outputDir, input.walkId), "walk.json"),
  );
  return {
    walkId: input.walkId,
    from: input.from,
    to: input.to,
    fromResolved: input.fromResolved,
    toResolved: input.toResolved,
    commits: [],
    concurrency: input.concurrency,
    steps: [],
    stepsFailed: 0,
    catalog: [],
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    artifactPath: relativeWalkPath,
  };
}

function writeWalkBundle(input: {
  cwd: string;
  outputDir: string;
  artifact: WalkArtifact;
  stepsJsonl: string[];
}): void {
  const dir = walkDir(input.outputDir, input.artifact.walkId);
  mkdirSync(dir, { recursive: true });
  const walkPath = path.join(dir, "walk.json");
  writeFileSync(walkPath, `${JSON.stringify(input.artifact, null, 2)}\n`, "utf8");

  const stepsPath = path.join(dir, "steps.jsonl");
  writeFileSync(
    stepsPath,
    input.stepsJsonl.length > 0 ? `${input.stepsJsonl.join("\n")}\n` : "",
    "utf8",
  );

  const catalogPath = path.join(dir, "catalog.json");
  writeFileSync(catalogPath, `${JSON.stringify(input.artifact.catalog, null, 2)}\n`, "utf8");

  const summaryPath = path.join(dir, "summary.md");
  writeFileSync(
    summaryPath,
    formatWalkCatalogSummary({
      walkId: input.artifact.walkId,
      from: input.artifact.from,
      to: input.artifact.to,
      commitCount: input.artifact.commits.length,
      stepsFailed: input.artifact.stepsFailed,
      entries: input.artifact.catalog,
    }),
    "utf8",
  );

  mkdirSync(walksRoot(input.outputDir), { recursive: true });
  const indexPath = path.join(input.outputDir, "walks.jsonl");
  const indexLine = {
    walkId: input.artifact.walkId,
    from: input.artifact.from,
    to: input.artifact.to,
    fromResolved: input.artifact.fromResolved,
    toResolved: input.artifact.toResolved,
    commitCount: input.artifact.commits.length,
    stepsFailed: input.artifact.stepsFailed,
    catalogCount: input.artifact.catalog.length,
    path: input.artifact.artifactPath,
    recordedAt: input.artifact.finishedAt,
  };
  appendFileSync(indexPath, `${JSON.stringify(indexLine)}\n`, "utf8");
}
