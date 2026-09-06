#!/usr/bin/env bun
/**
 * Publish canonical agent-review skills into khoralabs/skills on CLI release.
 *
 * Clones the skills repo with SKILLS_REPO_TOKEN, replaces `agent-review/` wholesale,
 * writes skill-source.json, and pushes. No-ops when the token is unset.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const SKILLS_REPO = "khoralabs/skills";
export const SKILL_DEST_NAME = "agent-review";
export const SKILL_SOURCE_REL = "skills/agent-review";
export const PACKAGE_NAME = "@khoralabs/agent-review";
export const SOURCE_REPO = "khoralabs/agent-review";

/** Provenance written at `<dest>/skill-source.json`. */
export type SkillSource = {
  sourceRepo: string;
  packageName: string;
  version: string;
  sourceCommit: string;
};

export type SyncSkillDirectoryOptions = {
  sourceDir: string;
  destDir: string;
  skillSource: SkillSource;
};

export type SyncSkillDirectoryResult = {
  /** Absolute path to the written skill-source.json. */
  skillSourcePath: string;
};

/** Replace destDir with a copy of sourceDir and write skill-source.json. */
export function syncSkillDirectory(opts: SyncSkillDirectoryOptions): SyncSkillDirectoryResult {
  const { sourceDir, destDir, skillSource } = opts;
  if (!existsSync(sourceDir)) {
    throw new Error(`missing skill source directory: ${sourceDir}`);
  }
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(path.dirname(destDir), { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });
  const skillSourcePath = path.join(destDir, "skill-source.json");
  writeFileSync(skillSourcePath, `${JSON.stringify(skillSource, null, 2)}\n`);
  return { skillSourcePath };
}

export type PublishSkillsOptions = {
  workspaceRoot: string;
  version: string;
  sourceCommit: string;
  /** Override token (default: process.env.SKILLS_REPO_TOKEN). Empty/unset → no-op. */
  token?: string | undefined;
  /** When set, sync into this existing skills checkout instead of cloning. */
  skillsRepoDir?: string;
};

export type PublishSkillsResult =
  | { status: "skipped"; reason: "token_unset" }
  | { status: "unchanged" }
  | { status: "published"; commitMessage: string };

function resolveToken(opts: PublishSkillsOptions): string | undefined {
  if (opts.token !== undefined) {
    const t = opts.token.trim();
    return t.length === 0 ? undefined : t;
  }
  const env = process.env.SKILLS_REPO_TOKEN?.trim();
  return env !== undefined && env.length > 0 ? env : undefined;
}

/** Prefer header auth so the PAT never appears in clone/push URLs or git stderr. */
export function gitHttpsAuthHeader(token: string): string {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

/** Strip a token from error text in case git still echoes it. */
export function redactSecret(text: string, secret: string): string {
  if (secret.length === 0) return text;
  return text.split(secret).join("***");
}

async function commitAndPushSkillsRepo(opts: {
  skillsRepoDir: string;
  destName: string;
  commitMessage: string;
  push: boolean;
  /** When pushing, authenticate via http.extraheader (never embed in the remote URL). */
  token?: string;
}): Promise<"unchanged" | "published"> {
  const { skillsRepoDir, destName, commitMessage, push, token } = opts;
  await Bun.$`git -C ${skillsRepoDir} config user.name github-actions[bot]`.quiet();
  await Bun.$`git -C ${skillsRepoDir} config user.email 41898282+github-actions[bot]@users.noreply.github.com`.quiet();
  await Bun.$`git -C ${skillsRepoDir} add ${destName}`.quiet();
  const commit = await Bun.$`git -C ${skillsRepoDir} commit -m ${commitMessage}`.nothrow().quiet();
  if (commit.exitCode !== 0) {
    const msg = `${commit.stderr.toString()}${commit.stdout.toString()}`;
    if (msg.includes("nothing to commit") || msg.includes("no changes added")) {
      return "unchanged";
    }
    throw new Error(`skills repo commit failed: ${msg.trim()}`);
  }
  if (push) {
    if (token === undefined) {
      throw new Error("skills repo push requires a token");
    }
    const header = gitHttpsAuthHeader(token);
    const pushResult =
      await Bun.$`git -C ${skillsRepoDir} -c http.https://github.com/.extraheader=${header} push origin HEAD:main`
        .nothrow()
        .quiet();
    if (pushResult.exitCode !== 0) {
      throw new Error(
        `skills repo push failed: ${redactSecret(pushResult.stderr.toString().trim(), token)}`,
      );
    }
  }
  return "published";
}

/** Publish skills into khoralabs/skills (or a local checkout for tests). */
export async function publishSkills(opts: PublishSkillsOptions): Promise<PublishSkillsResult> {
  const sourceDir = path.join(opts.workspaceRoot, SKILL_SOURCE_REL);
  if (!existsSync(sourceDir)) {
    throw new Error(`missing skill source directory: ${sourceDir}`);
  }

  const skillSource: SkillSource = {
    sourceRepo: SOURCE_REPO,
    packageName: PACKAGE_NAME,
    version: opts.version,
    sourceCommit: opts.sourceCommit,
  };
  const commitMessage = `chore(skills): ${PACKAGE_NAME}@${opts.version}`;

  if (opts.skillsRepoDir !== undefined) {
    const destDir = path.join(opts.skillsRepoDir, SKILL_DEST_NAME);
    syncSkillDirectory({ sourceDir, destDir, skillSource });
    const outcome = await commitAndPushSkillsRepo({
      skillsRepoDir: opts.skillsRepoDir,
      destName: SKILL_DEST_NAME,
      commitMessage,
      push: false,
    });
    return outcome === "unchanged"
      ? { status: "unchanged" }
      : { status: "published", commitMessage };
  }

  const token = resolveToken(opts);
  if (token === undefined) {
    console.log("SKILLS_REPO_TOKEN not set; skills publish skipped");
    return { status: "skipped", reason: "token_unset" };
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "khoralabs-skills-"));
  try {
    const header = gitHttpsAuthHeader(token);
    const cloneUrl = `https://github.com/${SKILLS_REPO}.git`;
    const clone =
      await Bun.$`git -c http.https://github.com/.extraheader=${header} clone ${cloneUrl} ${tmp}`
        .nothrow()
        .quiet();
    if (clone.exitCode !== 0) {
      const detail = redactSecret(
        clone.stderr.toString().trim() || clone.stdout.toString().trim(),
        token,
      );
      throw new Error(`failed to clone ${SKILLS_REPO}: ${detail}`);
    }
    syncSkillDirectory({
      sourceDir,
      destDir: path.join(tmp, SKILL_DEST_NAME),
      skillSource,
    });
    const outcome = await commitAndPushSkillsRepo({
      skillsRepoDir: tmp,
      destName: SKILL_DEST_NAME,
      commitMessage,
      push: true,
      token,
    });
    if (outcome === "unchanged") {
      console.log(`${SKILLS_REPO} ${SKILL_DEST_NAME}/ already at ${PACKAGE_NAME}@${opts.version}`);
      return { status: "unchanged" };
    }
    console.log(`pushed ${SKILLS_REPO} ${SKILL_DEST_NAME}/ (${commitMessage})`);
    return { status: "published", commitMessage };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function readSourceCommit(workspaceRoot: string): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

if (import.meta.main) {
  const version = process.argv[2];
  if (version === undefined || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    console.error("usage: publish-skills.ts <semver>");
    process.exit(1);
  }
  const workspaceRoot = path.resolve(import.meta.dir, "..");
  const sourceCommit = readSourceCommit(workspaceRoot);
  await publishSkills({ workspaceRoot, version, sourceCommit });
}
