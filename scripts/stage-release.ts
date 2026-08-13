#!/usr/bin/env bun
/**
 * Stage a standalone npm package under release/ for publish.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export type StageReleaseOptions = {
  workspaceRoot: string;
  version: string;
  /** Override staged output directory (default: `<workspaceRoot>/release`). */
  releaseDir?: string;
};

export type StageReleaseResult = {
  releaseDir: string;
};

const COPY_PATHS = [
  "bin",
  "src",
  "skills",
  ".agent-review.example.json",
  "README.md",
  "LICENSE",
] as const;

export async function stageRelease(opts: StageReleaseOptions): Promise<StageReleaseResult> {
  const { workspaceRoot, version } = opts;
  const pkgJsonPath = path.join(workspaceRoot, "package.json");

  if (!existsSync(pkgJsonPath)) {
    throw new Error(`missing package.json at ${workspaceRoot}`);
  }

  const source = JSON.parse(await Bun.file(pkgJsonPath).text()) as Record<string, unknown>;
  const releaseDir = opts.releaseDir ?? path.join(workspaceRoot, "release");

  if (existsSync(releaseDir)) rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true });

  for (const rel of COPY_PATHS) {
    const src = path.join(workspaceRoot, rel);
    if (!existsSync(src)) {
      throw new Error(`missing ${rel} at ${workspaceRoot}`);
    }
    cpSync(src, path.join(releaseDir, rel), { recursive: true });
  }

  const staged: Record<string, unknown> = {
    name: source.name,
    version,
    description: source.description,
    license: source.license,
    type: source.type ?? "module",
    engines: source.engines,
    repository: source.repository,
    homepage: source.homepage,
    bugs: source.bugs,
    keywords: source.keywords,
    bin: source.bin,
    files: source.files,
    exports: source.exports,
    dependencies: source.dependencies,
    publishConfig: { access: "public", ...(source.publishConfig as object | undefined) },
  };

  await Bun.write(path.join(releaseDir, "package.json"), `${JSON.stringify(staged, null, 2)}\n`);

  return { releaseDir };
}

if (import.meta.main) {
  const version = process.argv[2];
  if (version === undefined || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    console.error("usage: stage-release.ts <semver>");
    process.exit(1);
  }
  const workspaceRoot = path.resolve(import.meta.dir, "..");
  const result = await stageRelease({ workspaceRoot, version });
  console.log(`staged → ${path.relative(workspaceRoot, result.releaseDir)}`);
}
