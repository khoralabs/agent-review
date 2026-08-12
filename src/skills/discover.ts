import fs from "node:fs";
import path from "node:path";

import { parseSkillMarkdown } from "./parse.ts";
import type { SkillDiagnostic, SkillRecord } from "./types.ts";

export type DiscoverSkillsOptions = {
  /** Extra skill directories to activate/discover (each is a skill root containing SKILL.md). */
  skillPaths?: string[];
  /** Roots whose immediate children are skill directories. */
  skillsDirs?: string[];
  cwd?: string;
  strictPaths?: boolean;
};

export type DiscoverSkillsResult = {
  skills: SkillRecord[];
  diagnostics: SkillDiagnostic[];
};

function resolvePath(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

function loadSkillAt(
  skillMdPath: string,
  diagnostics: SkillDiagnostic[],
  byName: Map<string, SkillRecord>,
  strict: boolean,
): void {
  if (!fs.existsSync(skillMdPath) || !fs.statSync(skillMdPath).isFile()) {
    diagnostics.push({
      level: strict ? "error" : "warn",
      path: skillMdPath,
      message: "SKILL.md not found",
    });
    return;
  }

  const text = fs.readFileSync(skillMdPath, "utf8");
  const parsed = parseSkillMarkdown(text, skillMdPath, { strict });
  diagnostics.push(...parsed.diagnostics);
  if (!parsed.ok) return;

  const existing = byName.get(parsed.skill.name);
  if (existing) {
    diagnostics.push({
      level: "warn",
      path: skillMdPath,
      message: `skill name "${parsed.skill.name}" collides with ${existing.location}; keeping first`,
    });
    return;
  }
  byName.set(parsed.skill.name, parsed.skill);
}

/**
 * Discover Agent Skills directories.
 * Explicit skill paths are loaded strictly; skillsDirs children are lenient.
 */
export function discoverSkills(options: DiscoverSkillsOptions = {}): DiscoverSkillsResult {
  const cwd = options.cwd ?? process.cwd();
  const diagnostics: SkillDiagnostic[] = [];
  const byName = new Map<string, SkillRecord>();

  for (const skillPath of options.skillPaths ?? []) {
    const resolved = resolvePath(cwd, skillPath);
    const skillMd = resolved.endsWith("SKILL.md") ? resolved : path.join(resolved, "SKILL.md");
    loadSkillAt(skillMd, diagnostics, byName, options.strictPaths !== false);
  }

  for (const dir of options.skillsDirs ?? []) {
    const root = resolvePath(cwd, dir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      diagnostics.push({
        level: "warn",
        path: root,
        message: "skills directory does not exist",
      });
      continue;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      loadSkillAt(path.join(root, entry.name, "SKILL.md"), diagnostics, byName, false);
    }
  }

  return { skills: [...byName.values()], diagnostics };
}
