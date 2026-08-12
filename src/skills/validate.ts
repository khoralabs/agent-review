import path from "node:path";

import type { SkillDiagnostic, SkillFrontmatter } from "./types.ts";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ValidateSkillOptions = {
  /** When true, name/dir mismatch and soft name issues are errors. */
  strict?: boolean;
};

export function validateSkillName(name: string): string | undefined {
  if (name.length === 0 || name.length > 64) {
    return "name must be 1-64 characters";
  }
  if (!NAME_RE.test(name)) {
    return "name must be lowercase alphanumeric with single hyphens (no leading/trailing/consecutive hyphens)";
  }
  return undefined;
}

export function validateSkillDescription(description: string): string | undefined {
  if (description.length === 0 || description.length > 1024) {
    return "description must be 1–1024 characters";
  }
  return undefined;
}

export function validateSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  dirName: string,
  skillPath: string,
  options: ValidateSkillOptions = {},
): SkillDiagnostic[] {
  const strict = options.strict === true;
  const diagnostics: SkillDiagnostic[] = [];

  const nameError = validateSkillName(frontmatter.name);
  if (nameError) {
    diagnostics.push({ level: "error", path: skillPath, message: nameError });
  }

  const descError = validateSkillDescription(frontmatter.description);
  if (descError) {
    diagnostics.push({ level: "error", path: skillPath, message: descError });
  }

  if (frontmatter.name !== dirName) {
    diagnostics.push({
      level: strict ? "error" : "warn",
      path: skillPath,
      message: `name "${frontmatter.name}" does not match parent directory "${dirName}"`,
    });
  }

  if (
    frontmatter.compatibility !== undefined &&
    (frontmatter.compatibility.length === 0 || frontmatter.compatibility.length > 500)
  ) {
    diagnostics.push({
      level: strict ? "error" : "warn",
      path: skillPath,
      message: "compatibility must be 1–500 characters when provided",
    });
  }

  return diagnostics;
}

export function parentDirName(skillMdPath: string): string {
  return path.basename(path.dirname(skillMdPath));
}
