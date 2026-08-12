import type { AgentReviewConfig } from "../config.ts";
import { discoverSkills } from "./discover.ts";
import { formatActivatedSkills, formatSkillCatalog, selectActivatedSkills } from "./format.ts";
import type { SkillDiagnostic, SkillRecord } from "./types.ts";

export type LoadSkillPromptResult = {
  discovered: SkillRecord[];
  activated: SkillRecord[];
  diagnostics: SkillDiagnostic[];
  system: string;
  error?: string;
};

export function formatSkillSystem(discovered: SkillRecord[], activated: SkillRecord[]): string {
  return [formatSkillCatalog(discovered), formatActivatedSkills(activated)]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

/** Discover, activate, and format skill catalog + bodies for agent system prompts. */
export function loadSkillPrompt(
  config: Pick<AgentReviewConfig, "skills" | "skillsDirs">,
  cwd: string,
): LoadSkillPromptResult {
  const discovered = discoverSkills({
    skillPaths: config.skills,
    skillsDirs: config.skillsDirs,
    cwd,
    strictPaths: true,
  });
  const strictErrors = discovered.diagnostics.filter((d) => d.level === "error");
  if (strictErrors.length > 0) {
    return {
      discovered: discovered.skills,
      activated: [],
      diagnostics: discovered.diagnostics,
      system: "",
      error: strictErrors.map((d) => `${d.path}: ${d.message}`).join("\n"),
    };
  }

  const activated = selectActivatedSkills(discovered.skills, config.skills, cwd);
  if (config.skills.length > 0 && activated.length === 0) {
    return {
      discovered: discovered.skills,
      activated,
      diagnostics: discovered.diagnostics,
      system: "",
      error: "configured skills did not resolve to any SKILL.md",
    };
  }

  return {
    discovered: discovered.skills,
    activated,
    diagnostics: discovered.diagnostics,
    system: formatSkillSystem(discovered.skills, activated),
  };
}
