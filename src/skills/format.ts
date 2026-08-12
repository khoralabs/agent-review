import path from "node:path";

import type { SkillRecord } from "./types.ts";

/** Tier-1 catalog: name + description for all discovered skills. */
export function formatSkillCatalog(skills: SkillRecord[]): string {
  if (skills.length === 0) return "";
  const entries = skills
    .map(
      (skill) =>
        `<skill><name>${escapeXml(skill.name)}</name><description>${escapeXml(skill.description)}</description></skill>`,
    )
    .join("\n");
  return `<available_skills>\n${entries}\n</available_skills>`;
}

/** Tier-2 activated skill bodies. */
export function formatActivatedSkills(skills: SkillRecord[]): string {
  if (skills.length === 0) return "";
  return skills
    .map(
      (skill) => `<skill_content name="${escapeXml(skill.name)}">\n${skill.body}\n</skill_content>`,
    )
    .join("\n\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Resolve which discovered skills to activate (tier 2).
 * Matches by path basename / skill name / absolute location.
 */
export function selectActivatedSkills(
  discovered: SkillRecord[],
  activatePaths: string[],
  cwd: string = process.cwd(),
): SkillRecord[] {
  if (activatePaths.length === 0) return [];
  const wanted = new Set<string>();
  for (const raw of activatePaths) {
    const resolved = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    const withoutSkillFile = resolved.replace(/[/\\]SKILL\.md$/i, "");
    wanted.add(path.basename(withoutSkillFile));
    wanted.add(raw);
    wanted.add(resolved);
    wanted.add(withoutSkillFile);
  }

  return discovered.filter((skill) => {
    if (wanted.has(skill.name) || wanted.has(skill.dirName)) return true;
    if (wanted.has(skill.location)) return true;
    const parent = path.dirname(skill.location);
    if (wanted.has(parent)) return true;
    return false;
  });
}
