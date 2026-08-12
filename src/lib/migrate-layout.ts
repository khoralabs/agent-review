import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ReviewRunArtifact } from "./artifacts.ts";
import { toRepoRelativePath } from "./artifacts.ts";
import {
  PLAN_FILENAME,
  remediationRelativePath,
  runArtifactPath,
  runDiffGzipPath,
} from "./paths.ts";

export type MigrateLayoutResult = {
  migratedRuns: string[];
  migratedRemediations: Array<{ runId: string; index: string }>;
  rewrittenReviewsJsonl: boolean;
  alreadyMigrated: boolean;
};

const LEGACY_PLAN = "_plan.md";

function listEntries(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !name.startsWith("."));
}

function moveFile(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  if (existsSync(to)) {
    // Idempotent resume: same content already at the destination.
    rmSync(from, { force: true });
    return;
  }
  renameSync(from, to);
}

function posixRemediationPath(runId: string, index: number): string {
  return remediationRelativePath(runId, index).split(path.sep).join("/");
}

function rewriteFindingRemediationPaths(
  artifact: ReviewRunArtifact,
  runId: string,
): ReviewRunArtifact["findings"] {
  return artifact.findings.map((finding, findingIndex) => {
    const decision = finding.decision;
    if (decision === undefined || decision.verdict !== "remediate") {
      return finding;
    }
    const normalizedPath = decision.remediationPath.replace(/\\/g, "/");
    const legacy = normalizedPath.match(/remediations\/.+-(\d+)$/);
    const nested = normalizedPath.match(/reviews\/[^/]+\/remediations\/(\d+)$/);
    const index = Number(legacy?.[1] ?? nested?.[1] ?? findingIndex);
    return {
      ...finding,
      decision: {
        ...decision,
        remediationPath: posixRemediationPath(runId, index),
      },
    };
  });
}

function rewriteRunJson(cwd: string, outputDir: string, runId: string): void {
  const runPath = runArtifactPath(outputDir, runId);
  if (!existsSync(runPath)) return;
  const parsed = JSON.parse(readFileSync(runPath, "utf8")) as ReviewRunArtifact;
  const next: ReviewRunArtifact = {
    ...parsed,
    artifactPath: toRepoRelativePath(cwd, runPath),
    findings: rewriteFindingRemediationPaths(parsed, runId),
  };
  writeFileSync(runPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function parseLegacyRemediationDirName(name: string): { runId: string; index: string } | undefined {
  const match = name.match(/^(.+)-(\d+)$/);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { runId: match[1], index: match[2] };
}

function rewritePlanSource(planText: string, runId: string): string {
  return planText.replace(
    /Source:\s*runs\/([^\s]+)\.json\s+finding\[(\d+)\]/g,
    (_full, _oldId: string, index: string) => `Source: reviews/${runId}/run.json finding[${index}]`,
  );
}

/**
 * Convert legacy `runs/` + top-level `remediations/` into `reviews/<runId>/`.
 * Idempotent when the tree is already on the new layout and legacy dirs are absent.
 */
export function migrateAgentReviewLayout(input: {
  cwd: string;
  outputDir: string;
}): MigrateLayoutResult {
  const { cwd, outputDir } = input;
  const legacyRunsDir = path.join(outputDir, "runs");
  const legacyRemediationsDir = path.join(outputDir, "remediations");

  const hasLegacyRuns = existsSync(legacyRunsDir);
  const hasLegacyRemediations = existsSync(legacyRemediationsDir);

  if (!hasLegacyRuns && !hasLegacyRemediations) {
    return {
      migratedRuns: [],
      migratedRemediations: [],
      rewrittenReviewsJsonl: false,
      alreadyMigrated: true,
    };
  }

  const migratedRuns: string[] = [];
  const migratedRemediations: Array<{ runId: string; index: string }> = [];

  if (hasLegacyRuns) {
    const legacyNames = listEntries(legacyRunsDir);
    const jsonRunIds = new Set(
      legacyNames
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length)),
    );

    for (const runId of jsonRunIds) {
      const fromJson = path.join(legacyRunsDir, `${runId}.json`);
      const toJson = runArtifactPath(outputDir, runId);
      moveFile(fromJson, toJson);

      const fromDiff = path.join(legacyRunsDir, `${runId}.diff.gz`);
      if (existsSync(fromDiff)) {
        moveFile(fromDiff, runDiffGzipPath(outputDir, runId));
      }

      rewriteRunJson(cwd, outputDir, runId);
      migratedRuns.push(runId);
    }

    // Resume after partial migration: pair orphaned .diff.gz with already-moved JSON.
    for (const name of listEntries(legacyRunsDir)) {
      if (!name.endsWith(".diff.gz")) continue;
      const runId = name.slice(0, -".diff.gz".length);
      if (jsonRunIds.has(runId)) continue;
      const toJson = runArtifactPath(outputDir, runId);
      if (!existsSync(toJson)) {
        throw new Error(`orphaned legacy diff with no run JSON: ${path.join(legacyRunsDir, name)}`);
      }
      moveFile(path.join(legacyRunsDir, name), runDiffGzipPath(outputDir, runId));
      if (!migratedRuns.includes(runId)) {
        rewriteRunJson(cwd, outputDir, runId);
        migratedRuns.push(runId);
      }
    }
  }

  if (hasLegacyRemediations) {
    for (const name of listEntries(legacyRemediationsDir)) {
      const fromDir = path.join(legacyRemediationsDir, name);
      if (!statSync(fromDir).isDirectory()) continue;
      const parsed = parseLegacyRemediationDirName(name);
      if (parsed === undefined) {
        console.warn(`agent-review: skipping non-legacy remediation dir: ${name}`);
        continue;
      }
      const { runId, index } = parsed;
      const toDir = path.join(outputDir, remediationRelativePath(runId, Number(index)));
      if (existsSync(toDir)) {
        throw new Error(`cannot migrate ${fromDir}: target already exists ${toDir}`);
      }
      mkdirSync(path.dirname(toDir), { recursive: true });
      renameSync(fromDir, toDir);

      const legacyPlan = path.join(toDir, LEGACY_PLAN);
      const newPlan = path.join(toDir, PLAN_FILENAME);
      if (existsSync(legacyPlan)) {
        if (existsSync(newPlan)) {
          throw new Error(`both ${LEGACY_PLAN} and ${PLAN_FILENAME} in ${toDir}`);
        }
        renameSync(legacyPlan, newPlan);
      }
      if (existsSync(newPlan)) {
        const text = readFileSync(newPlan, "utf8");
        writeFileSync(newPlan, rewritePlanSource(text, runId), "utf8");
      }

      rewriteRunJson(cwd, outputDir, runId);
      migratedRemediations.push({ runId, index });
    }
  }

  let rewrittenReviewsJsonl = false;
  const reviewsJsonl = path.join(outputDir, "reviews.jsonl");
  if (existsSync(reviewsJsonl)) {
    const lines = readFileSync(reviewsJsonl, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const next = lines.map((line) => {
      const row = JSON.parse(line) as { runId?: string; path?: string };
      if (typeof row.runId !== "string") return line;
      const abs = runArtifactPath(outputDir, row.runId);
      if (!existsSync(abs)) return line;
      const updatedPath = toRepoRelativePath(cwd, abs);
      if (row.path !== updatedPath) rewrittenReviewsJsonl = true;
      row.path = updatedPath;
      return JSON.stringify(row);
    });
    writeFileSync(reviewsJsonl, `${next.join("\n")}\n`, "utf8");
  }

  if (hasLegacyRuns) {
    const leftover = listEntries(legacyRunsDir);
    if (leftover.length > 0) {
      throw new Error(`legacy runs/ not empty after migration: ${leftover.join(", ")}`);
    }
    rmSync(legacyRunsDir, { recursive: true, force: true });
  }
  if (hasLegacyRemediations) {
    const leftoverMigratable = listEntries(legacyRemediationsDir).filter((name) => {
      const full = path.join(legacyRemediationsDir, name);
      return statSync(full).isDirectory() && parseLegacyRemediationDirName(name) !== undefined;
    });
    if (leftoverMigratable.length > 0) {
      throw new Error(
        `legacy remediations/ not empty after migration: ${leftoverMigratable.join(", ")}`,
      );
    }
    // Preserve skipped non-legacy dirs; remove the folder only when empty.
    if (listEntries(legacyRemediationsDir).length === 0) {
      rmSync(legacyRemediationsDir, { recursive: true, force: true });
    }
  }

  return {
    migratedRuns,
    migratedRemediations,
    rewrittenReviewsJsonl,
    alreadyMigrated: false,
  };
}
